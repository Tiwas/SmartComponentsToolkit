'use strict';

const SunCalc = require('suncalc');

const SOLAR_EVENTS = [
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'civil_dawn', label: 'Civil dawn' },
  { value: 'civil_dusk', label: 'Civil dusk' },
  { value: 'nautical_dawn', label: 'Nautical dawn' },
  { value: 'nautical_dusk', label: 'Nautical dusk' },
  { value: 'astronomical_dawn', label: 'Astronomical dawn' },
  { value: 'astronomical_dusk', label: 'Astronomical dusk' },
  { value: 'golden_hour_morning', label: 'Golden hour (morning end)' },
  { value: 'golden_hour_evening', label: 'Golden hour (evening start)' },
  { value: 'blue_hour_morning', label: 'Blue hour (morning)' },
  { value: 'blue_hour_evening', label: 'Blue hour (evening)' },
  { value: 'solar_noon', label: 'Solar noon' },
  { value: 'solar_midnight', label: 'Solar midnight' },
];

function midpoint(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return new Date((a.getTime() + b.getTime()) / 2);
}

function eventToDate(event, times) {
  switch (event) {
    case 'sunrise': return times.sunrise;
    case 'sunset': return times.sunset;
    case 'civil_dawn': return times.dawn;
    case 'civil_dusk': return times.dusk;
    case 'nautical_dawn': return times.nauticalDawn;
    case 'nautical_dusk': return times.nauticalDusk;
    case 'astronomical_dawn': return times.nightEnd;
    case 'astronomical_dusk': return times.night;
    case 'golden_hour_morning': return times.goldenHourEnd;
    case 'golden_hour_evening': return times.goldenHour;
    case 'blue_hour_morning': return midpoint(times.nauticalDawn, times.dawn);
    case 'blue_hour_evening': return midpoint(times.dusk, times.nauticalDusk);
    case 'solar_noon': return times.solarNoon;
    case 'solar_midnight': return times.nadir;
    default: return null;
  }
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function dateToMinutesOfDay(date) {
  return (date.getHours() * 60) + date.getMinutes() + (date.getSeconds() / 60);
}

function parseTimeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

/**
 * Resolve an anchor configuration to minutes-of-day for the given date.
 * Returns null if unresolvable (e.g. polar day with no sunset and no fallback).
 *
 * @param {object} anchor - { mode, time, solarEvent, offsetMinutes, fallbackTime }
 * @param {object} ctx - { date, latitude, longitude }
 */
function resolveAnchor(anchor, ctx) {
  if (!anchor || !anchor.mode) return null;

  if (anchor.mode === 'time') {
    return parseTimeToMinutes(anchor.time);
  }

  if (anchor.mode === 'solar') {
    const lat = Number(ctx && ctx.latitude);
    const lon = Number(ctx && ctx.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return parseTimeToMinutes(anchor.fallbackTime || anchor.time);
    }

    const date = (ctx && ctx.date) || new Date();
    const times = SunCalc.getTimes(date, lat, lon);
    const eventDate = eventToDate(anchor.solarEvent, times);

    if (!isValidDate(eventDate)) {
      return parseTimeToMinutes(anchor.fallbackTime || anchor.time);
    }

    const offset = Number(anchor.offsetMinutes) || 0;
    const minutes = dateToMinutesOfDay(eventDate) + offset;
    return ((minutes % 1440) + 1440) % 1440;
  }

  if (anchor.mode === 'lux') {
    const dateKey = todayKey(ctx && ctx.date);
    const crossings = (ctx && ctx.luxCrossings) || {};
    const anchorKey = ctx && ctx.anchorKey;
    const stored = anchorKey && crossings[anchorKey];
    if (stored && stored.dateKey === dateKey && Number.isFinite(Number(stored.minutes))) {
      return Number(stored.minutes);
    }
    return parseTimeToMinutes(anchor.fallbackTime || anchor.time);
  }

  return parseTimeToMinutes(anchor.time);
}

function todayKey(date) {
  const d = (date instanceof Date && !Number.isNaN(date.getTime())) ? date : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function defaultDirectionFor(anchorKey) {
  return (anchorKey === 'morning' || anchorKey === 'day') ? 'rising' : 'falling';
}

function detectCrossing(prevValue, currentValue, threshold, direction) {
  if (!Number.isFinite(prevValue) || !Number.isFinite(currentValue) || !Number.isFinite(threshold)) return false;
  if (direction === 'rising') {
    return prevValue < threshold && currentValue >= threshold;
  }
  return prevValue > threshold && currentValue <= threshold;
}

module.exports = {
  SOLAR_EVENTS,
  resolveAnchor,
  parseTimeToMinutes,
  dateToMinutesOfDay,
  todayKey,
  defaultDirectionFor,
  detectCrossing,
};
