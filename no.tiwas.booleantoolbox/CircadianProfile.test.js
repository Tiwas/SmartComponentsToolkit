'use strict';

const { calculateTarget } = require('./lib/CircadianProfile');
const { createOutdoorValue, estimateAstronomicalLux, estimateLuxFromRadiation, isFreshOutdoorValue } = require('./lib/OutdoorLightProvider');

describe('CircadianProfile', () => {
  test('returns day settings during the day plateau', () => {
    const target = calculateTarget({}, null, new Date('2026-04-30T12:00:00'));

    expect(target.phase).toBe('day');
    expect(target.mode).toBe('temperature');
    expect(target.dim).toBeCloseTo(1, 2);
    expect(target.temperature).toBeCloseTo(0.85, 2);
  });

  test('uses red color mode when temperature drops below redThreshold', () => {
    // Deep night: by 01:00 the interpolated temperature has dropped below the
    // default redThreshold (0.2), so red color mode should be active.
    const target = calculateTarget({}, null, new Date('2026-04-30T01:00:00'));

    expect(target.phase).toBe('night');
    expect(target.mode).toBe('color');
    expect(target.hue).toBe(0);
    expect(target.temperature).toBeLessThan(0.2);
    expect(target.saturation).toBeGreaterThan(0);
    expect(target.saturation).toBeLessThanOrEqual(1);
  });

  test('stays in temperature mode when temperature is above redThreshold', () => {
    // 23:30 is just past the night anchor, but interpolation keeps temperature
    // close to the evening value (0.25), still above the default threshold (0.2).
    const target = calculateTarget({}, null, new Date('2026-04-30T23:30:00'));

    expect(target.phase).toBe('night');
    expect(target.mode).toBe('temperature');
    expect(target.temperature).toBeGreaterThanOrEqual(0.2);
  });

  test('redThreshold of 0 disables red mode entirely', () => {
    const target = calculateTarget({ redThreshold: 0 }, null, new Date('2026-04-30T03:00:00'));

    expect(target.mode).toBe('temperature');
    expect(target.saturation).toBeNull();
  });

  test('outdoor lux increases dim within configured limits', () => {
    const dark = calculateTarget({}, { outdoorComputedLux: 0 }, new Date('2026-04-30T12:00:00'));
    const bright = calculateTarget({}, { outdoorComputedLux: 20000 }, new Date('2026-04-30T12:00:00'));

    expect(dark.outdoorDimFactor).toBeLessThan(bright.outdoorDimFactor);
    expect(bright.dim).toBe(1);
  });
});

describe('OutdoorLightProvider helpers', () => {
  test('creates expiring external values', () => {
    const value = createOutdoorValue(173, 'test', 15);

    expect(value.outdoorComputedLux).toBe(173);
    expect(value.source).toBe('test');
    expect(isFreshOutdoorValue(value)).toBe(true);
  });

  test('estimates more lux from more radiation', () => {
    expect(estimateLuxFromRadiation(200, 0)).toBeGreaterThan(estimateLuxFromRadiation(50, 0));
  });

  test('astronomical lux is zero-ish during night', () => {
    expect(estimateAstronomicalLux(new Date('2026-01-15T00:00:00'), 60)).toBe(0);
  });
});
