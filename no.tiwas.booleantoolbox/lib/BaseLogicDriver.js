"use strict";
const Homey = require("homey");
const Logger = require("./Logger");

/**
 * Autocomplete helper for formula selection in flow cards.
 *
 * Retrieves available formulas from the device and filters by query.
 *
 * @param {string} query - Search query for filtering formulas
 * @param {Object} args - Flow card arguments containing device reference
 * @returns {Promise<Array>} Filtered list of formulas for autocomplete
 *
 * Called by:
 *   - BaseLogicDriver.registerAutocomplete() - For formula argument autocomplete
 *
 * Calls:
 *   - device.getFormulas() - Get available formulas from device
 */
async function formulaAutocompleteHelper(query, args) {
    const device = args.device;
    if (!device || typeof device.getFormulas !== "function") {
        console.warn(
            `formulaAutocompleteHelper: Invalid device or missing getFormulas in args for autocomplete.`,
        );
        return [];
    }
    try {
        const formulas = device.getFormulas();
        if (!Array.isArray(formulas)) {
            console.warn(
                `getFormulas didn't return array for ${device.getName()}.`,
            );
            return [];
        }
        const lowerQuery = query ? query.toLowerCase() : "";
        return formulas.filter(
            (f) =>
                f &&
                f.name &&
                (!query || f.name.toLowerCase().includes(lowerQuery)),
        );
    } catch (e) {
        console.error(
            `Error in formulaAutocompleteHelper for ${device.getName()}`,
            e,
        );
        return [];
    }
}

/**
 * Autocomplete helper for input selection in flow cards.
 *
 * Retrieves available inputs (A, B, C, etc.) from the device and filters by query.
 *
 * @param {string} query - Search query for filtering inputs
 * @param {Object} args - Flow card arguments containing device reference
 * @returns {Promise<Array>} Filtered list of inputs for autocomplete
 *
 * Called by:
 *   - BaseLogicDriver.registerAutocomplete() - For input argument autocomplete
 *
 * Calls:
 *   - device.getInputOptions() - Get available inputs from device
 */
async function inputAutocompleteHelper(query, args) {
    const device = args.device;
    if (!device || typeof device.getInputOptions !== "function") {
        console.warn(
            `inputAutocompleteHelper: Invalid device or missing getInputOptions in args for autocomplete.`,
        );
        return [];
    }
    try {
        const inputs = device.getInputOptions(args);
        if (!Array.isArray(inputs)) {
            console.warn(
                `getInputOptions didn't return array for ${device.getName()}.`,
            );
            return [];
        }
        const lowerQuery = query ? query.toLowerCase() : "";
        return inputs.filter(
            (i) =>
                i &&
                i.name &&
                (!query || i.name.toLowerCase().includes(lowerQuery)),
        );
    } catch (e) {
        console.error(
            `Error in inputAutocompleteHelper for ${device.getName()}`,
            e,
        );
        return [];
    }
}
// --- End Autocomplete Helper Functions ---

/**
 * BaseLogicDriver - Base class for all Logic Unit drivers
 *
 * Handles driver-level functionality shared across all Logic Unit types:
 * - Flow card registration (triggers, conditions, actions)
 * - Device pairing workflow
 * - Autocomplete registration for flow card arguments
 * - Unique device name generation
 *
 * Uses a static flag to ensure shared flow cards are only registered once
 * by the first Logic Unit driver instance that initializes.
 *
 * Called by:
 *   - drivers/logic-unit-2..10/driver.js - Extends this class
 *   - Homey runtime - For driver lifecycle
 *
 * Calls:
 *   - Logger - For logging operations
 *   - Homey.Driver methods - Flow card registration
 *   - formulaAutocompleteHelper - Formula autocomplete
 *   - inputAutocompleteHelper - Input autocomplete
 *
 * @class BaseLogicDriver
 * @extends Homey.Driver
 */
class BaseLogicDriver extends Homey.Driver {
    /** @static Flag to prevent duplicate flow card registration */
    static logicUnitCardsRegistered = false;

    /**
     * Initializes the driver when the app starts.
     *
     * Parses the number of inputs from the driver ID, initializes logger,
     * and registers shared flow cards (only once across all Logic Unit drivers).
     *
     * Called by:
     *   - Homey runtime - When app starts
     *
     * Calls:
     *   - Logger constructor - Create driver logger
     *   - BaseLogicDriver.registerFlowCards() - Register flow cards (once)
     */
    async onInit() {
        const driverName = `Driver: ${this.id}`;
        this.logger = new Logger(this, driverName);

        // Set numInputs based on driver ID
        const driverId = this.id;
        let numInputsParsed = 2;
        try {
            const parts = driverId.split("-");
            const numStr = parts[parts.length - 1];
            const num = parseInt(numStr);
            if (!isNaN(num) && num > 0) {
                numInputsParsed = num;
            } else if (driverId !== "logic-device") {
                this.logger.warn(
                    `Could not parse number of inputs from driver ID '${driverId}'. Using default: ${numInputsParsed}.`,
                    {},
                );
            }
        } catch (e) {
            this.logger.error(
                `Error parsing numInputs from driver ID '${driverId}'. Using default: ${numInputsParsed}.`,
                e,
            );
        }
        this.numInputs = numInputsParsed;

        this.logger.info("driver.ready", {
            driverId: this.id,
            numInputs: this.numInputs,
        });

        if (!BaseLogicDriver.logicUnitCardsRegistered) {
            this.logger.info(
                "First Logic Unit driver initializing. Registering shared flow cards...",
            );
            await this.registerFlowCards();
            BaseLogicDriver.logicUnitCardsRegistered = true;
        } else {
            this.logger.debug(
                "Shared flow cards already registered by another Logic Unit driver.",
            );
        }
    }

    async registerFlowCards() {
        this.logger.debug("driver.registering_flow_cards");

        // ===== DEPRECATED TRIGGERS (for backward compatibility) =====
        
        // Deprecated: Formula changed to FALSE (old separate card)
        try {
            const formulaChangedToFalseCard = this.homey.flow.getTriggerCard("formula_changed_to_false_lu_deprecated");
            formulaChangedToFalseCard.registerRunListener(async (args, state) => {
                return (
                    args &&
                    args.device &&
                    args.device.driver &&
                    args.device.driver.id &&
                    args.device.driver.id.startsWith("logic-unit-") &&
                    state?.result === false
                );
            });
            this.registerAutocomplete(formulaChangedToFalseCard, "formula", formulaAutocompleteHelper);
            this.logger.debug(` -> OK: DEPRECATED TRIGGER registered: 'formula_changed_to_false_lu_deprecated'`);
        } catch (e) {
            this.logger.warn(` -> SKIP: Deprecated trigger 'formula_changed_to_false_lu_deprecated' not found`);
        }

        // Deprecated: Formula changed to TRUE (old separate card)
        try {
            const formulaChangedToTrueCard = this.homey.flow.getTriggerCard("formula_changed_to_true_lu_deprecated");
            formulaChangedToTrueCard.registerRunListener(async (args, state) => {
                return (
                    args &&
                    args.device &&
                    args.device.driver &&
                    args.device.driver.id &&
                    args.device.driver.id.startsWith("logic-unit-") &&
                    state?.result === true
                );
            });
            this.registerAutocomplete(formulaChangedToTrueCard, "formula", formulaAutocompleteHelper);
            this.logger.debug(` -> OK: DEPRECATED TRIGGER registered: 'formula_changed_to_true_lu_deprecated'`);
        } catch (e) {
            this.logger.warn(` -> SKIP: Deprecated trigger 'formula_changed_to_true_lu_deprecated' not found`);
        }

        // ===== NEW IMPROVED TRIGGERS =====
        
        // New: Formula changed to [dropdown selection] (combined card)
        const formulaChangedToCard = this.homey.flow.getTriggerCard("formula_changed_to_lu");
        formulaChangedToCard.registerRunListener(async (args, state) => {
            const expectedResult = args.result === "true";
            return (
                args &&
                args.device &&
                args.device.driver &&
                args.device.driver.id &&
                args.device.driver.id.startsWith("logic-unit-") &&
                state?.result === expectedResult
            );
        });
        this.registerAutocomplete(formulaChangedToCard, "formula", formulaAutocompleteHelper);
        this.logger.debug(` -> OK: NEW TRIGGER registered: 'formula_changed_to_lu'`);

        // ===== EXISTING TRIGGERS (unchanged) =====
        
        // Existing: Formula timeout
        const formulaTimeoutCard = this.homey.flow.getTriggerCard("formula_timeout_lu");
        formulaTimeoutCard.registerRunListener(async (args, state) => {
            return (
                args &&
                args.device &&
                args.device.driver &&
                args.device.driver.id &&
                args.device.driver.id.startsWith("logic-unit-")
            );
        });
        this.registerAutocomplete(formulaTimeoutCard, "formula", formulaAutocompleteHelper);
        this.logger.debug(` -> OK: EXISTING TRIGGER registered: 'formula_timeout_lu'`);

        // New: Configuration alarm changed to [dropdown selection]
        const configAlarmChangedToCard = this.homey.flow.getTriggerCard("config_alarm_changed_to_lu");
        configAlarmChangedToCard.registerRunListener(async (args, state) => {
            const expectedAlarmState = args.alarm_state === "true";
            return (
                args &&
                args.device &&
                args.device.driver &&
                args.device.driver.id &&
                args.device.driver.id.startsWith("logic-unit-") &&
                state?.alarm_state === expectedAlarmState
            );
        });
        this.logger.debug(` -> OK: NEW TRIGGER registered: 'config_alarm_changed_to_lu'`);

        // New: Configuration alarm state changed (no dropdown, triggers on any state change)
        const configAlarmStateChangedCard = this.homey.flow.getTriggerCard("config_alarm_state_changed_lu");
        configAlarmStateChangedCard.registerRunListener(async (args, state) => {
            return (
                args &&
                args.device &&
                args.device.driver &&
                args.device.driver.id &&
                args.device.driver.id.startsWith("logic-unit-")
            );
        });
        this.logger.debug(` -> OK: NEW TRIGGER registered: 'config_alarm_state_changed_lu'`);

        // ===== ACTIONS (unchanged) =====
        
        const actionCards = [
            {
                id: "set_input_value_lu",
                handler: "onFlowActionSetInput",
            },
            {
                id: "evaluate_formula_lu",
                handler: "onFlowActionEvaluateFormula",
            },
            {
                id: "evaluate_all_formulas_lu",
                handler: "onFlowActionReEvaluateAll",
            },
            {
                id: "clear_error_state_lu",
                handler: "onFlowActionClearError",
            },
            {
                id: "validate_config_lu",
                handler: "onFlowActionValidateConfig",
            },
            {
                id: "set_all_inputs_lu",
                handler: "setAllInputsFromFlow",
            },
            {
                id: "set_input_lu",
                handler: "setInputForAllFormulasFromFlow",
            },
        ];
        actionCards.forEach((cardInfo) => {
            try {
                const card = this.homey.flow.getActionCard(cardInfo.id);
                card.registerRunListener(async (args, state) => {
                    const device = args.device;
                    if (!device)
                        throw new Error(
                            this.homey.__("errors.invalid_device_instance"),
                        );
                    const methodName = cardInfo.handler;
                    if (typeof device[methodName] !== "function")
                        throw new Error(
                            this.homey.__("errors.method_missing_on_device", {
                                methodName,
                            }),
                        );
                    this.logger.flow(
                        `Executing ACTION '${cardInfo.id}' on device ${device.getName()}`,
                    );
                    return await device[methodName](args, state);
                });

                // --- Autocomplete ---
                if (
                    [
                        "set_input_value_lu",
                        "evaluate_formula_lu",
                        "clear_error_state_lu",
                    ].includes(cardInfo.id)
                ) {
                    this.registerAutocomplete(
                        card,
                        "formula",
                        formulaAutocompleteHelper,
                    );
                }
                if (
                    ["set_input_value_lu", "set_input_lu"].includes(cardInfo.id)
                ) {
                    this.registerAutocomplete(
                        card,
                        "input",
                        inputAutocompleteHelper,
                    );
                }
                this.logger.debug(
                    ` -> OK: ACTION card registered: '${cardInfo.id}'`,
                );
            } catch (e) {
                this.logger.error(
                    ` -> FAILED: Registering ACTION card '${cardInfo.id}'`,
                    e,
                );
            }
        });

        // ===== CONDITIONS (existing + new with dropdowns) =====
        
        const conditionCards = [
            {
                id: "formula_has_timed_out_lu",
                checkType: "timeout",
            },
            {
                id: "formula_result_is_lu",
                checkTypeFromArg: "what_is",
            },
            {
                id: "has_any_error_lu",
                checkType: "has_error",
            },
        ];
        conditionCards.forEach((cardInfo) => {
            try {
                const card = this.homey.flow.getConditionCard(cardInfo.id);
                card.registerRunListener(async (args, state) => {
                    const device = args.device;
                    if (!device) return false;
                    if (typeof device.onFlowCondition !== "function")
                        return false;

                    let checkType;
                    if (cardInfo.checkType) {
                        checkType = cardInfo.checkType;
                    } else if (cardInfo.checkTypeFromArg) {
                        checkType = args[cardInfo.checkTypeFromArg] === "true";
                    }

                    this.logger.flow(
                        `Executing CONDITION '${cardInfo.id}' on device ${device.getName()}`,
                    );
                    return await device.onFlowCondition(args, state, checkType);
                });

                if (
                    [
                        "formula_has_timed_out_lu",
                        "formula_result_is_lu",
                    ].includes(cardInfo.id)
                ) {
                    this.registerAutocomplete(
                        card,
                        "formula",
                        formulaAutocompleteHelper,
                    );
                }
                this.logger.debug(
                    ` -> OK: CONDITION card registered: '${cardInfo.id}'`,
                );
            } catch (e) {
                this.logger.error(
                    ` -> FAILED: Registering CONDITION card '${cardInfo.id}'`,
                    e,
                );
            }
        });

        // ===== NEW CONDITIONS WITH DROPDOWNS =====
        
        // New: Logic Unit is turned [dropdown selection]
        try {
            const unitIsTurnedCard = this.homey.flow.getConditionCard("unit_is_turned_lu");
            unitIsTurnedCard.registerRunListener(async (args, state) => {
                const device = args.device;
                if (!device) return false;
                
                const expectedOnState = args.on_state === "true";
                const currentOnState = device.getCapabilityValue("onoff");
                
                this.logger.flow(
                    `Executing CONDITION 'unit_is_turned_lu' on device ${device.getName()}: expected=${expectedOnState}, current=${currentOnState}`,
                );
                
                return currentOnState === expectedOnState;
            });
            this.logger.debug(` -> OK: NEW CONDITION registered: 'unit_is_turned_lu'`);
        } catch (e) {
            this.logger.warn(` -> SKIP: New condition 'unit_is_turned_lu' not found`);
        }

        // New: Logic Unit alarm is [dropdown selection]
        try {
            const unitAlarmIsCard = this.homey.flow.getConditionCard("unit_alarm_is_lu");
            unitAlarmIsCard.registerRunListener(async (args, state) => {
                const device = args.device;
                if (!device) return false;
                
                const expectedAlarmState = args.alarm_state === "true";
                const currentAlarmState = device.getCapabilityValue("alarm_generic");
                
                this.logger.flow(
                    `Executing CONDITION 'unit_alarm_is_lu' on device ${device.getName()}: expected=${expectedAlarmState}, current=${currentAlarmState}`,
                );
                
                return currentAlarmState === expectedAlarmState;
            });
            this.logger.debug(` -> OK: NEW CONDITION registered: 'unit_alarm_is_lu'`);
        } catch (e) {
            this.logger.warn(` -> SKIP: New condition 'unit_alarm_is_lu' not found`);
        }
    }

    // --- Helper for Autocomplete Registration ---
    registerAutocomplete(card, argName, helperFn) {
        try {
            if (typeof helperFn !== "function") {
                throw new Error(
                    this.homey.__("errors.helper_not_function", { argName }),
                );
            }
            card.registerArgumentAutocompleteListener(
                argName,
                async (query, args) => {
                    const device = args?.device;

                    if (argName === "formula" || argName === "input") {
                        if (!device) {
                            this.logger.warn(
                                `Autocomplete for device arg '${argName}' on card '${card.id}' called without device context.`,
                            );
                            return [];
                        }

                        let requiredMethod = "";
                        if (argName === "formula")
                            requiredMethod = "getFormulas";
                        if (argName === "input")
                            requiredMethod = "getInputOptions";

                        if (typeof device[requiredMethod] !== "function") {
                            this.logger.warn(
                                `Autocomplete for device arg '${argName}' on card '${card.id}': Device ${device.getName()} missing method ${requiredMethod}.`,
                            );
                            return [];
                        }
                    }

                    try {
                        return await helperFn(query, args);
                    } catch (autocompleteError) {
                        this.logger.error(
                            `Error during autocomplete for ${argName} on card '${card.id}'`,
                            autocompleteError,
                        );
                        return [];
                    }
                },
            );
            this.logger.debug(
                `Registered ${argName.toUpperCase()} autocomplete for card '${card.id}'`,
            );
        } catch (e) {
            this.logger.error(
                ` -> FAILED to register autocomplete for '${argName}' on card '${card.id}'`,
                e,
            );
        }
    }

    async ensureUniqueDeviceName(name) {
        try {
            if (
                !this.homey.app ||
                !this.homey.app.api ||
                typeof this.homey.app.api.devices?.getDevices !== "function"
            ) {
                this.logger.warn(
                    "ensureUniqueDeviceName: Homey API (via app) not ready, returning original name.",
                    {},
                );
                return String(name || "");
            }
            const all = await this.homey.app.api.devices.getDevices();
            if (!all || typeof all !== "object") {
                this.logger.error(
                    "ensureUniqueDeviceName: Unexpected response from getDevices:",
                    all,
                );
                return String(name || "");
            }
            const existingNames = new Set(
                Object.values(all)
                    .map((d) => (d?.name || "").trim())
                    .filter(Boolean),
            );

            const nameStr = String(name || "");
            if (!existingNames.has(nameStr)) return nameStr;

            const base = nameStr.replace(/\s+\d+$/, "").trim();
            const m = nameStr.match(/\s+(\d+)$/);
            let n = m ? parseInt(m[1], 10) + 1 : 2;
            if (isNaN(n)) n = 2; // Fallback

            let candidate = `${base} ${n}`;
            let safetyCounter = 0;
            while (existingNames.has(candidate) && safetyCounter < 100) {
                n++;
                candidate = `${base} ${n}`;
                safetyCounter++;
            }
            if (safetyCounter >= 100) {
                this.logger.error(
                    "ensureUniqueDeviceName: Could not find unique name after 100 attempts, returning original + timestamp.",
                    {},
                );
                return `${nameStr}-${Date.now()}`;
            }
            return candidate;
        } catch (e) {
            this.logger.error("driver.ensure_unique_failed", e);
            return String(name || "");
        }
    }

    async onPair(session) {
        this.logger.info("pair.session_started");

        let deviceName = this.homey.__("pair.name_placeholder");

        session.setHandler("set_device_name", async (data) => {
            this.logger.debug("pair.set_device_name", {
                name: data.name,
            });
            deviceName = String(
                data.name || this.homey.__("pair.name_placeholder"),
            );
            return {
                success: true,
            };
        });

        session.setHandler("create_device", async () => {
            this.logger.info("pair.create_device");

            const uniqueName = await this.ensureUniqueDeviceName(deviceName);

            const device = {
                name: uniqueName,
                data: {
                    id: `logic-unit-${this.numInputs}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    numInputs: this.numInputs,
                },
                settings: {
                    formulas: JSON.stringify(
                        [
                            {
                                id: "formula_1",
                                name:
                                    this.homey.__("formula.default_name_lu") ||
                                    "Main Formula",
                                expression: this.getDefaultExpression(),
                                enabled: true,
                                timeout: 0,
                                firstImpression: false,
                            },
                        ],
                        null,
                        2,
                    ),
                },
                capabilities: ["onoff", "alarm_generic"],
                capabilitiesOptions: {
                    onoff: {
                        setable: true,
                    },
                    alarm_generic: {
                        setable: false,
                    },
                },
                capabilityValues: {
                    onoff: true,
                    alarm_generic: false
                }
            };

            this.logger.info("pair.creating_device", {
                name: uniqueName,
            });
            this.logger.dump("Device data to be created", device);
            return device;
        });

        this.logger.debug("pair.handlers_registered");
    }

    getDefaultExpression() {
        const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        const inputsToUse = Math.min(this.numInputs, letters.length);
        if (inputsToUse <= 0) return "true";
        return letters.slice(0, inputsToUse).join(" AND ");
    }
}

module.exports = BaseLogicDriver;