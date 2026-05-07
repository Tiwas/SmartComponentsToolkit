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
});
