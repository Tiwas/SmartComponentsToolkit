'use strict';

const { calculateTarget } = require('./lib/CircadianProfile');
const { resolveAnchor } = require('./lib/AnchorResolver');
const { minutesOfDay, dateKey } = require('./lib/LocalTime');
const { createOutdoorValue, estimateAstronomicalLux, estimateLuxFromRadiation, isFreshOutdoorValue } = require('./lib/OutdoorLightProvider');

const OSLO = 'Europe/Oslo';

describe('CircadianProfile', () => {
  test('smoothly moves from day toward evening between those anchors', () => {
    const target = calculateTarget({}, null, new Date('2026-04-30T12:00:00'));

    expect(target.phase).toBe('day');
    expect(target.mode).toBe('temperature');
    expect(target.dim).toBeLessThan(1);
    expect(target.dim).toBeGreaterThan(0.45);
    expect(target.temperature).toBeLessThan(0.85);
    expect(target.temperature).toBeGreaterThan(0.25);
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

  test('stays in temperature mode while early evening is above redThreshold', () => {
    // Early evening is transitioning from day toward evening, but the
    // calculated temperature is still above the default threshold (0.2).
    const target = calculateTarget({}, null, new Date('2026-04-30T20:00:00'));

    expect(target.phase).toBe('evening');
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

describe('CircadianProfile time zone', () => {
  test('time anchors use the Homey time zone, not the UTC process clock', () => {
    // 07:30 UTC is 09:30 in Oslo (summer time): late in the 07:00 → 10:00 morning ramp.
    const now = new Date('2026-09-30T07:30:00Z');
    const oslo = calculateTarget({}, null, now, { timeZone: OSLO });
    const utc = calculateTarget({}, null, now, { timeZone: 'UTC' });

    expect(oslo.phase).toBe('day');
    expect(oslo.dim).toBeGreaterThan(0.9);
    expect(utc.phase).toBe('night');
    expect(utc.dim).toBeLessThan(0.2);
  });

  test('reaches the day anchor at local wall-clock time in winter', () => {
    // 09:00 UTC is 10:00 in Oslo (standard time), the default Day anchor.
    const target = calculateTarget({}, null, new Date('2026-01-15T09:00:00Z'), { timeZone: OSLO });

    expect(target.phase).toBe('day');
    expect(target.dim).toBeCloseTo(1, 5);
    expect(target.temperature).toBeCloseTo(0.85, 5);
  });

  test('solar anchors follow the sun whatever the time zone', () => {
    const profile = {
      anchors: {
        morning: { mode: 'solar', solarEvent: 'sunrise', offsetMinutes: 0 },
        day: { mode: 'solar', solarEvent: 'solar_noon', offsetMinutes: -60 },
        evening: { mode: 'solar', solarEvent: 'sunset', offsetMinutes: 0 },
        night: { mode: 'solar', solarEvent: 'civil_dusk', offsetMinutes: 60 },
      },
    };
    const geo = { latitude: 59.91, longitude: 10.75 };
    const now = new Date('2026-09-30T06:30:00Z');
    const oslo = calculateTarget(profile, null, now, { ...geo, timeZone: OSLO });
    const utc = calculateTarget(profile, null, now, { ...geo, timeZone: 'UTC' });

    expect(oslo.phase).toBe(utc.phase);
    expect(oslo.dim).toBeCloseTo(utc.dim, 5);
    expect(oslo.temperature).toBeCloseTo(utc.temperature, 5);
  });

  test('lux anchor crossings are matched against the local date', () => {
    // 23:30 UTC on Sep 29 is already Sep 30 in Oslo.
    const minutes = resolveAnchor(
      { mode: 'lux', sensorDeviceId: 'sensor-1', threshold: 100, fallbackTime: '09:00' },
      {
        date: new Date('2026-09-29T23:30:00Z'),
        timeZone: OSLO,
        anchorKey: 'morning',
        luxCrossings: { morning: { dateKey: '2026-09-30', minutes: 75 } },
      }
    );

    expect(minutes).toBe(75);
  });
});

describe('CircadianProfile morning profile', () => {
  const extras = { timeZone: OSLO };

  test('without a morning profile the morning ramp starts from night values', () => {
    // 05:30 UTC = 07:30 Oslo, early in the 07:00 → 10:00 ramp.
    const now = new Date('2026-09-30T05:30:00Z');
    const target = calculateTarget({}, null, now, extras);
    const withNull = calculateTarget({ morning: null }, null, now, extras);

    expect(target.phase).toBe('night');
    expect(target.segment.from).toBe('night');
    expect(target.mode).toBe('color');
    expect(target.dim).toBeGreaterThan(0.08);
    expect(target.dim).toBeLessThan(0.2);
    expect(withNull).toEqual(target);
  });

  test('applies morning values from the morning anchor and fades them into day', () => {
    const profile = { morning: { dim: 0.5, temperature: 0.4 } };
    const before = calculateTarget(profile, null, new Date('2026-09-30T04:59:00Z'), extras);
    const atAnchor = calculateTarget(profile, null, new Date('2026-09-30T05:00:00Z'), extras);
    const ramp = calculateTarget(profile, null, new Date('2026-09-30T06:00:00Z'), extras);
    const lateRamp = calculateTarget(profile, null, new Date('2026-09-30T07:30:00Z'), extras);

    expect(before.phase).toBe('night');
    expect(before.dim).toBeCloseTo(0.08, 5);

    expect(atAnchor.phase).toBe('morning');
    expect(atAnchor.dim).toBeCloseTo(0.5, 5);
    expect(atAnchor.temperature).toBeCloseTo(0.4, 5);
    expect(atAnchor.mode).toBe('temperature');

    expect(ramp.phase).toBe('morning');
    expect(ramp.dim).toBeGreaterThan(0.5);
    expect(ramp.dim).toBeLessThan(1);

    expect(lateRamp.phase).toBe('day');
    expect(lateRamp.segment.from).toBe('morning');
  });

  test('missing morning fields fall back to the night values', () => {
    const target = calculateTarget(
      { night: { dim: 0.02, temperature: 0.05 }, morning: { dim: 0.3 } },
      null,
      new Date('2026-09-30T05:00:00Z'),
      extras
    );

    expect(target.phase).toBe('morning');
    expect(target.dim).toBeCloseTo(0.3, 5);
    expect(target.temperature).toBeCloseTo(0.05, 5);
    expect(target.mode).toBe('color');
  });
});

describe('LocalTime', () => {
  test('reads wall-clock minutes in the given time zone', () => {
    expect(minutesOfDay(new Date('2026-09-30T05:00:00Z'), OSLO)).toBe(420);
    expect(minutesOfDay(new Date('2026-01-15T05:00:00Z'), OSLO)).toBe(360);
    expect(minutesOfDay(new Date('2026-09-30T05:00:00Z'), 'America/New_York')).toBe(60);
    expect(minutesOfDay(new Date('2026-09-29T22:00:00Z'), OSLO)).toBe(0);
    expect(minutesOfDay(new Date('2026-09-30T05:00:30Z'), OSLO)).toBeCloseTo(420.5, 5);
  });

  test('builds the date key from the local date', () => {
    expect(dateKey(new Date('2026-09-29T23:30:00Z'), OSLO)).toBe('2026-09-30');
    expect(dateKey(new Date('2026-09-30T03:30:00Z'), 'America/New_York')).toBe('2026-09-29');
  });

  test('falls back to the process clock without a usable time zone', () => {
    const date = new Date('2026-09-30T05:00:00Z');
    const processMinutes = (date.getHours() * 60) + date.getMinutes();

    expect(minutesOfDay(date, null)).toBe(processMinutes);
    expect(minutesOfDay(date, 'Not/AZone')).toBe(processMinutes);
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

  test('astronomical lux follows the local sun when a longitude is known', () => {
    // New York in January: 12:00 UTC is 07:00 local, before sunrise; 17:00 UTC is local noon.
    expect(estimateAstronomicalLux(new Date('2026-01-15T12:00:00Z'), 40.71, -74.01)).toBeLessThan(100);
    expect(estimateAstronomicalLux(new Date('2026-01-15T17:00:00Z'), 40.71, -74.01)).toBeGreaterThan(10000);
  });
});
