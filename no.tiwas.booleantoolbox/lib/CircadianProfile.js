'use strict';

const { resolveAnchor } = require('./AnchorResolver');

const DEFAULT_PROFILE = {
  updateIntervalSeconds: 120,
  transitionSeconds: 90,
  redThreshold: 0.2,
  anchors: {
    morning: { mode: 'time', time: '07:00' },
    day: { mode: 'time', time: '10:00' },
    evening: { mode: 'time', time: '19:00' },
    night: { mode: 'time', time: '23:00' },
  },
  day: {
    dim: 1,
    temperature: 0.85,
  },
  evening: {
    dim: 0.45,
    temperature: 0.25,
  },
  night: {
    dim: 0.08,
    temperature: 0,
  },
  outdoor: {
    enabled: true,
    minLux: 0,
    maxLux: 20000,
    minDimFactor: 0.65,
    maxDimFactor: 1.15,
  },
};

function normalizeAnchor(value, fallback) {
  if (typeof value === 'string') {
    return { mode: 'time', time: value };
  }
  if (value && typeof value === 'object') {
    if (value.mode === 'time' && typeof value.time === 'string') {
      return { mode: 'time', time: value.time };
    }
    if (value.mode === 'solar') {
      return {
        mode: 'solar',
        solarEvent: value.solarEvent || 'sunrise',
        offsetMinutes: Number.isFinite(Number(value.offsetMinutes)) ? Number(value.offsetMinutes) : 0,
        fallbackTime: typeof value.fallbackTime === 'string' ? value.fallbackTime : (fallback.time || '07:00'),
      };
    }
    if (value.mode === 'lux') {
      return {
        mode: 'lux',
        sensorDeviceId: value.sensorDeviceId || null,
        threshold: Number.isFinite(Number(value.threshold)) ? Number(value.threshold) : 100,
        direction: value.direction === 'rising' || value.direction === 'falling' ? value.direction : null,
        fallbackTime: typeof value.fallbackTime === 'string' ? value.fallbackTime : (fallback.time || '07:00'),
      };
    }
  }
  return { ...fallback };
}

function clamp(value, min = 0, max = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function mergeProfile(profile = {}) {
  const inputAnchors = profile.anchors || {};
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    anchors: {
      morning: normalizeAnchor(inputAnchors.morning, DEFAULT_PROFILE.anchors.morning),
      day: normalizeAnchor(inputAnchors.day, DEFAULT_PROFILE.anchors.day),
      evening: normalizeAnchor(inputAnchors.evening, DEFAULT_PROFILE.anchors.evening),
      night: normalizeAnchor(inputAnchors.night, DEFAULT_PROFILE.anchors.night),
    },
    day: {
      ...DEFAULT_PROFILE.day,
      ...(profile.day || {}),
    },
    evening: {
      ...DEFAULT_PROFILE.evening,
      ...(profile.evening || {}),
    },
    night: {
      ...DEFAULT_PROFILE.night,
      ...(profile.night || {}),
    },
    outdoor: {
      ...DEFAULT_PROFILE.outdoor,
      ...(profile.outdoor || {}),
    },
  };
}

function parseTimeToMinutes(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;

  return (hours * 60) + minutes;
}

function getMinutesOfDay(date) {
  return (date.getHours() * 60) + date.getMinutes() + (date.getSeconds() / 60);
}

function smoothstep(t) {
  const x = clamp(t);
  return x * x * (3 - (2 * x));
}

function interpolate(start, end, t) {
  return start + ((end - start) * smoothstep(t));
}

function resolveAnchorMinutes(anchor, fallback, ctx, anchorKey) {
  const resolved = resolveAnchor(anchor, { ...ctx, anchorKey });
  if (resolved === null || resolved === undefined || !Number.isFinite(resolved)) {
    return fallback;
  }
  return resolved;
}

function getSegment(nowMinutes, anchors, ctx) {
  const morning = resolveAnchorMinutes(anchors.morning, 420, ctx, 'morning');
  const day = resolveAnchorMinutes(anchors.day, 600, ctx, 'day');
  const evening = resolveAnchorMinutes(anchors.evening, 1140, ctx, 'evening');
  const night = resolveAnchorMinutes(anchors.night, 1380, ctx, 'night');

  if (nowMinutes < morning) {
    const start = night - 1440;
    return { from: 'night', to: 'day', progress: (nowMinutes - start) / (morning - start), phase: 'night' };
  }

  if (nowMinutes < day) {
    const progress = (nowMinutes - morning) / (day - morning);
    return { from: 'night', to: 'day', progress, phase: progress < 0.5 ? 'night' : 'day' };
  }

  if (nowMinutes < evening) {
    return { from: 'day', to: 'day', progress: 1, phase: 'day' };
  }

  if (nowMinutes < night) {
    return { from: 'day', to: 'evening', progress: (nowMinutes - evening) / (night - evening), phase: 'evening' };
  }

  return { from: 'evening', to: 'night', progress: (nowMinutes - night) / ((morning + 1440) - night), phase: 'night' };
}

function getPhaseValues(profile, phase) {
  if (phase === 'day') return profile.day;
  if (phase === 'evening') return profile.evening;
  return profile.night;
}

function calculateOutdoorDimFactor(outdoor, outdoorConfig) {
  if (!outdoorConfig.enabled || !outdoor || !Number.isFinite(Number(outdoor.outdoorComputedLux))) {
    return 1;
  }

  const lux = clamp(Number(outdoor.outdoorComputedLux), outdoorConfig.minLux, outdoorConfig.maxLux);
  const span = Math.max(1, outdoorConfig.maxLux - outdoorConfig.minLux);
  const normalized = (lux - outdoorConfig.minLux) / span;

  return interpolate(outdoorConfig.minDimFactor, outdoorConfig.maxDimFactor, normalized);
}

function calculateTarget(profileInput = {}, outdoorInput = {}, now = new Date(), extras = {}) {
  const profile = mergeProfile(profileInput);
  const nowMinutes = getMinutesOfDay(now);
  const ctx = {
    date: now,
    latitude: extras.latitude,
    longitude: extras.longitude,
    luxCrossings: extras.luxCrossings || {},
  };
  const segment = getSegment(nowMinutes, profile.anchors, ctx);
  const from = getPhaseValues(profile, segment.from);
  const to = getPhaseValues(profile, segment.to);
  const progress = clamp(segment.progress);

  const baseDim = interpolate(Number(from.dim), Number(to.dim), progress);
  const temperature = clamp(interpolate(Number(from.temperature), Number(to.temperature), progress));
  const outdoorDimFactor = calculateOutdoorDimFactor(outdoorInput, profile.outdoor);
  const dim = clamp(baseDim * outdoorDimFactor);
  const targetPhase = segment.phase || (progress >= 0.5 ? segment.to : segment.from);

  const threshold = clamp(Number(profile.redThreshold));
  const redMode = threshold > 0 && temperature < threshold;
  const saturation = redMode ? clamp((threshold - temperature) / threshold) : null;

  return {
    dim,
    temperature,
    hue: redMode ? 0 : null,
    saturation,
    mode: redMode ? 'color' : 'temperature',
    phase: targetPhase,
    segment,
    outdoorDimFactor,
  };
}

module.exports = {
  DEFAULT_PROFILE,
  calculateTarget,
  clamp,
  mergeProfile,
  parseTimeToMinutes,
};
