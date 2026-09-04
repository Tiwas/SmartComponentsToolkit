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
});
