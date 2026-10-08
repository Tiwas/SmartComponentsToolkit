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
    await expect(device.applyCurrentProfile({ reason: 'timer' })).resolves.toEqual(expect.objectContaining({
      ok: false,
      completed: false,
      skipped: 'deferred',
    }));

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

    await expect(device.onFlowTurnOnAllMembers()).resolves.toEqual(expect.objectContaining({
      ok: true,
      completed: true,
      skipped: 'paused',
    }));

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

    await expect(device.onFlowTurnOnAllMembers()).resolves.toEqual(expect.objectContaining({
      ok: true,
      completed: true,
      total: 1,
      background: null,
    }));

    expect(device.runDeviceTasksParallel).toHaveBeenCalledWith(
      members,
      expect.any(Function),
      expect.objectContaining({
        label: 'turn_on_all_members',
        verifyFn: expect.any(Function),
        deferRetries: true,
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

    await expect(device.onFlowTurnOffAllMembers()).resolves.toEqual(expect.objectContaining({
      ok: false,
      completed: false,
      failed: ['Kitchen'],
    }));

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

describe('CircadianLightGroupDevice time zone', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('reads the Homey time zone and tolerates a missing clock', () => {
    const device = createDeviceHarness();
    device.homey = { clock: { getTimezone: () => 'Europe/Oslo' } };
    expect(device.getTimeZone()).toBe('Europe/Oslo');

    device.homey = {};
    expect(device.getTimeZone()).toBeNull();

    device.homey = { clock: { getTimezone: () => { throw new Error('no clock'); } } };
    expect(device.getTimeZone()).toBeNull();
  });

  test('pauses until the local wall-clock time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T04:00:00Z')); // 06:00 in Oslo
    const device = createDeviceHarness();
    device.homey = { clock: { getTimezone: () => 'Europe/Oslo' } };
    device.onFlowPause = jest.fn().mockResolvedValue(true);

    await device.onFlowPauseUntilTime({ until_time: '07:00' });
    await device.onFlowPauseUntilTime({ until_time: '05:30' });

    expect(device.onFlowPause).toHaveBeenNthCalledWith(1, { amount: 60, unit: 'minutes' });
    expect(device.onFlowPause).toHaveBeenNthCalledWith(2, { amount: 1410, unit: 'minutes' });
  });

  test('stores lux anchor crossings with the local date and time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T05:15:00Z')); // 07:15 in Oslo
    const device = createDeviceHarness();
    device.homey = { clock: { getTimezone: () => 'Europe/Oslo' } };
    device.luxWatchers = new Map([['sensor-1', { prevValue: 50 }]]);
    device.getConfig = jest.fn(() => ({
      profile: {
        anchors: {
          morning: { mode: 'lux', sensorDeviceId: 'sensor-1', threshold: 100, direction: 'rising', fallbackTime: '07:00' },
        },
      },
    }));
    device.getStoreValue = jest.fn().mockResolvedValue({});
    device.setStoreValue = jest.fn().mockResolvedValue(undefined);
    device.applyCurrentProfile = jest.fn().mockResolvedValue(true);

    await device.onLuxSensorValue('sensor-1', 150);

    expect(device.setStoreValue).toHaveBeenCalledWith('luxCrossings', {
      morning: { dateKey: '2026-09-30', minutes: 435 },
    });
    expect(device.applyCurrentProfile).toHaveBeenCalledWith({ reason: 'lux-crossing' });
  });

  test('computes the current target in the Homey time zone', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T07:30:00Z')); // 09:30 in Oslo
    const device = createDeviceHarness();
    device.homey = { clock: { getTimezone: () => 'Europe/Oslo' } };
    device.outdoorProvider = { getOutdoorLight: jest.fn().mockResolvedValue({ outdoorComputedLux: 0 }) };
    device.getGeo = jest.fn(() => ({}));
    device.getStoreValue = jest.fn().mockResolvedValue({});
    device.applyOverridesToTarget = jest.fn();

    const target = await device.computeCurrentTarget({ profile: { outdoor: { enabled: false } } });

    expect(target.phase).toBe('day');
    expect(target.dim).toBeGreaterThan(0.9);
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

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTaskHarness() {
  const device = createDeviceHarness();
  device.error = jest.fn();
  return device;
}

describe('CircadianLightGroupDevice retries after the Flow card', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns after the first pass and retries unconfirmed lights in the background', async () => {
    jest.useFakeTimers();
    const device = createTaskHarness();
    const items = [{ id: 'light-1', name: 'Kitchen' }, { id: 'light-2', name: 'Hall' }];
    const confirmed = new Set();
    const taskFn = jest.fn(async (item, attempt) => {
      if (item.id === 'light-2' && attempt === 0) throw new Error('Timeout after 10000ms');
      confirmed.add(item.id);
    });
    const verifyFn = jest.fn(async item => confirmed.has(item.id));

    const result = await device.runDeviceTasksParallel(items, taskFn, {
      label: 'turn_on_all_members',
      verifyFn,
      deferRetries: true,
    });

    expect(result.ok.map(res => res.item.id)).toEqual(['light-1']);
    expect(result.pending.map(res => res.item.id)).toEqual(['light-2']);
    expect(result.failed).toEqual([]);
    expect(result.background).toBeInstanceOf(Promise);
    expect(taskFn).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1500);
    const final = await result.background;

    expect(final.ok.map(res => res.item.id).sort()).toEqual(['light-1', 'light-2']);
    expect(final.failed).toEqual([]);
    expect(final.superseded).toBe(false);
    expect(taskFn).toHaveBeenCalledWith(items[1], 1);
  });

  test('a light that reports late is confirmed in the background without another write', async () => {
    jest.useFakeTimers();
    const device = createTaskHarness();
    const item = { id: 'light-1', name: 'Kitchen' };
    let reported = false;
    const taskFn = jest.fn().mockResolvedValue(undefined);
    const verifyFn = jest.fn(async () => reported);

    const result = await device.runDeviceTasksParallel([item], taskFn, { verifyFn, deferRetries: true });
    expect(result.pending.map(res => res.item.id)).toEqual(['light-1']);

    reported = true;
    await jest.advanceTimersByTimeAsync(1500);
    const final = await result.background;

    expect(final.ok.map(res => res.item.id)).toEqual(['light-1']);
    expect(taskFn).toHaveBeenCalledTimes(1);
  });

  test('a newer command stops the background retries', async () => {
    jest.useFakeTimers();
    const device = createTaskHarness();
    let current = true;
    const taskFn = jest.fn().mockRejectedValue(new Error('Timeout after 10000ms'));

    const result = await device.runDeviceTasksParallel([{ id: 'light-1', name: 'Kitchen' }], taskFn, {
      verifyFn: jest.fn().mockResolvedValue(false),
      isCurrent: () => current,
      deferRetries: true,
    });
    current = false;
    await jest.advanceTimersByTimeAsync(1500);
    const final = await result.background;

    expect(final.superseded).toBe(true);
    expect(taskFn).toHaveBeenCalledTimes(1);
  });

  test('keeps retrying inside the call when retries are not deferred', async () => {
    const device = createTaskHarness();
    const taskFn = jest.fn()
      .mockRejectedValueOnce(new Error('Timeout after 10000ms'))
      .mockResolvedValue(undefined);

    const result = await device.runDeviceTasksParallel([{ id: 'light-1', name: 'Kitchen' }], taskFn, {});

    expect(result.background).toBeUndefined();
    expect(result.ok.map(res => res.item.id)).toEqual(['light-1']);
    expect(taskFn).toHaveBeenCalledTimes(2);
  });

  test('keeps the member command active and reports verification once background retries finish', async () => {
    const device = createDeviceHarness();
    const member = { id: 'light-1', name: 'Kitchen' };
    const background = deferredPromise();

    device.currentOpGen = 0;
    device.getCapabilityValue = jest.fn(capability => capability === 'onoff');
    device.getConfig = jest.fn(() => ({ devices: [member] }));
    device.computeCurrentTarget = jest.fn().mockResolvedValue({ mode: 'temperature', temperature: 0.3, dim: 0.5 });
    device.runDeviceTasksParallel = jest.fn().mockResolvedValue({
      ok: [],
      failed: [],
      pending: [{ item: member, ok: false, retryable: true }],
      superseded: false,
      background: background.promise,
    });
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.triggerError = jest.fn().mockResolvedValue(undefined);
    device._applyCurrentProfileImpl = jest.fn();

    const outcome = await device.onFlowTurnOnAllMembers();

    expect(outcome).toEqual(expect.objectContaining({ completed: false, pending: ['Kitchen'], total: 1 }));
    expect(device.activeMemberCommand).toEqual(expect.objectContaining({ label: 'turn_on_all_members' }));
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    await expect(device.applyCurrentProfile({ reason: 'timer' })).resolves.toEqual(
      expect.objectContaining({ skipped: 'deferred' })
    );

    background.resolve({ ok: [{ ok: true, item: member }], failed: [], superseded: false });
    const final = await outcome.background;

    expect(final).toEqual(expect.objectContaining({ completed: true, ok: true, total: 1 }));
    expect(device.activeMemberCommand).toBeNull();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', false);
    expect(device.triggerError).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(device._applyCurrentProfileImpl).toHaveBeenCalledWith('deferred-timer', expect.anything());
  });

  test('fires the target trigger and error reporting for a profile update after its background retries', async () => {
    const device = createDeviceHarness();
    const member = { id: 'light-1', name: 'Kitchen' };
    const background = deferredPromise();
    const targetChanged = { trigger: jest.fn().mockResolvedValue(undefined) };

    device.error = jest.fn();
    device.previousPhase = null;
    device.previousRedMode = null;
    device.getConfig = jest.fn(() => ({ profile: {}, devices: [member] }));
    device.outdoorProvider = {
      getOutdoorLight: jest.fn().mockResolvedValue({ outdoorComputedLux: 100, source: 'test' }),
    };
    device.getGeo = jest.fn(() => ({}));
    device.getTimeZone = jest.fn(() => 'Europe/Oslo');
    device.getStoreValue = jest.fn().mockResolvedValue({});
    device.getCapabilityValue = jest.fn(capability => capability === 'onoff');
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.triggerError = jest.fn().mockResolvedValue(undefined);
    device.homey = { flow: { getDeviceTriggerCard: jest.fn(() => targetChanged) } };
    device.runDeviceTasksParallel = jest.fn().mockResolvedValue({
      ok: [],
      failed: [],
      pending: [{ item: member, ok: false, retryable: true, error: new Error('Timeout after 10000ms') }],
      superseded: false,
      background: background.promise,
    });

    const outcome = await device._applyCurrentProfileImpl('flow', { isCurrent: () => true });

    expect(outcome).toEqual(expect.objectContaining({ completed: false, pending: ['Kitchen'] }));
    expect(device.homey.flow.getDeviceTriggerCard).not.toHaveBeenCalledWith('clg_target_changed');
    expect(device.setCapabilityValue).not.toHaveBeenCalledWith('alarm_config', expect.anything());

    background.resolve({ ok: [{ ok: true, item: member }], failed: [], superseded: false });
    const final = await outcome.background;

    expect(final).toEqual(expect.objectContaining({ completed: true, ok: true }));
    expect(device.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('clg_target_changed');
    expect(targetChanged.trigger).toHaveBeenCalledTimes(1);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', false);
  });

  test('resume still counts as successful when the group is off', async () => {
    const device = createPauseHarness(true);
    device.applyCurrentProfile = jest.fn().mockResolvedValue(
      CircadianLightGroupDevice.createOperationOutcome({ ok: false, total: 3, skipped: 'off' })
    );
    device.pauseDebug = jest.fn();
    device.clearPersistedPauseState = jest.fn().mockResolvedValue(undefined);

    const outcome = await device.onFlowResume();

    expect(outcome).toEqual(expect.objectContaining({ ok: true, completed: true, skipped: 'off' }));
  });
});

describe('CircadianLightGroupDevice Flow card time budget', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns the result when the work finishes within the budget', async () => {
    const device = createTaskHarness();
    const outcome = CircadianLightGroupDevice.createOperationOutcome({ total: 2 });

    await expect(device.runWithinCardTimeBudget('clg_turn_on', Promise.resolve(outcome))).resolves.toBe(outcome);
  });

  test('lets the Flow continue after the budget while the work goes on', async () => {
    jest.useFakeTimers();
    const device = createTaskHarness();
    const work = deferredPromise();
    device.recordAppDiagnostic = jest.fn();

    const result = device.runWithinCardTimeBudget('clg_turn_on', work.promise);
    await jest.advanceTimersByTimeAsync(CircadianLightGroupDevice.CARD_TIME_BUDGET_MS);
    const outcome = await result;

    expect(outcome).toEqual(expect.objectContaining({ completed: false, budgetExceeded: true }));
    expect(device.recordAppDiagnostic).toHaveBeenCalledWith('WARN', expect.any(String));

    const finalBackground = Promise.resolve(CircadianLightGroupDevice.createOperationOutcome({ total: 4 }));
    work.resolve(CircadianLightGroupDevice.createOperationOutcome({ total: 4, pending: ['Hall'], background: finalBackground }));
    await expect(outcome.background).resolves.toEqual(expect.objectContaining({ completed: true, total: 4 }));
  });

  test('logs work that fails after the Flow continued instead of leaving it unhandled', async () => {
    jest.useFakeTimers();
    const device = createTaskHarness();
    const work = deferredPromise();
    device.recordAppDiagnostic = jest.fn();

    const result = device.runWithinCardTimeBudget('clg_turn_on', work.promise);
    await jest.advanceTimersByTimeAsync(CircadianLightGroupDevice.CARD_TIME_BUDGET_MS);
    const outcome = await result;
    work.reject(new Error('boom'));

    await expect(outcome.background).resolves.toEqual(expect.objectContaining({ ok: false }));
    expect(device.error).toHaveBeenCalledWith('clg_turn_on failed after the Flow had continued:', expect.any(Error));
  });

  test('still fails the card when the work fails within the budget', async () => {
    const device = createTaskHarness();

    await expect(device.runWithinCardTimeBudget('clg_turn_on_member', Promise.reject(new Error('No light selected'))))
      .rejects.toThrow('No light selected');
  });
});

describe('CircadianLightGroupDevice card tokens', () => {
  const { createOperationOutcome } = CircadianLightGroupDevice;

  test.each([
    [createOperationOutcome({ total: 11 }), true, 'All lights confirmed (11).'],
    [
      createOperationOutcome({ total: 11, pending: ['Hall', 'Desk'] }),
      false,
      'Continued before everything was confirmed. Lights still being retried in the background (2 of 11): Hall, Desk.',
    ],
    [
      createOperationOutcome({ ok: false, total: 5, failed: ['Bedside'] }),
      false,
      'Lights that did not respond (1 of 5): Bedside.',
    ],
    [createOperationOutcome({ total: 5, skipped: 'paused' }), true, 'The group is paused, so the lights were not changed.'],
    [createOperationOutcome({ ok: false, total: 5, skipped: 'off' }), true, 'The group is off, so the lights were not changed.'],
    [
      createOperationOutcome({ ok: false, skipped: 'deferred' }),
      false,
      'An on/off command is still running. The profile is applied when it has finished.',
    ],
    [createOperationOutcome({ superseded: true }), false, 'A newer command took over before this one had finished.'],
    [
      createOperationOutcome({ budgetExceeded: true }),
      false,
      'Still running after 50 seconds. The Flow continued and the rest goes on in the background.',
    ],
    [true, true, 'Done.'],
  ])('describes %j', (outcome, completed, status) => {
    const device = createDeviceHarness();

    expect(device.toCardTokens(outcome)).toEqual({ completed, status });
  });

  test('uses the translated text and fills in its values', () => {
    const device = createDeviceHarness();
    device.homey = {
      __: jest.fn(key => (key === 'circadian_outcome.pending'
        ? 'Gikk videre før alt var bekreftet ({count} av {total}): {names}.'
        : key)),
    };

    expect(device.toCardTokens(createOperationOutcome({ total: 3, pending: ['Hall'] }))).toEqual({
      completed: false,
      status: 'Gikk videre før alt var bekreftet (1 av 3): Hall.',
    });
  });

  test('cards without tokens keep the boolean they returned before', () => {
    const device = createDeviceHarness();

    expect(device.toLegacyCardResult(createOperationOutcome({ ok: false, failed: ['Hall'] }))).toBe(false);
    expect(device.toLegacyCardResult(true)).toBe(true);
  });
});
