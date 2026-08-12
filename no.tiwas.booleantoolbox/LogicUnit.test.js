"use strict";

jest.mock("homey", () => ({
  Device: class {},
  Driver: class {},
}), { virtual: true });

const FormulaEvaluator = require("./lib/FormulaEvaluator");
const LogicUnitDevice = require("./drivers/logic-unit/device");
const BaseLogicDriver = require("./lib/BaseLogicDriver");

function createLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    flow: jest.fn(),
    formula: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
}

function createTriggerCard() {
  return {
    registerArgumentAutocompleteListener: jest.fn(),
    registerRunListener: jest.fn(),
    trigger: jest.fn(async () => {}),
  };
}

function createLogicUnit(formulas) {
  const device = Object.create(LogicUnitDevice.prototype);
  const capabilityValues = new Map([
    ["alarm_generic", false],
    ["onoff", true],
  ]);
  const triggerCards = new Map([
    ["formula_changed_lu", createTriggerCard()],
    ["formula_changed_to_lu", createTriggerCard()],
    ["formula_changed_to_true", createTriggerCard()],
    ["formula_changed_to_false", createTriggerCard()],
    ["formula_changed_to_true_lu_deprecated", createTriggerCard()],
    ["formula_changed_to_false_lu_deprecated", createTriggerCard()],
  ]);

  device.logger = createLogger();
  device.driver = { id: "logic-unit" };
  device.formulaEvaluator = new FormulaEvaluator();
  device.numInputs = 2;
  device.availableInputs = ["a", "b"];
  device.formulas = formulas;
  device.homey = {
    flow: {
      getDeviceTriggerCard: jest.fn(cardId => triggerCards.get(cardId)),
    },
  };
  device.getName = jest.fn(() => "Motion Formula");
  device.hasCapability = jest.fn(capabilityId => capabilityValues.has(capabilityId));
  device.getCapabilityValue = jest.fn(capabilityId => capabilityValues.get(capabilityId));
  device.setCapabilityValue = jest.fn(async (capabilityId, value) => {
    capabilityValues.set(capabilityId, value);
  });
  device.capabilityValues = capabilityValues;
  device.triggerCards = triggerCards;
  return device;
}

function createFormula(overrides = {}) {
  return {
    id: "f1",
    name: "My Formula",
    expression: "A+B",
    enabled: true,
    firstImpression: false,
    inputStates: { a: "undefined", b: "undefined" },
    lockedInputs: { a: false, b: false },
    lastInputTime: null,
    result: null,
    timedOut: false,
    sessionComplete: false,
    ...overrides,
  };
}

describe("Logic Unit formula results", () => {
  test("syncs A+B to alarm_generic and fires both formula-change cards", async () => {
    const device = createLogicUnit([createFormula()]);

    await device.setInputForFormula("f1", "a", true);
    expect(device.capabilityValues.get("alarm_generic")).toBe(false);

    await device.setInputForFormula("f1", "b", false);
    expect(device.getFormulaResult("f1")).toBe(true);
    expect(device.capabilityValues.get("alarm_generic")).toBe(true);
    expect(device.triggerCards.get("formula_changed_lu").trigger).not.toHaveBeenCalled();

    await device.setInputForFormula("f1", "a", false);
    expect(device.getFormulaResult("f1")).toBe(false);
    expect(device.capabilityValues.get("alarm_generic")).toBe(false);
    expect(device.triggerCards.get("formula_changed_lu").trigger).toHaveBeenCalledWith(
      device,
      {
        device_name: "Motion Formula",
        formula_name: "My Formula",
        result: false,
        previous_result: true,
      },
      {
        formula_id: "f1",
        result: false,
        previous_result: true,
      },
    );
    expect(device.triggerCards.get("formula_changed_to_lu").trigger)
      .toHaveBeenCalledTimes(1);
    expect(device.triggerCards.get("formula_changed_to_false").trigger)
      .toHaveBeenCalledTimes(1);
  });

  test("keeps the aggregate alarm on while any enabled formula is true", async () => {
    const device = createLogicUnit([
      createFormula({ id: "f1", name: "First", expression: "A" }),
      createFormula({ id: "f2", name: "Second", expression: "B" }),
    ]);

    await device.setInputForFormula("f1", "a", true);
    await device.setInputForFormula("f2", "b", false);
    expect(device.capabilityValues.get("alarm_generic")).toBe(true);

    await device.setInputForFormula("f1", "a", false);
    expect(device.capabilityValues.get("alarm_generic")).toBe(false);
  });
});

describe("Logic Unit formula Flow cards", () => {
  test("registers device triggers and filters by formula and result", async () => {
    const cards = new Map();
    const getCard = (id) => {
      if (!cards.has(id)) cards.set(id, createTriggerCard());
      return cards.get(id);
    };
    const driver = Object.create(BaseLogicDriver.prototype);
    driver.id = "logic-unit";
    driver.logger = createLogger();
    driver.homey = {
      __: key => key,
      flow: {
        getActionCard: jest.fn(getCard),
        getConditionCard: jest.fn(getCard),
        getDeviceTriggerCard: jest.fn(getCard),
        getTriggerCard: jest.fn(getCard),
      },
    };

    await driver.registerFlowCards();

    const changedListener = cards.get("formula_changed_lu")
      .registerRunListener.mock.calls[0][0];
    const changedToListener = cards.get("formula_changed_to_lu")
      .registerRunListener.mock.calls[0][0];

    await expect(changedListener(
      { formula: { id: "f1" } },
      { formula_id: "f1", result: true },
    )).resolves.toBe(true);
    await expect(changedListener(
      { formula: { id: "f2" } },
      { formula_id: "f1", result: true },
    )).resolves.toBe(false);
    await expect(changedToListener(
      { formula: { id: "f1" }, result: "true" },
      { formula_id: "f1", result: true },
    )).resolves.toBe(true);
    await expect(changedToListener(
      { formula: { id: "f1" }, result: { id: "false" } },
      { formula_id: "f1", result: true },
    )).resolves.toBe(false);
    expect(driver.homey.flow.getDeviceTriggerCard)
      .toHaveBeenCalledWith("formula_changed_lu");
    expect(driver.homey.flow.getDeviceTriggerCard)
      .toHaveBeenCalledWith("formula_changed_to_lu");
  });
});
