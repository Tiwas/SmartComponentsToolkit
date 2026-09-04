jest.mock('homey', () => ({
  Driver: class {},
}), { virtual: true });

jest.mock('suncalc', () => ({}), { virtual: true });

const CircadianLightGroupDriver = require('./drivers/circadian-light-group/driver');

describe('CircadianLightGroupDriver probe cleanup', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('destroys all capability instances after completing a pairing probe', async () => {
    jest.useFakeTimers();
    const instance = { destroy: jest.fn() };
    const apiDevice = {
      capabilitiesObj: { onoff: { value: false, setable: true } },
      makeCapabilityInstance: jest.fn(() => instance),
      setCapabilityValue: jest.fn().mockResolvedValue(undefined),
    };
    const driver = Object.create(CircadianLightGroupDriver.prototype);
    driver.homey = { app: { api: { devices: { getDevice: jest.fn().mockResolvedValue(apiDevice) } } } };
    driver.debug = jest.fn();
    driver.error = jest.fn();

    const probe = driver.probeDevice('light-1');
    await jest.runAllTimersAsync();
    await probe;

    expect(apiDevice.makeCapabilityInstance).toHaveBeenCalledWith('onoff', expect.any(Function));
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
