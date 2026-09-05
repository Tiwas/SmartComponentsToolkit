'use strict';

jest.mock('homey', () => ({ Device: class {} }), { virtual: true });

const StateDevice = require('./drivers/state-device/device');
const StateCaptureDevice = require('./drivers/state-capture-device/device');

function createTriggerMap() {
  const cards = new Map();
  return {
    cards,
    getTriggerCard: jest.fn((id) => {
      if (!cards.has(id)) cards.set(id, { trigger: jest.fn().mockResolvedValue(undefined) });
      return cards.get(id);
    }),
  };
}

function createStateDevice(jsonData, api) {
  const flow = createTriggerMap();
  const device = Object.create(StateDevice.prototype);
  device.homey = { app: { api }, flow };
  device.getSetting = jest.fn((key) => ({ json_data: jsonData, log_errors: true })[key]);
  device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
  device.getData = jest.fn(() => ({ id: 'state-device' }));
  device.driver = { getDevices: () => [] };
  device.debug = jest.fn();
  device.error = jest.fn();
  device.warn = jest.fn();
  device.log = jest.fn();
  return { device, flow };
}

function createCaptureDevice(api, state) {
  const flow = createTriggerMap();
  const device = Object.create(StateCaptureDevice.prototype);
  device.homey = { app: { api }, flow, __: (key) => key };
  device.getTemplate = jest.fn(() => ({ items: [] }));
  device.getSetting = jest.fn(() => true);
  device.getData = jest.fn(() => ({ id: 'capture-device' }));
  device.debug = jest.fn();
  device.error = jest.fn();
  device.log = jest.fn();
  device.stateManager = {
    getState: jest.fn(() => state),
    peekState: jest.fn(() => state),
    popState: jest.fn(() => state),
  };
  return { device, flow };
}

describe('StateDevice application result', () => {
  test.each([
    ['invalid JSON', '{not valid json'],
    ['empty configuration', JSON.stringify({ items: [] })],
  ])('does not emit success for %s', async (_name, jsonData) => {
    const { device, flow } = createStateDevice(jsonData, { devices: {} });

    await expect(device._executeApply()).resolves.toBe(false);

    expect(flow.cards.get('state_applied_successfully_sd')).toBeUndefined();
    expect(flow.cards.get('state_error_occurred_sd').trigger).toHaveBeenCalledTimes(1);
  });

  test('does not emit success when a configured device is unavailable', async () => {
    const api = { devices: { getDevice: jest.fn().mockRejectedValue(new Error('Could not reach device')) } };
    const { device, flow } = createStateDevice(JSON.stringify({
      items: [{ id: 'missing', name: 'Missing', capabilities: { onoff: true } }],
    }), api);

    await expect(device._executeApply()).resolves.toBe(false);

    expect(flow.cards.get('state_applied_successfully_sd')).toBeUndefined();
    expect(flow.cards.get('state_error_occurred_sd').trigger).toHaveBeenCalledTimes(1);
  });

  test('does not emit success for unsupported capabilities or failed writes', async () => {
    const api = { devices: { getDevice: jest.fn()
      .mockResolvedValueOnce({ capabilitiesObj: { dim: { setable: false } } })
      .mockResolvedValueOnce({ capabilitiesObj: { onoff: { setable: true } }, setCapabilityValue: jest.fn().mockRejectedValue(new Error('Timed out')) }) } };
    const { device, flow } = createStateDevice(JSON.stringify({
      items: [
        { id: 'readonly', name: 'Read only', capabilities: { dim: 0.5 } },
        { id: 'failing', name: 'Failing', capabilities: { onoff: true } },
      ],
    }), api);

    await expect(device._executeApply()).resolves.toBe(false);

    expect(flow.cards.get('state_applied_successfully_sd')).toBeUndefined();
    expect(flow.cards.get('state_error_occurred_sd').trigger).toHaveBeenCalledTimes(1);
  });

  test('emits success only after every requested write completes', async () => {
    const setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    const api = { devices: { getDevice: jest.fn().mockResolvedValue({
      capabilitiesObj: { onoff: { setable: true } }, setCapabilityValue,
    }) } };
    const { device, flow } = createStateDevice(JSON.stringify({
      config: { ignore_errors: false },
      items: [{ id: 'light', name: 'Light', capabilities: { onoff: true } }],
    }), api);

    await expect(device._executeApply()).resolves.toBe(true);

    expect(setCapabilityValue).toHaveBeenCalledWith('onoff', true);
    expect(flow.cards.get('state_applied_successfully_sd').trigger).toHaveBeenCalledTimes(1);
    expect(flow.cards.get('state_error_occurred_sd')).toBeUndefined();
  });

  test('aborts reset-all before activating or applying state when errors are not ignored', async () => {
    const api = { devices: { getDevice: jest.fn() } };
    const { device, flow } = createStateDevice(JSON.stringify({
      config: { ignore_errors: false },
      items: [{ id: 'light', name: 'Light', capabilities: { onoff: true } }],
    }), api);
    const otherState = {
      getData: () => ({ id: 'other-state' }),
      getName: () => 'Other state',
      setCapabilityValue: jest.fn().mockRejectedValue(new Error('reset failed')),
    };
    device.driver = { getDevices: () => [otherState, device] };

    await expect(device._executeApply({ reset_all: true })).resolves.toBe(false);

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(api.devices.getDevice).not.toHaveBeenCalled();
    expect(flow.cards.get('state_applied_successfully_sd')).toBeUndefined();
    expect(flow.cards.get('state_error_occurred_sd').trigger).toHaveBeenCalledTimes(1);
  });
});

describe('StateCaptureDevice application result', () => {
  test('returns failure for empty or unavailable state application', async () => {
    const { device } = createCaptureDevice(null, { values: {} });

    await expect(device._executeApply({ values: {} })).resolves.toEqual(expect.objectContaining({ success: false }));
  });

  test('does not fire success for partial application and retains a popped state', async () => {
    const api = { devices: { getDevice: jest.fn().mockResolvedValue({
      capabilitiesObj: { onoff: { setable: true } },
      setCapabilityValue: jest.fn().mockRejectedValue(new Error('Timed out')),
    }) } };
    const state = { config: { ignore_errors: true }, zones: {
      Home: { items: [{ id: 'light', name: 'Light', capabilities: { onoff: true } }] },
    } };
    const { device, flow } = createCaptureDevice(api, state);

    await expect(device.onFlowApplyState({ state_name: 'Evening' })).resolves.toBe(false);
    await expect(device.onFlowPopState({})).resolves.toBe(false);

    expect(flow.cards.get('state_applied_scd')).toBeUndefined();
    expect(flow.cards.get('capture_error_scd').trigger).toHaveBeenCalledTimes(2);
    expect(device.stateManager.popState).not.toHaveBeenCalled();
  });

  test('treats items without capability values as failed application', async () => {
    const api = { devices: { getDevice: jest.fn().mockResolvedValue({
      capabilitiesObj: {},
      setCapabilityValue: jest.fn(),
    }) } };
    const state = { config: { ignore_errors: true }, zones: {
      Home: { items: [{ id: 'light', name: 'Light', capabilities: [] }] },
    } };
    const { device, flow } = createCaptureDevice(api, state);

    await expect(device.onFlowApplyState({ state_name: 'Empty item' })).resolves.toBe(false);

    expect(flow.cards.get('state_applied_scd')).toBeUndefined();
    expect(flow.cards.get('capture_error_scd').trigger).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent pop-and-apply actions so each removes the state it applied', async () => {
    const { device } = createCaptureDevice({}, { id: 'first' });
    const secondState = { id: 'second' };
    let resolveFirst;
    let resolveSecond;
    device.stateManager.peekState = jest.fn()
      .mockReturnValueOnce({ id: 'first' })
      .mockReturnValueOnce(secondState);
    device._executeApply = jest.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    device._finishFlowApply = jest.fn().mockResolvedValue(true);

    const first = device.onFlowPopState({});
    const second = device.onFlowPopState({});
    await Promise.resolve();
    await Promise.resolve();
    expect(device._executeApply).toHaveBeenCalledTimes(1);

    resolveFirst({ success: true, errors: [] });
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(device._executeApply).toHaveBeenCalledTimes(2);

    resolveSecond({ success: true, errors: [] });
    await second;

    expect(device.stateManager.peekState).toHaveBeenCalledTimes(2);
    expect(device.stateManager.popState).toHaveBeenCalledTimes(2);
  });

  test('removes a successfully applied stack entry before announcing success', async () => {
    const { device } = createCaptureDevice({}, { id: 'first' });
    device._executeApply = jest.fn().mockResolvedValue({ success: true, errors: [] });
    device._finishFlowApply = jest.fn(() => {
      expect(device.stateManager.popState).toHaveBeenCalledTimes(1);
      return true;
    });

    await expect(device.onFlowPopState({})).resolves.toBe(true);
  });

  test('queues stack pushes behind pop-and-apply', async () => {
    const { device } = createCaptureDevice({}, { id: 'first' });
    let resolveApply;
    let resolvePush;
    device.stateManager.peekState = jest.fn().mockReturnValue({ id: 'first' });
    device._executeApply = jest.fn(() => new Promise(resolve => { resolveApply = resolve; }));
    device._finishFlowApply = jest.fn().mockResolvedValue(true);
    device.stateManager.pushState = jest.fn(() => new Promise(resolve => { resolvePush = resolve; }));

    const pop = device.onFlowPopState({});
    await Promise.resolve();
    await Promise.resolve();
    const push = device.onFlowPushState({});
    await Promise.resolve();
    await Promise.resolve();
    expect(device.stateManager.pushState).not.toHaveBeenCalled();

    resolveApply({ success: true, errors: [] });
    await pop;
    await Promise.resolve();
    await Promise.resolve();
    expect(device.stateManager.popState).toHaveBeenCalledTimes(1);
    expect(device.stateManager.pushState).toHaveBeenCalledTimes(1);

    resolvePush({ depth: 1 });
    await expect(push).resolves.toBe(true);
  });

  test('queues stack clearing behind pop-and-apply', async () => {
    const { device } = createCaptureDevice({}, { id: 'first' });
    let resolveApply;
    device.stateManager.peekState = jest.fn().mockReturnValue({ id: 'first' });
    device._executeApply = jest.fn(() => new Promise(resolve => { resolveApply = resolve; }));
    device._finishFlowApply = jest.fn().mockResolvedValue(true);
    device.stateManager.clearStack = jest.fn().mockReturnValue(1);

    const pop = device.onFlowPopState({});
    await Promise.resolve();
    await Promise.resolve();
    const clear = device.onFlowClearStack({});
    await Promise.resolve();
    await Promise.resolve();
    expect(device.stateManager.clearStack).not.toHaveBeenCalled();

    resolveApply({ success: true, errors: [] });
    await pop;
    await expect(clear).resolves.toBe(true);
    expect(device.stateManager.popState).toHaveBeenCalledTimes(1);
    expect(device.stateManager.clearStack).toHaveBeenCalledTimes(1);
  });
});
