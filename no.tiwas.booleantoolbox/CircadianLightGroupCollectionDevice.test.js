'use strict';

jest.mock('homey', () => ({
  Device: class {},
}), { virtual: true });

const CircadianLightGroupCollectionDevice = require('./drivers/circadian-light-group-collection/device');

function createCollectionHarness() {
  const device = Object.create(CircadianLightGroupCollectionDevice.prototype);
  device.debug = jest.fn();
  device.error = jest.fn();
  device.deleted = false;
  device.timer = null;
  device.collectionOperationBatchDelayMs = 0;
  return device;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushAsyncWork() {
  return new Promise(resolve => setTimeout(resolve, 5));
}

describe('CircadianLightGroupCollectionDevice scheduling', () => {
  test('does not create a second scheduler beside the member group schedulers', async () => {
    const device = createCollectionHarness();
    device.applyCurrentProfile = jest.fn().mockResolvedValue(true);
    device.getConfig = jest.fn(() => ({ profile: { updateIntervalSeconds: 30 } }));

    await device.startScheduler(true);

    expect(device.applyCurrentProfile).not.toHaveBeenCalled();
    expect(device.timer).toBeNull();
    device.stopScheduler();
  });

  test('resume waits for member groups without an extra collection-wide apply', async () => {
    const device = createCollectionHarness();
    const capabilityValues = { clg_paused: true };
    const membersFinished = deferred();
    device.getCapabilityValue = jest.fn(capability => capabilityValues[capability]);
    device.setCapabilityValue = jest.fn(async (capability, value) => {
      capabilityValues[capability] = value;
    });
    device.clearPauseTimer = jest.fn();
    device.clearPersistedPauseState = jest.fn().mockResolvedValue(undefined);
    device.firePauseTrigger = jest.fn().mockResolvedValue(undefined);
    device.runForMemberGroups = jest.fn(() => membersFinished.promise);
    device.applyCurrentProfile = jest.fn().mockResolvedValue(true);

    let settled = false;
    const resume = device.onFlowResume().then(result => {
      settled = true;
      return result;
    });

    await flushAsyncWork();

    expect(capabilityValues.clg_paused).toBe(false);
    expect(device.runForMemberGroups).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(device.applyCurrentProfile).not.toHaveBeenCalled();

    membersFinished.resolve({ ok: [{ ok: true, item: { id: 'group-1', name: 'Group 1' } }], failed: [] });
    await expect(resume).resolves.toEqual(expect.objectContaining({ ok: true, completed: true }));
    expect(settled).toBe(true);
  });

  test.each([
    [true, 'pause', 'onFlowPause'],
    [false, 'resume', 'onFlowResume'],
  ])('propagates a direct paused capability change (%s) to every member group', async (paused, label, method) => {
    const device = createCollectionHarness();
    const capabilityValues = { clg_paused: paused };
    const member = {
      onFlowPause: jest.fn().mockResolvedValue(true),
      onFlowResume: jest.fn().mockResolvedValue(true),
    };

    device.pauseDebug = jest.fn();
    device.clearPauseTimer = jest.fn();
    device.getCapabilityValue = jest.fn(capability => capabilityValues[capability]);
    device.setCapabilityValue = jest.fn(async (capability, value) => {
      capabilityValues[capability] = value;
    });
    device.persistPauseState = jest.fn().mockResolvedValue(undefined);
    device.clearPersistedPauseState = jest.fn().mockResolvedValue(undefined);
    device.firePauseTrigger = jest.fn().mockResolvedValue(undefined);
    device.runAwaitedMemberGroups = jest.fn(async (operationLabel, taskFn) => {
      expect(operationLabel).toBe(label);
      return taskFn(member);
    });

    await expect(device.onPausedCapabilityChanged(paused)).resolves.toBe(true);

    expect(member[method]).toHaveBeenCalledTimes(1);
    expect(member[method === 'onFlowPause' ? 'onFlowResume' : 'onFlowPause']).not.toHaveBeenCalled();
    expect(device.firePauseTrigger).toHaveBeenCalledWith(paused);
    if (paused) {
      expect(device.persistPauseState).toHaveBeenCalledWith(null);
      expect(device.clearPersistedPauseState).not.toHaveBeenCalled();
    } else {
      expect(device.clearPersistedPauseState).toHaveBeenCalledTimes(1);
      expect(device.persistPauseState).not.toHaveBeenCalled();
    }
  });

  test('prioritizes resume over a simultaneously queued turn-on and keeps both promises pending', async () => {
    const device = createCollectionHarness();
    const turnOnFinished = deferred();
    const resumeFinished = deferred();
    const started = [];
    const capabilityValues = { onoff: false, clg_paused: true };

    device.getCapabilityValue = jest.fn(capability => capabilityValues[capability]);
    device.setCollectionOnoff = jest.fn(async (value) => {
      capabilityValues.onoff = value;
    });
    device.clearPauseTimer = jest.fn();
    device.pauseDebug = jest.fn();
    device.setCapabilityValue = jest.fn(async (capability, value) => {
      capabilityValues[capability] = value;
    });
    device.clearPersistedPauseState = jest.fn().mockResolvedValue(undefined);
    device.firePauseTrigger = jest.fn().mockResolvedValue(undefined);
    device.runAwaitedMemberGroups = jest.fn(async (label) => {
      started.push(label);
      if (label === 'turn_on') return turnOnFinished.promise;
      if (label === 'resume') return resumeFinished.promise;
      return true;
    });

    let turnOnSettled = false;
    let resumeSettled = false;
    const turnOn = device.onFlowTurnOn().then(result => {
      turnOnSettled = true;
      return result;
    });
    const resume = device.onFlowResume().then(result => {
      resumeSettled = true;
      return result;
    });

    await flushAsyncWork();
    expect(started).toEqual(['resume']);
    expect(turnOnSettled).toBe(false);
    expect(resumeSettled).toBe(false);

    resumeFinished.resolve(true);
    await expect(resume).resolves.toBe(true);
    await flushAsyncWork();
    expect(started).toEqual(['resume', 'turn_on']);
    expect(turnOnSettled).toBe(false);

    turnOnFinished.resolve(true);
    await expect(turnOn).resolves.toBe(true);

    expect(started).toEqual(['resume', 'turn_on']);
    expect(resumeSettled).toBe(true);
  });

  test('continues the operation queue after a failed Flow card', async () => {
    const device = createCollectionHarness();
    const order = [];

    const failed = device.runCollectionOperation('failed', async () => {
      order.push('failed');
      throw new Error('boom');
    });
    const succeeding = device.runCollectionOperation('succeeding', async () => {
      order.push('succeeding');
      return true;
    });

    await expect(failed).rejects.toThrow('boom');
    await expect(succeeding).resolves.toBe(true);
    expect(order).toEqual(['failed', 'succeeding']);
  });
});

describe('CircadianLightGroupCollectionDevice results after the Flow card', () => {
  const { createOperationOutcome } = CircadianLightGroupCollectionDevice;

  function createFanOutHarness(groups) {
    const device = createCollectionHarness();
    device.currentOpGen = 0;
    device.setCapabilityValue = jest.fn().mockResolvedValue(undefined);
    device.triggerError = jest.fn().mockResolvedValue(undefined);
    device.resolveMemberEntries = jest.fn().mockResolvedValue(groups.map(group => ({
      id: group.id,
      name: group.name,
      item: { id: group.id, name: group.name },
      memberDevice: group.device,
    })));
    return device;
  }

  test('returns after the first pass of every group and reports group failures when the retries finish', async () => {
    const mainRetries = deferred();
    const main = {
      onFlowTurnOn: jest.fn().mockResolvedValue(createOperationOutcome({
        total: 11,
        pending: ['Dining room bulb'],
        background: mainRetries.promise,
      })),
    };
    const bedroom = {
      onFlowTurnOn: jest.fn().mockResolvedValue(createOperationOutcome({ total: 5 })),
    };
    const device = createFanOutHarness([
      { id: 'main', name: 'Main', device: main },
      { id: 'bedroom', name: 'Bedroom', device: bedroom },
    ]);

    const outcome = await device.runAwaitedMemberGroups('turn_on', group => group.onFlowTurnOn());

    expect(outcome).toEqual(expect.objectContaining({
      completed: false,
      total: 16,
      pending: ['Dining room bulb'],
    }));
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(device.describeOperationOutcome(outcome)).toBe(
      'Main: Continued before everything was confirmed. Lights still being retried in the background (1 of 11): Dining room bulb. '
      + 'Bedroom: All lights confirmed (5).'
    );

    mainRetries.resolve(createOperationOutcome({ ok: false, total: 11, failed: ['Dining room bulb'] }));
    const final = await outcome.background;

    expect(final).toEqual(expect.objectContaining({ completed: false, ok: false, failed: ['Dining room bulb'] }));
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', true);
    expect(device.triggerError).toHaveBeenCalledWith('turn_on: 1 group(s) had unresponsive members: Main');
  });

  test('starts the next queued operation while the previous one still retries in the background', async () => {
    const device = createCollectionHarness();
    const retries = deferred();
    const started = [];
    device.setCollectionOnoff = jest.fn().mockResolvedValue(undefined);
    device.runAwaitedMemberGroups = jest.fn(async (label) => {
      started.push(label);
      return label === 'turn_on'
        ? createOperationOutcome({ total: 11, pending: ['Hall'], background: retries.promise })
        : createOperationOutcome({ total: 11 });
    });

    const turnOn = await device.onFlowTurnOn();
    const turnOff = await device.onFlowTurnOff();

    expect(turnOn).toEqual(expect.objectContaining({ completed: false, pending: ['Hall'] }));
    expect(turnOff).toEqual(expect.objectContaining({ completed: true }));
    expect(started).toEqual(['turn_on', 'turn_off']);
    retries.resolve(createOperationOutcome({ superseded: true }));
  });

  test('reports at once and sums the lights when no group retries in the background', async () => {
    const device = createFanOutHarness([
      { id: 'main', name: 'Main', device: { onFlowTurnOn: jest.fn().mockResolvedValue(createOperationOutcome({ total: 11 })) } },
      { id: 'bedroom', name: 'Bedroom', device: { onFlowTurnOn: jest.fn().mockResolvedValue(createOperationOutcome({ total: 5 })) } },
    ]);

    const outcome = await device.runAwaitedMemberGroups('turn_on', group => group.onFlowTurnOn());

    expect(outcome).toEqual(expect.objectContaining({ completed: true, ok: true, total: 16, background: null }));
    expect(device.describeOperationOutcome(outcome)).toBe('All lights confirmed (16).');
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', false);
    expect(device.triggerError).not.toHaveBeenCalled();
  });

  test('an older operation finishing its retries late does not overwrite a newer report', async () => {
    const oldRetries = deferred();
    const main = {
      onFlowTurnOn: jest.fn().mockResolvedValue(createOperationOutcome({
        total: 11,
        pending: ['Hall'],
        background: oldRetries.promise,
      })),
      onFlowTurnOff: jest.fn().mockResolvedValue(createOperationOutcome({ ok: false, total: 11, failed: ['Desk'] })),
    };
    const device = createFanOutHarness([{ id: 'main', name: 'Main', device: main }]);

    const turnOn = await device.runAwaitedMemberGroups('turn_on', group => group.onFlowTurnOn());
    await device.runAwaitedMemberGroups('turn_off', group => group.onFlowTurnOff());
    expect(device.setCapabilityValue).toHaveBeenLastCalledWith('alarm_config', true);

    oldRetries.resolve(createOperationOutcome({ total: 11, superseded: true }));
    await turnOn.background;

    expect(device.setCapabilityValue).toHaveBeenCalledTimes(1);
    expect(device.setCapabilityValue).toHaveBeenLastCalledWith('alarm_config', true);
    expect(device.triggerError).toHaveBeenCalledTimes(1);
  });

  test('a profile update a group postponed is not reported as a failed group', async () => {
    const device = createFanOutHarness([
      {
        id: 'main',
        name: 'Main',
        device: { applyCurrentProfile: jest.fn().mockResolvedValue(createOperationOutcome({ ok: false, skipped: 'deferred' })) },
      },
    ]);

    const outcome = await device.runAwaitedMemberGroups('apply_flow', group => group.applyCurrentProfile());

    expect(outcome).toEqual(expect.objectContaining({ ok: true, completed: false }));
    expect(device.setCapabilityValue).toHaveBeenCalledWith('alarm_config', false);
    expect(device.triggerError).not.toHaveBeenCalled();
  });

  test('names a group that could not run in the error message', async () => {
    const device = createFanOutHarness([
      { id: 'main', name: 'Main', device: null },
    ]);

    const outcome = await device.runAwaitedMemberGroups('turn_off', group => group.onFlowTurnOff());

    expect(outcome).toEqual(expect.objectContaining({ completed: false, ok: false }));
    expect(device.describeOperationOutcome(outcome)).toBe('Main: did not finish.');
    expect(device.triggerError).toHaveBeenCalledWith('turn_off: 1 group(s) had unresponsive members: Main');
  });
});
