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
});
