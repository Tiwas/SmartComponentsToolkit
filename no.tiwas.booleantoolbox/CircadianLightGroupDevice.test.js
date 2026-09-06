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

function createPauseHarness(initialPaused = false, storedPauseState = null) {
  const device = createDeviceHarness();
  device.pauseTimer = null;
  device.capabilityValues = { clg_paused: initialPaused };
  device.getCapabilityValue = jest.fn((capability) => device.capabilityValues[capability]);
  device.setCapabilityValue = jest.fn(async (capability, value) => {
    device.capabilityValues[capability] = value;
  });
  device.getStoreValue = jest.fn(async (key) => (key === 'clg_pause_state' ? storedPauseState : null));
  device.setStoreValue = jest.fn().mockResolvedValue(undefined);
  device.firePauseTrigger = jest.fn().mockResolvedValue(undefined);
  device.applyCurrentProfile = jest.fn().mockResolvedValue(true);
  device.error = jest.fn();
  return device;
}

function setable(value) {
  return { setable: true, value };
}

describe('CircadianLightGroupDevice capability selection', () => {
  test('captures an anonymous app diagnostic with an error stack', () => {
    const device = createDeviceHarness();
    const recordDiagnosticEvent = jest.fn();
    device.homey = { app: { recordDiagnosticEvent } };
    const error = new Error('member failed');

    device.recordAppDiagnostic('ERROR', 'Circadian member update failed.', error);

    expect(recordDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'ERROR',
      category: 'CircadianLightGroup',
      message: 'Circadian member update failed.',
      stack: expect.stringContaining('at '),
    }));
    expect(recordDiagnosticEvent.mock.calls[0][0].stack).not.toContain('member failed');
  });

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

  test('keeps accepting intentional on events while a member settles after turn-on', async () => {
    const device = createDeviceHarness();
    const now = Date.now();
    const apiDevice = {
      setCapabilityValue: jest.fn(),
    };
    const watcher = {
      apiDevice,
      value: false,
      onoffSetable: true,
      lastOffAt: now - 1000,
      lastClgWriteAt: now - 500,
      lastClgWriteCapability: 'dim',
      allowOnUntil: now + 10000,
    };

    await device.onMemberOnoffChange({ id: 'light-1', name: 'Kitchen' }, watcher, true);
    await device.onMemberOnoffChange({ id: 'light-1', name: 'Kitchen' }, watcher, false);
    await device.onMemberOnoffChange({ id: 'light-1', name: 'Kitchen' }, watcher, true);

    expect(apiDevice.setCapabilityValue).not.toHaveBeenCalled();
    expect(watcher.value).toBe(true);
    expect(watcher.allowOnUntil).toBeGreaterThan(Date.now());
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
    device.waitForMemberOnoffState = jest.fn(async () => {
      expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('onoff', true);
      expect(apiDevice.setCapabilityValue).not.toHaveBeenCalledWith('dim', 0.5);
      watcher.value = true;
      return true;
    });

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
    expect(device.waitForMemberOnoffState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'light-1' }),
      apiDevice,
      true,
      expect.any(Function)
    );
    expect(watcher.value).toBe(true);
  });

  test('defers a scheduler apply while an explicit member command is active', async () => {
    const device = createDeviceHarness();
    device.deleted = false;
    device.currentOpGen = 0;
    device.error = jest.fn();
    device._applyCurrentProfileImpl = jest.fn().mockResolvedValue(true);

    const command = device.beginMemberCommand('turn_on_all_members');
    await expect(device.applyCurrentProfile({ reason: 'timer' })).resolves.toBe(false);

    expect(device.currentOpGen).toBe(command.gen);
    expect(device._applyCurrentProfileImpl).not.toHaveBeenCalled();

    device.finishMemberCommand(command);
    await Promise.resolve();
    await Promise.resolve();

    expect(device._applyCurrentProfileImpl).toHaveBeenCalledWith(
      'deferred-timer',
      expect.objectContaining({ label: 'apply[deferred-timer]' })
    );
  });

  test('stops an old turn-on before target writes after a newer command supersedes it', async () => {
    const device = createDeviceHarness();
    device.getCapabilityValue = jest.fn(capability => capability === 'onoff');
    let current = true;
    const watcher = {
      value: false,
      onoffSetable: true,
      lastOffAt: null,
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
    device.waitForMemberOnoffState = jest.fn(async () => {
      current = false;
      return true;
    });

    await device.turnOnMemberToTarget(
      { id: 'light-1', name: 'Kitchen', prewarmSupport: { dim: false } },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 },
      () => current
    );

    expect(apiDevice.setCapabilityValue).toHaveBeenCalledWith('onoff', true);
    expect(apiDevice.setCapabilityValue).not.toHaveBeenCalledWith('dim', 0.5);
  });

  test('an explicit off cancels the intentional turn-on allowance', async () => {
    const device = createDeviceHarness();
    const item = { id: 'light-1', name: 'Kitchen' };
    const apiDevice = {
      capabilitiesObj: { onoff: { setable: true, value: true } },
      setCapabilityValue: jest.fn().mockResolvedValue(undefined),
    };
    const watcher = {
      apiDevice,
      value: true,
      onoffSetable: true,
      lastOffAt: null,
      lastClgWriteAt: Date.now() - 500,
      lastClgWriteCapability: 'dim',
      allowOnUntil: Date.now() + 10000,
    };
    device.memberOnoffWatchers = new Map([[item.id, watcher]]);
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };

    await device.turnOffMember(item);
    await device.onMemberOnoffChange(item, watcher, false);
    await device.onMemberOnoffChange(item, watcher, true);

    expect(watcher.allowOnUntil).toBeNull();
    expect(apiDevice.setCapabilityValue).toHaveBeenNthCalledWith(1, 'onoff', false);
    expect(apiDevice.setCapabilityValue).toHaveBeenNthCalledWith(2, 'onoff', false);
  });

  test('explicit onoff writes converge when watcher and API cache disagree', async () => {
    const device = createDeviceHarness();
    const item = { id: 'light-1', name: 'Kitchen' };
    const apiDevice = {
      capabilitiesObj: { onoff: { setable: true, value: false } },
      setCapabilityValue: jest.fn().mockResolvedValue(undefined),
    };
    device.memberOnoffWatchers = new Map([[item.id, {
      value: true,
      allowOnUntil: null,
    }]]);
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn().mockResolvedValue(apiDevice),
          },
        },
      },
    };

    await device.setMemberOnoff(apiDevice, item, true);
    await device.turnOffMember(item);

    expect(apiDevice.setCapabilityValue).toHaveBeenNthCalledWith(1, 'onoff', true);
    expect(apiDevice.setCapabilityValue).toHaveBeenNthCalledWith(2, 'onoff', false);
  });

  test('skips turning all members on while paused', async () => {
    const device = createDeviceHarness();
    device.getCapabilityValue = jest.fn((capability) => capability === 'clg_paused');
    device.getConfig = jest.fn(() => ({
      devices: [{ id: 'light-1', name: 'Kitchen' }],
    }));
    device.computeCurrentTarget = jest.fn();
    device.runDeviceTasksParallel = jest.fn();

    await expect(device.onFlowTurnOnAllMembers()).resolves.toBe(true);

    expect(device.computeCurrentTarget).not.toHaveBeenCalled();
    expect(device.runDeviceTasksParallel).not.toHaveBeenCalled();
    expect(device.debug).toHaveBeenCalledWith('turn_on_all_members: SKIPPED 1 member(s) because clg_paused=true');
  });

  test('does not write onoff=true from turnOnMemberToTarget while paused', async () => {
    const device = createDeviceHarness();
    device.getCapabilityValue = jest.fn((capability) => capability === 'clg_paused');
    device.homey = {
      app: {
        api: {
          devices: {
            getDevice: jest.fn(),
          },
        },
      },
    };

    await device.turnOnMemberToTarget(
      { id: 'light-1', name: 'Kitchen' },
      { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 }
    );

    expect(device.homey.app.api.devices.getDevice).not.toHaveBeenCalled();
    expect(device.debug).toHaveBeenCalledWith('turn_on_member[Kitchen]: SKIPPED turn on because clg_paused=true');
  });

  test('reports verified state after turning all members on', async () => {
    const device = createDeviceHarness();
    const target = { mode: 'temperature', hue: null, saturation: null, temperature: 0.25, dim: 0.5 };
    const members = [{ id: 'light-1', name: 'Kitchen' }];
    const result = { ok: [{ item: members[0] }], failed: [], superseded: false };

    device.currentOpGen = 0;
    device.getCapabilityValue = jest.fn((capability) => capability === 'onoff');
    device.getConfig = jest.fn(() => ({ devices: members }));
    device.computeCurrentTarget = jest.fn().mockResolvedValue(target);
    device.runDeviceTasksParallel = jest.fn().mockResolvedValue(result);
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.triggerError = jest.fn().mockResolvedValue(undefined);

    await expect(device.onFlowTurnOnAllMembers()).resolves.toBe(true);

    expect(device.runDeviceTasksParallel).toHaveBeenCalledWith(
      members,
      expect.any(Function),
      expect.objectContaining({
        label: 'turn_on_all_members',
        verifyFn: expect.any(Function),
      })
    );
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', false);
    expect(device.triggerError).not.toHaveBeenCalled();
    expect(device.debug).toHaveBeenCalledWith(
      'turn_on_all_members: verified 1 member(s) on and at target after retries'
    );
  });

  test('reports members still not verified after turning all members off', async () => {
    const device = createDeviceHarness();
    const members = [{ id: 'light-1', name: 'Kitchen' }];
    const result = {
      ok: [],
      failed: [{ item: members[0], error: new Error('verify failed after final serial retry') }],
      superseded: false,
    };

    device.currentOpGen = 0;
    device.getConfig = jest.fn(() => ({ devices: members }));
    device.runDeviceTasksParallel = jest.fn().mockResolvedValue(result);
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.triggerError = jest.fn().mockResolvedValue(undefined);

    await expect(device.onFlowTurnOffAllMembers()).resolves.toBe(false);

    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', true);
    expect(device.triggerError).toHaveBeenCalledWith(
      'turn_off_all_members: 1 light(s) not verified off after retries: Kitchen'
    );
    expect(device.debug).toHaveBeenCalledWith(
      'turn_off_all_members: 1 member(s) not verified off after retries: Kitchen'
    );
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

describe('CircadianLightGroupDevice pause persistence', () => {
  const now = new Date('2026-05-15T08:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('stores a timed pause expiry and resumes when it elapses', async () => {
    const device = createPauseHarness(false);
    const expiresAt = now.getTime() + (2 * 3600000);

    await device.onFlowPause({ amount: 2, unit: 'hours' });

    expect(device.capabilityValues.clg_paused).toBe(true);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_pause_state', expect.objectContaining({
      paused: true,
      expiresAt,
    }));

    await jest.advanceTimersByTimeAsync(2 * 3600000);

    expect(device.capabilityValues.clg_paused).toBe(false);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_pause_state', expect.objectContaining({
      paused: false,
      expiresAt: null,
    }));
    expect(device.firePauseTrigger).toHaveBeenCalledWith(true);
    expect(device.firePauseTrigger).toHaveBeenCalledWith(false);
  });

  test('accepts Homey dropdown objects and localized hour labels', () => {
    const device = createPauseHarness(false);

    expect(device.getPauseDurationMs({ amount: 2, unit: { id: 'hours' } })).toBe(2 * 3600000);
    expect(device.getPauseDurationMs({ amount: 2, unit: 'Timer' })).toBe(2 * 3600000);
  });

  test('restores a future timed pause after init and resumes at the stored expiry', async () => {
    const device = createPauseHarness(true, {
      paused: true,
      expiresAt: now.getTime() + 5000,
      updatedAt: now.toISOString(),
    });

    await device.restorePersistedPauseState();

    expect(device.capabilityValues.clg_paused).toBe(true);

    await jest.advanceTimersByTimeAsync(5000);

    expect(device.capabilityValues.clg_paused).toBe(false);
  });

  test('clears an already expired timed pause during restore', async () => {
    const device = createPauseHarness(true, {
      paused: true,
      expiresAt: now.getTime() - 1,
      updatedAt: now.toISOString(),
    });

    await device.restorePersistedPauseState();

    expect(device.capabilityValues.clg_paused).toBe(false);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_pause_state', expect.objectContaining({
      paused: false,
      expiresAt: null,
    }));
  });

  test('a manual pause clears any previous timed resume', async () => {
    const device = createPauseHarness(true);
    device.pauseTimer = setTimeout(() => {
      device.capabilityValues.clg_paused = false;
    }, 1000);

    await device.onFlowPause({ amount: 0, unit: 'minutes' });
    await jest.advanceTimersByTimeAsync(1000);

    expect(device.pauseTimer).toBeNull();
    expect(device.capabilityValues.clg_paused).toBe(true);
    expect(device.setStoreValue).toHaveBeenCalledWith('clg_pause_state', expect.objectContaining({
      paused: true,
      expiresAt: null,
    }));
  });
});

describe('CircadianLightGroupDevice capability watcher cleanup', () => {
  test('destroys the lux capability instance during watcher teardown', async () => {
    const device = createDeviceHarness();
    const instance = { destroy: jest.fn() };
    const apiDevice = {
      capabilitiesObj: { measure_luminance: { value: 42 } },
      makeCapabilityInstance: jest.fn(() => instance),
    };
    device.luxWatchers = new Map();
    device.getConfig = jest.fn(() => ({
      profile: { anchors: { day: { mode: 'lux', sensorDeviceId: 'sensor-1' } } },
    }));
    device.homey = { app: { api: { devices: { getDevice: jest.fn().mockResolvedValue(apiDevice) } } } };
    device.onLuxSensorValue = jest.fn().mockResolvedValue(undefined);
    device.error = jest.fn();

    await device.setupLuxWatchers();
    await device.teardownLuxWatchers();

    expect(apiDevice.makeCapabilityInstance).toHaveBeenCalledWith('measure_luminance', expect.any(Function));
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  test('destroys the member on/off capability instance during watcher teardown', async () => {
    const device = createDeviceHarness();
    const instance = { destroy: jest.fn() };
    const apiDevice = {
      capabilitiesObj: { onoff: { value: false, setable: true } },
      makeCapabilityInstance: jest.fn(() => instance),
    };
    device.memberOnoffWatchers = new Map();
    device.getConfig = jest.fn(() => ({ devices: [{ id: 'light-1', name: 'Kitchen' }] }));
    device.homey = { app: { api: { devices: { getDevice: jest.fn().mockResolvedValue(apiDevice) } } } };
    device.onMemberOnoffChange = jest.fn().mockResolvedValue(undefined);

    await device.setupMemberOnoffWatchers();
    await device.teardownMemberOnoffWatchers();

    expect(apiDevice.makeCapabilityInstance).toHaveBeenCalledWith('onoff', expect.any(Function));
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
