'use strict';

jest.mock('homey', () => ({
  Device: class {},
}), { virtual: true });

const CircadianLightGroupDevice = require('./drivers/circadian-light-group/device');

function createDeviceHarness() {
  const device = Object.create(CircadianLightGroupDevice.prototype);
  device.debug = jest.fn();
  return device;
}

function setable(value) {
  return { setable: true, value };
}

describe('CircadianLightGroupDevice capability selection', () => {
  test('does not switch to color mode when red target cannot write hue and saturation', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      { redModeAllowed: true },
      { mode: 'color', hue: 0, saturation: 1, temperature: 0.05, dim: 0.2 },
      {
        light_mode: setable('color'),
        light_temperature: setable(0.8),
        light_hue: { setable: true },
        dim: setable(0.5),
      },
      true
    );

    expect(writes).toContainEqual(['light_mode', 'temperature']);
    expect(writes).toContainEqual(['light_temperature', 0.95]);
    expect(writes).not.toContainEqual(['light_mode', 'color']);
    expect(writes.some(([cap]) => cap === 'light_hue')).toBe(false);
  });

  test('writes explicit red for full color-capable lights', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      { redModeAllowed: true },
      { mode: 'color', hue: 0, saturation: 0.9, temperature: 0.02, dim: 0.15 },
      {
        light_mode: setable('temperature'),
        light_temperature: setable(0.8),
        light_hue: setable(0.7),
        light_saturation: setable(0.4),
      },
      true
    );

    expect(writes).toEqual([
      ['light_mode', 'color'],
      ['light_hue', 0],
      ['light_saturation', 0.9],
    ]);
  });

  test('uses warm color fallback for RGB-only lights during temperature mode', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      { redModeAllowed: true },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.45 },
      {
        light_mode: setable('temperature'),
        light_hue: setable(0.7),
        light_saturation: setable(0.2),
      },
      true
    );

    expect(writes[0]).toEqual(['light_mode', 'color']);
    expect(writes[1][0]).toBe('light_hue');
    expect(writes[1][1]).toBeGreaterThanOrEqual(0);
    expect(writes[1][1]).toBeLessThanOrEqual(0.08);
    expect(writes[2][0]).toBe('light_saturation');
    expect(writes[2][1]).toBeGreaterThan(0.5);
  });

  test('falls back to temperature when prewarming color is not supported', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      {
        redModeAllowed: true,
        prewarmSupport: {
          light_hue: false,
          light_saturation: true,
          light_temperature: true,
          light_mode: true,
        },
      },
      { mode: 'color', hue: 0, saturation: 1, temperature: 0.1, dim: 0.2 },
      {
        light_mode: setable('color'),
        light_temperature: setable(0.8),
        light_hue: setable(0.7),
        light_saturation: setable(0.4),
      },
      false
    );

    expect(writes).toEqual([
      ['light_mode', 'temperature'],
      ['light_temperature', 0.9],
    ]);
  });

  test('can opt out of inverted temperature writes for drivers with opposite scale', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      { invertTemperature: false },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      {
        light_temperature: setable(0.8),
      },
      true
    );

    expect(writes).toEqual([
      ['light_temperature', 0.25],
    ]);
  });

  test('only uses tested prewarm capabilities while off', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      {
        prewarmSupport: {
          dim: true,
          light_temperature: true,
          light_hue: false,
          light_saturation: true,
          light_mode: false,
        },
      },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      {
        light_mode: setable('color'),
        light_temperature: setable(0.8),
        light_hue: setable(0.7),
        light_saturation: setable(0.4),
        dim: setable(0.2),
      },
      false
    );

    expect(writes).toEqual([
      ['light_temperature', 0.75],
      ['dim', 0.5],
    ]);
  });

  test('does not prewarm untested capabilities while off', () => {
    const device = createDeviceHarness();
    const writes = device.getCapabilitiesToSet(
      {
        prewarmSupport: {
          dim: null,
          light_temperature: null,
          light_hue: null,
          light_saturation: null,
          light_mode: null,
        },
      },
      { mode: 'color', hue: 0, saturation: 1, temperature: 0.1, dim: 0.2 },
      {
        light_mode: setable('temperature'),
        light_temperature: setable(0.8),
        light_hue: setable(0.7),
        light_saturation: setable(0.4),
        dim: setable(0.5),
      },
      false
    );

    expect(writes).toEqual([]);
  });
});

describe('CircadianLightGroupDevice light application', () => {
  test('prewarms supported capabilities while member light is off', async () => {
    const device = createDeviceHarness();
    device.waitForPrewarmTrip = jest.fn().mockResolvedValue(false);
    const apiDevice = {
      capabilitiesObj: {
        onoff: { setable: true, value: false },
        light_temperature: setable(0.8),
        dim: setable(0.5),
      },
      setCapabilityValue: jest.fn(),
      makeCapabilityInstance: jest.fn(() => ({ destroy: jest.fn() })),
    };
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };

    await device.applyTargetToDevice(
      {
        id: 'light-1',
        name: 'Kitchen',
        prewarmBeforeOn: true,
        prewarmSupport: { light_temperature: true, dim: true },
      },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      { remaining: 0 }
    );

    expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('light_temperature', 0.75);
    expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('dim', 0.5);
  });

  test('uses live onoff watcher instead of stale cached onoff value', async () => {
    const device = createDeviceHarness();
    device.waitForPrewarmTrip = jest.fn().mockResolvedValue(false);
    device.memberOnoffWatchers = new Map([
      ['light-1', { value: false }],
    ]);
    const apiDevice = {
      capabilitiesObj: {
        onoff: { setable: true, value: true },
        light_temperature: setable(0.8),
        dim: setable(0.5),
      },
      setCapabilityValue: jest.fn(),
      makeCapabilityInstance: jest.fn(() => ({ destroy: jest.fn() })),
    };
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };

    await device.applyTargetToDevice(
      {
        id: 'light-1',
        name: 'Kitchen',
        prewarmBeforeOn: true,
        prewarmSupport: { light_temperature: false, dim: false },
      },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      { remaining: 0 }
    );

    expect(apiDevice.setCapabilityValue).not.toHaveBeenCalled();
  });

  test('marks prewarm capability unsupported when it turns the light on', async () => {
    const device = createDeviceHarness();
    const config = {
      devices: [{
        id: 'light-1',
        name: 'Kitchen',
        prewarmSupport: { light_temperature: true, dim: true },
      }],
    };
    let onoffListener = null;
    const apiDevice = {
      capabilitiesObj: {
        onoff: { setable: true, value: false },
        light_temperature: setable(0.8),
        dim: setable(0.5),
      },
      setCapabilityValue: jest.fn(async (capability) => {
        if (capability === 'light_temperature') onoffListener(true);
      }),
      makeCapabilityInstance: jest.fn((capability, listener) => {
        if (capability === 'onoff') onoffListener = listener;
        return { destroy: jest.fn() };
      }),
    };
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };
    device.getConfig = jest.fn(() => config);
    device.setSettings = jest.fn();
    device.triggerError = jest.fn();

    await device.applyTargetToDevice(
      {
        id: 'light-1',
        name: 'Kitchen',
        prewarmBeforeOn: true,
        prewarmSupport: { light_temperature: true, dim: true },
      },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      { remaining: 0 }
    );

    expect(config.devices[0].prewarmSupport.light_temperature).toBe(false);
    expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('onoff', false);
    expect(device.setSettings).toHaveBeenCalledWith({
      config_json: JSON.stringify(config, null, 2),
    });
  });

  test('reverts delayed re-on after a recent CLG write and user off', async () => {
    const device = createDeviceHarness();
    const apiDevice = {
      setCapabilityValue: jest.fn(),
    };
    const watcher = {
      apiDevice,
      value: false,
      onoffSetable: true,
      lastOffAt: Date.now() - 1000,
      lastClgWriteAt: Date.now() - 2000,
      lastClgWriteCapability: 'dim',
    };

    await device.onMemberOnoffChange({ id: 'light-1', name: 'Kitchen' }, watcher, true);

    expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('onoff', false);
    expect(watcher.value).toBe(false);
  });

  test('turns member on before applying capabilities that are not safe to prewarm', async () => {
    const device = createDeviceHarness();
    device.getCapabilityValue = jest.fn((capability) => capability === 'onoff');
    const watcher = {
      value: false,
      onoffSetable: true,
      lastOffAt: Date.now() - 1000,
      lastClgWriteAt: null,
      lastClgWriteCapability: null,
      allowOnUntil: null,
    };
    device.memberOnoffWatchers = new Map([['light-1', watcher]]);
    const apiDevice = {
      capabilitiesObj: {
        onoff: { setable: true, value: false },
        dim: setable(0),
      },
      setCapabilityValue: jest.fn().mockResolvedValue(undefined),
    };
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };

    await device.turnOnMemberToTarget(
      {
        id: 'light-1',
        name: 'Kitchen',
        prewarmBeforeOn: true,
        prewarmSupport: { dim: false },
      },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 }
    );

    const calls = apiDevice.setCapabilityValue.mock.calls;
    expect(calls[0]).toEqual(['onoff', true]);
    expect(calls).toContainEqual(['dim', 0.5]);
    expect(watcher.value).toBe(true);
  });
});

describe('CircadianLightGroupDevice onoff persistence', () => {
  test('defaults CLG on when no structured persisted state exists', async () => {
    const device = createDeviceHarness();
    device.getStoreValue = jest.fn(async (key) => (key === 'clg_onoff' ? false : null));
    device.setStoreValue = jest.fn().mockResolvedValue(undefined);
    device.getCapabilityValue = jest.fn(() => false);
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.error = jest.fn();

    await device.restorePersistedOnoffState();

    expect(device.setCapabilityValue).toHaveBeenCalledWith('onoff', true);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_onoff_state', expect.objectContaining({ value: true }));
  });

  test('restores an explicit structured CLG off state', async () => {
    const device = createDeviceHarness();
    device.getStoreValue = jest.fn(async (key) => {
      if (key === 'clg_onoff_state') return { value: false, updatedAt: '2026-05-08T00:00:00.000Z' };
      return true;
    });
    device.setStoreValue = jest.fn().mockResolvedValue(undefined);
    device.getCapabilityValue = jest.fn(() => true);
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.error = jest.fn();

    await device.restorePersistedOnoffState();

    expect(device.setCapabilityValue).toHaveBeenCalledWith('onoff', false);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_onoff_state', expect.objectContaining({ value: false }));
  });
});
