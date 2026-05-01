'use strict';

const Homey = require('homey');
const SunCalc = require('suncalc');

const SOLAR_EVENTS_LIST = [
  'sunrise', 'sunset', 'civil_dawn', 'civil_dusk',
  'nautical_dawn', 'nautical_dusk', 'astronomical_dawn', 'astronomical_dusk',
  'golden_hour_morning', 'golden_hour_evening', 'blue_hour_morning', 'blue_hour_evening',
  'solar_noon', 'solar_midnight',
];

function midpointDate(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return new Date((a.getTime() + b.getTime()) / 2);
}

function eventToDate(event, t) {
  switch (event) {
    case 'sunrise': return t.sunrise;
    case 'sunset': return t.sunset;
    case 'civil_dawn': return t.dawn;
    case 'civil_dusk': return t.dusk;
    case 'nautical_dawn': return t.nauticalDawn;
    case 'nautical_dusk': return t.nauticalDusk;
    case 'astronomical_dawn': return t.nightEnd;
    case 'astronomical_dusk': return t.night;
    case 'golden_hour_morning': return t.goldenHourEnd;
    case 'golden_hour_evening': return t.goldenHour;
    case 'blue_hour_morning': return midpointDate(t.nauticalDawn, t.dawn);
    case 'blue_hour_evening': return midpointDate(t.dusk, t.nauticalDusk);
    case 'solar_noon': return t.solarNoon;
    case 'solar_midnight': return t.nadir;
    default: return null;
  }
}

const LIGHT_CAPABILITIES = [
  'onoff',
  'dim',
  'light_temperature',
  'light_hue',
  'light_saturation',
  'light_mode',
];

class CircadianLightGroupDriver extends Homey.Driver {
  async onInit() {
    this.debug('CircadianLightGroupDriver has been initialized');
    this.registerFlowCards();
    this.startSolarEventScheduler();
  }

  async onUninit() {
    if (this.solarTimer) {
      clearInterval(this.solarTimer);
      this.solarTimer = null;
    }
  }

  startSolarEventScheduler() {
    const trigger = this.homey.flow.getTriggerCard('app_solar_event_occurred');
    trigger.registerRunListener(async (args, state) => {
      if (args.event !== state.event) return false;
      const argOffset = Math.round(Number(args.offset_minutes) || 0);
      return argOffset === state.offsetMinutes;
    });

    const tick = () => {
      try {
        const geo = this.homey.geolocation;
        if (!geo) return;
        const lat = typeof geo.getLatitude === 'function' ? geo.getLatitude() : geo.latitude;
        const lon = typeof geo.getLongitude === 'function' ? geo.getLongitude() : geo.longitude;
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return;

        const now = new Date();
        const nowMinutes = (now.getHours() * 60) + now.getMinutes();
        const times = SunCalc.getTimes(now, Number(lat), Number(lon));

        SOLAR_EVENTS_LIST.forEach(event => {
          const eventDate = eventToDate(event, times);
          if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) return;
          const eventMinutes = (eventDate.getHours() * 60) + eventDate.getMinutes();

          let offset = nowMinutes - eventMinutes;
          if (offset > 720) offset -= 1440;
          if (offset < -720) offset += 1440;
          if (offset < -180 || offset > 180) return;

          trigger.trigger({}, { event, offsetMinutes: offset })
            .catch(err => this.error('Solar trigger fire failed:', err));
        });
      } catch (error) {
        this.error('Solar scheduler tick failed:', error);
      }
    };

    // Align to next minute boundary, then fire every 60s.
    const msToNextMinute = 60000 - (Date.now() % 60000);
    setTimeout(() => {
      tick();
      this.solarTimer = setInterval(tick, 60000);
    }, msToNextMinute);
  }

  debug(...args) {
    if (this.homey.settings.get('debug_mode')) {
      this.log('[DEBUG]', ...args);
    }
  }

  registerFlowCards() {
    const action = (id, fn) => this.homey.flow.getActionCard(id).registerRunListener(async (args) => args.device[fn](args));
    const cond = (id, fn) => this.homey.flow.getConditionCard(id).registerRunListener(async (args) => args.device[fn](args));

    action('clg_apply_now', 'onFlowApplyNow');
    action('clg_pause', 'onFlowPause');
    action('clg_pause_until_time', 'onFlowPauseUntilTime');
    action('clg_pause_until_solar', 'onFlowPauseUntilSolar');
    action('clg_resume', 'onFlowResume');
    action('clg_set_external_lux', 'onFlowSetExternalLux');
    action('clg_turn_on', 'onFlowTurnOn');
    action('clg_turn_off', 'onFlowTurnOff');
    action('clg_toggle', 'onFlowToggle');
    action('clg_set_red_threshold', 'onFlowSetRedThreshold');
    action('clg_apply_state', 'onFlowApplyState');
    action('clg_force_red_mode', 'onFlowForceRedMode');

    cond('clg_is_in_phase', 'onConditionIsInPhase');
    cond('clg_red_mode_active', 'onConditionRedModeActive');
    cond('clg_is_paused', 'onConditionIsPaused');
    cond('clg_is_on', 'onConditionIsOn');

    this.homey.flow.getTriggerCard('clg_outdoor_light_requested')
      .registerRunListener(async (args, state) => args.device?.getData().id === state?.deviceId);
  }

  async onPair(session) {
    this.debug('Circadian Light Group pairing started');

    let candidateItems = [];
    let selectedItems = [];
    let generatedConfig = null;

    session.setHandler('get_zones', async () => {
      if (!this.homey.app || typeof this.homey.app.getAvailableZones !== 'function') return [];
      return this.homey.app.getAvailableZones();
    });

    session.setHandler('generate_snapshot', async (data) => {
      candidateItems = await this.getLightCandidates(data);
      this.debug(`Found ${candidateItems.length} candidate light devices.`);

      const response = { success: true, count: candidateItems.length };
      this.debug('generate_snapshot returning to client:', JSON.stringify(response));
      return response;
    });

    session.setHandler('get_snapshot_candidates', async () => {
      this.debug(`get_snapshot_candidates called, returning ${candidateItems.length} items`);
      return candidateItems.map(item => ({
        id: item.id,
        name: item.name,
        zoneName: item.zoneName,
        capabilitySummary: Object.keys(item.capabilities).join(', '),
      }));
    });

    session.setHandler('pair_debug', async (msg) => {
      this.debug('[pair-client]', msg);
      return { ok: true };
    });

    session.setHandler('save_device_selection', async (data) => {
      const selectedIds = new Set(data.selectedIds || []);
      selectedItems = candidateItems.filter(item => selectedIds.has(item.id));

      generatedConfig = this.createDefaultConfig(selectedItems);
      return { success: true };
    });

    session.setHandler('get_generated_json', async () => generatedConfig || this.createDefaultConfig([]));

    session.setHandler('get_lux_sensors', async () => this.getLuxSensors());

    session.setHandler('create_device', async (data) => {
      const name = data.name || 'Circadian Light Group';
      const configJson = data.json_data;

      JSON.parse(configJson);

      return {
        name,
        data: {
          id: `circadian-light-group-${Date.now()}`,
        },
        settings: {
          config_json: configJson,
          log_errors: true,
        },
      };
    });
  }

  async onRepair(session, device) {
    this.debug('Circadian Light Group repair started');

    session.setHandler('get_config', async () => ({
      name: device.getName(),
      config: this.parseConfig(device.getSetting('config_json')),
    }));

    session.setHandler('save_config', async (data) => {
      const config = data?.config || {};
      const configJson = JSON.stringify(config, null, 2);

      JSON.parse(configJson);
      await device.setSettings({ config_json: configJson });
      // setSettings triggers onSettings on the device, which re-runs lux watchers
      // and the scheduler.
      return { success: true };
    });

    session.setHandler('get_light_candidates', async () => this.getLightCandidates({ wholeHouse: true }));
    session.setHandler('get_lux_sensors', async () => this.getLuxSensors());
  }

  parseConfig(json) {
    if (!json) return this.createDefaultConfig([]);
    try {
      return JSON.parse(json);
    } catch (error) {
      return this.createDefaultConfig([]);
    }
  }

  async getLightCandidates(data = {}) {
    const api = this.homey.app.api;
    if (!api) throw new Error('Homey API not ready. Please try again in a few seconds.');

    const allDevices = await api.devices.getDevices();
    const allZones = await api.zones.getZones();
    const zoneMap = {};

    Object.values(allZones).forEach(zone => {
      zoneMap[zone.id] = zone;
    });

    const selectedZones = new Set(data.zones || []);
    const wholeHouse = data.wholeHouse !== false;

    const isZoneSelected = (zoneId) => {
      if (wholeHouse) return true;
      let currentId = zoneId;
      while (currentId) {
        if (selectedZones.has(currentId)) return true;
        const zone = zoneMap[currentId];
        currentId = zone ? zone.parent : null;
      }
      return false;
    };

    const candidates = [];

    for (const deviceId in allDevices) {
      const homeyDevice = allDevices[deviceId];
      if (!isZoneSelected(homeyDevice.zone)) continue;
      if (homeyDevice.driverUri && homeyDevice.driverUri.includes('circadian-light-group')) continue;
      if (homeyDevice.class !== 'light') continue;

      const supportedCapabilities = {};
      let hasSupportedCapability = false;

      for (const capId of LIGHT_CAPABILITIES) {
        const capDef = homeyDevice.capabilitiesObj?.[capId];
        if (!capDef || capDef.setable !== true) continue;
        supportedCapabilities[capId] = {
          value: capDef.value,
          title: capDef.title || capId,
          type: capDef.type || 'unknown',
        };
        hasSupportedCapability = true;
      }

      if (!hasSupportedCapability) continue;

      candidates.push({
        id: homeyDevice.id,
        name: homeyDevice.name,
        zoneName: allZones[homeyDevice.zone] ? allZones[homeyDevice.zone].name : 'Unknown',
        capabilities: supportedCapabilities,
        capabilitySummary: Object.keys(supportedCapabilities).join(', '),
      });
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name));
    return candidates;
  }

  async getLuxSensors() {
    const api = this.homey.app.api;
    if (!api) return [];

    const allDevices = await api.devices.getDevices();
    const allZones = await api.zones.getZones();
    const sensors = [];

    for (const deviceId in allDevices) {
      const homeyDevice = allDevices[deviceId];
      const capDef = homeyDevice.capabilitiesObj?.measure_luminance;
      if (!capDef) continue;

      sensors.push({
        id: homeyDevice.id,
        name: homeyDevice.name,
        zoneName: allZones[homeyDevice.zone] ? allZones[homeyDevice.zone].name : 'Unknown',
        value: capDef.value,
      });
    }

    sensors.sort((a, b) => a.name.localeCompare(b.name));
    return sensors;
  }

  createDefaultConfig(devices) {
    return {
      _meta: {
        device: 'Circadian Light Group',
        version: 2,
      },
      profile: {
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
      },
      outdoorLight: {
        provider: 'astronomical',
        fallbackProvider: 'astronomical',
        staleAfterMinutes: 20,
        cacheMinutes: 15,
      },
      devices: devices.map(device => ({
        id: device.id,
        name: device.name,
        zoneName: device.zoneName,
        enabled: true,
        prewarmBeforeOn: true,
        redModeAllowed: true,
        minDim: 0.05,
        maxDim: 1,
        capabilities: Object.keys(device.capabilities),
      })),
    };
  }
}

module.exports = CircadianLightGroupDriver;
