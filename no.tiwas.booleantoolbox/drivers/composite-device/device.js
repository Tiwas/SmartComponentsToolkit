"use strict";

const Homey = require("homey");
const Logger = require("../../lib/Logger");
const { aggregateEntries } = require("../../lib/CompositeAggregator");

/**
 * CompositeDevice - Keeps a virtual aggregate capability synchronized with
 * multiple source devices.
 *
 * Source values are fetched at startup, updated through realtime capability
 * listeners, and periodically refreshed to recover from removed or restarted
 * source devices. Available values continue contributing when another source
 * is missing; alarm_config exposes partial-source failures.
 *
 * Called by:
 *   - Homey runtime - Device lifecycle
 *   - Homey API capability instances - Realtime source updates
 *
 * Calls:
 *   - CompositeAggregator.aggregateEntries() - Calculate the output value
 *   - Homey API - Fetch source devices and subscribe to capabilities
 */
module.exports = class CompositeDevice extends Homey.Device {
  /**
   * Initialize source state, listeners, and periodic recovery.
   *
   * @returns {Promise<void>} Resolves after the initial aggregate is calculated.
   */
  async onInit() {
    this.logger = new Logger(this, `Device: ${this.driver.id}`);
    this._isDeleting = false;
    this.sourceListeners = new Map();
    this.sourceStates = new Map();
    this.hasAggregateValue = false;
    this.lastAggregateValue = undefined;
    this.configuration = this.getStoreValue("composite_config");

    if (!this.isConfigurationValid(this.configuration)) {
      await this.setSourceAlarm(true);
      await this.setUnavailable("Composite Device configuration is missing or invalid.")
        .catch(() => {});
      this.logger.error("Composite Device configuration is missing or invalid");
      return;
    }

    if (!this.hasCapability(this.configuration.outputCapability)) {
      await this.addCapability(this.configuration.outputCapability);
    }
    if (!this.hasCapability("alarm_config")) {
      await this.addCapability("alarm_config");
    }

    await this.refreshSources();
    this.refreshTimer = setInterval(() => {
      this.refreshSources().catch(error => {
        if (!this._isDeleting) {
          this.logger.error(`Composite source refresh failed: ${error.message}`);
        }
      });
    }, 5 * 60 * 1000);

    this.logger.info(
      `Composite Device initialized with ${this.configuration.sources.length} sources`,
    );
  }

  /**
   * Validate the immutable pairing configuration.
   *
   * @param {object} configuration - Stored Composite Device configuration.
   * @returns {boolean} True when required fields and sources exist.
   */
  isConfigurationValid(configuration) {
    return Boolean(
      configuration
      && configuration.capabilityId
      && configuration.sourceType
      && configuration.operation
      && configuration.outputCapability
      && Array.isArray(configuration.sources)
      && configuration.sources.length >= 2
      && configuration.sources.every(source => source?.id),
    );
  }

  /**
   * Get the Homey API initialized by the app.
   *
   * @returns {Promise<object|null>} Homey API instance when available.
   */
  async getHomeyApi() {
    const app = this.homey?.app;
    if (app && typeof app.ensureHomeyApi === "function") {
      return app.ensureHomeyApi();
    }
    return app?.api || null;
  }

  /**
   * Convert API update timestamps to milliseconds for newest-value selection.
   *
   * @param {unknown} value - Date, string, number, or null.
   * @returns {number} Timestamp in milliseconds, or zero when absent.
   */
  normalizeTimestamp(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  /**
   * Destroy the realtime listener for one source.
   *
   * @param {string} sourceId - Homey device id.
   * @returns {void}
   */
  destroySourceListener(sourceId) {
    const listener = this.sourceListeners.get(sourceId);
    if (!listener) return;
    try {
      listener.destroy();
    } catch (error) {
      this.logger.debug(`Could not destroy listener for ${sourceId}: ${error.message}`);
    }
    this.sourceListeners.delete(sourceId);
  }

  /**
   * Fetch all current source values and create any missing realtime listeners.
   *
   * @returns {Promise<void>} Resolves after recalculating the aggregate.
   */
  async refreshSources() {
    if (this._isDeleting || !this.configuration) return;
    const api = await this.getHomeyApi();
    if (!api?.devices?.getDevice) {
      this.configuration.sources.forEach(source => {
        this.sourceStates.set(source.id, {
          value: null,
          updatedAt: 0,
          error: "Homey API unavailable",
        });
      });
      await this.recalculate();
      return;
    }

    await Promise.all(this.configuration.sources.map(async source => {
      try {
        const targetDevice = await api.devices.getDevice({ id: source.id });
        const capability = targetDevice?.capabilitiesObj?.[this.configuration.capabilityId];
        if (!targetDevice || !capability) {
          throw new Error("Device or capability not found");
        }

        this.sourceStates.set(source.id, {
          value: capability.value,
          updatedAt: this.normalizeTimestamp(capability.lastUpdated),
          error: null,
        });

        if (!this.sourceListeners.has(source.id)) {
          const capabilityInstance = targetDevice.makeCapabilityInstance(
            this.configuration.capabilityId,
            (value, instance) => {
              this.handleSourceUpdate(source, value, instance).catch(error => {
                if (!this._isDeleting) {
                  this.logger.error(`Composite update failed for ${source.name}: ${error.message}`);
                }
              });
            },
          );
          capabilityInstance.once?.("destroy", () => {
            if (this.sourceListeners.get(source.id) === capabilityInstance) {
              this.sourceListeners.delete(source.id);
            }
          });
          this.sourceListeners.set(source.id, capabilityInstance);
        }
      } catch (error) {
        this.destroySourceListener(source.id);
        this.sourceStates.set(source.id, {
          value: null,
          updatedAt: 0,
          error: error.message,
        });
        this.logger.warn(`Composite source '${source.name || source.id}' unavailable: ${error.message}`);
      }
    }));

    await this.recalculate();
  }

  /**
   * Apply one realtime source update and recalculate the output.
   *
   * @param {object} source - Stored source metadata.
   * @param {boolean|number|string|null} value - New capability value.
   * @param {object} instance - Homey capability instance.
   * @returns {Promise<void>} Resolves after updating the output.
   */
  async handleSourceUpdate(source, value, instance) {
    if (this._isDeleting) return;
    this.sourceStates.set(source.id, {
      value,
      updatedAt: this.normalizeTimestamp(instance?.lastChanged) || Date.now(),
      error: null,
    });
    await this.recalculate();
  }

  /**
   * Safely set one capability value when the device still exists.
   *
   * @param {string} capabilityId - Output capability id.
   * @param {boolean|number|string} value - New value.
   * @returns {Promise<void>} Resolves after the Homey capability is updated.
   */
  async safeSetCapabilityValue(capabilityId, value) {
    if (this._isDeleting || !this.hasCapability(capabilityId)) return;
    const currentValue = this.getCapabilityValue(capabilityId);
    if (Object.is(currentValue, value)) return;
    try {
      await this.setCapabilityValue(capabilityId, value);
    } catch (error) {
      const message = error?.message || "";
      if (error?.statusCode === 404 || /not\s*found/i.test(message)) return;
      throw error;
    }
  }

  /**
   * Update the partial-source error alarm.
   *
   * @param {boolean} value - Alarm state.
   * @returns {Promise<void>} Resolves after the alarm update.
   */
  async setSourceAlarm(value) {
    await this.safeSetCapabilityValue("alarm_config", value === true).catch(error => {
      if (this.logger) this.logger.warn(`Could not set Composite source alarm: ${error.message}`);
    });
  }

  /**
   * Convert any supported aggregate value to a stable Flow token string.
   *
   * @param {boolean|number|string} value - Composite output value.
   * @returns {string} String representation for the universal change card.
   */
  formatFlowValue(value) {
    return typeof value === "string" ? value : String(value);
  }

  /**
   * Calculate the absolute percentage change relative to the previous value.
   *
   * A non-zero value following zero is represented as 100 percent so Homey
   * receives a finite number token and percentage thresholds remain useful.
   *
   * @param {number} previousValue - Previous numeric aggregate.
   * @param {number} value - Current numeric aggregate.
   * @returns {number} Absolute percentage change.
   */
  calculatePercentageChange(previousValue, value) {
    const absoluteChange = Math.abs(value - previousValue);
    if (previousValue === 0) return absoluteChange === 0 ? 0 : 100;
    return (absoluteChange / Math.abs(previousValue)) * 100;
  }

  /**
   * Trigger the universal change card and, for numeric output, the threshold
   * card. Trigger errors are logged without invalidating the aggregate value.
   *
   * @param {boolean|number|string} previousValue - Previous aggregate value.
   * @param {boolean|number|string} value - Current aggregate value.
   * @returns {Promise<void>} Resolves after all applicable triggers settle.
   */
  async triggerValueChanged(previousValue, value) {
    const deviceName = typeof this.getName === "function"
      ? this.getName()
      : "Composite Device";
    const valueType = typeof value;
    const triggers = [];
    const queueTrigger = (cardId, tokens, state) => {
      try {
        const card = this.homey?.flow?.getDeviceTriggerCard?.(cardId);
        if (card?.trigger) {
          triggers.push(Promise.resolve(card.trigger(this, tokens, state)));
        }
      } catch (error) {
        if (this.logger) {
          this.logger.warn(`Could not trigger Composite value Flow: ${error.message}`);
        }
      }
    };

    queueTrigger(
      "composite_value_changed",
      {
        value: this.formatFlowValue(value),
        previous_value: this.formatFlowValue(previousValue),
        value_type: valueType,
        device_name: deviceName,
      },
      { value_type: valueType },
    );

    if (
      typeof previousValue === "number"
      && Number.isFinite(previousValue)
      && typeof value === "number"
      && Number.isFinite(value)
    ) {
      const change = value - previousValue;
      const absoluteChange = Math.abs(change);
      const percentageChange = this.calculatePercentageChange(previousValue, value);
      queueTrigger(
        "composite_value_changed_larger_than",
        {
          value,
          previous_value: previousValue,
          change,
          absolute_change: absoluteChange,
          percentage_change: percentageChange,
          device_name: deviceName,
        },
        {
          absolute_change: absoluteChange,
          percentage_change: percentageChange,
        },
      );
    }

    const results = await Promise.allSettled(triggers);
    results.forEach(result => {
      if (result.status === "rejected" && this.logger) {
        this.logger.warn(`Could not trigger Composite value Flow: ${result.reason?.message || result.reason}`);
      }
    });
  }

  /**
   * Recalculate the Composite Device output from all valid source values.
   *
   * @returns {Promise<boolean>} True when an aggregate value was produced.
   */
  async recalculate() {
    if (this._isDeleting || !this.configuration) return false;
    const entries = this.configuration.sources.map(source => {
      const state = this.sourceStates.get(source.id) || {};
      return {
        value: state.value,
        updatedAt: state.updatedAt,
      };
    });

    try {
      const result = aggregateEntries(
        entries,
        this.configuration.sourceType,
        this.configuration.operation,
      );
      const previousValue = this.lastAggregateValue;
      const shouldTrigger = this.hasAggregateValue && !Object.is(previousValue, result.value);
      await this.safeSetCapabilityValue(this.configuration.outputCapability, result.value);
      this.lastAggregateValue = result.value;
      this.hasAggregateValue = true;
      await this.setSourceAlarm(result.count < this.configuration.sources.length);
      await this.setAvailable().catch(() => {});
      if (shouldTrigger) {
        await this.triggerValueChanged(previousValue, result.value);
      }
      return true;
    } catch (error) {
      await this.setSourceAlarm(true);
      await this.setUnavailable(error.message).catch(() => {});
      this.logger.warn(`Composite value unavailable: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean up timers and realtime listeners when Homey removes the device.
   *
   * @returns {Promise<void>} Resolves after cleanup.
   */
  async onDeleted() {
    this._isDeleting = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    [...this.sourceListeners.keys()].forEach(sourceId => {
      this.destroySourceListener(sourceId);
    });
    this.sourceStates.clear();
    this.logger.info("Composite Device deleted and listeners cleaned up");
  }
};
