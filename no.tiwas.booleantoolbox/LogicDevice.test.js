'use strict';

jest.mock('homey', () => ({
  Device: class {},
  Driver: class {},
}), { virtual: true });

const LogicDeviceDevice = require('./drivers/logic-device/device');
const LogicDeviceDriver = require('./drivers/logic-device/driver');

function createLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    flow: jest.fn(),
    info: jest.fn(),
    input: jest.fn(),
    warn: jest.fn(),
  };
}

function createLogicDeviceHarness(api) {
  const device = Object.create(LogicDeviceDevice.prototype);
  device.logger = createLogger();
  device.homey = {
    app: {
      api: null,
      ensureHomeyApi: jest.fn(async () => api),
    },
  };
  device.formulas = [
    {
      id: 'formula_1',
      inputStates: { a: 'undefined', b: 'undefined' },
      lastInputTime: null,
    },
  ];
  return device;
}

function createSettingsHarness() {
  const device = Object.create(LogicDeviceDevice.prototype);
  device.logger = createLogger();
  device.homey = {
    __: (key, vars) => (vars?.message ? `${key}: ${vars.message}` : key),
  };
  device.getData = jest.fn(() => ({ numInputs: 2 }));
  device.numInputs = 2;
  device.availableInputs = ['a', 'b'];
  return device;
}

describe('LogicDeviceDevice linked inputs', () => {
  test('fetches initial values through ensureHomeyApi during startup', async () => {
    const api = {
      devices: {
        getDevice: jest.fn(async () => ({
          capabilitiesObj: {
            alarm_generic: { value: true },
          },
        })),
      },
    };
    const device = createLogicDeviceHarness(api);

    await device.fetchInitialValues([
      { input: 'A', deviceId: 'logic-group-id', capability: 'alarm_generic' },
    ]);

    expect(device.homey.app.ensureHomeyApi).toHaveBeenCalledTimes(1);
    expect(api.devices.getDevice).toHaveBeenCalledWith({ id: 'logic-group-id' });
    expect(device.formulas[0].inputStates.a).toBe(true);
    expect(device.formulas[0].lastInputTime).toEqual(expect.any(Number));
  });

  test('registers listeners through ensureHomeyApi and normalizes input ids', async () => {
    let registeredListener = null;
    const destroy = jest.fn();
    const api = {
      devices: {
        getDevice: jest.fn(async () => ({
          name: 'Motion Logic Group',
          capabilities: ['alarm_generic'],
          makeCapabilityInstance: jest.fn((capability, listener) => {
            registeredListener = listener;
            return { destroy };
          }),
        })),
      },
    };
    const device = createLogicDeviceHarness(api);
    device.deviceListeners = new Map();
    device.setInputForFormula = jest.fn(async () => true);

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'logic-group-id',
      capability: 'alarm_generic',
      deviceName: 'Motion Logic Group',
    });
    await registeredListener(true);

    expect(device.homey.app.ensureHomeyApi).toHaveBeenCalledTimes(1);
    expect(device.deviceListeners.has('a-logic-group-id-alarm_generic')).toBe(true);
    expect(device.setInputForFormula).toHaveBeenCalledWith('formula_1', 'a', true);
  });
});

describe('LogicDeviceDevice settings validation', () => {
  test('rejects multiple formulas in the active onSettings handler', async () => {
    const device = createSettingsHarness();

    await expect(device.onSettings({
      newSettings: {
        formulas: JSON.stringify([
          { id: 'f1', name: 'One', expression: 'A', enabled: true },
          { id: 'f2', name: 'Two', expression: 'B', enabled: true },
        ]),
      },
      changedKeys: ['formulas'],
    })).rejects.toThrow('Logic Device kan kun ha');
  });

  test('rejects duplicate linked inputs in the active onSettings handler', async () => {
    const device = createSettingsHarness();

    await expect(device.onSettings({
      newSettings: {
        input_links: JSON.stringify([
          { input: 'a', deviceId: 'one', capability: 'alarm_generic' },
          { input: 'A', deviceId: 'two', capability: 'alarm_generic' },
        ]),
      },
      changedKeys: ['input_links'],
    })).rejects.toThrow('Input "A" er linket flere ganger');
  });

  test('settings poller refetches inputs with the existing refetch method', async () => {
    const device = createSettingsHarness();
    device.lastKnownFormulas = 'old-formulas';
    device.lastKnownInputLinks = 'old-links';
    device.getSettings = jest.fn(() => ({
      formulas: 'new-formulas',
      input_links: 'new-links',
    }));
    device.initializeFormulas = jest.fn(async () => {});
    device.setupDeviceLinks = jest.fn(async () => {});
    device.updateConfigAlarm = jest.fn(async () => {});
    device.refetchInputsAndEvaluate = jest.fn(async () => {});

    await device.checkSettingsChanged();

    expect(device.refetchInputsAndEvaluate).toHaveBeenCalledWith('settings_changed');
  });
});

describe('LogicDeviceDriver flow cards', () => {
  test('registers formula_result_is_ld condition card', async () => {
    const conditionListeners = {};
    const createCard = (id) => ({
      id,
      registerRunListener: jest.fn((listener) => {
        conditionListeners[id] = listener;
      }),
    });
    const driver = Object.create(LogicDeviceDriver.prototype);
    driver.id = 'logic-device';
    driver.logger = createLogger();
    driver.homey = {
      __: (key) => key,
      flow: {
        getActionCard: jest.fn((id) => createCard(id)),
        getConditionCard: jest.fn((id) => createCard(id)),
        getDeviceTriggerCard: jest.fn((id) => createCard(id)),
        getTriggerCard: jest.fn((id) => createCard(id)),
      },
    };
    const device = {
      getName: () => 'Bedtime Group',
      onFlowCondition: jest.fn(async () => true),
    };

    await driver.registerFlowCards();
    const result = await conditionListeners.formula_result_is_ld(
      { device, what_is: 'true' },
      {},
    );

    expect(result).toBe(true);
    expect(device.onFlowCondition).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      true,
    );
  });
});
