"use strict";
const FormulaEvaluator = require("./FormulaEvaluator");
const Homey = require("homey");
const Logger = require("./Logger");

/**
 * BaseLogicUnit - Base class for all Logic Unit devices
 *
 * Provides the core functionality for evaluating boolean formulas with
 * multiple inputs. Logic Units are virtual devices that combine boolean
 * inputs (A, B, C, etc.) using expressions like "A AND B OR NOT C".
 *
 * Key Features:
 * - Formula evaluation using secure AST-based FormulaEvaluator
 * - Per-formula input state tracking with namespacing
 * - Timeout handling for incomplete input sets
 * - "First Impression" mode (locks inputs after first value)
 * - Configuration validation with alarm_config capability
 * - Flow card integration (triggers, conditions, actions)
 *
 * Called by:
 *   - drivers/logic-unit-2..10/device.js - Extends this class
 *   - Flow cards - Via action/condition/trigger handlers
 *
 * Calls:
 *   - FormulaEvaluator - For secure boolean expression evaluation
 *   - Logger - For logging operations
 *   - Homey.Device methods - Capability management
 *
 * @class BaseLogicUnit
 * @extends Homey.Device
 */
module.exports = class BaseLogicUnit extends Homey.Device {
  // --- INTERN NAMESPACING (UNDER THE HOOD) ---
  _nsId(formula) {
    // Stabil og trygg ID for bruk i tokens
    return String(formula.id || 'F').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }
  _nsPrefix(formula) {
    return `F_${this._nsId(formula)}_`;
  }
  /**
   * Bytt A..J i uttrykket til namespacede tokens (kun internt for evaluering)
   * Eks: "A AND B" -> "F_<FORMULAID>_A AND F_<FORMULAID>_B"
 */
  _namespaceExprForFormula(formula, upperExpr) {
    const inputsU = this.getAvailableInputsUppercase(); // ["A","B",...]
    if (inputsU.length === 0) return upperExpr;
    const ns = this._nsPrefix(formula);
    const tokenRe = new RegExp(`\\b(${inputsU.join("|")})\\b`, "g");
    return upperExpr.replace(tokenRe, (_m, t) => `${ns}${t}`);
  }
  /**
   * Bygg variabeltabell med namespacede nøkler for AST
   */
  _buildNsVariables(formula) {
    const ns = this._nsPrefix(formula);
    const vars = {};
    this.availableInputs.forEach(id => {
      const v = formula.inputStates[id];
      if (v !== "undefined") {
        vars[`${ns}${id.toUpperCase()}`] = (v === true);
      }
    });
    return vars;
  }

  /** @static Migration key to track onoff capability migration status */
  static MIGRATION_KEY = "migrated_onoff_v1";

  /**
   * Safely sets a capability value with error handling and validation.
   *
   * Prevents setting onoff to false (Logic Units are always enabled),
   * handles device deletion gracefully, and logs errors appropriately.
   *
   * @param {string} cap - Capability ID to set
   * @param {any} value - Value to set
   *
   * Called by:
   *   - BaseLogicUnit.updateConfigAlarm() - Setting alarm_config
   *   - BaseLogicUnit.onInit() - Initial capability setup
   *
   * Calls:
   *   - Homey.Device.setCapabilityValue() - Actual capability update
   *   - Logger methods - For logging
   */
  async safeSetCapabilityValue(cap, value) {
    if (cap === "onoff" && value === false) {
      this.logger.warn(
        "Prevented setting onoff to false - Logic Units are always enabled",
      );
      return;
    }
    if (this._isDeleting) return;
    try {
      if (!this.hasCapability(cap)) {
        return;
      }
      await this.setCapabilityValue(cap, value);
    } catch (e) {
      const msg = e?.message || String(e);
      if (e?.statusCode === 404 || /not\s*found/i.test(msg)) {
        this.logger.debug("device.capability_skip_deleted", {
          capability: cap,
        });
      } else {
        this.logger.error("device.capability_update_failed", {
          capability: cap,
          message: msg,
        });
      }
    }
  }

  /**
   * Initializes the Logic Unit device when added or app starts.
   *
   * Performs:
   * 1. Logger initialization
   * 2. FormulaEvaluator creation
   * 3. Capability setup (onoff, alarm_config)
   * 4. Migration for existing devices
   * 5. Formula loading from settings
   * 6. Configuration validation
   * 7. Initial formula evaluation
   * 8. Timeout check interval startup
   * 9. Settings change polling
   *
   * Called by:
   *   - Homey runtime - When device is added or app starts
   *
   * Calls:
   *   - Logger constructor - Create device logger
   *   - FormulaEvaluator constructor - Create evaluator
   *   - BaseLogicUnit.migrateOnoffForExistingDevice() - Migration
   *   - BaseLogicUnit.initializeFormulas() - Load formulas
   *   - BaseLogicUnit.updateConfigAlarm() - Validate config
   *   - BaseLogicUnit.evaluateAllFormulasInitial() - Initial evaluation
   *   - BaseLogicUnit.startTimeoutChecks() - Start timeout interval
   */
  async onInit() {
    const driverName = `Device: ${this.driver ? this.driver.id : "unknown-driver"}`;
    this.logger = new Logger(this, driverName);

    // Initialize AST-based formula evaluator for secure evaluation
    this.formulaEvaluator = new FormulaEvaluator();

    this.logger.device("device.initializing", {
      name: this.getName(),
    });

    if (!(await this.getStoreValue(BaseLogicUnit.MIGRATION_KEY))) {
      await this.migrateOnoffForExistingDevice();
    }

    // ✅ STEP 1: Add capabilities FIRST
    if (!this.hasCapability("onoff")) {
      await this.addCapability("onoff").catch((e) =>
        this.logger.error("Failed to add 'onoff' capability", e),
      );
    }
    if (!this.hasCapability("alarm_generic")) {
    }

    // ✅ STEP 2: Add alarm_config capability if missing
    if (!this.hasCapability("alarm_config")) {
      await this.addCapability("alarm_config").catch((e) =>
        this.logger.error("Failed to add 'alarm_config' capability", e),
      );
    }

    // ✅ STEP 3: ALWAYS force enabled - Logic Units are always on
    // Forbedret logging og sjekk for eksisterende devices
    let onoffValue = this.getCapabilityValue("onoff");
    this.logger.info(
      `📊 Initial onoff value: ${onoffValue} (type: ${typeof onoffValue})`,
    );

    if (onoffValue !== true) {
      this.logger.info("🔧 Forcing Logic Unit to enabled (was ${onoffValue})");
      await this.setCapabilityValue("onoff", true).catch((e) =>
        this.logger.error("Failed to set onoff value", e),
      );
      onoffValue = true;
    }

    this.logger.info(`✅ Logic Unit: ENABLED (onoff: ${onoffValue})`);

    // ✅ STEP 4: Make onoff READ-ONLY for Logic Units
    try {
      await this.setCapabilityOptions("onoff", {
        setable: false, // READ-ONLY: Users cannot toggle
        getable: true,
      });
      this.logger.debug("onoff capability set as read-only");
    } catch (e) {
      this.logger.error("Failed to set onoff options", e);
    }

    // ✅ STEP 5: Continue with normal initialization
    this.numInputs = this.getData().numInputs ?? 2;
    this.availableInputs = this.getAvailableInputIds();
    this.logger.debug(
      `Device initialized with ${this.numInputs} inputs: ${this.availableInputs.join(", ")}`,
      {},
    );

    await this.initializeFormulas();

    // Reset all formulas to prevent old values
    this.formulas.forEach(formula => {
      if (formula.enabled && formula.expression) {
        const required = this.parseExpression(formula.expression);
        if (required.length > 0) {
          formula.result = null;  // TVING null ved oppstart
          this.logger.debug("formula.reset_at_startup", {
            name: formula.name,
            reason: "waiting_for_inputs"
          });
        }
      }
    });

    // ✅ STEP 6: Validate configuration and set alarm_config
    await this.updateConfigAlarm();

    await this.evaluateAllFormulasInitial();
    this.startTimeoutChecks();

    // Store current formulas for change detection
    const currentSettings = this.getSettings();
    this.lastKnownFormulas = currentSettings.formulas;

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

  areAllInputsDefined(formula) {
    const usedVars = this.getUsedVariables([formula]); // Fra device.js
    return usedVars.every((varLetter) => {
      const inputId = varLetter.toLowerCase();
      const value = formula.inputStates[inputId];
      return value !== undefined && value !== "undefined";
    });
  }
  async migrateOnoffForExistingDevice() {
    this.logger.info(
      "Migrering: Satt onoff = true og setable = false for eksisterende enhet",
    );

    try {
      // 1. Sett onoff = true
      await this.setCapabilityValue("onoff", true);

      // 2. Gjør onoff read-only
      await this.setCapabilityOptions("onoff", {
        setable: false,
        getable: true,
      });

      // 3. Merk som migrert (én gang)
      await this.setStoreValue(BaseLogicUnit.MIGRATION_KEY, true);

      this.logger.info("Migrering fullført: onoff = true, setable = false");
    } catch (err) {
      this.logger.error("Migrering feilet", err);
    }
  }

  async onFlowCondition(args, state, checkType) {
    // DEBUG: Log the condition check details
    this.logger.info("🔍 DEBUG: onFlowCondition called", {
      checkType: checkType,
      formulaId: args.formula?.id,
      formulaName: args.formula?.name,
      cardId: args.cardId,
      allFormulasState: this.formulas.map(f => ({
        id: f.id,
        name: f.name,
        result: f.result,
        timedOut: f.timedOut,
        inputStates: { ...f.inputStates }
      }))
    });

    this.logger.flow(`onFlowCondition called for checkType: '${checkType}'`, {
      formulaId: args.formula?.id,
    });

    if (checkType === "has_error") {
      const hasTimeout = this.formulas.some((f) => f.timedOut === true);
      this.logger.flow(`Condition 'has_any_error' check result: ${hasTimeout}`);
      return hasTimeout;
    }

    const cardIdFromArgs = args.cardId;
    if (
      (cardIdFromArgs === "formula_result_is_lu" ||
        cardIdFromArgs === "formula_has_timed_out_lu") &&
      !args.formula
    ) {
      this.logger.warn(
        "onFlowCondition: _lu card called without formula on LU device. Checking first formula as fallback.",
      );
      if (this.formulas.length > 0) args.formula = this.formulas[0];
      else return false;
    }

    if (!args.formula || !args.formula.id) {
      this.logger.warn(
        "onFlowCondition: No formula specified in args for formula-specific check.",
        {
          checkType,
        },
      );
      return false;
    }
    const formulaId = args.formula.id;
    const formula = this.formulas.find((f) => f.id === formulaId);

    if (!formula) {
      this.logger.warn("onFlowCondition: Invalid formula ID received.", {
        formulaId,
      });
      return false;
    }

    if (checkType === "timeout") {
      const isTimedOut = formula.timedOut === true;
      this.logger.flow(
        `Condition 'formula_has_timed_out' check for '${formula.name}': Result=${isTimedOut}`,
      );
      return isTimedOut;
} else if (typeof checkType === "boolean") {
  const desiredResult = checkType;

  // Hvis formelen ikke er klar (result == null), vent til den blir klar eller til timeout slår inn.
  if (formula.result === null) {
    const maxWaitMs =
      formula.timeout && formula.timeout > 0 ? formula.timeout * 1000 : 30000; // fallback-sikkerhetsnett

    this.logger.debug("condition.waiting_for_formula", {
      formula: formula.name,
      timeoutMs: maxWaitMs,
    });

    await this._waitForFormulaResolution(formula, maxWaitMs);
  }

  // Etter venting: tre muligheter
  if (formula.result === null || formula.timedOut === true) {
    // Viktig: IKKE returner false ved timeout/ubestemt.
    // Vi aborterer noden, så grenen ikke fortsetter "false-veien".
    this.logger.debug("condition.aborting_due_to_timeout_or_undefined", {
      formula: formula.name,
      timedOut: !!formula.timedOut,
    });
    throw new Error("Formula timed out or is still undefined"); // ← aborterer noden
  }

  // Formelen er klar (true/false)
  const currentResult = formula.result;
  const evaluatedResult = currentResult === true;
  const conditionMet = evaluatedResult === desiredResult;

  this.logger.flow(
    `Condition 'formula_result_is' check for '${formula.name}': Current=${currentResult}, Desired=${desiredResult}, Match=${conditionMet}`,
  );

  return conditionMet;

    } else {
      this.logger.error(
        `onFlowCondition: Unknown checkType received: '${checkType}'`,
      );
      return false;
    }
  }

  async onFlowActionSetInput(args, state) {
    // DEBUG: Log a SAFE snapshot of the args (avoid circular JSON)
    const safeArgs = {
      formulaId: args?.formula?.id ?? null,
      formulaName: args?.formula?.name ?? null,
      inputId: args?.input?.id ?? null,
      value: typeof args?.value === 'string' ? args.value : String(args?.value),
      cardId: args?.cardId ?? null
    };
    this.logger.info("🔍 DEBUG: onFlowActionSetInput called", {
      ...safeArgs,
      availableFormulas: this.formulas.map(f => ({ id: f.id, name: f.name }))
    });



    if (!args.formula || !args.input || !args.formula.id || !args.input.id) {
      this.logger.warn("onFlowActionSetInput: Missing formula or input ID.", { safeArgs });

      return false;
    }
    const formulaId = args.formula.id;
    const inputId = args.input.id;
    const value = (args?.value === true || String(args?.value).toLowerCase() === "true");
    this.logger.flow("onFlowActionSetInput: Setting input", {
      formula: formulaId,
      input: inputId,
      value: value,
    });
    try {
      await this.setInputForFormula(formulaId, inputId, value);
      return true;
    } catch (e) {
      this.logger.error(
        `Error during onFlowActionSetInput for ${formulaId}/${inputId}`,
        e,
      );
      return false;
    }
  }

  async onFlowActionEvaluateFormula(args, state) {
    const cardIdFromArgs = args.cardId;
    if (
      (!args.formula || !args.formula.id) &&
      cardIdFromArgs === "evaluate_formula_ld"
    ) {
      this.logger.warn(
        `onFlowActionEvaluateFormula (LD) called on LU device ${this.getName()}. Falling back to re-evaluate all.`,
      );
      return this.onFlowActionReEvaluateAll(args, state);
    }
    
    if (!args.formula || !args.formula.id) {
      const safeArgs = { formulaId: args?.formula?.id ?? null, cardId: args?.cardId ?? null };
      this.logger.warn("onFlowActionEvaluateFormula: Missing formula ID.", { safeArgs });

      return false;
    }
    const formulaId = args.formula.id;
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      this.logger.warn("onFlowActionEvaluateFormula: Invalid formula ID.", {
        formulaId,
      });
      return false;
    }
    this.logger.flow(
      `onFlowActionEvaluateFormula: Evaluating '${formula.name}' (Resetting locks)`,
    );
    try {
      await this.evaluateFormula(formulaId, true);
      return true;
    } catch (e) {
      this.logger.error(
        `Error during onFlowActionEvaluateFormula for ${formulaId}`,
        e,
      );
      return false;
    }
  }

  async onFlowActionClearError(args, state) {
    const cardIdFromArgs = args.cardId;
    if (
      (!args.formula || !args.formula.id) &&
      cardIdFromArgs === "clear_error_ld"
    ) {
      this.logger.warn(
        `onFlowActionClearError (LD) called on LU device ${this.getName()}. Clearing all formula timeouts.`,
      );
      this.formulas.forEach((f) => {
        f.timedOut = false;
      });
      this.logger.info("notifications.error_cleared_all", {});
      return true;
    }
    
    if (!args.formula || !args.formula.id) {
      const safeArgs = { formulaId: args?.formula?.id ?? null, cardId: args?.cardId ?? null };
      this.logger.warn("onFlowActionClearError: Missing formula ID.", { safeArgs });

      return false;
    }
    const formulaId = args.formula.id;
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      this.logger.warn("onFlowActionClearError: Invalid formula ID.", {
        formulaId,
      });
      return false;
    }
    this.logger.flow(
      `onFlowActionClearError: Clearing timeout state for '${formula.name}'`,
    );
    formula.timedOut = false;
    this.logger.info("notifications.error_cleared", {
      formulaName: formula.name,
    });
    return true;
  }

  async onFlowActionReEvaluateAll(args, state) {
    this.logger.flow(
      "onFlowActionReEvaluateAll: Re-evaluating all formulas",
      {},
    );
    try {
      await this.evaluateAllFormulas();
      return true;
    } catch (e) {
      this.logger.error("Error during onFlowActionReEvaluateAll", e);
      return false;
    }
  }

  async setAllInputsFromFlow(args, state) {
    const device = this;
    const valuesJson = args.values;
    this.logger.flow(
      `Executing Action 'set_all_inputs' on device '${device.getName()}'`,
    );
    if (typeof valuesJson !== "string" || valuesJson.trim() === "") {
      this.logger.warn(
        `RunListener set_all_inputs: Empty or invalid JSON provided.`,
      );
      return false;
    }
    try {
      const values = JSON.parse(valuesJson);
      if (typeof values !== "object" || values === null) {
        throw new Error("Parsed JSON is not an object.");
      }
      const promises = [];
      const inputs = device.getAvailableInputIds
        ? device.getAvailableInputIds()
        : [];
      const formulas = Array.isArray(device.formulas) ? device.formulas : [];

      for (const key in values) {
        if (!inputs.includes(key.toLowerCase())) {
          this.logger.warn(
            `setAllInputsFromFlow: JSON contains invalid input key '${key}' for this device.`,
          );
        }
      }

      for (const inputId of inputs) {
        const key = inputId.toUpperCase();
        if (values.hasOwnProperty(key)) {
          formulas.forEach((f) => {
            if (
              f &&
              f.enabled &&
              typeof device.setInputForFormula === "function"
            ) {
              const boolValue =
                values[key] === true ||
                String(values[key]).toLowerCase() === "true";
              promises.push(
                device.setInputForFormula(f.id, inputId, boolValue),
              );
            }
          });
        }
      }
      await Promise.all(promises);
      this.logger.info(`set_all_inputs OK for ${device.getName()}`, {});
      return true;
    } catch (e) {
      this.logger.error(`Error set_all_inputs for ${device.getName()}`, e);
      return false;
    }
  }

  async setInputForAllFormulasFromFlow(args, state) {
    const device = this;
    const inputId = args.input?.id;
    const value = args.value === "true";

    this.logger.flow(
      `Executing Action 'set_input' on device '${device.getName()}'`,
      {
        input: inputId,
        value,
      },
    );

    if (!inputId || !this.availableInputs.includes(inputId)) {
      this.logger.error(
        `RunListener set_input: Invalid or missing input ID: ${inputId}. Available: ${this.availableInputs.join(",")}`,
      );

      return false;
    }

    const promises = [];
    const formulas = Array.isArray(device.formulas) ? device.formulas : [];
    try {
      formulas.forEach((f) => {
        if (f && f.enabled && typeof device.setInputForFormula === "function") {
          promises.push(device.setInputForFormula(f.id, inputId, value));
        }
      });
      await Promise.all(promises);
      this.logger.info(`set_input OK for ${device.getName()}`, {});
      return true;
    } catch (e) {
      this.logger.error(`Error set_input for ${device.getName()}`, e);
      return false;
    }
  }

  getAvailableInputIds() {
    const allInputs = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const count = Math.max(
      0,
      Math.min(allInputs.length, Number(this.numInputs) || 0),
    );
    return allInputs.slice(0, count);
  }

  getAvailableInputsUppercase() {
    return this.availableInputs.map((i) => i.toUpperCase());
  }

  initializeFormulas() {
    this.logger.debug("Initializing formulas from settings...", {});
    const settings = this.getSettings();
    try {
      const formulasData = settings.formulas
        ? JSON.parse(settings.formulas)
        : [];
      if (!Array.isArray(formulasData)) {
        this.logger.error("errors.invalid_formula", {
          message: "Formulas setting is not an array.",
        });
        this.formulas = [];
      } else {
        this.formulas = formulasData.map((f) => ({
          id: f.id || `formula_${Math.random().toString(16).slice(2)}`,
          name: f.name || this.homey.__("formula.unnamed_formula"),
          expression: f.expression || "",
          enabled: f.enabled !== false,
          timeout: Number(f.timeout) || 0,
          firstImpression: !!f.firstImpression,
          inputStates: {},
          lockedInputs: {},
          lastInputTime: null,
          result: null,
          timedOut: false,
          sessionComplete: false, // Track if all inputs have been set in current flow session
        }));
      }

      this.formulas.forEach((formula) => {
        this.availableInputs.forEach((id) => {
          formula.inputStates[id] = "undefined";
          formula.lockedInputs[id] = false;
        });
      });
    } catch (e) {
      this.logger.error("errors.invalid_formula", e);
      this.formulas = [];
    }

    if (this.formulas.length === 0) {
      this.logger.warn(
        "No valid formulas found in settings, creating default.",
        {},
      );
      const defaultFormula = {
        id: "formula_1",
        name: this.homey.__
          ? this.homey.__("formula.default_name_alt")
          : this.homey.__("formula.default_name_alt_fallback"),
        expression: this.getDefaultExpression(),
        enabled: true,
        timeout: 0,
        firstImpression: false,
        inputStates: {},
        lockedInputs: {},
        lastInputTime: null,
        result: null,
        timedOut: false,
        sessionComplete: false,
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
    this.formulas.forEach((f) =>
      this.logger.debug("formula.details", {
        name: f.name,
        expression: f.expression,
        enabled: f.enabled,
      }),
    );
  }

  getDefaultExpression() {
    const inputs = this.getAvailableInputsUppercase();
    return inputs.length > 0 ? inputs.join(" AND ") : "true";
  }

  getFormulas() {
    return this.formulas
      .filter((f) => f.enabled)
      .map((f) => ({
        id: f.id,
        name: f.name,
        description:
          f.expression ||
          (this.homey.__
            ? this.homey.__("formula.no_expression")
            : "(no expression)"),
      }));
  }

  getInputOptions() {
    return this.getAvailableInputsUppercase().map((input) => ({
      id: input.toLowerCase(),
      name: input,
    }));
  }

  validateExpression(expression) {
    this.logger.debug(`Validating expression: "${expression || ""}"`, {});
    if (
      !expression ||
      typeof expression !== "string" ||
      expression.trim() === ""
    ) {
      return {
        valid: false,
        error: this.homey.__
          ? this.homey.__("formula.expression_empty")
          : "Expression empty",
      };
    }
    const upper = expression.toUpperCase();
    const inputs = this.getAvailableInputsUppercase();
    if (!inputs.length && upper.match(/[A-J]/)) {
      return {
        valid: false,
        error: this.homey.__("formula.error_inputs_used_but_none_configured"),
      };
    }
    let validationInputs = inputs.length > 0 ? inputs : ["TEMP_VALIDATION_VAR"];

    const tokenRe = new RegExp(
      `\\b(?:AND|OR|XOR|NOT)\\b|&&|\\|\\||&|\\||\\^|!=|\\*|\\+|!|\\(|\\)|\\b(?:${validationInputs.join("|")})\\b|\\bTRUE\\b|\\bFALSE\\b`,
      "gi",
    );
    const stripped = upper.replace(tokenRe, "").replace(/\s+/g, "");
    if (stripped.length > 0) {
      return {
        valid: false,
        error: this.homey.__
          ? this.homey.__("formula.invalid_tokens", {
              tokens: stripped,
            })
          : `Invalid tokens: ${stripped}`,
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
        error: "Unbalanced parentheses",
      };

    // Normalize alternative syntax to standard keywords for AST evaluation
    let normalizedExpr = upper
      .replace(/&|\*/g, " AND ") // Convert & or * to AND
      .replace(/\||\+/g, " OR ") // Convert | or + to OR
      .replace(/\^|!=/g, " XOR ") // Convert ^ or != to XOR
      .replace(/!/g, " NOT "); // Convert ! to NOT

    // Clean up extra spaces
    normalizedExpr = normalizedExpr.replace(/\s+/g, " ").trim();

    // Try validating med AST, men med fiktiv FORMULA-ID (namespacet)
    try {
      
      const fakeId = { id: "FAKE_FORMULA_VALIDATION" };
      const nsExpr = this._namespaceExprForFormula(fakeId, normalizedExpr);
      const testVars = {};
      (validationInputs.length ? validationInputs : ["TEMP_VALIDATION_VAR"])
        .forEach((input) => {
          const name = `F_${this._nsId(fakeId)}_${input}`;
          testVars[name] = true;
        });
      this.formulaEvaluator.evaluate(nsExpr, testVars);
      
      return {
        valid: true,
      };
    } catch (e) {
      return {
        valid: false,
        error: this.homey.__
          ? this.homey.__("formula.invalid_syntax", {
              message: e.message,
            })
          : `Syntax error: ${e.message}`,
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
    const settings = this.getSettings();

    // Check if formulas JSON is valid
    try {
      const formulasData = settings.formulas
        ? JSON.parse(settings.formulas)
        : [];

      if (!Array.isArray(formulasData)) {
        hasError = true;
        this.logger.warn("config.validation_failed", {
          reason: "Formulas is not an array",
        });
      } else if (formulasData.length === 0) {
        // VIKTIG: Logic Unit må ha minst én formel
        hasError = true;
        this.logger.warn("config.validation_failed", {
          reason: "Logic Unit må ha minst én formel",
        });
      } else {
        // Sjekk for duplikate formel-ID-er
        const ids = formulasData.map((f) => f.id).filter(id => id); // Filter out undefined/null
        if (ids.length > 0) {
          const uniqueIds = new Set(ids);
          if (ids.length !== uniqueIds.size) {
            hasError = true;
            this.logger.warn("config.validation_failed", {
              reason: "Duplikate formel-ID-er funnet",
              ids: ids.join(", "),
            });
          }
        }

        // Validate each formula
        if (!hasError) {
          for (let i = 0; i < formulasData.length; i++) {
            const formula = formulasData[i];
            const formulaLabel = formula.name || formula.id || `Formel #${i + 1}`;

            // Sjekk at formelen har en ID
            if (!formula.id || typeof formula.id !== 'string' || formula.id.trim() === '') {
              hasError = true;
              this.logger.warn("config.validation_failed", {
                reason: `${formulaLabel}: Mangler gyldig ID`,
              });
              break;
            }

            // Sjekk at formelen har et navn
            if (!formula.name || typeof formula.name !== 'string' || formula.name.trim() === '') {
              hasError = true;
              this.logger.warn("config.validation_failed", {
                reason: `${formulaLabel}: Mangler gyldig navn`,
              });
              break;
            }

            // Sjekk at formelen har et expression
            if (!formula.expression || typeof formula.expression !== 'string' || formula.expression.trim() === '') {
              hasError = true;
              this.logger.warn("config.validation_failed", {
                reason: `${formulaLabel}: Mangler gyldig uttrykk`,
              });
              break;
            }

            // Validate expression syntax
            const validation = this.validateExpression(formula.expression);
            if (!validation.valid) {
              hasError = true;
              this.logger.warn("config.validation_failed", {
                formula: formulaLabel,
                error: validation.error,
              });
              break;
            }

            // Validate timeout value (optional, but if present must be valid)
            if (formula.timeout !== undefined && formula.timeout !== null) {
              const timeout = Number(formula.timeout);
              if (isNaN(timeout) || timeout < 0) {
                hasError = true;
                this.logger.warn("config.validation_failed", {
                  reason: `${formulaLabel}: Ugyldig timeout-verdi (${formula.timeout})`,
                });
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      hasError = true;
      this.logger.warn("config.validation_failed", {
        reason: "Invalid JSON",
        error: e.message,
      });
    }

    // Update alarm_config capability
    await this.safeSetCapabilityValue("alarm_config", hasError);

    if (hasError) {
      this.logger.info("⚠️  Configuration error detected - alarm_config set to true");
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
      const card = this.homey.flow.getDeviceTriggerCard("config_alarm_changed_to_lu");
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
      const stateCard = this.homey.flow.getDeviceTriggerCard("config_alarm_state_changed_lu");
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
      const driverId = this.driver?.id || 'unknown';
      const driverFilter = driverId.startsWith('logic-unit') ? 'logic-unit' : 'any';

      // Get all devices with errors (if alarm is true) or all devices (if alarm is false)
      const affectedDevices = await this.homey.app.getDevicesWithConfigErrors(driverFilter);

      const tokens = {
        device_name: this.getName(),
        device_type: driverId.startsWith('logic-unit') ? 'Logic Unit' : 'Unknown',
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

  parseExpression(expression) {
    if (!expression || typeof expression !== "string") return [];
    const inputs = this.getAvailableInputsUppercase();
    if (!inputs.length) return [];
    const varRe = new RegExp(`\\b(${inputs.join("|")})\\b`, "gi");
    const matches = expression.match(varRe);
    return matches ? [...new Set(matches.map((c) => c.toUpperCase()))] : [];
  }

  /**
   * Sets an input value for a specific formula and triggers evaluation.
   *
   * Handles "First Impression" mode by resetting session state when needed,
   * locking inputs after first value, and tracking session completion.
   * Automatically triggers formula evaluation after setting the input.
   *
   * @param {string} formulaId - ID of the formula to update
   * @param {string} inputId - Input ID (a, b, c, etc.)
   * @param {boolean} value - Boolean value to set
   * @returns {Promise<boolean|null>} Evaluation result or null if not ready
   *
   * Called by:
   *   - BaseLogicUnit.onFlowActionSetInput() - Flow action card
   *   - BaseLogicUnit.setAllInputsFromFlow() - Bulk set action
   *   - BaseLogicUnit.setInputForAllFormulasFromFlow() - Set across formulas
   *
   * Calls:
   *   - BaseLogicUnit.evaluateFormula() - Trigger evaluation
   *   - Logger methods - For logging
   */
  async setInputForFormula(formulaId, inputId, value) {
    if (this._isDeleting) return null;
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      this.logger.warn("errors.invalid_formula", {
        formulaId,
      });
      return null;
    }
    if (!this.availableInputs.includes(inputId)) {
      this.logger.warn(
        `setInputForFormula: Invalid inputId '${inputId}' for device with ${this.numInputs} inputs.`,
      );
      return null;
    }

    // DEBUG: Log current state of ALL formulas before any changes
    this.logger.info("🔍 DEBUG: setInputForFormula BEFORE changes", {
      targetFormula: formulaId,
      targetInput: inputId,
      targetValue: value,
      allFormulasState: this.formulas.map(f => ({
        id: f.id,
        name: f.name,
        inputStates: { ...f.inputStates },
        lockedInputs: { ...f.lockedInputs },
        sessionComplete: f.sessionComplete,
        firstImpression: f.firstImpression,
        result: f.result
      }))
    });

    // NEW: If firstImpression mode and a complete session exists, reset for new flow run
    if (
      formula.firstImpression === true &&
      formula.sessionComplete === true
    ) {
      this.logger.debug("inputs.new_flow_session", {
        formula: formula.name,
        resettingInputs: this.availableInputs.join(", "),
      });
      // Reset all locks AND input states for new flow session
      this.availableInputs.forEach((id) => {
        formula.lockedInputs[id] = false;
        formula.inputStates[id] = "undefined"; // CRITICAL: Clear old values!
      });
      formula.sessionComplete = false;
      
      // DEBUG: Log state after reset
      this.logger.info("🔍 DEBUG: Formula state AFTER reset", {
        formula: formula.name,
        inputStates: { ...formula.inputStates },
        lockedInputs: { ...formula.lockedInputs }
      });
    }

    if (
      formula.firstImpression === true &&
      formula.lockedInputs[inputId] === true
    ) {
      this.logger.debug("inputs.locked", {
        input: inputId.toUpperCase(),
        formula: formula.name,
      });
      return formula.result;
    }

    const oldValue = formula.inputStates[inputId];
    formula.inputStates[inputId] =
      value === true || value === false ? value : "undefined";
    formula.timedOut = false;

    // DEBUG: Log the specific change
    this.logger.info("🔍 DEBUG: Input value changed", {
      formula: formula.name,
      input: inputId,
      oldValue: oldValue,
      newValue: formula.inputStates[inputId]
    });

    if (
      formula.firstImpression === true &&
      formula.inputStates[inputId] !== "undefined" &&
      formula.lockedInputs[inputId] !== true
    ) {
      formula.lockedInputs[inputId] = true;
      this.logger.debug("inputs.locked_at_value", {
        input: inputId.toUpperCase(),
        value: formula.inputStates[inputId],
        formula: formula.name,
      });
    }

    if (formula.inputStates[inputId] !== "undefined") {
      formula.lastInputTime = Date.now();
    }

    // NEW: Check if all required inputs are now set in firstImpression mode
    if (formula.firstImpression === true && formula.sessionComplete === false) {
      const requiredInputs = this.parseExpression(formula.expression);
      const allSet = requiredInputs.every(
        (inputIdUpper) =>
          formula.inputStates[inputIdUpper.toLowerCase()] !== "undefined"
      );
      if (allSet) {
        formula.sessionComplete = true;
        this.logger.debug("inputs.session_complete", {
          formula: formula.name,
        });
      }
    }

    // DEBUG: Log current state of ALL formulas after changes
    this.logger.info("🔍 DEBUG: setInputForFormula AFTER changes", {
      targetFormula: formulaId,
      allFormulasState: this.formulas.map(f => ({
        id: f.id,
        name: f.name,
        inputStates: { ...f.inputStates },
        lockedInputs: { ...f.lockedInputs },
        sessionComplete: f.sessionComplete,
        firstImpression: f.firstImpression,
        result: f.result
      }))
    });

    return await this.evaluateFormula(formulaId, false);
  }

  /**
   * Evaluates a single formula and triggers flow cards on result changes.
   *
   * Core evaluation logic:
   * 1. Validates formula exists and is enabled
   * 2. Optionally resets input locks (for re-evaluation)
   * 3. Checks if all required inputs are defined
   * 4. Normalizes expression syntax (alternative operators)
   * 5. Namespaces variables for AST evaluation
   * 6. Evaluates using FormulaEvaluator
   * 7. Triggers flow cards if result changed
   *
   * @param {string} formulaId - ID of the formula to evaluate
   * @param {boolean} [resetLocks=false] - Whether to reset locked inputs
   * @returns {Promise<boolean|null>} Evaluation result or null if not ready
   *
   * Called by:
   *   - BaseLogicUnit.setInputForFormula() - After input change
   *   - BaseLogicUnit.onFlowActionEvaluateFormula() - Manual evaluation
   *   - BaseLogicUnit.evaluateAllFormulas() - Batch evaluation
   *   - BaseLogicUnit.evaluateAllFormulasInitial() - Initial evaluation
   *
   * Calls:
   *   - BaseLogicUnit._namespaceExprForFormula() - Variable namespacing
   *   - BaseLogicUnit._buildNsVariables() - Build variable map
   *   - FormulaEvaluator.evaluate() - AST evaluation
   *   - Homey flow.getDeviceTriggerCard() - Trigger flow cards
   */
  async evaluateFormula(formulaId, resetLocks = false) {
    if (this._isDeleting) return null;
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula || !formula.enabled) {
      this.logger.debug("errors.invalid_formula", {
        formulaId,
      });
      return null;
    }

    if (resetLocks === true && formula.firstImpression === true) {
      this.availableInputs.forEach((id) => {
        formula.lockedInputs[id] = false;
      });
      formula.sessionComplete = false;
      this.logger.debug("inputs.unlocked", {
        formula: formula.name,
      });
    }

    const expression = formula.expression;
    if (!expression) {
      this.logger.debug("formula.invalid", {
        formula: formula.name,
        reason: "No expression",
      });
      formula.result = null;
      return null;
    }

    const requiredInputs = this.parseExpression(expression);
    const allDefined = requiredInputs.every(
      (inputIdUpper) =>
        formula.inputStates[inputIdUpper.toLowerCase()] !== "undefined",
    );

    if (!allDefined && requiredInputs.length > 0) {
      const missing = requiredInputs.filter(
        (id) => formula.inputStates[id.toLowerCase()] === "undefined",
      );
      this.logger.debug("inputs.waiting", {
        formula: formula.name,
        missing: missing.join(", "),
      });
      const previous = formula.result;
      formula.result = null;

      return null;
    }

    this.logger.debug("formula.evaluating", { formula: formula.name });

    try {
      
      // 1) Normaliser syntaks (AND/OR/XOR/NOT) uten å endre brukerens tekst
      const normalizedExprBase = expression
        .toUpperCase()
        .replace(/&|\*/g, " AND ") // Convert & or * to AND
        .replace(/\||\+/g, " OR ") // Convert | or + to OR
        .replace(/\^|!=/g, " XOR ") // Convert ^ or != to XOR
        .replace(/!/g, " NOT ") // Convert ! to NOT
        .replace(/\s+/g, " ") // Clean up extra spaces
        .trim();

      
      // 2) Namespac’e input‑tokens (A..J) per formel
      const nsExpr = this._namespaceExprForFormula(formula, normalizedExprBase);
      // 3) Bygg variabler for AST med namespacede nøkler
      const variables = this._buildNsVariables(formula);
      this.logger.formula("formula.evaluating_expression", {
        expression,
        evalExpression: nsExpr
      });
      // 4) Evaluer med AST
      const result = this.formulaEvaluator.evaluate(nsExpr, variables);


      this.logger.debug("formula.evaluated", {
        formula: formula.name,
        result: result,
      });

      const previous = formula.result;
      formula.result = result;
      formula.timedOut = false;

      if (result !== previous && previous !== null) {
        const triggerData = {
          formula: {
            id: formula.id,
            name: formula.name,
          },
        };
        const state = {
          formulaId: formula.id,
        };
        const triggerCardId = result
          ? "formula_changed_to_true"
          : "formula_changed_to_false";
        try {
          this.logger.flow(
            `Triggering flow '${triggerCardId}' for '${formula.name}'`,
          );
          const card = this.homey.flow.getDeviceTriggerCard(triggerCardId);
          await card.trigger(this, triggerData, state);
        } catch (e) {
          if (e.message && e.message.includes("Invalid Flow Card ID")) {
            this.logger.error(
              `FATAL: Trigger card '${triggerCardId}' not found. Check app.json/compose flow definitions.`,
              e,
            );
          } else {
            this.logger.error("flow.trigger_error", e);
          }
        }
      }
      return result;
    } catch (e) {
      // Check if error is due to undefined variable
      if (e.message && e.message.includes("is not defined")) {
        this.logger.debug("formula.waiting_for_input", {
          formula: formula.name,
          error: e.message,
        });
        formula.result = null;
        return null;
      }
      this.logger.error("errors.evaluation_failed", e);
      formula.result = null;
      return null;
    }
  }

  async evaluateAllFormulas() {
    this.logger.info("notifications.reevaluating", {});
    const results = [];
    for (const formula of this.formulas) {
      if (formula.enabled) {
        if (formula.firstImpression) {
          this.availableInputs.forEach((id) => {
            formula.lockedInputs[id] = false;
          });
          formula.sessionComplete = false;
          this.logger.debug("inputs.unlocked", {
            formula: formula.name,
          });
        }
        const result = await this.evaluateFormula(formula.id, false);
        results.push({
          id: formula.id,
          name: formula.name,
          result,
        });
      } else {
        formula.result = null;
      }
    }
    // ✅ Calculate overall state (TRUE if any formula is TRUE)
    const overallDeviceState = this.formulas.some(
      (f) => f.enabled && f.result === true,
    );

    this.logger.debug("formula.evaluated_count", {
      count: results.length,
    });
    return results;
  }

  async evaluateAllFormulasInitial() {
    this.logger.info("evaluation.initial_complete", {});
    let anyEvaluated = false;

    for (const formula of this.formulas) {
      if (!formula.enabled) {
        formula.result = null;
        continue;
      }
      const expr = formula.expression;
      if (!expr) {
        formula.result = null;
        continue;
      }
      const required = this.parseExpression(expr);
      this.logger.debug("debug.checking_formula", {
        name: formula.name,
        expression: expr,
      });
      if (required.length > 0) {
        this.logger.debug("debug.required_inputs", {
          inputs: required.join(", "),
        });
      }

      const allDefined = required.every(
        (id) => formula.inputStates[id.toLowerCase()] !== "undefined",
      );

      if (allDefined || required.length === 0) {
        this.logger.debug("formula.all_inputs_defined", {
          name: formula.name,
        });
        const result = await this.evaluateFormula(formula.id);
        if (result !== null) {
          anyEvaluated = true;
        }
      } else {
        const missing = required.filter(
          (id) => formula.inputStates[id.toLowerCase()] === "undefined",
        );
        this.logger.debug("inputs.waiting", {
          formula: formula.name,
          missing: missing.join(", "),
        });
        formula.result = null;
      }
    }

    const finalState = this.formulas.some(
      (f) => f.enabled && f.result === true,
    );

    this.logger.info(
      `Initial evaluation complete. Final state: ${finalState} (anyEvaluated=${anyEvaluated})`,
    );

    if (
      !anyEvaluated &&
      this.formulas.some(
        (f) =>
          f.enabled &&
          f.expression &&
          this.parseExpression(f.expression).length > 0,
      )
    ) {
      this.logger.warn("evaluation.no_formulas_ready", {});
    }
  }

  getFormulaResult(formulaId) {
    const formula = this.formulas.find((f) => f.id === formulaId);
    if (!formula) {
      this.logger.warn("errors.invalid_formula", {
        formulaId,
      });
      return null;
    }
    this.logger.debug("formula.result_debug", {
      name: formula.name,
      id: formulaId,
      result: formula.result,
      type: typeof formula.result,
    });
    return formula.result === true;
  }

  /**
   * Action card handler: Validate configuration manually
   */
  async onFlowActionValidateConfig(args, state) {
    this.logger.info("🔍 Manual configuration validation triggered");
    await this.updateConfigAlarm();
    return true;
  }

  hasFormulaTimedOut(formulaId) {
    const formula = this.formulas.find((f) => f.id === formulaId);
    return !!(formula && formula.timedOut);
  }

  startTimeoutChecks() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }
    this.timeoutInterval = setInterval(() => {
      this.checkTimeouts();
    }, 1000);
    this.logger.debug("Started timeout check interval.", {});
  }

  checkTimeouts() {
    const now = Date.now();
    this.formulas.forEach((formula) => {
      if (
        !formula.enabled ||
        formula.timedOut ||
        !formula.timeout ||
        formula.timeout <= 0
      )
        return;

      const requiredInputs = this.parseExpression(formula.expression);
      if (
        requiredInputs.length === 0 ||
        requiredInputs.every(
          (id) => formula.inputStates[id.toLowerCase()] !== "undefined",
        )
      ) {
        return;
      }

      if (!formula.lastInputTime) return;

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
        try {
          const card =
            this.homey.flow.getDeviceTriggerCard("formula_timeout_lu");
          card
            .trigger(this, triggerData, state)
            .catch((err) => this.logger.error("timeout.error", err));
        } catch (e) {
          if (e.message && e.message.includes("Invalid Flow Card ID")) {
            this.logger.error(
              `FATAL: Trigger card 'formula_timeout' not found. Check app.json/compose flow definitions.`,
              e,
            );
          } else {
            this.logger.error(
              this.homey.__("errors.trigger_timeout_card_failed"),
              e,
            );
          }
        }
      }
    });
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.logger.info("settings.changed", {
      keys: changedKeys.join(", "),
    });
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }

    // When formulas change, use newSettings directly instead of cached getSettings()
    if (changedKeys.includes("formulas")) {
      this.logger.debug(
        "Initializing formulas from newSettings (not cached)...",
        {},
      );
      try {
        const formulasData = newSettings.formulas
          ? JSON.parse(newSettings.formulas)
          : [];
        if (!Array.isArray(formulasData)) {
          this.logger.error("errors.invalid_formula", {
            message: "Formulas setting is not an array.",
          });
          this.formulas = [];
        } else {
          this.formulas = formulasData.map((f) => ({
            id: f.id || `formula_${Math.random().toString(16).slice(2)}`,
            name: f.name || this.homey.__("formula.unnamed_formula"),
            expression: f.expression || "",
            enabled: f.enabled !== false,
            timeout: Number(f.timeout) || 0,
            firstImpression: !!f.firstImpression,
            inputStates: {},
            lockedInputs: {},
            lastInputTime: null,
            result: null,
            timedOut: false,
            sessionComplete: false,
          }));
        }

        this.formulas.forEach((formula) => {
          this.availableInputs.forEach((id) => {
            formula.inputStates[id] = "undefined";
            formula.lockedInputs[id] = false;
          });
        });
      } catch (e) {
        this.logger.error("errors.invalid_formula", e);
        this.formulas = [];
      }

      if (this.formulas.length === 0) {
        this.logger.warn(
          "No valid formulas found in settings, creating default.",
          {},
        );
        const defaultFormula = {
          id: "formula_1",
          name: this.homey.__
            ? this.homey.__("formula.default_name_alt")
            : this.homey.__("formula.default_name_alt_fallback"),
          expression: this.getDefaultExpression(),
          enabled: true,
          timeout: 0,
          firstImpression: false,
          inputStates: {},
          lockedInputs: {},
          lastInputTime: null,
          result: null,
          timedOut: false,
          sessionComplete: false,
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
      this.formulas.forEach((f) =>
        this.logger.debug("formula.details", {
          name: f.name,
          expression: f.expression,
          enabled: f.enabled,
        }),
      );
    } else {
      // For other setting changes, use the normal initializeFormulas
      await this.initializeFormulas();
    }

    if (changedKeys.includes("formulas")) {
      for (const formula of this.formulas) {
        const validation = this.validateExpression(formula.expression);
        if (!validation.valid) {
          this.homey.notifications
            .createNotification({
              excerpt: this.homey.__("notifications.invalid_formula_config", {
                formulaName: formula.name,
                error: validation.error,
              }),
            })
            .catch((e) =>
              this.logger.error(
                this.homey.__("errors.notification_failed_invalid_formula"),
                e,
              ),
            );
          this.logger.error(
            `Invalid formula configuration saved for '${formula.name}'`,
            {
              error: validation.error,
            },
          );
        }
      }

      // Update alarm_config based on validation results
      await this.updateConfigAlarm();
    }

    await this.evaluateAllFormulasInitial();

    this.startTimeoutChecks();
    this.logger.info("settings.applied", {});

    const formatSettings = {};
    let needsFormat = false;
    if (changedKeys.includes("formulas")) {
      try {
        const parsed = JSON.parse(newSettings.formulas);
        const formatted = JSON.stringify(parsed, null, 2);
        if (formatted !== newSettings.formulas) {
          formatSettings.formulas = formatted;
          needsFormat = true;
          this.logger.debug("settings.formatting", {
            type: "formulas",
          });
        }
      } catch (e) {}
    }
    if (needsFormat) {
      setTimeout(async () => {
        try {
          this.logger.debug("settings.applying_formatted", {});
          await this.setSettings(formatSettings);
          this.logger.info("settings.auto_formatted", {});
        } catch (e) {
          this.logger.error("settings.format_failed", e);
        }
      }, 500);
    }
  }

  async checkSettingsChanged() {
    const currentSettings = this.getSettings();
    const currentFormulas = currentSettings.formulas;

    // Check if formulas have changed
    if (this.lastKnownFormulas !== currentFormulas) {
      this.logger.info("⚙️  Settings changed detected, reloading and validating...");

      // Update stored value
      this.lastKnownFormulas = currentFormulas;

      // Reinitialize formulas and validate
      await this.initializeFormulas();

      // This will update the alarm_config capability
      await this.updateConfigAlarm();

      // Re-evaluate formulas with new settings
      await this.evaluateAllFormulasInitial();

      this.logger.info("✅ Settings reloaded and validated");
    }
  }

  async onDeleted() {
    this._isDeleting = true;
    this.logger.device("device.deleted_cleanup", {
      name: this.getName(),
    });
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }
    if (this.settingsPoller) {
      clearInterval(this.settingsPoller);
      this.settingsPoller = null;
    }
    this.logger.info("device.cleanup_complete", {
      name: this.getName(),
    });
  }


// --- Async venting for condition-kort ---
_sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Vent til formelen har et bestemt (ikke-null) resultat ELLER har timet ut
 * Avslutter også hvis enheten slettes (onDeleted).
 */
async _waitForFormulaResolution(formula, maxWaitMs) {
  const start = Date.now();
  while (!this._isDeleting) {
    if (formula.result !== null) return;        // fikk true/false
    if (formula.timedOut === true) return;      // timeout slo inn (se checkTimeouts)
    if (Date.now() - start >= maxWaitMs) return; // sikkerhetsnett
    await this._sleep(50);
  }
}

};