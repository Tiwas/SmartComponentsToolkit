"use strict";

const Homey = require("homey");
const Logger = require("../../lib/Logger");
const {
  getOperationsForType,
  getOutputSpec,
  normalizeSourceType,
} = require("../../lib/CompositeAggregator");

/**
 * CompositeDeviceDriver - Pairs virtual devices that aggregate one capability
 * from multiple Homey devices.
 *
 * The pairing view first selects a shared capability signature, then an
 * operation and at least two source devices. The resulting immutable
 * configuration is stored in the device store while the visible output
 * capability is selected dynamically for number, boolean, or text results.
 *
 * Called by:
 *   - Homey runtime - Driver initialization and pairing sessions
 *   - pair/configure.html - Pairing event handlers
 *
 * Calls:
 *   - Homey API - Discover devices, zones, and live capability metadata
 *   - CompositeAggregator - Validate operations and derive output capabilities
 */
module.exports = class CompositeDeviceDriver extends Homey.Driver {
  /**
   * Initialize the Composite Device driver.
   *
   * @returns {Promise<void>} Resolves after logger initialization.
   */
  async onInit() {
    this.logger = new Logger(this, `Driver: ${this.id}`);
    this.logger.info("Composite Device driver initialized");
  }

  /**
   * Resolve a localized API value such as a capability title or unit.
   *
   * @param {unknown} value - String or localization object.
   * @param {string} fallback - Fallback value.
   * @returns {string} Localized string.
   */
  localizeValue(value, fallback = "") {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return fallback;
    const language = this.homey.i18n?.getLanguage?.() || "en";
    return String(value[language] || value.en || Object.values(value)[0] || fallback);
  }

  /**
   * Infer a supported capability type when the API omits explicit metadata.
   *
   * @param {object} capability - Homey capability object.
   * @returns {string|null} number, boolean, string, enum, or null.
   */
  getCapabilityType(capability) {
    if (["number", "boolean", "string", "enum"].includes(capability?.type)) {
      return capability.type;
    }
    const valueType = typeof capability?.value;
    return ["number", "boolean", "string"].includes(valueType) ? valueType : null;
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
   * Discover capability groups shared by at least two devices.
   *
   * A group is keyed by capability id, type, and unit to prevent unrelated
   * custom capabilities with the same id from being mixed accidentally.
   *
   * @returns {Promise<Map<string, object>>} Capability group map.
   */
  async discoverCapabilityGroups() {
    const api = await this.getHomeyApi();
    if (!api?.devices?.getDevices || !api?.zones?.getZones) {
      throw new Error("Homey API is not ready. Please try again in a few seconds.");
    }

    const [allDevices, allZones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones(),
    ]);
    const groupsBySignature = new Map();

    Object.values(allDevices || {}).forEach(homeyDevice => {
      if (!homeyDevice?.id || !homeyDevice.capabilitiesObj) return;
      const zoneName = allZones?.[homeyDevice.zone]?.name || "Unknown zone";

      Object.entries(homeyDevice.capabilitiesObj).forEach(([capabilityId, capability]) => {
        if (capabilityId === "alarm_config" || capability?.getable === false) return;
        const sourceType = this.getCapabilityType(capability);
        if (!sourceType) return;

        const normalizedType = normalizeSourceType(sourceType);
        if (getOperationsForType(normalizedType).length === 0) return;

        const units = this.localizeValue(capability.units, "");
        const signature = JSON.stringify([capabilityId, normalizedType, units]);
        let group = groupsBySignature.get(signature);
        if (!group) {
          group = {
            signature,
            capabilityId,
            sourceType,
            normalizedType,
            title: this.localizeValue(capability.title, capabilityId),
            units,
            decimals: Number.isFinite(capability.decimals) ? capability.decimals : 0,
            devices: [],
          };
          groupsBySignature.set(signature, group);
        }

        group.devices.push({
          id: homeyDevice.id,
          name: homeyDevice.name || homeyDevice.id,
          zoneName,
          value: capability.value,
          updatedAt: capability.lastUpdated
            ? new Date(capability.lastUpdated).getTime()
            : 0,
        });
      });
    });

    const groups = new Map();
    [...groupsBySignature.values()]
      .filter(group => group.devices.length >= 2)
      .sort((left, right) => (
        left.title.localeCompare(right.title)
        || left.capabilityId.localeCompare(right.capabilityId)
      ))
      .forEach((group, index) => {
        group.id = `capability-${index}`;
        group.devices.sort((left, right) => (
          left.name.localeCompare(right.name)
          || left.zoneName.localeCompare(right.zoneName)
        ));
        groups.set(group.id, group);
      });

    return groups;
  }

  /**
   * Build per-device capability options for the dynamically selected output.
   *
   * @param {object} outputSpec - Output metadata from CompositeAggregator.
   * @returns {object} Homey pairing capability options.
   */
  createCapabilityOptions(outputSpec) {
    const title = {
      en: outputSpec.title,
      no: outputSpec.title,
    };
    const options = {
      [outputSpec.capabilityId]: {
        title,
        getable: true,
        setable: false,
      },
      alarm_config: {
        title: {
          en: "Source Error",
          no: "Kildefeil",
        },
        getable: true,
        setable: false,
      },
    };

    if (outputSpec.outputType === "number") {
      options[outputSpec.capabilityId].decimals = outputSpec.decimals;
      options[outputSpec.capabilityId].units = {
        en: outputSpec.units,
        no: outputSpec.units,
      };
    } else if (outputSpec.outputType === "boolean") {
      options[outputSpec.capabilityId].titleTrue = { en: "Yes", no: "Ja" };
      options[outputSpec.capabilityId].titleFalse = { en: "No", no: "Nei" };
    }

    return options;
  }

  /**
   * Register custom pairing handlers.
   *
   * @param {object} session - Homey pairing session.
   * @returns {Promise<void>} Resolves after handlers are registered.
   */
  async onPair(session) {
    this.logger.info("Composite Device pairing started");
    let capabilityGroups = new Map();

    session.setHandler("get_capability_groups", async () => {
      capabilityGroups = await this.discoverCapabilityGroups();
      return [...capabilityGroups.values()].map(group => ({
        id: group.id,
        capabilityId: group.capabilityId,
        title: group.title,
        units: group.units,
        sourceType: group.sourceType,
        deviceCount: group.devices.length,
        operations: getOperationsForType(group.sourceType),
      }));
    });

    session.setHandler("get_devices_for_capability", async (data = {}) => {
      const group = capabilityGroups.get(data.groupId);
      if (!group) throw new Error("Select a valid capability first.");
      return group.devices.map(device => ({ ...device }));
    });

    session.setHandler("create_device", async (data = {}) => {
      const group = capabilityGroups.get(data.groupId);
      if (!group) throw new Error("The selected capability is no longer available.");

      const selectedIds = new Set(Array.isArray(data.selectedIds) ? data.selectedIds : []);
      const selectedDevices = group.devices.filter(device => selectedIds.has(device.id));
      if (selectedDevices.length < 2) {
        throw new Error("Select at least two source devices.");
      }

      const outputSpec = getOutputSpec(group.sourceType, data.operation, group);
      const name = String(data.name || "").trim();
      if (!name) throw new Error("Enter a device name.");

      const configuration = {
        version: 1,
        capabilityId: group.capabilityId,
        sourceType: group.sourceType,
        operation: data.operation,
        outputCapability: outputSpec.capabilityId,
        sourceMetadata: {
          title: group.title,
          units: group.units,
          decimals: group.decimals,
        },
        sources: selectedDevices.map(device => ({
          id: device.id,
          name: device.name,
          zoneName: device.zoneName,
        })),
      };

      return {
        name,
        class: "sensor",
        icon: "/icon.svg",
        data: {
          id: `composite-device-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        },
        store: {
          composite_config: configuration,
        },
        capabilities: [outputSpec.capabilityId, "alarm_config"],
        capabilitiesOptions: this.createCapabilityOptions(outputSpec),
      };
    });
  }
};
