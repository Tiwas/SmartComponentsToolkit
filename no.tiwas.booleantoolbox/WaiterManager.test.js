const WaiterManager = require('./lib/WaiterManager');

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('WaiterManager capability listener cleanup', () => {
  let manager;

  beforeEach(() => {
    jest.useFakeTimers();
    WaiterManager.instance = null;
    manager = new WaiterManager({}, createLogger());
  });

  afterEach(() => {
    manager.destroy();
    WaiterManager.instance = null;
    jest.useRealTimers();
  });

  async function createDeviceWaiter(id = 'waiter-1', timeoutValue = 0) {
    await manager.createWaiter(
      id,
      { timeoutValue, timeoutUnit: 'ms' },
      { flowId: 'flow-1' },
      { deviceId: 'device-1', capability: 'onoff', targetValue: true },
    );
  }

  test('destroys the capability instance when a waiter is removed', async () => {
    await createDeviceWaiter();
    const instance = { destroy: jest.fn() };
    const homey = { devices: { getDevice: jest.fn().mockResolvedValue({
      makeCapabilityInstance: jest.fn().mockResolvedValue(instance),
    }) } };

    await manager.registerCapabilityListener('waiter-1', homey);
    manager.removeWaiter('waiter-1');

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  test('destroys the capability instance when a waiter times out', async () => {
    await createDeviceWaiter('waiter-timeout', 100);
    const instance = { destroy: jest.fn() };
    const homey = { devices: { getDevice: jest.fn().mockResolvedValue({
      makeCapabilityInstance: jest.fn().mockResolvedValue(instance),
    }) } };

    await manager.registerCapabilityListener('waiter-timeout', homey);
    await jest.advanceTimersByTimeAsync(100);

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(manager.waiters.has('waiter-timeout')).toBe(false);
  });

  test('destroys active capability instances when the manager is shut down', async () => {
    await createDeviceWaiter();
    const instance = { destroy: jest.fn() };
    const homey = { devices: { getDevice: jest.fn().mockResolvedValue({
      makeCapabilityInstance: jest.fn().mockResolvedValue(instance),
    }) } };

    await manager.registerCapabilityListener('waiter-1', homey);
    manager.destroy();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  test('destroys a late capability instance if its waiter was removed during registration', async () => {
    await createDeviceWaiter();
    let resolveInstance;
    const instancePromise = new Promise(resolve => { resolveInstance = resolve; });
    const instance = { destroy: jest.fn() };
    const homey = { devices: { getDevice: jest.fn().mockResolvedValue({
      makeCapabilityInstance: jest.fn().mockReturnValue(instancePromise),
    }) } };

    const registration = manager.registerCapabilityListener('waiter-1', homey);
    await Promise.resolve();
    manager.removeWaiter('waiter-1');
    resolveInstance(instance);
    await registration;

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  test('reinitializing a waiter releases its previous capability instance', async () => {
    await createDeviceWaiter();
    const instance = { destroy: jest.fn() };
    const homey = { devices: { getDevice: jest.fn().mockResolvedValue({
      makeCapabilityInstance: jest.fn().mockResolvedValue(instance),
    }) } };
    await manager.registerCapabilityListener('waiter-1', homey);

    await createDeviceWaiter();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  test('reinitializing a waiter with a wildcard in its ID only removes that exact waiter', async () => {
    await createDeviceWaiter('job*');
    await createDeviceWaiter('job1');

    await createDeviceWaiter('job*');

    expect(manager.waiters.has('job*')).toBe(true);
    expect(manager.waiters.has('job1')).toBe(true);
  });
});

describe('WaiterManager orphan cleanup', () => {
  let manager;
  let logger;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    WaiterManager.instance = null;
    logger = createLogger();
    manager = new WaiterManager({}, logger);
  });

  afterEach(() => {
    manager.destroy();
    WaiterManager.instance = null;
    jest.useRealTimers();
  });

  async function createWaiter(id, timeoutValue = 0, virtualGateConfig = null) {
    await manager.createWaiter(
      id,
      { timeoutValue, timeoutUnit: 'ms' },
      { flowId: `flow-${id}` },
      null,
      virtualGateConfig,
    );
  }

  test('reaps an indefinite waiter after the orphan age and resolves its Flow as false', async () => {
    await createWaiter('orphan');
    const waiter = manager.waiters.get('orphan');
    waiter.resolver = jest.fn();
    jest.setSystemTime(Date.now() + manager.MAX_ORPHAN_AGE_MS);

    expect(manager.cleanupOrphans()).toBe(1);

    expect(waiter.resolver).toHaveBeenCalledWith(false);
    expect(manager.waiters.has('orphan')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Reaping orphan waiter "orphan"'));
  });

  test('does not reap a waiter that completed through its gate before cleanup', async () => {
    await createWaiter('completed', 0, { gateName: 'gate-1', targetState: 'GO' });
    const waiter = manager.waiters.get('completed');
    waiter.resolver = jest.fn();

    expect(manager.setGateState('gate-1', 'GO')).toBe(1);
    jest.setSystemTime(Date.now() + manager.MAX_ORPHAN_AGE_MS);

    expect(manager.cleanupOrphans()).toBe(0);
    expect(waiter.resolver).toHaveBeenCalledWith({ gate_state: true, gate_state_text: 'GO' });
    expect(manager.waiters.has('completed')).toBe(false);
  });

  test('lets timed waiters expire through their own timeout instead of orphan cleanup', async () => {
    await createWaiter('timed', 100);
    const waiter = manager.waiters.get('timed');
    waiter.resolver = jest.fn();
    jest.setSystemTime(Date.now() + manager.MAX_ORPHAN_AGE_MS);

    expect(manager.cleanupOrphans()).toBe(0);
    expect(manager.waiters.has('timed')).toBe(true);
    await jest.advanceTimersByTimeAsync(100);

    expect(waiter.resolver).toHaveBeenCalledWith(false);
    expect(manager.waiters.has('timed')).toBe(false);
  });

  test('does not revisit a waiter that was explicitly stopped', async () => {
    await createWaiter('stopped');

    expect(manager.stopWaiter('stopped')).toBe(1);
    jest.setSystemTime(Date.now() + manager.MAX_ORPHAN_AGE_MS);

    expect(manager.cleanupOrphans()).toBe(0);
    expect(manager.waiters.has('stopped')).toBe(false);
  });

  test('reclaims stale indefinite waiters so the waiter limit recovers', async () => {
    for (let index = 0; index < manager.MAX_WAITERS; index++) {
      await createWaiter(`stale-${index}`);
    }
    jest.setSystemTime(Date.now() + manager.MAX_ORPHAN_AGE_MS);

    expect(manager.cleanupOrphans()).toBe(manager.MAX_WAITERS);
    await expect(createWaiter('fresh')).resolves.toBeUndefined();
    expect(manager.waiters.has('fresh')).toBe(true);
  });

  test('stops the orphan cleanup interval during shutdown', async () => {
    const cleanupOrphans = jest.spyOn(manager, 'cleanupOrphans');

    manager.destroy();
    await jest.advanceTimersByTimeAsync(2 * 60000);

    expect(cleanupOrphans).not.toHaveBeenCalled();
  });
});
