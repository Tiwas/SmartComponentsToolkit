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

    membersFinished.resolve({ ok: [{ item: { id: 'group-1' } }], failed: [] });
    await expect(resume).resolves.toBe(true);
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
