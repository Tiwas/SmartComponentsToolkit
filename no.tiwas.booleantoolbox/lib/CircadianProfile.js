'use strict';

const DEFAULT_PROFILE = {
  updateIntervalSeconds: 120,
  transitionSeconds: 90,
  anchors: {
    morning: '07:00',
    day: '10:00',
    evening: '19:00',
    night: '23:00',
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
    red: true,
    redSaturation: 1,
  },
  outdoor: {
    enabled: true,
    minLux: 0,
    maxLux: 20000,
    minDimFactor: 0.65,
    maxDimFactor: 1.15,
  },
};

function clamp(value, min = 0, max = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function mergeProfile(profile = {}) {
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    anchors: {
      ...DEFAULT_PROFILE.anchors,
      ...(profile.anchors || {}),
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

function getSegment(nowMinutes, anchors) {
  const morning = parseTimeToMinutes(anchors.morning, 420);
  const day = parseTimeToMinutes(anchors.day, 600);
  const evening = parseTimeToMinutes(anchors.evening, 1140);
  const night = parseTimeToMinutes(anchors.night, 1380);

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

function calculateTarget(profileInput = {}, outdoorInput = {}, now = new Date()) {
  const profile = mergeProfile(profileInput);
  const nowMinutes = getMinutesOfDay(now);
  const segment = getSegment(nowMinutes, profile.anchors);
  const from = getPhaseValues(profile, segment.from);
  const to = getPhaseValues(profile, segment.to);
  const progress = clamp(segment.progress);

  const baseDim = interpolate(Number(from.dim), Number(to.dim), progress);
  const temperature = interpolate(Number(from.temperature), Number(to.temperature), progress);
  const outdoorDimFactor = calculateOutdoorDimFactor(outdoorInput, profile.outdoor);
  const dim = clamp(baseDim * outdoorDimFactor);
  const targetPhase = segment.phase || (progress >= 0.5 ? segment.to : segment.from);
  const redMode = targetPhase === 'night' && profile.night.red === true;

  return {
    dim,
    temperature: clamp(temperature),
    hue: redMode ? 0 : null,
    saturation: redMode ? clamp(profile.night.redSaturation) : null,
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
