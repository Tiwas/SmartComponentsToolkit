"use strict";

const FormulaEvaluator = require("../../lib/FormulaEvaluator");
const Homey = require("homey");
const Logger = require("../../lib/Logger");

/**
 * LogicDeviceDevice - Dynamic Logic Device with linked inputs
 *
 * Unlike Logic Units which have fixed inputs set via flow cards, Logic Devices
 * can link their inputs directly to capabilities of other Homey devices. When
 * a linked capability changes, the formula is automatically re-evaluated.
 *
 * Key Features:
 * - Dynamic input linking to other device capabilities
 * - Automatic capability listeners for real-time updates
 * - Settings-based configuration (JSON for formulas and input_links)
 * - Supports only ONE formula (use Logic Units for multiple formulas)
 * - onoff capability controls enable/disable state
 * - alarm_generic shows formula result
 * - alarm_config shows configuration error state
 *
 * Called by:
 *   - Homey runtime - Device lifecycle management
 *   - Flow cards - Via handler methods
 *   - Capability listeners - On linked device changes
 *
 * Calls:
 *   - FormulaEvaluator - For secure AST-based formula evaluation
 *   - Logger - For logging operations
 *   - Homey API - For device queries and capability listeners
 *
 * @class LogicDeviceDevice
 * @extends Homey.Device
 */
module.exports = class LogicDeviceDevice extends Homey.Device {
  async onInit() {
    const driverName = `Device: ${this.driver.id}`;
    this.logger = new Logger(this, driverName);

    // Initialize AST-based formula evaluator for secure evaluation
    this.formulaEvaluator = new FormulaEvaluator();
    this.logger.info("🔐 AST-based secure formula evaluation enabled");

    this.logger.device("device.initializing", {
      name: this.getName(),
    });

    // ✅ STEP 1: Add capabilities FIRST, before anything else
    if (!this.hasCapability("onoff")) {
      await this.addCapability("onoff");
    }

    if (!this.hasCapability("alarm_generic")) {
      await this.addCapability("alarm_generic");
    }

    if (!this.hasCapability("alarm_config")) {
      await this.addCapability("alarm_config");
    }

    // ✅ STEP 2: Initialize device enabled state from onoff capability
    // onoff = user control (ON/OFF), NOT formula output
    // alarm_generic = formula output (TRUE/FALSE)
    let onoffValue = this.getCapabilityValue("onoff");
    
    // Only handle null/undefined (safety check)
    if (onoffValue === null || onoffValue === undefined) {
      // Default to enabled for new devices (also set via capabilityValues in driver.js)
      this.logger.info("⚠️  onoff value is null/undefined, defaulting to enabled (true)");
      await this.setCapabilityValue("onoff", true);
      onoffValue = true;
    }
    
    this.deviceEnabled = onoffValue === true;
    this.logger.info(`📊 Logic Device state: ${this.deviceEnabled ? 'ENABLED' : 'DISABLED'} (user can toggle, state is remembered)`);

    // ✅ STEP 3: Set capability options
    try {
      await this.setCapabilityOptions("onoff", {
        setable: true, // CHANGED: User can now turn device on/off
        getable: true,
      });

      this.logger.debug("device.capability_readonly");
    } catch (e) {
      this.logger.warn("device.capability_options_failed", {
        message: e.message,
      });
    }

    // ✅ STEP 4: NOW we can safely run the rest of initialization
    const settings = this.getSettings();
    const detectedInputs = this.detectRequiredInputs(settings);

    const originalNumInputs = this.getData().numInputs || 2;
    this.numInputs = Math.max(detectedInputs, originalNumInputs);

    if (detectedInputs > originalNumInputs) {
      this.logger.info("device.capacity_expanded", {
        detected: detectedInputs,
        original: originalNumInputs,
      });
    }

    this.availableInputs = this.getAvailableInputIds();
    this.deviceListeners = new Map();
    this.pollingIntervals = new Map();

    // Register on/off capability listener to enable/disable device
    this.registerCapabilityListener("onoff", async (value) => {
      this.deviceEnabled = value;
      this.logger.info(`🔌 Device ${value ? "enabled" : "disabled"}`, {});

      if (value) {
        // Device enabled - re-evaluate formula
        await this.evaluateAllFormulasInitial();
        this.startTimeoutChecks();
        this.logger.info("✅ Device enabled - evaluations resumed");
        
        // Fire on-state trigger for enabling device
        await this.fireAllRelevantTriggers(
          null, // newAlarmState (will be set by formula evaluation)
          true, // newOnState (device was turned on)
          null, // previousAlarmState
          false // previousOnState (was off before)
        );
      } else {
        // Device disabled - stop timeout checks and clear alarm
        if (this.timeoutInterval) {
          clearInterval(this.timeoutInterval);
          this.timeoutInterval = null;
        }
        const previousAlarmState = this.getCapabilityValue("alarm_generic");
        await this.setCapabilityValue("alarm_generic", false).catch(() => {});
        
        // Fire triggers for on/off state change
        const previousOnState = !value; // Previous state is opposite of new value
        await this.fireAllRelevantTriggers(
          false,            // newAlarmState (set to false when disabled)
          value,            // newOnState (the new on/off state)
          previousAlarmState, // previousAlarmState
          previousOnState   // previousOnState
        );
        this.logger.info("⏸️  Device disabled - evaluations stopped");
      }

      return true;
    });

    await this.initializeFormulas();
    await this.setupDeviceLinks();

    // Validate configuration and set alarm_config
    await this.updateConfigAlarm();

    this.logger.debug("evaluation.running_initial");
    await this.evaluateAllFormulasInitial();

    this.startTimeoutChecks();

    // Store current formulas and input_links for change detection
    const currentSettings = this.getSettings();
    this.lastKnownFormulas = currentSettings.formulas;
    this.lastKnownInputLinks = currentSettings.input_links;

    // Poll settings every 5 seconds to detect changes (since onSettings doesn't fire for textarea)
    this.settingsPoller = setInterval(async () => {
      try {
        await this.checkSettingsChanged();
      } catch (error) {
        this.logger.error("Error checking settings", { error: error.message });
      }
    }, 5000);

    this.logger.info("device.initialized", {
      name: this.getName(),
      count: this.numInputs,
    });
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.logger.info("🔧 onSettings called", {
      changedKeys: changedKeys.join(", "),
    });

    try {
      // Validate formulas
      if (changedKeys.includes("formulas")) {
        this.logger.info("📝 Validating formulas...");

        let formulas;
        try {
          formulas = JSON.parse(newSettings.formulas);
          this.logger.info(`📊 Parsed ${formulas.length} formula(s)`);
        } catch (e) {
          this.logger.error("❌ JSON parse error", { error: e.message });
          throw new Error(
            this.homey.__("settings.invalid_json", {
              field: "formulas",
              error: e.message,
            }),
          );
        }

        // IMPORTANT: Limit to one formula for Logic Device
        if (formulas.length > 1) {
          this.logger.error(`❌ TOO MANY FORMULAS: ${formulas.length} formulas found, but Logic Device only supports 1`);
          throw new Error(
            "Logic Device kan kun ha én formel. " +
              "For flere formler, bruk Logic Unit (Dynamic) i stedet.",
          );
        }

        this.logger.info("✅ Formula count validation passed");

        // Valider hver formel
        for (const formula of formulas) {
          // Sjekk at ID er gyldig
          if (!formula.id || !/^[a-zA-Z0-9_-]+$/.test(formula.id)) {
            throw new Error(
              `Ugyldig formel-ID: "${formula.id}". ` +
                "ID må bare inneholde bokstaver, tall, bindestrek og understrek.",
            );
          }

          // Valider expression
          if (formula.expression) {
            const validation = this.validateExpression(formula.expression);
            if (!validation.valid) {
              throw new Error(
                `Ugyldig formel "${formula.name}": ${validation.error}`,
              );
            }
          }
        }

        // Sjekk for duplikate ID-er
        const ids = formulas.map((f) => f.id);
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
          throw new Error(
            "Duplikate formel-ID-er funnet. Hver formel må ha unik ID.",
          );
        }
      }

      // Valider input_links
      if (changedKeys.includes("input_links")) {
        let inputLinks;
        try {
          inputLinks = JSON.parse(newSettings.input_links);
        } catch (e) {
          throw new Error(
            this.homey.__("settings.invalid_json", {
              field: "input_links",
              error: e.message,
            }),
          );
        }

        // Valider at hver input bare er linket én gang
        const inputCounts = {};
        for (const link of inputLinks) {
          const input = link.input?.toLowerCase();
          if (input) {
            inputCounts[input] = (inputCounts[input] || 0) + 1;
            if (inputCounts[input] > 1) {
              throw new Error(
                `Input "${input.toUpperCase()}" er linket flere ganger. ` +
                  "Hver input kan bare linkes til én enhet/capability.",
              );
            }
          }
        }
      }

      // Hvis alt er OK, fortsett med å oppdatere innstillinger
      this.logger.info("settings.validated_successfully");

      // Re-initialiser enheten med nye innstillinger
      await this.initializeFormulas();
      await this.setupDeviceLinks();

      // Update alarm_config based on validation
      await this.updateConfigAlarm();

      await this.refetchAndEvaluate("settings_changed");

      return true;
    } catch (error) {
      this.logger.error("settings.validation_failed", {
        message: error.message,
      });

      // Set alarm_config to true to show error visually
      try {
        const previousAlarmConfig = this.getCapabilityValue("alarm_config");
        await this.setCapabilityValue("alarm_config", true);

        // Trigger flow cards if state changed
        if (previousAlarmConfig !== true) {
          await this.triggerConfigAlarmChanged(true);
        }
      } catch (e) {
        this.logger.error("Failed to set alarm_config during validation error", {
          error: e.message,
        });
      }

      throw error;
    }
  }

  async checkSettingsChanged() {
    const currentSettings = this.getSettings();
    const currentFormulas = currentSettings.formulas;
    const currentInputLinks = currentSettings.input_links;

    // Check if formulas or input_links have changed
    if (this.lastKnownFormulas !== currentFormulas || this.lastKnownInputLinks !== currentInputLinks) {
      this.logger.info("⚙️  Settings changed detected, reloading and validating...");

      // Update stored values
      this.lastKnownFormulas = currentFormulas;
      this.lastKnownInputLinks = currentInputLinks;

      // Reinitialize formulas and validate
      await this.initializeFormulas();
      await this.setupDeviceLinks();

      // This will update the alarm_config capability
      await this.updateConfigAlarm();

      // Re-evaluate formulas with new settings
      await this.refetchAndEvaluate("settings_changed");

      this.logger.debug("✅ Settings reloaded and validated");
    }
  }

  getAvailableInputIds() {
    const allInputs = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    return allInputs.slice(0, this.numInputs);
  }

  getAvailableInputsUppercase() {
    return this.availableInputs.map((i) => i.toUpperCase());
  }

  detectRequiredInputs(settings) {
    let maxInput = 2; // Default minimum

    try {
      const formulasData = settings.formulas
        ? JSON.parse(settings.formulas)
        : [];

      formulasData.forEach((formula) => {
        if (!formula.expression) return;

        const pattern = /\b([A-J])\b/gi;
        const matches = formula.expression.match(pattern);

        if (matches) {
          matches.forEach((letter) => {
            const inputNumber = letter.toUpperCase().charCodeAt(0) - 64; // A=1, B=2
            maxInput = Math.max(maxInput, inputNumber);
          });
        }
      });

      const inputLinks = settings.input_links
        ? JSON.parse(settings.input_links)
        : [];

      inputLinks.forEach((link) => {
        if (link.input) {
          const inputNumber = link.input.toLowerCase().charCodeAt(0) - 96; // a=1, b=2
          maxInput = Math.max(maxInput, inputNumber);
        }
      });

      this.logger.debug("device.max_input_detected", {
        input: String.fromCharCode(64 + maxInput),
        count: maxInput,
      });
    } catch (e) {
      this.logger.error("parse.error_detecting_inputs", {
        message: e.message,
      });
    }

    return maxInput;
  }

  async initializeFormulas() {
    const settings = this.getSettings();
    try {
      const formulasData = settings.formulas
        ? JSON.parse(settings.formulas)
        : [];

      // IMPORTANT: Logic Device can ONLY have one formula
      if (formulasData.length > 1) {
        this.logger.warn(
          "⚠️  Logic Device can only have one formula. Using only the first one.",
          {
            found: formulasData.length,
          },
        );
        // Behold kun den første formelen
        formulasData.splice(1);
      }

      this.formulas = formulasData.map((f) => ({
        id: f.id,
        name: f.name,
        expression: f.expression,
        enabled: f.enabled !== false,
        timeout: f.timeout || 0,
        firstImpression: f.firstImpression === true,
        inputStates: {},
        lockedInputs: {},
        lastInputTime: null,
        result: null,
        timedOut: false,
      }));

      this.formulas.forEach((formula) => {
        // Fjern 'async'
        this.availableInputs.forEach((id) => {
          formula.inputStates[id] = "undefined";
          formula.lockedInputs[id] = false;
        });
      });
    } catch (e) {
      this.logger.error("parse.error_formulas", {
        message: e.message,
      });
      this.formulas = [];
    }

    if (this.formulas.length === 0) {
      const defaultFormula = {
        id: "formula_1",
        name: this.homey.__("formula.default_name"),
        expression: this.getDefaultExpression(),
        enabled: true,
        timeout: 0,
        firstImpression: false,
        inputStates: {},
        lockedInputs: {},
        lastInputTime: null,
        result: null,
        timedOut: false,
      };

      this.availableInputs.forEach((id) => {
        defaultFormula.inputStates[id] = "undefined";
        defaultFormula.lockedInputs[id] = false;
      });

      this.formulas = [defaultFormula];
    }

    this.logger.info("formula.initialized", {
      count: this.formulas.length,
    });
    this.formulas.forEach((f) => {
      this.logger.debug("formula.details", {
        name: f.name,
        expression: f.expression,
        enabled: f.enabled,
      });
    });

    // Validate configuration after formulas are initialized
    await this.updateConfigAlarm();
  }

  getDefaultExpression() {
    const inputs = this.getAvailableInputsUppercase();
    return inputs.join(" AND ");
  }

  async setupDeviceLinks() {
    // Clean up old listeners first
    for (const [key, entry] of this.deviceListeners.entries()) {
      try {
        if (typeof entry?.unregister === "function") {
          await entry.unregister();
          this.logger.debug("devicelinks.unregistered", { key });
        }
      } catch (e) {
        this.logger.error("devicelinks.error_cleanup", { message: e.message });
      }
    }
    this.deviceListeners.clear();

    // Then setup new ones
    const settings = this.getSettings();
    let inputLinks = [];
    try {
      inputLinks = settings.input_links ? JSON.parse(settings.input_links) : [];
    } catch (e) {
      this.logger.error("parse.error_input_links", {
        message: e.message,
      });
      return;
    }

    this.inputLinks = inputLinks;

    this.logger.debug("devicelinks.count", {
      count: inputLinks.length,
    });
    for (const link of inputLinks) {
      try {
        await this.setupDeviceListener(link);
      } catch (e) {
        this.logger.error("devicelinks.setup_failed", {
          input: link.input,
          message: e.message,
        });
      }
    }

    this.logger.debug("initial.fetching_all");
    await this.fetchInitialValues(inputLinks);

    this.logger.info("devicelinks.complete");
  }

  async fetchInitialValues(inputLinks) {
    if (!this.homey.app.api) {
      this.logger.error("initial.api_unavailable");
      return;
    }

    for (const link of inputLinks) {
      const { input, deviceId, capability } = link;
      if (!input || !deviceId || !capability) continue;

      try {
        this.logger.debug("initial.fetching_input", {
          input: input.toUpperCase(),
        });
        const device = await this.homey.app.api.devices.getDevice({
          id: deviceId,
        });
        if (!device) {
          this.logger.warn("initial.device_not_found", {
            input: input.toUpperCase(),
          });
          continue;
        }

        let initialValue = null;

        if (device.capabilitiesObj && device.capabilitiesObj[capability]) {
          initialValue = device.capabilitiesObj[capability].value;
        } else if (
          device.capabilityValues &&
          device.capabilityValues[capability] !== undefined
        ) {
          initialValue = device.capabilityValues[capability];
        } else if (device.state && device.state[capability] !== undefined) {
          initialValue = device.state[capability];
        }

        this.logger.input("initial.received_value", {
          input: input.toUpperCase(),
          value: initialValue,
        });

        if (initialValue !== null && initialValue !== undefined) {
          const boolValue = this.convertToBoolean(initialValue, capability);

          this.logger.debug("initial.value_received", {
            input: input.toUpperCase(),
            value: initialValue,
            boolean: boolValue,
          });

          for (const formula of this.formulas) {
            formula.inputStates[input] = boolValue;
          }
        } else {
          this.logger.warn("initial.no_value_waiting", {
            input: input.toUpperCase(),
          });
        }
      } catch (e) {
        this.logger.error("initial.error", {
          input: input.toUpperCase(),
          message: e.message,
        });
      }
    }
  }

  async refetchInputsAndEvaluate(source = "unknown") {
    this.logger.info("refetch.invoked", {
      source: source,
    });
    let links = [];
    try {
      const settings = this.getSettings();
      links = settings.input_links ? JSON.parse(settings.input_links) : [];
    } catch (e) {
      this.logger.error("refetch.parse_failed", {
        message: e.message,
      });
    }

    if (!Array.isArray(links) || links.length === 0) {
      this.logger.warn("refetch.no_links");
      await this.evaluateAllFormulasInitial();
      return;
    }

    this.inputLinks = links;

    this.logger.debug("refetch.fetching_values");
    await this.fetchInitialValues(links);
    await this.evaluateAllFormulasInitial();
  }

  async setupDeviceListener(link) {
    const { input, deviceId, capability, deviceName } = link;

    this.logger.debug("listener.setting_up", {
      input: input.toUpperCase(),
      deviceName,
      deviceId,
      capability,
    });

    if (!input || !deviceId || !capability) {
      this.logger.error("listener.invalid_config", {
        input: input?.toUpperCase(),
      });
      return;
    }

    try {
      if (!this.homey.app.api) {
        this.logger.error("listener.api_unavailable");
        return;
      }

      const targetDevice = await this.homey.app.api.devices.getDevice({
        id: deviceId,
      });

      if (!targetDevice) {
        this.logger.error("listener.device_not_found", {
          input: input.toUpperCase(),
          device: deviceId,
        });
        return;
      }
      this.logger.debug("listener.device_found", {
        device: targetDevice.name,
      });

      if (
        !targetDevice.capabilities ||
        !targetDevice.capabilities.includes(capability)
      ) {
        this.logger.error("listener.capability_not_exist", {
          input: input.toUpperCase(),
          capability,
          device: deviceId,
          available: targetDevice.capabilities,
        });
        return;
      }
      this.logger.debug("listener.capability_found", {
        capability: capability,
      });

      const listenerFn = async (value) => {
        if (this._isDeleting) return;

        this.logger.input("listener.event_received", {
          input: input.toUpperCase(),
          device: targetDevice.name,
          capability,
          value,
        });

        const boolValue = this.convertToBoolean(value, capability);

        this.logger.debug("listener.capability_changed", {
          input: input.toUpperCase(),
          capability,
          value,
          boolean: boolValue,
        });

        for (const formula of this.formulas) {
          try {
            await this.setInputForFormula(formula.id, input, boolValue);
          } catch (err) {
            if (!this._isDeleting)
              this.logger.error("formula.set_input_error", {
                message: err.message,
              });
          }
        }
      };

      this.logger.debug("listener.registering", {
        capability: capability,
      });
      const capabilityInstance = targetDevice.makeCapabilityInstance(
        capability,
        listenerFn,
      );

      const listenerKey = `${input}-${deviceId}-${capability}`;
      this.deviceListeners.set(listenerKey, {
        unregister: () => capabilityInstance.destroy(),
      });

      this.logger.debug("listener.registered", {
        input: input.toUpperCase(),
        device: targetDevice.name,
        capability,
      });
    } catch (e) {
      this.logger.error("listener.error_setup", {
        input: input.toUpperCase(),
        message: e.message,
      });
      this.logger.debug(e.stack);
    }
  }

  convertToBoolean(value, capability) {
    if (typeof value === "boolean") return value;
    if (capability.startsWith("alarm_")) return !!value;
    if (capability === "onoff") return !!value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string") {
      const lowerValue = value.toLowerCase();
      return (
        lowerValue === "true" ||
        lowerValue === "1" ||
        lowerValue === "on" ||
        lowerValue === "yes"
      );
    }
    return !!value;
  }

  async safeSetCapabilityValue(cap, value) {
    if (this._isDeleting) return;
    try {
      if (!this.hasCapability(cap)) return;
      await this.setCapabilityValue(cap, value);
    } catch (e) {
      const msg = e?.message || "";
      if (e?.statusCode === 404 || /not\s*found/i.test(msg)) {
        this.logger.debug("device.capability_skip_deleted", {
          capability: cap,
        });
        return;
      }

      this.logger.error("device.capability_update_failed", {
        capability: cap,
        message: msg,
      });
    }
  }

  async setInputForFormula(formulaId, inputId, value) {
    if (this._isDeleting) return null;
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      return null;
    }

    if (formula.firstImpression && formula.lockedInputs[inputId]) {
      this.logger.warn("inputs.locked_first_impression", {
        device: this.getName(), // <-- Legg til device navn
        deviceId: this.getData().id, // <-- Legg til device ID
        input: inputId.toUpperCase(),
        formula: formula.name,
      });
      return formula.result;
    }

    const oldValue = formula.inputStates[inputId];
    this.logger.debug("inputs.setting_value", {
      device: this.getName(), // <-- Legg til device navn
      deviceId: this.getData().id, // <-- Legg til device ID
      input: inputId.toUpperCase(),
      value,
      formula: formula.name,
      oldValue,
    });

    formula.inputStates[inputId] = value;
    formula.timedOut = false;

    if (
      formula.firstImpression &&
      value !== "undefined" &&
      !formula.lockedInputs[inputId]
    ) {
      formula.lockedInputs[inputId] = true;
      this.logger.debug("inputs.locked_at_value", {
        input: inputId.toUpperCase(),
        value,
      });
    }

    if (value !== "undefined") {
      formula.lastInputTime = Date.now();
    }

    return await this.evaluateFormula(formulaId);
  }

  async evaluateFormula(formulaId, resetLocks = false) {
    if (this._isDeleting) return null;

    // Check if device is enabled
    if (this.deviceEnabled === false) {
      this.logger.debug("⏸️  Device disabled - skipping evaluation", {
        formulaId,
      });
      return null;
    }

    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula || !formula.enabled) {
      this.logger.debug("formula.not_found_or_disabled", {
        id: formulaId,
      });
      return null;
    }

    if (resetLocks && formula.firstImpression) {
      this.availableInputs.forEach((id) => {
        formula.lockedInputs[id] = false;
      });
      this.logger.debug("formula.unlocked_inputs", {
        name: formula.name,
      });
    }

    const expression = formula.expression;
    if (!expression) {
      this.logger.debug("formula.no_expression");
      return null;
    }

    const requiredInputs = this.parseExpression(expression);
    if (requiredInputs.length === 0) return null;

    const allInputsDefined = requiredInputs.every(
      (id) => formula.inputStates[id.toLowerCase()] !== "undefined",
    );

    if (!allInputsDefined) {
      this.logger.debug("formula.waiting_for_inputs", {
        name: formula.name,
        required: requiredInputs.join(", "),
      });
      return null;
    }

    try {
      // Normalize expression to standard keywords for AST evaluation
      const normalizedExpr = expression
        .toUpperCase()
        .replace(/&|\*/g, " AND ")
        .replace(/\||\+/g, " OR ")
        .replace(/\^|!=/g, " XOR ")
        .replace(/!/g, " NOT ")
        .replace(/\s+/g, " ")
        .trim();

      // Build variables object from formula inputs
      const variables = {};
      requiredInputs.forEach((inputKey) => {
        const inputId = inputKey.toLowerCase();
        const value = formula.inputStates[inputId];
        if (value !== "undefined") {
          variables[inputKey] = value === true;
        }
      });

      // Evaluate using AST (secure - no eval or new Function!)
      const result = this.formulaEvaluator.evaluate(normalizedExpr, variables);

      this.logger.debug("🔐 Formula evaluated (AST)", {
        name: formula.name,
        result,
      });

      const previousResult = formula.result;
      formula.result = result;
      formula.timedOut = false;

      // ✅ CRITICAL: Only set alarm_generic (formula output), NOT onoff!
      // onoff is user control (enable/disable), alarm_generic is formula result
      await this.safeSetCapabilityValue("alarm_generic", result);

      // Trigger flows hvis resultatet endret seg
      if (previousResult !== null && previousResult !== result) {
        // Get current on/off state for context
        const currentOnState = this.getCapabilityValue("onoff");
        
        this.logger.debug("formula_result_changed", {
          formulaName: formula.name,
          previousResult,
          newResult: result,
          currentOnState
        });
        
        // Fire all relevant triggers
        await this.fireAllRelevantTriggers(
          result,           // newAlarmState (formula result)
          currentOnState,   // newOnState (on/off capability)
          previousResult,   // previousAlarmState
          null             // previousOnState (not changing here)
        );
      }

      return result;
    } catch (e) {
      this.logger.error("formula.evaluation_failed", {
        name: formula.name,
        message: e.message,
      });
      return null;
    }
  }

  evaluateBooleanExpression(expression, inputStates) {
    // Parse expression til AST (Abstract Syntax Tree)
    const tokens = this.tokenize(expression);
    const ast = this.parse(tokens);

    // Evaluer AST med input-verdier
    return this.evaluateAST(ast, inputStates);
  }

  tokenize(expression) {
    const tokens = [];
    let i = 0;
    const expr = expression.toUpperCase().trim();

    while (i < expr.length) {
      // Skip whitespace
      if (/\s/.test(expr[i])) {
        i++;
        continue;
      }

      // Operators
      if (expr[i] === "(") {
        tokens.push({ type: "LPAREN", value: "(" });
        i++;
      } else if (expr[i] === ")") {
        tokens.push({ type: "RPAREN", value: ")" });
        i++;
      } else if (expr[i] === "!") {
        if (expr[i + 1] === "=") {
          tokens.push({ type: "XOR", value: "!=" });
          i += 2;
        } else {
          tokens.push({ type: "NOT", value: "!" });
          i++;
        }
      } else if (expr[i] === "&") {
        if (expr[i + 1] === "&") {
          i += 2;
        } else {
          i++;
        }
        tokens.push({ type: "AND", value: "&&" });
      } else if (expr[i] === "|") {
        if (expr[i + 1] === "|") {
          i += 2;
        } else {
          i++;
        }
        tokens.push({ type: "OR", value: "||" });
      } else if (expr[i] === "*") {
        tokens.push({ type: "AND", value: "*" });
        i++;
      } else if (expr[i] === "+") {
        tokens.push({ type: "OR", value: "+" });
        i++;
      } else if (expr[i] === "^") {
        tokens.push({ type: "XOR", value: "^" });
        i++;
      }
      // Keywords
      else if (expr.substr(i, 3) === "AND") {
        tokens.push({ type: "AND", value: "AND" });
        i += 3;
      } else if (expr.substr(i, 2) === "OR") {
        tokens.push({ type: "OR", value: "OR" });
        i += 2;
      } else if (expr.substr(i, 3) === "XOR") {
        tokens.push({ type: "XOR", value: "XOR" });
        i += 3;
      } else if (expr.substr(i, 3) === "NOT") {
        tokens.push({ type: "NOT", value: "NOT" });
        i += 3;
      }
      // Variables (A-J)
      else if (/[A-J]/.test(expr[i])) {
        tokens.push({ type: "VAR", value: expr[i] });
        i++;
      } else {
        throw new Error(`Uventet tegn: "${expr[i]}" på posisjon ${i}`);
      }
    }

    return tokens;
  }

  // Parser (konverterer tokens til AST)
  parse(tokens) {
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    // OR har lavest presedens
    const parseOr = () => {
      let left = parseXor();

      while (peek() && peek().type === "OR") {
        consume();
        const right = parseXor();
        left = { type: "OR", left, right };
      }

      return left;
    };

    // XOR har medium presedens
    const parseXor = () => {
      let left = parseAnd();

      while (peek() && peek().type === "XOR") {
        consume();
        const right = parseAnd();
        left = { type: "XOR", left, right };
      }

      return left;
    };

    // AND har høy presedens
    const parseAnd = () => {
      let left = parseNot();

      while (peek() && peek().type === "AND") {
        consume();
        const right = parseNot();
        left = { type: "AND", left, right };
      }

      return left;
    };

    // NOT har høyest presedens (unær operator)
    const parseNot = () => {
      if (peek() && peek().type === "NOT") {
        consume();
        const operand = parseNot(); // Støtter multiple NOT
        return { type: "NOT", operand };
      }

      return parsePrimary();
    };

    // Primary: variabler eller parenteser
    const parsePrimary = () => {
      const token = peek();

      if (!token) {
        throw new Error("Uventet slutt på uttrykk");
      }

      if (token.type === "VAR") {
        consume();
        return { type: "VAR", value: token.value };
      }

      if (token.type === "LPAREN") {
        consume(); // (
        const expr = parseOr();

        if (!peek() || peek().type !== "RPAREN") {
          throw new Error("Manglende avsluttende parentes");
        }
        consume(); // )

        return expr;
      }

      throw new Error(`Uventet token: ${token.type}`);
    };

    const ast = parseOr();

    if (pos < tokens.length) {
      throw new Error(`Uventet token etter slutten: ${tokens[pos].type}`);
    }

    return ast;
  }

  // Evaluerer AST med gitte input-verdier
  evaluateAST(node, inputStates) {
    if (!node) {
      throw new Error("Tomt AST-node");
    }

    switch (node.type) {
      case "VAR": {
        const value = inputStates[node.value.toLowerCase()];
        if (value === "undefined") {
          throw new Error(`Variabel ${node.value} er ikke definert`);
        }
        return value === true || value === "true";
      }

      case "NOT": {
        return !this.evaluateAST(node.operand, inputStates);
      }

      case "AND": {
        const left = this.evaluateAST(node.left, inputStates);
        const right = this.evaluateAST(node.right, inputStates);
        return left && right;
      }

      case "OR": {
        const left = this.evaluateAST(node.left, inputStates);
        const right = this.evaluateAST(node.right, inputStates);
        return left || right;
      }

      case "XOR": {
        const left = this.evaluateAST(node.left, inputStates);
        const right = this.evaluateAST(node.right, inputStates);
        return left !== right;
      }

      default:
        throw new Error(`Ukjent node-type: ${node.type}`);
    }
  }

  async evaluateAllFormulasInitial() {
    this.logger.info("evaluation.initial_complete");

    let anyEvaluated = false;

    for (const formula of this.formulas) {
      if (!formula.enabled) continue;

      const expression = formula.expression;
      if (!expression) continue;

      const requiredInputs = this.parseExpression(expression);
      if (requiredInputs.length === 0) continue;

      const allInputsDefined = requiredInputs.every(
        (id) => formula.inputStates[id.toLowerCase()] !== "undefined",
      );

      if (allInputsDefined) {
        this.logger.debug("formula.all_inputs_defined", {
          name: formula.name,
        });
        await this.evaluateFormula(formula.id);
        anyEvaluated = true;
      } else {
        const states = {};
        requiredInputs.forEach((id) => {
          states[id] = formula.inputStates[id.toLowerCase()];
        });
        this.logger.debug("formula.missing_inputs", {
          name: formula.name,
        });
      }
    }

    if (!anyEvaluated) {
      this.logger.warn("evaluation.no_formulas_ready");
      
      // Store previous state before updating
      const previousAlarmState = this.getCapabilityValue("alarm_generic");
      
      // ✅ CRITICAL: Only set alarm_generic, NOT onoff!
      // onoff is user control, alarm_generic is formula result
      await this.safeSetCapabilityValue("alarm_generic", false);
      
      // Fire alarm triggers if state changed
      if (previousAlarmState !== false) {
        const currentOnState = this.getCapabilityValue("onoff");
        await this.fireAllRelevantTriggers(
          false,              // newAlarmState
          currentOnState,     // newOnState
          previousAlarmState, // previousAlarmState
          null               // previousOnState (not changing)
        );
      }
    }
  }

  parseExpression(expression) {
    const inputs = this.getAvailableInputsUppercase();
    if (!inputs.length) return [];
    const varRe = new RegExp(`\\b(${inputs.join("|")})\\b`, "gi");
    const matches = expression.match(varRe);
    return matches ? [...new Set(matches.map((c) => c.toUpperCase()))] : [];
  }

  validateExpression(expression) {
    if (!expression || expression.trim() === "") {
      return {
        valid: false,
        error: this.homey.__("formula.expression_empty"),
      };
    }

    const upper = expression.toUpperCase();
    const inputs = this.getAvailableInputsUppercase();
    if (!inputs.length)
      return {
        valid: false,
        error: this.homey.__("formula.error_no_inputs"),
      };

    const tokenRe = new RegExp(
      `\\b(?:AND|OR|XOR|NOT)\\b|&&|\\|\\||&|\\||\\^|!=|\\*|\\+|!|\\(|\\)|\\b(?:${inputs.join("|")})\\b`,
      "gi",
    );

    const stripped = upper.replace(tokenRe, "").replace(/\s+/g, "");
    if (stripped.length > 0) {
      return {
        valid: false,
        error: this.homey.__("formula.invalid_tokens", {
          tokens: stripped,
        }),
      };
    }

    let depth = 0;
    for (const ch of upper) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth < 0)
        return {
          valid: false,
          error: this.homey.__("formula.error_unbalanced_parentheses"),
        };
    }
    if (depth !== 0)
      return {
        valid: false,
        error: this.homey.__("formula.error_unbalanced_parentheses"),
      };

    // Normalize alternative syntax to standard keywords for AST evaluation
    let normalizedExpr = upper
      .replace(/&|\*/g, " AND ")
      .replace(/\||\+/g, " OR ")
      .replace(/\^|!=/g, " XOR ")
      .replace(/!/g, " NOT ")
      .replace(/\s+/g, " ")
      .trim();

    try {
      // Create test variables (all set to true for validation)
      const testVars = {};
      inputs.forEach((input) => {
        testVars[input] = true;
      });

      // Try to evaluate with test values using AST (secure!)
      this.formulaEvaluator.evaluate(normalizedExpr, testVars);

      return {
        valid: true,
      };
    } catch (e) {
      return {
        valid: false,
        error: this.homey.__("formula.invalid_syntax", {
          message: e.message,
        }),
      };
    }
  }

  /**
   * Validate configuration and update alarm_config capability
   * Sets alarm_config to true if there are JSON parsing errors or invalid formulas
   */
  async updateConfigAlarm() {
    if (!this.hasCapability("alarm_config")) {
      return;
    }

    // Get previous alarm_config value to detect changes
    const previousAlarmConfig = this.getCapabilityValue("alarm_config");

    let hasError = false;
    let errorReason = "";
    const settings = this.getSettings();

    // Check if formulas JSON is valid
    try {
      const formulasData = settings.formulas
        ? JSON.parse(settings.formulas)
        : [];

      if (!Array.isArray(formulasData)) {
        hasError = true;
        errorReason = "Formulas is not an array";
        this.logger.warn("⚠️ config.validation_failed", {
          reason: errorReason,
        });
      } else {
        // IMPORTANT: Logic Device must have exactly one formula
        if (formulasData.length === 0) {
          hasError = true;
          errorReason = "Logic Device må ha minst én formel";
          this.logger.warn("⚠️ config.validation_failed", {
            reason: errorReason,
          });
        } else if (formulasData.length > 1) {
          hasError = true;
          errorReason = `Logic Device kan kun ha én formel (${formulasData.length} funnet)`;
          this.logger.warn("⚠️ config.validation_failed", {
            reason: errorReason,
            formulaCount: formulasData.length,
          });
        }

        // Validate the single formula
        if (!hasError && formulasData.length === 1) {
          const formula = formulasData[0];

          // Sjekk at formelen har en ID
          if (!formula.id || typeof formula.id !== 'string' || formula.id.trim() === '') {
            hasError = true;
            errorReason = "Formelen mangler en gyldig ID";
            this.logger.warn("⚠️ config.validation_failed", {
              reason: errorReason,
            });
          }

          // Sjekk at formelen har et navn
          if (!hasError && (!formula.name || typeof formula.name !== 'string' || formula.name.trim() === '')) {
            hasError = true;
            errorReason = "Formelen mangler et gyldig navn";
            this.logger.warn("⚠️ config.validation_failed", {
              reason: errorReason,
            });
          }

          // Sjekk at formelen har et expression
          if (!hasError && (!formula.expression || typeof formula.expression !== 'string' || formula.expression.trim() === '')) {
            hasError = true;
            errorReason = "Formelen mangler et gyldig uttrykk";
            this.logger.warn("⚠️ config.validation_failed", {
              reason: errorReason,
            });
          }

          // Validate expression syntax
          if (!hasError && formula.expression) {
            const validation = this.validateExpression(formula.expression);
            if (!validation.valid) {
              hasError = true;
              errorReason = `Ugyldig formel "${formula.name}": ${validation.error}`;
              this.logger.warn("⚠️ config.validation_failed", {
                formula: formula.name || formula.id,
                error: validation.error,
              });
            }
          }

          // Validate timeout value (optional, but if present must be valid)
          if (!hasError && formula.timeout !== undefined && formula.timeout !== null) {
            const timeout = Number(formula.timeout);
            if (isNaN(timeout) || timeout < 0) {
              hasError = true;
              errorReason = `Ugyldig timeout-verdi: ${formula.timeout}`;
              this.logger.warn("⚠️ config.validation_failed", {
                reason: errorReason,
              });
            }
          }
        }
      }
    } catch (e) {
      hasError = true;
      errorReason = `Invalid JSON in formulas: ${e.message}`;
      this.logger.warn("⚠️ config.validation_failed", {
        reason: errorReason,
        error: e.message,
      });
    }

    // Check if input_links JSON is valid
    try {
      const inputLinks = settings.input_links
        ? JSON.parse(settings.input_links)
        : [];

      if (!Array.isArray(inputLinks)) {
        hasError = true;
        this.logger.warn("config.validation_failed", {
          reason: "Input links is not an array",
        });
      }
    } catch (e) {
      hasError = true;
      this.logger.warn("config.validation_failed", {
        reason: "Invalid JSON in input_links",
        error: e.message,
      });
    }

    // Update alarm_config capability
    try {
      await this.setCapabilityValue("alarm_config", hasError);
    } catch (e) {
      this.logger.error("Failed to set alarm_config capability", {
        error: e.message,
      });
    }

    if (hasError) {
      this.logger.info("⚠️  Configuration error detected - alarm_config set to true");

      // Send notification to user
      try {
        await this.homey.notifications.createNotification({
          excerpt: `⚠️ Konfigurasjonsfeil i ${this.getName()}: ${errorReason}`,
        });
      } catch (e) {
        this.logger.error("Failed to send notification", { error: e.message });
      }
    } else {
      this.logger.debug("✅ Configuration valid - alarm_config set to false");
    }

    // Trigger flow card if alarm_config value changed
    if (previousAlarmConfig !== null && previousAlarmConfig !== hasError) {
      await this.triggerConfigAlarmChanged(hasError);
    }
  }

  /**
   * Trigger config_alarm_changed_to flow cards (both device-level and app-level)
   */
  async triggerConfigAlarmChanged(alarmState) {
    // Trigger device-specific "changed to" card
    try {
      const card = this.homey.flow.getDeviceTriggerCard("config_alarm_changed_to_ld");
      const tokens = {
        device_name: this.getName(),
        alarm_state: alarmState,
      };
      const state = {
        alarm_state: alarmState,
      };

      await card.trigger(this, tokens, state);

      this.logger.info("config_alarm.device_trigger_fired", {
        alarm_state: alarmState,
        device_name: this.getName(),
      });
    } catch (e) {
      this.logger.error("config_alarm.device_trigger_failed", {
        error: e.message,
      });
    }

    // Trigger device-specific "state changed" card
    try {
      const stateCard = this.homey.flow.getDeviceTriggerCard("config_alarm_state_changed_ld");
      const tokens = {
        device_name: this.getName(),
        alarm_state: alarmState,
      };

      await stateCard.trigger(this, tokens);

      this.logger.debug("config_alarm.device_state_trigger_fired", {
        alarm_state: alarmState,
        device_name: this.getName(),
      });
    } catch (e) {
      this.logger.error("config_alarm.device_state_trigger_failed", {
        error: e.message,
      });
    }

    // Trigger app-level cards with all affected devices
    try {
      const driverId = this.driver?.id || 'logic-device';

      // Get all devices with errors
      const affectedDevices = await this.homey.app.getDevicesWithConfigErrors('logic-device');

      const tokens = {
        device_name: this.getName(),
        device_type: 'Logic Device',
        alarm_state: alarmState,
        affected_devices: affectedDevices.map(d => d.name).join(', ') || this.getName(),
        error_count: affectedDevices.length,
      };

      const state = {
        alarm_state: alarmState,
        driver_id: driverId,
      };

      // Trigger "changed to" app-level card
      const appCard = this.homey.flow.getTriggerCard("any_config_alarm_changed");
      await appCard.trigger(tokens, state);

      // Trigger "state changed" app-level card
      const appStateCard = this.homey.flow.getTriggerCard("any_config_alarm_state_changed");
      await appStateCard.trigger(tokens, state);

      this.logger.info("config_alarm.app_triggers_fired", {
        alarm_state: alarmState,
        affected_count: affectedDevices.length,
      });
    } catch (e) {
      this.logger.error("config_alarm.app_triggers_failed", {
        error: e.message,
      });
    }
  }

  getFormulas() {
    return this.formulas
      .filter((f) => f.enabled)
      .map((f) => ({
        id: f.id,
        name: f.name,
        description: f.expression || this.homey.__("formula.no_expression"),
      }));
  }

  getInputOptions() {
    return this.getAvailableInputsUppercase().map((input) => ({
      id: input.toLowerCase(),
      name: input,
    }));
  }

  getFormulaResult(formulaId) {
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      this.logger.warn("formula.get_result_not_found", {
        id: formulaId,
      });
      return null;
    }
    return formula.result;
  }

  /**
   * Action card handler: Validate configuration manually
   */
  async onFlowActionValidateConfig(args, state) {
    this.logger.info("🔍 Manual configuration validation triggered");
    await this.updateConfigAlarm();
    return true;
  }

  /**
   * Action card handler: Evaluate formula manually
   */
  async onFlowActionEvaluateFormula(args, state) {
    this.logger.info("🔄 Manual formula evaluation triggered");
    await this.evaluateAllFormulas();
    return true;
  }

  /**
   * Action card handler: Clear error/timeout state
   */
  async onFlowActionClearError(args, state) {
    this.logger.info("🧹 Clearing error state");

    // Clear timeout state for all formulas
    for (const formula of this.formulas) {
      formula.timedOut = false;
      formula.lastInputTime = Date.now();
    }

    // Re-evaluate to update state
    await this.evaluateAllFormulas();
    return true;
  }

  /**
   * Condition card handler for formula_result_is_ld, formula_has_timed_out_ld, has_any_error_ld
   * @param {object} args - Flow card arguments
   * @param {object} state - Flow card state
   * @param {string|boolean} checkType - Type of check: "timeout", "has_error", or boolean for result check
   */
  async onFlowCondition(args, state, checkType) {
    // Check for timeout
    if (checkType === "timeout") {
      const hasTimeout = this.formulas.some((f) => this.hasFormulaTimedOut(f.id));
      this.logger.debug("Condition check: timeout", { hasTimeout });
      return hasTimeout;
    }

    // Check for any error (config error or timeout)
    if (checkType === "has_error") {
      const hasConfigError = this.getCapabilityValue("alarm_config") === true;
      const hasTimeout = this.formulas.some((f) => this.hasFormulaTimedOut(f.id));
      const hasError = hasConfigError || hasTimeout;
      this.logger.debug("Condition check: has_error", { hasConfigError, hasTimeout, hasError });
      return hasError;
    }

    // Check formula result (checkType is boolean: true or false)
    if (typeof checkType === "boolean") {
      // For Logic Device there's only one formula, use alarm_generic capability
      const currentResult = this.getCapabilityValue("alarm_generic");
      const matches = currentResult === checkType;
      this.logger.debug("Condition check: result", { expected: checkType, current: currentResult, matches });
      return matches;
    }

    this.logger.warn("Unknown condition checkType", { checkType });
    return false;
  }

  hasFormulaTimedOut(formulaId) {
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) return false;
    return formula.timedOut;
  }

  async evaluateAllFormulas() {
    this.logger.info("evaluation.reevaluating_all");
    const results = [];
    for (const formula of this.formulas) {
      if (formula.enabled) {
        this.availableInputs.forEach((id) => {
          formula.lockedInputs[id] = false;
        });
        this.logger.debug("formula.unlocked_inputs", {
          name: formula.name,
        });
        const result = await this.evaluateFormula(formula.id);
        results.push({
          id: formula.id,
          name: formula.name,
          result,
        });
      }
    }

    this.logger.debug("formula.evaluated_count", {
      count: results.length,
    });
    return results;
  }

  startTimeoutChecks() {
    // Clear existing interval hvis det finnes
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }

    // Start nytt interval
    this.timeoutInterval = setInterval(() => {
      // Sjekk at enheten ikke er i ferd med å bli slettet
      if (this._isDeleting) {
        clearInterval(this.timeoutInterval);
        this.timeoutInterval = null;
        return;
      }

      this.checkTimeouts();
    }, 1000);
  }

  checkTimeouts() {
    const now = Date.now();
    this.formulas.forEach((formula) => {
      if (!formula.timeout || formula.timeout <= 0) return;
      if (formula.timedOut || !formula.enabled) return;
      if (!formula.lastInputTime) return;

      const hasAnyInput = this.availableInputs.some(
        (id) => formula.inputStates[id] !== "undefined",
      );
      if (!hasAnyInput) return;

      const requiredInputs = this.parseExpression(formula.expression);
      const allInputsDefined = requiredInputs.every(
        (id) => formula.inputStates[id.toLowerCase()] !== "undefined",
      );
      if (allInputsDefined) return;

      const timeoutMs = formula.timeout * 1000;
      const elapsed = now - formula.lastInputTime;

      if (elapsed >= timeoutMs) {
        this.logger.info("formula.timed_out", {
          name: formula.name,
          timeout: formula.timeout,
        });
        formula.timedOut = true;

        const triggerData = {
          formula: {
            id: formula.id,
            name: formula.name,
          },
        };
        const state = {
          formulaId: formula.id,
        };
        this.homey.flow
          .getDeviceTriggerCard("formula_timeout")
          .trigger(this, triggerData, state)

          .catch((err) =>
            this.logger.error("timeout.error", {
              message: err.message,
            }),
          );
      }
    });
  }

  async onSettings({ newSettings, changedKeys }) {
    this.logger.info("settings.changed", {
      keys: changedKeys.join(", "),
    });

    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }

    if (
      changedKeys.includes("formulas") ||
      changedKeys.includes("input_links")
    ) {
      const detectedInputs = this.detectRequiredInputs(newSettings);
      const originalNumInputs = this.getData().numInputs ?? 2;
      const newNumInputs = Math.max(detectedInputs, originalNumInputs);
      if (newNumInputs !== this.numInputs) {
        this.logger.info("device.capacity_updated", {
          old: this.numInputs,
          new: newNumInputs,
        });
        this.numInputs = newNumInputs;
        this.availableInputs = this.getAvailableInputIds();
      }
    }

    const formatSettings = {};
    let needsFormat = false;

    let parsedFormulas = [];
    if (changedKeys.includes("formulas")) {
      try {
        let rawFormulas = newSettings.formulas;

        this.logger.debug("debug.raw_formulas", {
          formulas: rawFormulas,
        });
        parsedFormulas =
          typeof rawFormulas === "string"
            ? JSON.parse(rawFormulas)
            : rawFormulas;

        const formatted = JSON.stringify(parsedFormulas, null, 2);
        const original =
          typeof newSettings.formulas === "string"
            ? newSettings.formulas
            : JSON.stringify(newSettings.formulas);
        if (formatted !== original) {
          formatSettings.formulas = formatted;
          needsFormat = true;

          this.logger.debug("settings.formatting", {
            type: "formulas",
          });
        }
      } catch (e) {
        this.logger.error("parse.error_formulas_json", {
          message: e.message,
        });
        throw new Error(
          this.homey.__("parse.error_formulas_invalid", {
            message: e.message,
          }),
        );
      }
    }

    let parsedLinks = [];
    if (changedKeys.includes("input_links")) {
      try {
        let rawLinks = newSettings.input_links;

        this.logger.debug("debug.raw_input_links", {
          links: rawLinks,
        });
        parsedLinks =
          typeof rawLinks === "string" ? JSON.parse(rawLinks) : rawLinks;

        const formatted = JSON.stringify(parsedLinks, null, 2);
        const original =
          typeof newSettings.input_links === "string"
            ? newSettings.input_links
            : JSON.stringify(newSettings.input_links);
        if (formatted !== original) {
          formatSettings.input_links = formatted;
          needsFormat = true;

          this.logger.debug("settings.formatting", {
            type: "input_links",
          });
        }
      } catch (e) {
        this.logger.error("parse.error_input_links", {
          message: e.message,
        });
        throw new Error(
          this.homey.__("parse.error_input_links_invalid", {
            message: e.message,
          }),
        );
      }
    }

    if (changedKeys.includes("formulas")) {
      this.formulas = parsedFormulas.map((f) => ({
        id: f.id,
        name: f.name,
        expression: f.expression,
        enabled: f.enabled !== false,
        timeout: f.timeout ?? 0,
        firstImpression: f.firstImpression === true,
        inputStates: {},
        lockedInputs: {},
        lastInputTime: null,
        result: null,
        timedOut: false,
      }));
      this.availableInputs.forEach((id) => {
        this.formulas.forEach((f) => {
          f.inputStates[id] = "undefined";
          f.lockedInputs[id] = false;
        });
      });

      this.logger.debug("formula.reinitialized", {
        count: this.formulas.length,
      });
      for (const formula of this.formulas) {
        const validation = this.validateExpression(formula.expression);
        if (!validation.valid) {
          throw new Error(
            this.homey.__("formula.error_validation", {
              name: formula.name,
              error: validation.error,
            }),
          );
        }
      }
    }

    if (changedKeys.includes("input_links")) {
      await this.setupDeviceLinks();
      await this.evaluateAllFormulasInitial();
    }

    if (
      changedKeys.includes("formulas") &&
      !changedKeys.includes("input_links")
    ) {
      await this.refetchInputsAndEvaluate("formulas-change");
    }

    this.startTimeoutChecks();

    this.logger.info("settings.applied");

    if (needsFormat) {
      // Bruk setImmediate for å la Homey fullføre nåværende settings-oppdatering først
      setImmediate(async () => {
        try {
          this.logger.debug("settings.applying_formatted");

          // Sjekk at enheten fortsatt eksisterer
          if (this._isDeleting) {
            this.logger.debug("Device being deleted, skipping auto-format");
            return;
          }

          await this.setSettings(formatSettings);
          this.logger.info("settings.auto_formatted");
        } catch (e) {
          // Ignorer feil hvis enheten er slettet
          if (e?.statusCode === 404 || this._isDeleting) {
            this.logger.debug(
              "Device deleted during auto-format, ignoring error",
            );
            return;
          }

          this.logger.error("settings.format_failed", {
            message: e.message,
          });
        }
      });
    }
  }

  async pollDeviceInputs() {
    this.logger.debug("polling.all_inputs");

    const links = this.inputLinks || [];
    if (!links.length) {
      this.logger.warn("polling.no_links");
      return;
    }
    if (!this.homey.app.api) {
      this.logger.error("polling.api_unavailable");
      return;
    }

    for (const link of links) {
      this.logger.debug("polling.input", {
        input: link.input,
        device: link.deviceId,
        capability: link.capability,
      });
      try {
        const dev = await this.homey.app.api.devices.getDevice({
          id: link.deviceId,
        });
        if (!dev) {
          this.logger.warn("polling.device_not_found", {
            device: link.deviceId,
          });
          continue;
        }

        let raw = null;
        if (dev.capabilitiesObj && dev.capabilitiesObj[link.capability]) {
          raw = dev.capabilitiesObj[link.capability].value;
        } else if (
          dev.capabilityValues &&
          dev.capabilityValues[link.capability] !== undefined
        ) {
          raw = dev.capabilityValues[link.capability];
        } else if (dev.state && dev.state[link.capability] !== undefined) {
          raw = dev.state[link.capability];
        }

        if (raw === null || raw === undefined) {
          this.logger.warn("polling.no_value", {
            input: link.input.toUpperCase(),
            capability: link.capability,
          }); // FIKSET: Fjernet ekstra parentes her
          continue;
        }

        const boolValue = this.convertToBoolean(raw, link.capability);

        this.logger.input("polling.value_received", {
          input: link.input.toUpperCase(),
          value: raw,
          boolean: boolValue,
        });

        for (const formula of this.formulas) {
          formula.inputStates[link.input] = boolValue;
          if (boolValue !== "undefined") {
            formula.lastInputTime = Date.now();
          }
        }
      } catch (e) {
        this.logger.error("polling.failed", {
          input: link.input,
          message: e.message,
        });
      }
    }
  }

  async onDeleted() {
    this._isDeleting = true;

    this.logger.device("device.deleted_cleanup");

    for (const [key, entry] of this.deviceListeners.entries()) {
      try {
        if (typeof entry?.unregister === "function") {
          await entry.unregister();

          this.logger.debug("devicelinks.unregistered", {
            key,
          });
        }
      } catch (e) {
        this.logger.error("devicelinks.error_cleanup", {
          message: e.message,
        });
      }
    }
    this.deviceListeners.clear();

    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }

    if (this.settingsPoller) {
      clearInterval(this.settingsPoller);
      this.settingsPoller = null;
    }

    if (
      this.pollingIntervals &&
      typeof this.pollingIntervals.clear === "function"
    ) {
      try {
        this.pollingIntervals.clear();
      } catch (_) {}
    }

    this.logger.info("device.cleanup_complete");
  }

  async fireAllRelevantTriggers(newAlarmState, newOnState, previousAlarmState = null, previousOnState = null) {
    this.logger.debug("firing_all_triggers", {
      newAlarmState,
      newOnState,
      previousAlarmState,
      previousOnState
    });

    // Ensure values are never undefined (default to false)
    const safeAlarmState = newAlarmState ?? false;
    const safeOnState = newOnState ?? false;

    // ===== ALARM STATE TRIGGERS =====
    if (previousAlarmState !== null && previousAlarmState !== safeAlarmState) {
      
      // Ensure primitives
      const deviceName = String(this.getName() || "Unknown Device");
      const isAlarmOn = safeAlarmState === true;

      this.logger.debug("DEBUG: Preparing trigger data", {
        isAlarmOn,
        deviceName
      });

      // Fire deprecated triggers (for backward compatibility)
      // state_changed_ld expects token: state (boolean). NO ARGS.
      await this.safeTriggerCard("state_changed_ld", { state: isAlarmOn }, {});

      // device_state_changed_ld expects token: state (boolean). ARG: state (dropdown string)
      await this.safeTriggerCard("device_state_changed_ld", { state: isAlarmOn }, { state: String(isAlarmOn) });

      // Fire new alarm state triggers
      // device_alarm_state_changed_ld expects token: alarm_state (boolean). NO ARGS.
      // FIX: Removed device_name token as it is not in the card definition.
      await this.safeTriggerCard("device_alarm_state_changed_ld", { 
        alarm_state: isAlarmOn
      }, {});

      // device_alarm_turned_ld expects dropdown arg alarm_state ("true"/"false") and token alarm_state (boolean)
      await this.safeTriggerCard("device_alarm_turned_ld", {
        alarm_state: isAlarmOn,
        device_name: deviceName
      }, { 
        alarm_state: String(isAlarmOn)
      });

      // device_alarm_changed_to_ld expects token: device_name (string), alarm_state (boolean). ARG: alarm_state (dropdown string)
      await this.safeTriggerCard("device_alarm_changed_to_ld", { 
        device_name: deviceName,
        alarm_state: isAlarmOn
      }, { 
        alarm_state: String(isAlarmOn) 
      });
    }

    // ===== ON/OFF STATE TRIGGERS =====
    if (previousOnState !== null && previousOnState !== safeOnState) {
      // Prepare on/off state trigger data
      // Explicitly cast to boolean to prevent 'undefined' errors
      const onStateBool = !!safeOnState;
      const deviceName = this.getName() || "Unknown Device";

      const onTriggerData = {
        on_state: onStateBool,
        device_name: deviceName
      };

      const onState = {
        on_state: onStateBool
      };

      this.logger.flow(`🔘 On state changed: ${previousOnState} → ${safeOnState}`);

      // Fire new on/off state triggers
      await this.safeTriggerCard("device_on_state_changed_ld", onTriggerData, onState);
      await this.safeTriggerCard("device_turned_ld", onTriggerData, onState);
    }
  }

  // Safe trigger card firing with error handling
  async safeTriggerCard(triggerCardId, triggerData, state) {
    try {
      this.logger.flow(`🎯 Triggering '${triggerCardId}' with data:`, triggerData);

      // UNIVERSAL TRIGGER HANDLER
      // Prefer device trigger card (with device scoping), fall back to app trigger if not found.
      let card = null;
      try {
        card = this.homey.flow.getDeviceTriggerCard(triggerCardId);
      } catch (_) {
        // Ignore and try generic card below
      }
      if (!card) {
        card = this.homey.flow.getTriggerCard(triggerCardId);
      }

      // Prepare robust state object
      const safeState = state || {};
      
      // Add device_id for precise filtering in RunListener
      safeState.device_id = this.getData().id;
      
      // Add simplified device object - passing full 'this' can cause serialization errors
      // This might help Homey route the trigger if it attempts automatic matching
      safeState.device = {
        id: this.getData().id,
        name: this.getName()
      };

      // Ensure string format for boolean-like state args (for dropdowns)
      // This prevents "Invalid value..." errors during argument validation
      if (typeof safeState.state === 'boolean') {
        safeState.state = String(safeState.state);
      }
      const hasAlarmStateToken = typeof triggerData?.alarm_state === 'boolean';
      if (typeof safeState.alarm_state === 'boolean') {
        safeState.alarm_state = String(safeState.alarm_state);
      } else if (hasAlarmStateToken) {
        safeState.alarm_state = String(triggerData.alarm_state);
      }
      const hasOnStateToken = typeof triggerData?.on_state === 'boolean';
      if (typeof safeState.on_state === 'boolean') {
        safeState.on_state = String(safeState.on_state);
      } else if (hasOnStateToken) {
        safeState.on_state = String(triggerData.on_state);
      }
      
      // Call trigger with or without device depending on card type signature
      if (typeof card.trigger === 'function' && card.trigger.length >= 3) {
        // FlowCardTriggerDevice signature: trigger(device, tokens, state)
        await card.trigger(this, triggerData, safeState);
      } else {
        await card.trigger(triggerData, safeState);
      }

      this.logger.debug(`✅ Successfully triggered: ${triggerCardId}`);
    } catch (e) {
      if (e.message && e.message.includes("Invalid Flow Card ID")) {
        this.logger.error(
          `FATAL: Trigger card '${triggerCardId}' not found. Check app.json/compose flow definitions.`,
          e
        );
      } else {
        this.logger.error(`❌ Error triggering ${triggerCardId} (Data: ${JSON.stringify(triggerData)}):`, e);
      }
    }
  }
};
