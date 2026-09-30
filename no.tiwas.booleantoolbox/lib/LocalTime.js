'use strict';

// Homey runs SDK3 apps with TZ=UTC, so Date#getHours() and friends return UTC
// wall-clock values. These helpers read the wall clock in the Homey's own
// time zone (this.homey.clock.getTimezone()). Without a usable time zone they
// fall back to the process-local getters, which is the previous behaviour.

const formatterCache = new Map();

function getFormatter(timeZone) {
  if (formatterCache.has(timeZone)) return formatterCache.get(timeZone);

  let formatter = null;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (error) {
    formatter = null;
  }

  formatterCache.set(timeZone, formatter);
  return formatter;
}

function getLocalParts(date, timeZone) {
  const formatter = typeof timeZone === 'string' && timeZone ? getFormatter(timeZone) : null;
  if (formatter) {
    const parts = {};
    formatter.formatToParts(date).forEach(({ type, value }) => {
      parts[type] = value;
    });
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function minutesOfDay(date, timeZone) {
  const parts = getLocalParts(date, timeZone);
  return (parts.hour * 60) + parts.minute + (parts.second / 60);
}

function dateKey(date, timeZone) {
  const parts = getLocalParts(date, timeZone);
  return parts.year + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
}

module.exports = {
  getLocalParts,
  minutesOfDay,
  dateKey,
};
