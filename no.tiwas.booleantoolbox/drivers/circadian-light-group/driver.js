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

const PREWARM_TEST_CAPABILITIES = ['dim', 'light_temperature', 'light_hue', 'light_saturation'];

const PROBE_OFF_SETTLE_MS = 600;
const PROBE_VERIFY_DELAY_MS = 800;
const PROBE_RESTORE_DELAY_MS = 200;
const PROBE_ONOFF_CHECK_MS = 4000;
const PROBE_ONOFF_POLL_MS = 100;

async function waitForOnoffTrueOrTimeout(getValue, timeoutMs, pollMs = PROBE_ONOFF_POLL_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getValue() === true) return true;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return getValue() === true;
}

function pickProbeValue(capId, currentValue) {
  const cur = Number(currentValue);
  switch (capId) {
    case 'dim':
    case 'light_temperature':
      return Number.isFinite(cur) && Math.abs(cur - 0.5) < 0.05 ? 0.7 : 0.5;
    case 'light_hue':
      // Red (matches our actual red-mode usage; avoids leaving lamps blue if restore fails)
      return Number.isFinite(cur) && Math.abs(cur - 0) < 0.02 ? 0.05 : 0;
    case 'light_saturation':
      return Number.isFinite(cur) && cur >= 0.9 ? 0.5 : 1;
    default:
      return 0.5;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let flowCardsRegistered = false;
let solarSchedulerOwner = null;

class CircadianLightGroupDriver extends Homey.Driver {
  async onInit() {
    this.debug('CircadianLightGroupDriver has been initialized');
    if (!flowCardsRegistered) {
      this.registerFlowCards();
      flowCardsRegistered = true;
    } else {
      this.debug('CircadianLightGroupDriver flow cards already registered');
    }
    if (!solarSchedulerOwner) {
      this.startSolarEventScheduler();
      solarSchedulerOwner = this;
    }
  }

  async onUninit() {
    if (solarSchedulerOwner === this && this.solarTimer) {
      clearInterval(this.solarTimer);
      this.solarTimer = null;
      solarSchedulerOwner = null;
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
    action('clg_turn_on_member', 'onFlowTurnOnMember');
    action('clg_turn_on_all_members', 'onFlowTurnOnAllMembers');
    action('clg_turn_off_all_members', 'onFlowTurnOffAllMembers');

    this.homey.flow.getActionCard('clg_turn_on_member')
      .registerArgumentAutocompleteListener('member', async (query, args) => {
        const device = args.device;
        if (!device || typeof device.getConfig !== 'function') return [];
        const config = device.getConfig();
        const items = (config.devices || []).map(d => ({
          name: d.name || d.id,
          description: d.zoneName || '',
          id: d.id,
        }));
        const q = (query || '').toLowerCase();
        return items.filter(item =>
          item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
        );
      });

    cond('clg_is_in_phase', 'onConditionIsInPhase');
    cond('clg_red_mode_active', 'onConditionRedModeActive');
    cond('clg_is_paused', 'onConditionIsPaused');
    cond('clg_is_on', 'onConditionIsOn');
  }

  async probeDeviceAsync(deviceId, session) {
    const emitProgress = (phase, capId) => {
      if (!session) return;
      try { session.emit('probe_progress', { deviceId, phase, capId }).catch(() => {}); } catch (error) { /* ignore */ }
    };
    const result = await this.probeDevice(deviceId, emitProgress);
    if (session) {
      try { await session.emit('probe_complete', result); } catch (error) { /* ignore */ }
    }
    return result;
  }

  async probeDevice(deviceId, emitProgress = () => {}) {
    const api = this.homey.app && this.homey.app.api;
    if (!api) throw new Error('Homey API not ready');

    const result = {
      deviceId,
      tested: true,
      support: { dim: null, light_temperature: null, light_hue: null, light_saturation: null, light_mode: null },
      capErrors: {},
      error: null,
    };

    let apiDevice;
    try {
      apiDevice = await api.devices.getDevice({ id: deviceId });
    } catch (error) {
      result.tested = false;
      result.error = `Device unavailable: ${error.message}`;
      return result;
    }

    const initialCaps = apiDevice.capabilitiesObj || {};
    const originalOnoff = initialCaps.onoff?.value === true;

    // Realtime state via makeCapabilityInstance — capabilitiesObj from getDevice is cached
    // and not reliably updated after setCapabilityValue calls.
    const currentState = { onoff: originalOnoff };
    const capInstances = {};
    const watchedCaps = ['onoff', ...PREWARM_TEST_CAPABILITIES, 'light_mode']
      .filter(capId => initialCaps[capId]);

    for (const capId of watchedCaps) {
      currentState[capId] = initialCaps[capId]?.value;
      try {
        const instance = apiDevice.makeCapabilityInstance(capId, (value) => {
          currentState[capId] = value;
        });
        capInstances[capId] = instance;
      } catch (error) {
        this.debug(`Probe ${deviceId}: makeCapabilityInstance(${capId}) failed: ${error.message}`);
      }
    }

    const valueChanged = (capId, before, after) => {
      const a = Number(before);
      const b = Number(after);
      if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) > 0.01;
      return before !== after;
    };

    const setOnoff = async (value) => {
      if (initialCaps.onoff?.setable) {
        try { await apiDevice.setCapabilityValue('onoff', value); } catch (error) { /* ignore */ }
      }
    };

    const ensureOff = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await setOnoff(false);
        await sleep(PROBE_OFF_SETTLE_MS);
        if (currentState.onoff !== true) return true;
      }
      this.debug(`Probe ${deviceId}: failed to confirm off after 3 attempts (state=${currentState.onoff})`);
      return false;
    };

    let snapshot = { onoff: originalOnoff };
    PREWARM_TEST_CAPABILITIES.forEach(capId => {
      if (initialCaps[capId]?.setable) snapshot[capId] = currentState[capId];
    });
    if (initialCaps.light_mode?.setable) snapshot.light_mode = currentState.light_mode;

    try {
      if (!originalOnoff) {
        emitProgress('reading_baseline');
        await setOnoff(true);
        await sleep(PROBE_OFF_SETTLE_MS);
        PREWARM_TEST_CAPABILITIES.forEach(capId => {
          if (initialCaps[capId]?.setable && currentState[capId] !== undefined) {
            snapshot[capId] = currentState[capId];
          }
        });
        this.debug(`Probe ${deviceId}: baseline values=${JSON.stringify(snapshot)}`);
      }

      emitProgress('turning_off');
      if (!await ensureOff()) {
        result.tested = false;
        result.error = 'Could not confirm device is off before testing';
        return result;
      }

      for (const capId of PREWARM_TEST_CAPABILITIES) {
        if (!initialCaps[capId]?.setable) {
          result.capErrors[capId] = 'not setable';
          this.debug(`Probe ${deviceId}/${capId}: not setable → ?`);
          continue;
        }

        const beforeValue = snapshot[capId];
        const testValue = pickProbeValue(capId, beforeValue);

        emitProgress('pre_setting', capId);
        try {
          await apiDevice.setCapabilityValue(capId, testValue);
        } catch (error) {
          result.support[capId] = false;
          result.capErrors[capId] = error.message || String(error);
          this.debug(`Probe ${deviceId}/${capId} setCapabilityValue threw: ${result.capErrors[capId]}`);
          continue;
        }
        await waitForOnoffTrueOrTimeout(() => currentState.onoff, PROBE_ONOFF_CHECK_MS);

        if (currentState.onoff === true) {
          result.support[capId] = false;
          result.capErrors[capId] = 'turned on by write';
          this.debug(`Probe ${deviceId}/${capId}: onoff=true after pre-set → ✗`);
          await ensureOff();
          continue;
        }

        // Lamp stayed off. Turn on briefly to see if pre-set value persisted.
        emitProgress('verifying', capId);
        await setOnoff(true);
        await sleep(PROBE_VERIFY_DELAY_MS);

        const observed = currentState[capId];
        const matched = valueChanged(capId, beforeValue, observed) && !valueChanged(capId, testValue, observed);
        result.support[capId] = matched;
        if (!matched) {
          result.capErrors[capId] = `value did not persist (set ${testValue}, baseline ${beforeValue}, observed ${observed})`;
        }
        this.debug(`Probe ${deviceId}/${capId}: support=${matched} baseline=${beforeValue} test=${testValue} observed=${observed}`);

        await ensureOff();
      }

      if (initialCaps.light_mode?.setable) {
        const baselineMode = currentState.light_mode;
        const testMode = baselineMode === 'color' ? 'temperature' : 'color';
        emitProgress('pre_setting', 'light_mode');
        try {
          await apiDevice.setCapabilityValue('light_mode', testMode);
          await waitForOnoffTrueOrTimeout(() => currentState.onoff, PROBE_ONOFF_CHECK_MS);
          if (currentState.onoff === true) {
            result.support.light_mode = false;
            result.capErrors.light_mode = 'turned on by write';
            this.debug(`Probe ${deviceId}/light_mode: onoff=true after pre-set → ✗`);
            await ensureOff();
          } else {
            result.support.light_mode = true;
            this.debug(`Probe ${deviceId}/light_mode: support=true (${baselineMode} -> ${testMode}, lamp stayed off)`);
          }
          await apiDevice.setCapabilityValue('light_mode', baselineMode).catch(() => {});
        } catch (error) {
          result.support.light_mode = false;
          result.capErrors.light_mode = error.message || String(error);
          this.debug(`Probe ${deviceId}/light_mode setCapabilityValue threw: ${result.capErrors.light_mode}`);
        }
      } else {
        result.capErrors.light_mode = 'not setable';
        this.debug(`Probe ${deviceId}/light_mode: not setable → ?`);
      }
    } finally {
      emitProgress('restoring');
      try {
        if (originalOnoff && initialCaps.onoff?.setable) {
          await setOnoff(true);
          await sleep(PROBE_OFF_SETTLE_MS);
          if (snapshot.light_mode !== undefined && initialCaps.light_mode?.setable) {
            await apiDevice.setCapabilityValue('light_mode', snapshot.light_mode).catch(() => {});
            await sleep(PROBE_RESTORE_DELAY_MS);
          }
          for (const capId of PREWARM_TEST_CAPABILITIES) {
            if (snapshot[capId] === undefined) continue;
            if (!Number.isFinite(Number(snapshot[capId]))) continue;
            await apiDevice.setCapabilityValue(capId, snapshot[capId]).catch(() => {});
            await sleep(PROBE_RESTORE_DELAY_MS);
          }
        } else if (initialCaps.onoff?.setable) {
          await setOnoff(false);
        }
      } catch (error) {
        this.error('Probe restore failed:', error);
      }

      for (const capId of Object.keys(capInstances)) {
        try {
          if (typeof apiDevice.destroyCapabilityInstance === 'function') {
            apiDevice.destroyCapabilityInstance(capId);
          }
        } catch (error) { /* ignore */ }
      }
    }

    return result;
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

    session.setHandler('get_selected_devices_for_test', async () => {
      return selectedItems.map(item => ({
        id: item.id,
        name: item.name,
        zoneName: item.zoneName,
        capabilities: Object.keys(item.capabilities || {}).filter(c => PREWARM_TEST_CAPABILITIES.includes(c)),
      }));
    });

    session.setHandler('probe_device', async ({ deviceId } = {}) => {
      if (!deviceId) throw new Error('deviceId required');
      this.probeDeviceAsync(deviceId, session)
        .then(probe => {
          if (generatedConfig && Array.isArray(generatedConfig.devices)) {
            const device = generatedConfig.devices.find(d => d.id === deviceId);
            if (device) {
              device.prewarmSupport = { ...probe.support, testedAt: new Date().toISOString() };
            }
          }
        })
        .catch(error => {
          session.emit('probe_complete', { deviceId, tested: false, error: error.message, support: {} }).catch(() => {});
        });
      return { started: true };
    });

    session.setHandler('skip_capability_test', async () => {
      if (generatedConfig && Array.isArray(generatedConfig.devices)) {
        generatedConfig.devices.forEach(device => {
          device.prewarmSupport = { dim: null, light_temperature: null, light_hue: null, light_saturation: null, light_mode: null, testedAt: null };
        });
      }
      return { success: true };
    });

    session.setHandler('get_generated_json', async () => generatedConfig || this.createDefaultConfig([]));

    session.setHandler('get_lux_sensors', async () => this.getLuxSensors());

    session.setHandler('create_device', async (data) => {
      const name = data.name || this.getDefaultDeviceName();
      const configJson = data.json_data;

      JSON.parse(configJson);

      return {
        name,
        data: {
          id: this.createDeviceId(),
        },
        settings: {
          config_json: configJson,
          log_errors: true,
        },
      };
    });
  }

  getDefaultDeviceName() {
    return 'Circadian Light Group';
  }

  createDeviceId() {
    return `circadian-light-group-${Date.now()}`;
  }

  async onRepair(session, device) {
    this.debug('Circadian Light Group repair started');

    session.setHandler('get_config', async () => ({
      name: device.getName(),
      config: this.parseConfig(device.getSetting('config_json')),
    }));

    session.setHandler('save_config', async (data) => {
      this.debug(`save_config invoked, devices=${(data?.config?.devices || []).length}`);
      try {
        const config = data?.config || {};
        const configJson = JSON.stringify(config, null, 2);
        JSON.parse(configJson);
        await device.setSettings({ config_json: configJson });
        this.debug('save_config OK');
        return { success: true };
      } catch (error) {
        this.error('save_config failed:', error);
        throw error;
      }
    });

    session.setHandler('get_light_candidates', async () => this.getLightCandidates({ wholeHouse: true }));
    session.setHandler('get_lux_sensors', async () => this.getLuxSensors());

    session.setHandler('probe_device', async ({ deviceId } = {}) => {
      this.debug(`probe_device invoked deviceId=${deviceId}`);
      if (!deviceId) throw new Error('deviceId required');
      this.probeDeviceAsync(deviceId, session)
        .catch(error => {
          this.error(`probe_device async failure for ${deviceId}:`, error);
          session.emit('probe_complete', { deviceId, tested: false, error: error.message, support: {} }).catch(() => {});
        });
      return { started: true };
    });
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
      const driverRef = `${homeyDevice.driverUri || ''}|${homeyDevice.driverId || ''}|${homeyDevice.driver?.id || ''}`;
      if (driverRef.includes('circadian-light-group')) continue;

      const hasLightControl = ['dim', 'light_temperature', 'light_hue', 'light_saturation']
        .some(cap => homeyDevice.capabilitiesObj?.[cap]?.setable === true);
      if (!hasLightControl) continue;

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
      _meta: this.getDefaultConfigMeta(),
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
        invertTemperature: true,
        minDim: 0.05,
        maxDim: 1,
        capabilities: Object.keys(device.capabilities),
        prewarmSupport: {
          dim: null,
          light_temperature: null,
          light_hue: null,
          light_saturation: null,
          light_mode: null,
          testedAt: null,
        },
      })),
    };
  }

  getDefaultConfigMeta() {
    return {
      device: 'Circadian Light Group',
      version: 2,
    };
  }
}

module.exports = CircadianLightGroupDriver;
