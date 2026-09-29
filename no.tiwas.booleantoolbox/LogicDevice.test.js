'use strict';

jest.mock('homey', () => ({
  Device: class {},
  Driver: class {},
}), { virtual: true });

const LogicDeviceDevice = require('./drivers/logic-device/device');
const LogicDeviceDriver = require('./drivers/logic-device/driver');
const FormulaEvaluator = require('./lib/FormulaEvaluator');

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
            return {
              destroy,
            };
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

  test('drops a stale linked-input evaluation after a delayed capability write', async () => {
    const device = Object.create(LogicDeviceDevice.prototype);
    const capabilityValues = new Map([['alarm_generic', false], ['onoff', true]]);
    device.logger = createLogger();
    device.formulaEvaluator = new FormulaEvaluator();
    device.deviceEnabled = true;
    device.availableInputs = ['a'];
    device.getName = jest.fn(() => 'Logic Device');
    device.getData = jest.fn(() => ({ id: 'logic-device-id' }));
    device.formulas = [{
      id: 'formula_1', name: 'Latest wins', expression: 'A', enabled: true,
      inputStates: { a: false }, lockedInputs: {}, result: false, timedOut: false,
    }];
    device.getCapabilityValue = jest.fn(capabilityId => capabilityValues.get(capabilityId));
    device.hasCapability = jest.fn(() => true);
    device.fireAllRelevantTriggers = jest.fn(async () => {});
    let releaseFirstWrite;
    const firstWriteStarted = new Promise(resolve => { releaseFirstWrite = resolve; });
    let allowFirstWrite;
    const firstWriteReleased = new Promise(resolve => { allowFirstWrite = resolve; });
    let writes = 0;
    device.safeSetCapabilityValue = jest.fn(async (capabilityId, value) => {
      writes += 1;
      if (writes === 1) {
        releaseFirstWrite();
        await firstWriteReleased;
      }
      capabilityValues.set(capabilityId, value);
    });

    const older = device.setInputForFormula('formula_1', 'a', true);
    await firstWriteStarted;
    const newer = device.setInputForFormula('formula_1', 'a', false);
    allowFirstWrite();
    await Promise.all([older, newer]);

    expect(capabilityValues.get('alarm_generic')).toBe(false);
    expect(device.formulas[0].result).toBe(false);
    expect(device.fireAllRelevantTriggers).not.toHaveBeenCalled();
  });

  test('shares linked-input health refreshes across Logic Devices', async () => {
    const scheduleRefresh = jest.fn();
    const api = { devices: { scheduleRefresh } };
    const first = createLogicDeviceHarness(api);
    const second = createLogicDeviceHarness(api);
    first._isDeleting = false;
    second._isDeleting = false;
    first.inputLinks = [{ input: 'A' }];
    second.inputLinks = [{ input: 'A' }];
    first.setupDeviceListener = jest.fn(async () => {});
    second.setupDeviceListener = jest.fn(async () => {});

    await first.refreshDeviceLinkHealth();
    await second.refreshDeviceLinkHealth();

    expect(scheduleRefresh).toHaveBeenCalledTimes(1);
    expect(first.setupDeviceListener).toHaveBeenCalledWith(
      first.inputLinks[0],
      { replaceExisting: true },
    );
    expect(second.setupDeviceListener).toHaveBeenCalledWith(
      second.inputLinks[0],
      { replaceExisting: true },
    );
  });

  test('does not register a listener when deletion begins during source lookup', async () => {
    const device = createLogicDeviceHarness();
    const makeCapabilityInstance = jest.fn();
    device._isDeleting = false;
    device.deviceListeners = new Map();
    device.homey.app.ensureHomeyApi = jest.fn(async () => ({
      devices: {
        getDevice: jest.fn(async () => {
          device._isDeleting = true;
          return {
            name: 'Source',
            capabilities: ['alarm_generic'],
            makeCapabilityInstance,
          };
        }),
      },
    }));

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    });

    expect(makeCapabilityInstance).not.toHaveBeenCalled();
    expect(device.deviceListeners.size).toBe(0);
  });

  test('keeps a working listener when its health-check replacement cannot be created', async () => {
    const previousListener = { unregister: jest.fn(async () => {}) };
    const device = createLogicDeviceHarness({
      devices: { getDevice: jest.fn(async () => { throw new Error('offline'); }) },
    });
    device._isDeleting = false;
    device.deviceListeners = new Map([
      ['a-source-id-alarm_generic', previousListener],
    ]);

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(device.deviceListeners.get('a-source-id-alarm_generic')).toBe(previousListener);
    expect(previousListener.unregister).not.toHaveBeenCalled();
  });

  test('keeps the previous listener tracked when replacement cleanup fails', async () => {
    const previousListener = { unregister: jest.fn(async () => {
      throw new Error('destroy failed');
    }) };
    const destroyReplacement = jest.fn();
    const device = createLogicDeviceHarness({
      devices: {
        getDevice: jest.fn(async () => ({
          name: 'Source',
          capabilities: ['alarm_generic'],
          makeCapabilityInstance: jest.fn(() => ({ destroy: destroyReplacement })),
        })),
      },
    });
    device._isDeleting = false;
    device.deviceListeners = new Map([
      ['a-source-id-alarm_generic', previousListener],
    ]);

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(device.deviceListeners.get('a-source-id-alarm_generic')).toBe(previousListener);
    expect(destroyReplacement).toHaveBeenCalledTimes(1);
  });

  test('does not retain a replacement when deletion starts during listener cleanup', async () => {
    const destroyReplacement = jest.fn();
    const device = createLogicDeviceHarness({
      devices: {
        getDevice: jest.fn(async () => ({
          name: 'Source',
          capabilities: ['alarm_generic'],
          makeCapabilityInstance: jest.fn(() => ({ destroy: destroyReplacement })),
        })),
      },
    });
    const previousListener = { unregister: jest.fn(async () => {
      device._isDeleting = true;
      device.deviceListeners.clear();
    }) };
    device._isDeleting = false;
    device.deviceListeners = new Map([
      ['a-source-id-alarm_generic', previousListener],
    ]);

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(device.deviceListeners.size).toBe(0);
    expect(destroyReplacement).toHaveBeenCalledTimes(1);
  });

  function createReconcileHarness({ sourceValue, inputState, resubscribe = jest.fn(async () => true) }) {
    let registeredListener = null;
    const previousListener = { unregister: jest.fn(async () => {}) };
    const api = {
      __sctResubscribe: resubscribe,
      devices: {
        getDevice: jest.fn(async () => ({
          uri: 'homey:device:source-id',
          name: 'Source',
          capabilities: ['alarm_generic'],
          capabilitiesObj: { alarm_generic: { value: sourceValue } },
          makeCapabilityInstance: jest.fn((capability, listener) => {
            registeredListener = listener;
            return { destroy: jest.fn() };
          }),
        })),
      },
    };
    const device = createLogicDeviceHarness(api);
    device._isDeleting = false;
    device.formulas[0].inputStates.a = inputState;
    device.deviceListeners = new Map([['a-source-id-alarm_generic', previousListener]]);
    device.setInputForFormula = jest.fn(async () => true);
    return { device, api, resubscribe, getListener: () => registeredListener };
  }

  test('health check replays a missed linked value and recreates the realtime subscription', async () => {
    const { device, resubscribe } = createReconcileHarness({ sourceValue: true, inputState: false });

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(resubscribe).toHaveBeenCalledWith('homey:device:source-id');
    expect(device.setInputForFormula).toHaveBeenCalledWith('formula_1', 'a', true);
    expect(device.logger.warn).toHaveBeenCalledWith('listener.missed_update_recovered', {
      input: 'A',
      capability: 'alarm_generic',
    });
  });

  test('health check leaves matching linked values untouched', async () => {
    const { device, resubscribe } = createReconcileHarness({ sourceValue: true, inputState: true });

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(resubscribe).not.toHaveBeenCalled();
    expect(device.setInputForFormula).not.toHaveBeenCalled();
  });

  test('health check does not replay a snapshot older than a received event', async () => {
    const { device, resubscribe } = createReconcileHarness({ sourceValue: true, inputState: false });
    device.linkedInputEventAt = new Map([['a', Date.now() + 60000]]);

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(resubscribe).not.toHaveBeenCalled();
    expect(device.setInputForFormula).not.toHaveBeenCalled();
  });

  test('health check does not replay the snapshot over an event received while resubscribing', async () => {
    const harness = createReconcileHarness({ sourceValue: true, inputState: false });
    const { device, resubscribe } = harness;
    resubscribe.mockImplementation(async () => {
      // The source changes again while the subscription is being replaced.
      await harness.getListener()(false);
      return true;
    });

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(resubscribe).toHaveBeenCalledWith('homey:device:source-id');
    expect(device.setInputForFormula).toHaveBeenCalledTimes(1);
    expect(device.setInputForFormula).toHaveBeenCalledWith('formula_1', 'a', false);
    expect(device.setInputForFormula).not.toHaveBeenCalledWith('formula_1', 'a', true);
  });

  test('health check skips inputs locked by first-impression formulas', async () => {
    const { device, resubscribe } = createReconcileHarness({ sourceValue: true, inputState: false });
    device.formulas[0].firstImpression = true;
    device.formulas[0].lockedInputs = { a: true };

    await device.setupDeviceListener({
      input: 'A',
      deviceId: 'source-id',
      capability: 'alarm_generic',
    }, { replaceExisting: true });

    expect(resubscribe).not.toHaveBeenCalled();
    expect(device.setInputForFormula).not.toHaveBeenCalled();
  });
});

describe('LogicDeviceDevice timeout checks', () => {
  test('does not throw from the timeout interval for a formula without an expression', () => {
    const device = Object.create(LogicDeviceDevice.prototype);
    device.logger = createLogger();
    device.availableInputs = ['a', 'b'];
    device.formulas = [{
      id: 'formula_1', name: 'Incomplete', expression: undefined, enabled: true, timeout: 1,
      inputStates: { a: true, b: 'undefined' }, lockedInputs: {}, lastInputTime: Date.now() - 5000, timedOut: false,
    }];

    expect(() => device.checkTimeouts()).not.toThrow();
    expect(device.parseExpression(42)).toEqual([]);
  });
});

describe('LogicDeviceDevice output writes', () => {
  function createEvaluationHarness(currentAlarm) {
    const device = Object.create(LogicDeviceDevice.prototype);
    const capabilityValues = new Map([['alarm_generic', currentAlarm], ['onoff', true]]);
    device.logger = createLogger();
    device.formulaEvaluator = new FormulaEvaluator();
    device.deviceEnabled = true;
    device.availableInputs = ['a', 'b'];
    device.getName = jest.fn(() => 'Logic Device');
    device.getData = jest.fn(() => ({ id: 'logic-device-id' }));
    device.formulas = [{
      id: 'formula_1', name: 'Chained', expression: 'A AND B', enabled: true,
      inputStates: { a: true, b: false }, lockedInputs: {}, result: false, timedOut: false,
    }];
    device.getCapabilityValue = jest.fn((capabilityId) => capabilityValues.get(capabilityId));
    device.hasCapability = jest.fn(() => true);
    device.safeSetCapabilityValue = jest.fn(async (capabilityId, value) => {
      capabilityValues.set(capabilityId, value);
    });
    device.fireAllRelevantTriggers = jest.fn(async () => {});
    return { device, capabilityValues };
  }

  test('does not rewrite an unchanged result, so chained Logic Devices cannot ping-pong', async () => {
    const { device } = createEvaluationHarness(false);

    await expect(device.setInputForFormula('formula_1', 'a', true)).resolves.toBe(false);

    expect(device.safeSetCapabilityValue).not.toHaveBeenCalled();
    expect(device.fireAllRelevantTriggers).not.toHaveBeenCalled();
  });

  test('writes and triggers when the result changes', async () => {
    const { device, capabilityValues } = createEvaluationHarness(false);

    await expect(device.setInputForFormula('formula_1', 'b', true)).resolves.toBe(true);

    expect(device.safeSetCapabilityValue).toHaveBeenCalledWith('alarm_generic', true);
    expect(capabilityValues.get('alarm_generic')).toBe(true);
    expect(device.fireAllRelevantTriggers).toHaveBeenCalledWith(true, true, false, null);
  });

  test('corrects an output capability that differs from the cached result', async () => {
    const { device } = createEvaluationHarness(null);

    await device.setInputForFormula('formula_1', 'a', true);

    expect(device.safeSetCapabilityValue).toHaveBeenCalledWith('alarm_generic', false);
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

describe('LogicDeviceDevice formula timeouts', () => {
  test('fires the dedicated Logic Device timeout trigger with formula tokens', async () => {
    const trigger = { trigger: jest.fn().mockResolvedValue(undefined) };
    const device = createLogicDeviceHarness();
    device.homey.flow = { getDeviceTriggerCard: jest.fn(() => trigger) };
    device.availableInputs = ['a', 'b'];
    device.parseExpression = jest.fn(() => ['a', 'b']);
    device.formulas = [{
      id: 'formula-1',
      name: 'Main formula',
      enabled: true,
      timeout: 1,
      timedOut: false,
      lastInputTime: Date.now() - 1001,
      inputStates: { a: true, b: 'undefined' },
      expression: 'A AND B',
    }];

    device.checkTimeouts();
    await Promise.resolve();

    expect(device.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('formula_timeout_ld');
    expect(trigger.trigger).toHaveBeenCalledWith(device, {
      formula: { id: 'formula-1', name: 'Main formula' },
    }, { formulaId: 'formula-1' });
    expect(device.formulas[0].timedOut).toBe(true);
  });
});

describe('LogicDeviceDriver flow cards', () => {
  test('registers only defined Logic Device condition cards', async () => {
    const conditionListeners = {};
    const triggerListeners = {};
    const autocompleteListeners = {};
    const createCard = (id) => ({
      id,
      registerRunListener: jest.fn((listener) => {
        if (id === 'formula_timeout_ld') triggerListeners[id] = listener;
        else conditionListeners[id] = listener;
      }),
      registerArgumentAutocompleteListener: jest.fn((argName, listener) => {
        autocompleteListeners[`${id}:${argName}`] = listener;
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
      getFormulas: () => [{ id: 'formula-1', name: 'Main formula' }],
    };

    await driver.registerFlowCards();
    const result = await conditionListeners.has_any_error_ld({ device }, {});

    expect(result).toBe(true);
    expect(device.onFlowCondition).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      'has_error',
    );
    await expect(conditionListeners.formula_has_timed_out_ld({ device }, {}))
      .resolves.toBe(true);
    expect(device.onFlowCondition).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(Object),
      'timeout',
    );
    expect(driver.homey.flow.getConditionCard).not.toHaveBeenCalledWith('formula_result_is_ld');
    expect(driver.logger.error).not.toHaveBeenCalled();
    await expect(triggerListeners.formula_timeout_ld(
      { formula: { id: 'formula-1' } },
      { formulaId: 'formula-1' },
    )).resolves.toBe(true);
    await expect(autocompleteListeners['formula_timeout_ld:formula']('', { device }))
      .resolves.toEqual([{ id: 'formula-1', name: 'Main formula' }]);
  });
});
