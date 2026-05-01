'use strict';

const https = require('https');

const DEFAULT_CONFIG = {
  provider: 'external_value',
  fallbackProvider: 'astronomical',
  staleAfterMinutes: 20,
  cacheMinutes: 15,
  latitude: null,
  longitude: null,
};

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

function createOutdoorValue(outdoorComputedLux, source, validMinutes = 15, extras = {}) {
  const now = Date.now();
  const minutes = Number(validMinutes);
  const ttl = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;

  return {
    outdoorComputedLux: Number(outdoorComputedLux),
    source: source || 'external',
    updatedAt: now,
    expiresAt: now + (ttl * 60 * 1000),
    ...extras,
  };
}

function isFreshOutdoorValue(value, now = Date.now()) {
  return !!(
    value &&
    Number.isFinite(Number(value.outdoorComputedLux)) &&
    Number(value.expiresAt || 0) > now
  );
}

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 120)}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(10000, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

function estimateLuxFromRadiation(shortwaveRadiation, cloudCover) {
  const radiation = Math.max(0, Number(shortwaveRadiation) || 0);
  const cloud = Math.min(100, Math.max(0, Number(cloudCover) || 0));
  const cloudFactor = 1 - (cloud / 100 * 0.55);

  return Math.round(radiation * 120 * cloudFactor);
}

function estimateAstronomicalLux(date = new Date(), latitude = 60) {
  const dayOfYear = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const hour = date.getHours() + (date.getMinutes() / 60);
  const declination = 23.44 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const hourAngle = 15 * (hour - 12);
  const latRad = latitude * Math.PI / 180;
  const decRad = declination * Math.PI / 180;
  const hourRad = hourAngle * Math.PI / 180;
  const sinElevation = (Math.sin(latRad) * Math.sin(decRad)) + (Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourRad));
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation))) * 180 / Math.PI;

  if (elevation <= -6) return 0;
  if (elevation <= 0) return Math.round((elevation + 6) * 5);

  return Math.round(Math.min(120000, 120000 * Math.pow(Math.sin(elevation * Math.PI / 180), 1.25)));
}

class OutdoorLightProvider {
  constructor({ homey, logger } = {}) {
    this.homey = homey;
    this.logger = logger;
    this.externalValue = null;
    this.cache = null;
  }

  setExternalValue(lux, validMinutes, source = 'external-flow', extras = {}) {
    const value = createOutdoorValue(lux, source, validMinutes, extras);
    this.externalValue = value;
    return value;
  }

  async getOutdoorLight(configInput = {}, now = new Date()) {
    const config = mergeConfig(configInput);

    if (config.provider === 'external_value') {
      if (isFreshOutdoorValue(this.externalValue, now.getTime())) return this.externalValue;
      return this.getFallback(config, now);
    }

    if (config.provider === 'homey_lux_sensor') {
      return this.getFromHomeyLuxSensor(config, now);
    }

    if (config.provider === 'open_meteo') {
      return this.getFromOpenMeteo(config, now);
    }

    if (config.provider === 'met_no') {
      return this.getFromMetNo(config, now);
    }

    if (config.provider === 'homeyscript') {
      return this.getFallback(config, now, 'homeyscript-reserved');
    }

    return this.getAstronomical(config, now);
  }

  async getFallback(config, now, source = null) {
    if (config.fallbackProvider === 'open_meteo') {
      return this.getFromOpenMeteo({ ...config, provider: 'open_meteo' }, now);
    }

    if (config.fallbackProvider === 'met_no') {
      return this.getFromMetNo({ ...config, provider: 'met_no' }, now);
    }

    return this.getAstronomical(config, now, source);
  }

  async getLocation(config = {}) {
    if (Number.isFinite(Number(config.latitude)) && Number.isFinite(Number(config.longitude))) {
      return {
        latitude: Number(config.latitude),
        longitude: Number(config.longitude),
      };
    }

    if (this.homey && this.homey.geolocation) {
      return {
        latitude: this.homey.geolocation.getLatitude(),
        longitude: this.homey.geolocation.getLongitude(),
      };
    }

    return {
      latitude: 60,
      longitude: 10,
    };
  }

  async getFromHomeyLuxSensor(config, now) {
    if (!config.sensorDeviceId) return this.getFallback(config, now);

    const api = this.homey?.app?.api;
    if (!api) return this.getFallback(config, now);

    const apiDevice = await api.devices.getDevice({ id: config.sensorDeviceId });
    const cap = apiDevice.capabilitiesObj?.measure_luminance;
    const lux = Number(cap?.value);

    if (!Number.isFinite(lux)) return this.getFallback(config, now);
    return createOutdoorValue(lux, apiDevice.name || 'homey-lux-sensor', config.cacheMinutes);
  }

  async getFromOpenMeteo(config, now) {
    const cached = this.getCached('open_meteo', config, now);
    if (cached) return cached;

    const { latitude, longitude } = await this.getLocation(config);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=shortwave_radiation,cloud_cover&timezone=auto`;
    const data = await requestJson(url);
    const lux = estimateLuxFromRadiation(data.current?.shortwave_radiation, data.current?.cloud_cover);
    const value = createOutdoorValue(lux, 'open-meteo', config.cacheMinutes, {
      shortwaveRadiation: data.current?.shortwave_radiation,
      cloudCover: data.current?.cloud_cover,
    });

    this.setCached('open_meteo', config, value);
    return value;
  }

  async getFromMetNo(config, now) {
    const cached = this.getCached('met_no', config, now);
    if (cached) return cached;

    const { latitude, longitude } = await this.getLocation(config);
    const userAgent = config.userAgent || 'SmartComponentsToolkit/1.0 github.com/Tiwas/SmartComponentsToolkit';
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
    const data = await requestJson(url, { 'User-Agent': userAgent });
    const details = data.properties?.timeseries?.[0]?.data?.instant?.details || {};
    const cloudCover = details.cloud_area_fraction;
    const astronomical = estimateAstronomicalLux(now, latitude);
    const lux = Math.round(astronomical * (1 - (Math.min(100, Math.max(0, Number(cloudCover) || 0)) / 100 * 0.65)));
    const value = createOutdoorValue(lux, 'met-no', config.cacheMinutes, {
      cloudCover,
    });

    this.setCached('met_no', config, value);
    return value;
  }

  async getAstronomical(config, now, source = null) {
    const { latitude } = await this.getLocation(config);
    return createOutdoorValue(estimateAstronomicalLux(now, latitude), source || 'astronomical', config.cacheMinutes);
  }

  getCached(provider, config, now) {
    if (!this.cache || this.cache.provider !== provider) return null;
    if (this.cache.key !== this.getCacheKey(provider, config)) return null;
    if (!isFreshOutdoorValue(this.cache.value, now.getTime())) return null;
    return this.cache.value;
  }

  setCached(provider, config, value) {
    this.cache = {
      provider,
      key: this.getCacheKey(provider, config),
      value,
    };
  }

  getCacheKey(provider, config) {
    return JSON.stringify({
      provider,
      latitude: config.latitude || null,
      longitude: config.longitude || null,
      sensorDeviceId: config.sensorDeviceId || null,
    });
  }
}

module.exports = {
  OutdoorLightProvider,
  createOutdoorValue,
  estimateAstronomicalLux,
  estimateLuxFromRadiation,
  isFreshOutdoorValue,
};
