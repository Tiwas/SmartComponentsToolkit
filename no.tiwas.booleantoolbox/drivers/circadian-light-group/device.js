'use strict';

const Homey = require('homey');
const { calculateTarget, clamp } = require('../../lib/CircadianProfile');
const { OutdoorLightProvider } = require('../../lib/OutdoorLightProvider');
const { todayKey, defaultDirectionFor, detectCrossing, dateToMinutesOfDay } = require('../../lib/AnchorResolver');

const APPLY_CAPABILITY_DELAY = 150;
const PREWARM_ONOFF_WAIT_MS = 4000;
const PREWARM_ONOFF_POLL_MS = 100;
const RECENT_OFF_REVERT_WINDOW_MS = 10000;
const CLG_ONOFF_STORE_KEY = 'clg_onoff_state';
const CLG_ONOFF_LEGACY_STORE_KEY = 'clg_onoff';

const TRANSIENT_ERROR_PATTERNS = [
  /TRANSMIT_COMPLETE_NO_ACK/i,
  /did not respond/i,
  /timeout/i,
  /TRANSMIT_COMPLETE_FAIL/i,
];

const WARM_COLOR_HUE = 0.08; // amber on Homey's 0..1 hue wheel
const RED_BLEND_TEMPERATURE = 0.25;
const FULLY_DESATURATED_TEMPERATURE = 0.85;

function isTransientDeviceError(error) {
  const message = `${error?.message || ''} ${error?.cause?.error || ''} ${error?.cause?.error_description || ''}`;
  return TRANSIENT_ERROR_PATTERNS.some(re => re.test(message));
}

function temperatureToWarmColor(temperature) {
  const temp = clamp(temperature);
  const hue = WARM_COLOR_HUE * clamp(temp / RED_BLEND_TEMPERATURE);
  const saturation = clamp(1 - (temp / FULLY_DESATURATED_TEMPERATURE));
  return { hue, saturation };
}

class CircadianLightGroupDevice extends Homey.Device {
  async onInit() {
    this.debug('CircadianLightGroupDevice has been initialized');

    this.outdoorProvider = new OutdoorLightProvider({
      homey: this.homey,
      logger: this,
    });
    this.timer = null;
    this.deleted = false;
    this.luxWatchers = new Map(); // sensorDeviceId -> { capInstance, prevValue }
    this.memberOnoffWatchers = new Map(); // deviceId -> { apiDevice, listener, value }
    this.previousPhase = null;
    this.previousRedMode = null;
    this.tempOverride = null; // { dim?, temperature?, saturation?, forceRed?, forceColor?, expiresAt? }
    this.redModeOverride = null; // { value: true|false, expiresAt? }
    this.redOverrideTimer = null;

    this.registerCapabilityListener('onoff', async (value) => {
      await this.setOnoffState(value);
      await this.fireOnoffTrigger(value);
      await this.applyCurrentProfile({ reason: 'onoff-change' });
    });

    this.registerCapabilityListener('clg_paused', async (value) => {
      await this.firePauseTrigger(value);
      await this.applyCurrentProfile({ reason: 'paused-change' });
    });

    this.registerCapabilityListener('dim', async () => {});
    this.registerCapabilityListener('light_temperature', async () => {});

    await this.ensureDefaultCapabilityValues();
    await this.restorePersistedOnoffState();

    await this.setupLuxWatchers();
    await this.setupMemberOnoffWatchers();

    // Always start the scheduler so the tile keeps showing live computed values.
    // applyCurrentProfile internally gates whether to push to lights.
    await this.startScheduler(true);
  }

  async setupLuxWatchers() {
    await this.teardownLuxWatchers();

    const config = this.getConfig();
    const anchors = (config.profile && config.profile.anchors) || {};
    const sensorIds = new Set();
    Object.keys(anchors).forEach(key => {
      const anchor = anchors[key];
      if (anchor && anchor.mode === 'lux' && anchor.sensorDeviceId) {
        sensorIds.add(anchor.sensorDeviceId);
      }
    });

    if (sensorIds.size === 0) return;

    const api = this.homey.app && this.homey.app.api;
    if (!api) {
      this.error('Cannot setup lux watchers: HomeyAPI not ready');
      return;
    }

    for (const sensorId of sensorIds) {
      try {
        const apiDevice = await api.devices.getDevice({ id: sensorId });
        const capDef = apiDevice.capabilitiesObj && apiDevice.capabilitiesObj.measure_luminance;
        if (!capDef) {
          this.error(`Lux sensor ${sensorId} has no measure_luminance capability`);
          continue;
        }
        const initialValue = Number(capDef.value);
        const watcher = { prevValue: Number.isFinite(initialValue) ? initialValue : null, listener: null };
        this.luxWatchers.set(sensorId, watcher);

        const listener = (newValue) => {
          this.onLuxSensorValue(sensorId, Number(newValue)).catch(err => this.error('Lux watcher error:', err));
        };
        apiDevice.makeCapabilityInstance('measure_luminance', listener);
        watcher.listener = listener;
        watcher.apiDevice = apiDevice;
        this.debug(`Lux watcher attached to sensor ${sensorId} (initial value: ${initialValue})`);
      } catch (error) {
        this.error(`Failed to attach lux watcher to ${sensorId}:`, error);
      }
    }
  }

  async teardownLuxWatchers() {
    if (!this.luxWatchers || this.luxWatchers.size === 0) return;
    for (const [, watcher] of this.luxWatchers) {
      try {
        if (watcher.apiDevice && watcher.listener && typeof watcher.apiDevice.destroyCapabilityInstance === 'function') {
          watcher.apiDevice.destroyCapabilityInstance('measure_luminance');
        }
      } catch (error) {
        // ignore
      }
    }
    this.luxWatchers.clear();
  }

  async setupMemberOnoffWatchers() {
    await this.teardownMemberOnoffWatchers();

    const config = this.getConfig();
    const devices = Array.isArray(config.devices) ? config.devices.filter(device => device.enabled !== false) : [];
    if (devices.length === 0) return;

    const api = this.homey.app && this.homey.app.api;
    if (!api) {
      this.error('Cannot setup member onoff watchers: HomeyAPI not ready');
      return;
    }

    for (const item of devices) {
      if (!item.id) continue;
      try {
        const apiDevice = await api.devices.getDevice({ id: item.id });
        const capDef = apiDevice.capabilitiesObj?.onoff;
        if (!capDef) continue;

        const watcher = {
          apiDevice,
          listener: null,
          value: capDef.value === true,
          onoffSetable: capDef.setable === true,
          lastOffAt: null,
          lastClgWriteAt: null,
          lastClgWriteCapability: null,
          allowOnUntil: null,
        };
        const listener = (value) => {
          this.onMemberOnoffChange(item, watcher, value).catch(error => {
            this.debug(`member onoff[${item.name || item.id}] handler failed: ${error.message}`);
          });
        };
        apiDevice.makeCapabilityInstance('onoff', listener);
        watcher.listener = listener;
        this.memberOnoffWatchers.set(item.id, watcher);
        this.debug(`Member onoff watcher attached to ${item.name || item.id} (initial value: ${watcher.value})`);
      } catch (error) {
        this.debug(`Failed to attach member onoff watcher to ${item.name || item.id}: ${error.message}`);
      }
    }
  }

  async teardownMemberOnoffWatchers() {
    if (!this.memberOnoffWatchers || this.memberOnoffWatchers.size === 0) return;
    for (const [, watcher] of this.memberOnoffWatchers) {
      try {
        if (watcher.apiDevice && watcher.listener && typeof watcher.apiDevice.destroyCapabilityInstance === 'function') {
          watcher.apiDevice.destroyCapabilityInstance('onoff');
        }
      } catch (error) {
        // ignore
      }
    }
    this.memberOnoffWatchers.clear();
  }

  getLiveMemberOnoff(item, caps) {
    const watcher = this.memberOnoffWatchers && this.memberOnoffWatchers.get(item.id);
    if (watcher && typeof watcher.value === 'boolean') return watcher.value;
    return caps.onoff?.value === true;
  }

  async onMemberOnoffChange(item, watcher, value) {
    const isOn = value === true;
    const now = Date.now();
    watcher.value = isOn;
    this.debug(`member onoff[${item.name || item.id}]: ${watcher.value}`);

    if (!isOn) {
      watcher.lastOffAt = now;
      return;
    }

    const recentlyOff = watcher.lastOffAt && (now - watcher.lastOffAt) <= RECENT_OFF_REVERT_WINDOW_MS;
    const recentlyWritten = watcher.lastClgWriteAt && (now - watcher.lastClgWriteAt) <= RECENT_OFF_REVERT_WINDOW_MS;
    if (watcher.allowOnUntil && now <= watcher.allowOnUntil) {
      watcher.allowOnUntil = null;
      watcher.lastOffAt = null;
      this.debug(`member onoff[${item.name || item.id}]: accepted intentional CLG turn-on`);
      return;
    }
    if (!recentlyOff || !recentlyWritten || !watcher.onoffSetable) return;

    try {
      await watcher.apiDevice.setCapabilityValue('onoff', false);
      watcher.value = false;
      this.debug(`member onoff[${item.name || item.id}]: reverted delayed re-on after CLG ${watcher.lastClgWriteCapability || 'write'}`);
    } catch (error) {
      this.debug(`member onoff[${item.name || item.id}]: failed to revert delayed re-on: ${error.message}`);
    }
  }

  async onLuxSensorValue(sensorId, currentValue) {
    if (!Number.isFinite(currentValue)) return;
    const watcher = this.luxWatchers.get(sensorId);
    if (!watcher) return;

    const prev = watcher.prevValue;
    watcher.prevValue = currentValue;

    if (!Number.isFinite(prev)) return; // first reading, no crossing detection

    const config = this.getConfig();
    const anchors = (config.profile && config.profile.anchors) || {};
    const crossings = await this.getStoreValue('luxCrossings') || {};
    const dateKey = todayKey(new Date());
    let updated = false;

    Object.keys(anchors).forEach(anchorKey => {
      const anchor = anchors[anchorKey];
      if (!anchor || anchor.mode !== 'lux' || anchor.sensorDeviceId !== sensorId) return;

      const direction = anchor.direction || defaultDirectionFor(anchorKey);
      const threshold = Number(anchor.threshold);
      if (!Number.isFinite(threshold)) return;

      const stored = crossings[anchorKey];
      const alreadyToday = stored && stored.dateKey === dateKey;
      if (alreadyToday) return;

      if (detectCrossing(prev, currentValue, threshold, direction)) {
        crossings[anchorKey] = {
          dateKey,
          minutes: dateToMinutesOfDay(new Date()),
        };
        updated = true;
        this.debug(`Lux anchor "${anchorKey}" crossed (${prev} → ${currentValue}, threshold ${threshold}, ${direction})`);
      }
    });

    if (updated) {
      await this.setStoreValue('luxCrossings', crossings);
      await this.applyCurrentProfile({ reason: 'lux-crossing' });
    }
  }

  debug(...args) {
    if (this.homey.settings.get('debug_mode')) {
      this.log('[DEBUG]', ...args);
    }
  }

  getGeo() {
    try {
      const geo = this.homey.geolocation;
      if (!geo) return {};
      return {
        latitude: typeof geo.getLatitude === 'function' ? geo.getLatitude() : geo.latitude,
        longitude: typeof geo.getLongitude === 'function' ? geo.getLongitude() : geo.longitude,
      };
    } catch (error) {
      return {};
    }
  }

  async ensureDefaultCapabilityValues() {
    await this.setCapabilityValue('alarm_config', false).catch(this.error);
    if (this.getCapabilityValue('clg_paused') === null) {
      await this.setCapabilityValue('clg_paused', false).catch(this.error);
    }
    if (this.getCapabilityValue('dim') === null) {
      await this.setCapabilityValue('dim', 1).catch(this.error);
    }
    if (this.getCapabilityValue('light_temperature') === null) {
      await this.setCapabilityValue('light_temperature', 0.85).catch(this.error);
    }
    if (this.getCapabilityValue('measure_outdoor_lux') === null) {
      await this.setCapabilityValue('measure_outdoor_lux', 0).catch(this.error);
    }
  }

  async persistOnoffState(value) {
    const state = {
      value: value === true,
      updatedAt: new Date().toISOString(),
    };
    await this.setStoreValue(CLG_ONOFF_STORE_KEY, state).catch(this.error);
    await this.setStoreValue(CLG_ONOFF_LEGACY_STORE_KEY, state.value).catch(this.error);
  }

  async setOnoffState(value) {
    const next = value === true;
    if (this.getCapabilityValue('onoff') !== next) {
      await this.setCapabilityValue('onoff', next).catch(this.error);
    }
    await this.persistOnoffState(next);
    return next;
  }

  async restorePersistedOnoffState() {
    let storedState = null;
    let legacyStored = null;
    try {
      storedState = await this.getStoreValue(CLG_ONOFF_STORE_KEY);
    } catch (error) {
      storedState = null;
    }
    try {
      legacyStored = await this.getStoreValue(CLG_ONOFF_LEGACY_STORE_KEY);
    } catch (error) {
      legacyStored = null;
    }

    let desired = true;
    if (storedState && typeof storedState.value === 'boolean') {
      desired = storedState.value;
    } else if (legacyStored === true) {
      desired = true;
    }

    this.debug(`CLG onoff restore: stored=${JSON.stringify(storedState)} legacy=${legacyStored} desired=${desired}`);
    await this.setOnoffState(desired);
  }

  getConfig() {
    const json = this.getSetting('config_json');
    if (!json) return { profile: {}, outdoorLight: {}, devices: [] };

    try {
      return JSON.parse(json);
    } catch (error) {
      this.setCapabilityValue('alarm_config', true).catch(this.error);
      this.triggerError(`Invalid Circadian Light Group JSON: ${error.message}`).catch(this.error);
      return { profile: {}, outdoorLight: {}, devices: [] };
    }
  }

  async startScheduler(runImmediately) {
    this.stopScheduler();

    if (runImmediately) {
      await this.applyCurrentProfile({ reason: 'start' });
    }

    const config = this.getConfig();
    const intervalSeconds = Number(config.profile?.updateIntervalSeconds) || 120;
    const intervalMs = Math.max(30, intervalSeconds) * 1000;

    this.timer = setInterval(() => {
      this.applyCurrentProfile({ reason: 'timer' }).catch(error => {
        this.error('Circadian apply failed:', error);
      });
    }, intervalMs);
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async applyCurrentProfile({ reason = 'manual' } = {}) {
    if (this.deleted) return false;

    const config = this.getConfig();
    const allDevices = Array.isArray(config.devices) ? config.devices : [];
    const devices = allDevices.filter(device => device.enabled !== false);
    this.debug(`apply[${reason}] config: ${allDevices.length} device(s) total, ${devices.length} enabled`);

    let outdoor;
    try {
      outdoor = await this.outdoorProvider.getOutdoorLight(config.outdoorLight || {});
    } catch (error) {
      this.error('Failed to resolve outdoor light, using astronomical fallback:', error);
      outdoor = await this.outdoorProvider.getAstronomical(config.outdoorLight || {}, new Date(), 'fallback-after-error');
    }

    const geo = this.getGeo();
    const luxCrossings = await this.getStoreValue('luxCrossings') || {};
    const target = calculateTarget(config.profile || {}, outdoor, new Date(), {
      ...geo,
      luxCrossings,
    });

    this.applyOverridesToTarget(target);
    this.debug(`apply[${reason}] target: phase=${target.phase} dim=${target.dim?.toFixed?.(3)} temp=${target.temperature?.toFixed?.(3)} mode=${target.mode} outdoorLux=${outdoor.outdoorComputedLux} (source=${outdoor.source})`);

    // Phase + red mode change detection.
    if (this.previousPhase !== null && this.previousPhase !== target.phase) {
      this.homey.flow.getDeviceTriggerCard('clg_phase_changed')
        .trigger(this, { phase: target.phase, previous_phase: this.previousPhase })
        .catch(this.error);
    }
    this.previousPhase = target.phase;

    const isRed = target.mode === 'color';
    if (this.previousRedMode === false && isRed) {
      this.homey.flow.getDeviceTriggerCard('clg_red_mode_started').trigger(this).catch(this.error);
    } else if (this.previousRedMode === true && !isRed) {
      this.homey.flow.getDeviceTriggerCard('clg_red_mode_ended').trigger(this).catch(this.error);
    }
    this.previousRedMode = isRed;

    // Always update the virtual device's own status capabilities so the tile
    // reflects what the system would do right now, regardless of onoff/paused.
    await this.setCapabilityValue('dim', target.dim).catch(this.error);
    await this.setCapabilityValue('light_temperature', target.temperature).catch(this.error);
    await this.setCapabilityValue('measure_outdoor_lux', outdoor.outdoorComputedLux || 0).catch(this.error);

    // Light-application is gated by onoff/paused.
    const shouldApplyToLights = this.getCapabilityValue('onoff') === true
      && this.getCapabilityValue('clg_paused') !== true;

    if (!shouldApplyToLights) {
      this.debug(`apply[${reason}] SKIPPED push to lights: onoff=${this.getCapabilityValue('onoff')} clg_paused=${this.getCapabilityValue('clg_paused')}`);
      return false;
    }

    if (devices.length === 0) {
      this.debug(`apply[${reason}] SKIPPED push to lights: no enabled devices in config`);
      await this.setCapabilityValue('alarm_config', true).catch(this.error);
      return false;
    }

    await this.requestExternalOutdoorLightIfNeeded(config);

    const errors = [];
    const debugCtx = { remaining: 3, reason };
    for (const item of devices) {
      try {
        await this.applyTargetToDevice(item, target, debugCtx);
      } catch (error) {
        if (isTransientDeviceError(error)) {
          this.debug(`applyTargetToDevice[${item.name || item.id}]: transient error ignored — ${error.message}`);
          continue;
        }
        errors.push({ device: item.name || item.id, error: error.message });
        this.error(`Failed to apply target to ${item.name || item.id}:`, error);
      }
    }

    await this.setCapabilityValue('alarm_config', errors.length > 0).catch(this.error);

    if (errors.length > 0) {
      await this.triggerError(`${errors.length} light(s) failed during ${reason}`);
    }

    await this.homey.flow.getDeviceTriggerCard('clg_target_changed')
      .trigger(this, {
        phase: target.phase,
        dim: target.dim,
        temperature: target.temperature,
        outdoor_lux: outdoor.outdoorComputedLux || 0,
      })
      .catch(this.error);

    return errors.length === 0;
  }

  async requestExternalOutdoorLightIfNeeded(config) {
    if (config.outdoorLight?.provider !== 'external_value') return;

    await this.homey.flow.getDeviceTriggerCard('clg_outdoor_light_requested')
      .trigger(this, {}, {})
      .catch(this.error);
  }

  async applyTargetToDevice(item, target, debugCtx) {
    if (!item.id) {
      this.debug(`applyTargetToDevice: skipped (no id) for ${item.name || '<unnamed>'}`);
      return;
    }

    const label = item.name || item.id;
    const apiDevice = await this.homey.app.api.devices.getDevice({ id: item.id });
    const caps = apiDevice.capabilitiesObj || {};
    const cachedIsOn = caps.onoff?.value === true;
    const isOn = this.getLiveMemberOnoff(item, caps);
    const prewarmBeforeOn = item.prewarmBeforeOn !== false;

    const verbose = debugCtx && debugCtx.remaining > 0;
    if (verbose) {
      debugCtx.remaining -= 1;
      const capSummary = {
        onoff: { value: caps.onoff?.value, liveValue: isOn, setable: caps.onoff?.setable },
        light_mode: { value: caps.light_mode?.value, setable: caps.light_mode?.setable },
        light_temperature: { value: caps.light_temperature?.value, setable: caps.light_temperature?.setable },
        light_hue: { setable: caps.light_hue?.setable },
        light_saturation: { setable: caps.light_saturation?.setable },
        dim: { value: caps.dim?.value, setable: caps.dim?.setable },
      };
      this.debug(`applyTargetToDevice[${label}] DIAG: isOn=${isOn} cachedIsOn=${cachedIsOn} item.prewarmBeforeOn=${item.prewarmBeforeOn} -> prewarmBeforeOn=${prewarmBeforeOn}`);
      this.debug(`applyTargetToDevice[${label}] DIAG: prewarmSupport=${JSON.stringify(item.prewarmSupport || {})} redModeAllowed=${item.redModeAllowed} invertTemperature=${item.invertTemperature} minDim=${item.minDim} maxDim=${item.maxDim}`);
      this.debug(`applyTargetToDevice[${label}] DIAG: caps=${JSON.stringify(capSummary)}`);
      this.debug(`applyTargetToDevice[${label}] DIAG: target={mode:${target.mode}, dim:${target.dim}, temp:${target.temperature}, hue:${target.hue}, sat:${target.saturation}}`);
    }

    if (!isOn && !prewarmBeforeOn) {
      this.debug(`applyTargetToDevice[${label}]: skipped (off + prewarm disabled)`);
      return;
    }

    const capabilitiesToSet = this.getCapabilitiesToSet(item, target, caps, isOn, verbose ? label : null);
    if (capabilitiesToSet.length === 0) {
      this.debug(`applyTargetToDevice[${label}]: nothing to set (isOn=${isOn})`);
      return;
    }

    const isPrewarm = !isOn;
    const decision = isPrewarm ? 'prewarm-while-off' : 'apply-live';
    this.debug(`applyTargetToDevice[${label}]: decision=${decision} isOn=${isOn} writes=${JSON.stringify(capabilitiesToSet)}`);

    let liveOnoff = isOn;
    let onoffInstance = null;
    let lastPrewarmCapability = null;
    const watcher = this.memberOnoffWatchers && this.memberOnoffWatchers.get(item.id);
    if (isPrewarm) {
      try {
        onoffInstance = apiDevice.makeCapabilityInstance('onoff', (value) => {
          liveOnoff = value === true;
        });
      } catch (error) {
        this.debug(`applyTargetToDevice[${label}]: makeCapabilityInstance(onoff) failed: ${error.message}`);
      }
    }

    try {
      for (const [capability, value] of capabilitiesToSet) {
        if (isPrewarm) lastPrewarmCapability = capability;
        await apiDevice.setCapabilityValue(capability, value);
        if (watcher) {
          watcher.lastClgWriteAt = Date.now();
          watcher.lastClgWriteCapability = capability;
        }
        await new Promise(resolve => setTimeout(resolve, APPLY_CAPABILITY_DELAY));

        if (isPrewarm && liveOnoff === true) {
          await this.handlePrewarmTrip(item, label, apiDevice, caps, capability);
          return;
        }
      }

      if (isPrewarm) {
        const tripped = await this.waitForPrewarmTrip(() => liveOnoff, PREWARM_ONOFF_WAIT_MS);
        if (tripped) {
          await this.handlePrewarmTrip(item, label, apiDevice, caps, lastPrewarmCapability);
        } else {
          this.debug(`applyTargetToDevice[${label}]: prewarm OK (onoff stayed false ${PREWARM_ONOFF_WAIT_MS}ms)`);
        }
      }
    } finally {
      if (onoffInstance) {
        try { onoffInstance.destroy(); } catch (error) { /* ignore */ }
      }
    }
  }

  async waitForPrewarmTrip(getOnoff, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (getOnoff() === true) return true;
      await new Promise(resolve => setTimeout(resolve, Math.min(PREWARM_ONOFF_POLL_MS, Math.max(0, deadline - Date.now()))));
    }
    return getOnoff() === true;
  }

  async handlePrewarmTrip(item, label, apiDevice, caps, capability) {
    if (caps.onoff?.setable) {
      try {
        await apiDevice.setCapabilityValue('onoff', false);
        this.debug(`applyTargetToDevice[${label}]: prewarm ${capability} tripped lamp on — forced off`);
      } catch (error) {
        this.debug(`applyTargetToDevice[${label}]: failed to force off after prewarm trip: ${error.message}`);
      }
    }
    await this.markPrewarmCapabilityLost(item, label, capability);
  }

  async markPrewarmCapabilityLost(item, label, capability) {
    if (!capability) return;

    const config = this.getConfig();
    const devices = Array.isArray(config.devices) ? config.devices : [];
    const configItem = devices.find(device => device.id === item.id);
    if (!configItem) return;

    configItem.prewarmSupport = {
      ...(configItem.prewarmSupport || {}),
      [capability]: false,
      testedAt: new Date().toISOString(),
    };
    item.prewarmSupport = {
      ...(item.prewarmSupport || {}),
      [capability]: false,
      testedAt: configItem.prewarmSupport.testedAt,
    };

    this.debug(`markPrewarmCapabilityLost[${label}]: ${capability} marked unsupported for prewarm`);
    await this.setSettings({ config_json: JSON.stringify(config, null, 2) });
    await this.triggerError(`Prewarm ${capability} turned on ${item.name || item.id}. Marked as unsupported for this light.`);
  }

  getCapabilitiesToSet(item, target, caps, isOn, debugLabel) {
    const result = [];
    const minDim = Number.isFinite(Number(item.minDim)) ? Number(item.minDim) : 0.05;
    const maxDim = Number.isFinite(Number(item.maxDim)) ? Number(item.maxDim) : 1;
    const canUseRed = item.redModeAllowed !== false;
    const prewarm = item.prewarmSupport || {};
    const prewarmAllowed = (capId) => isOn || prewarm[capId] === true;
    const canWriteColor = canUseRed
      && caps.light_hue?.setable === true
      && caps.light_saturation?.setable === true
      && prewarmAllowed('light_hue')
      && prewarmAllowed('light_saturation');
    const canWriteTemperature = caps.light_temperature?.setable === true && prewarmAllowed('light_temperature');
    const useRedColor = target.mode === 'color' && canWriteColor;
    const useWarmColorFallback = target.mode !== 'color' && !canWriteTemperature && canWriteColor;
    const mode = useRedColor || useWarmColorFallback
      ? 'color'
      : (canWriteTemperature ? 'temperature' : null);

    const lightModeAllowed = isOn || prewarm.light_mode === true;
    if (mode && caps.light_mode?.setable && caps.light_mode.value !== mode && lightModeAllowed) {
      result.push(['light_mode', mode]);
      if (debugLabel) this.debug(`getCapabilitiesToSet[${debugLabel}]: light_mode ${caps.light_mode.value} -> ${mode} (isOn=${isOn} prewarm.light_mode=${prewarm.light_mode})`);
    } else if (debugLabel && mode && caps.light_mode?.setable && caps.light_mode.value !== mode) {
      this.debug(`getCapabilitiesToSet[${debugLabel}]: light_mode write SUPPRESSED (isOn=${isOn} prewarm.light_mode=${prewarm.light_mode}) — strict opt-in`);
    }

    if (mode === 'color') {
      const color = useRedColor ? target : temperatureToWarmColor(target.temperature);
      result.push(['light_hue', clamp(color.hue)]);
      result.push(['light_saturation', clamp(color.saturation)]);
      if (debugLabel) this.debug(`getCapabilitiesToSet[${debugLabel}]: color path (${useRedColor ? 'red' : 'warm-fallback'}), hue=${color.hue} saturation=${color.saturation}`);
    } else if (mode === 'temperature') {
      const temperature = item.invertTemperature === false ? target.temperature : 1 - target.temperature;
      result.push(['light_temperature', clamp(temperature)]);
      if (debugLabel) this.debug(`getCapabilitiesToSet[${debugLabel}]: temperature path, prewarmAllowed(temp)=${prewarmAllowed('light_temperature')} (prewarm.light_temperature=${prewarm.light_temperature})`);
    } else if (debugLabel) {
      this.debug(`getCapabilitiesToSet[${debugLabel}]: no color/temperature write — hue.setable=${caps.light_hue?.setable} sat.setable=${caps.light_saturation?.setable} temp.setable=${caps.light_temperature?.setable} prewarmAllowed(temp)=${prewarmAllowed('light_temperature')}`);
    }

    if (caps.dim?.setable && (isOn || prewarm.dim === true)) {
      result.push(['dim', clamp(target.dim, minDim, maxDim)]);
      if (debugLabel) this.debug(`getCapabilitiesToSet[${debugLabel}]: dim included (isOn=${isOn} prewarm.dim=${prewarm.dim})`);
    } else if (debugLabel && caps.dim?.setable) {
      this.debug(`getCapabilitiesToSet[${debugLabel}]: dim suppressed (isOn=${isOn} prewarm.dim=${prewarm.dim})`);
    }

    return result;
  }

  async triggerError(error) {
    if (this.getSetting('log_errors') !== false) {
      await this.homey.flow.getDeviceTriggerCard('clg_error_occurred')
        .trigger(this, { error })
        .catch(this.error);
    }
  }

  applyOverridesToTarget(target) {
    const now = Date.now();

    if (this.tempOverride && (!this.tempOverride.expiresAt || this.tempOverride.expiresAt > now)) {
      const o = this.tempOverride;
      if (Number.isFinite(o.dim)) target.dim = clamp(o.dim);
      if (Number.isFinite(o.temperature)) target.temperature = clamp(o.temperature);
      if (Number.isFinite(o.saturation)) {
        target.saturation = clamp(o.saturation);
        target.mode = 'color';
        target.hue = 0;
      }
      if (o.forceRed === true) {
        target.mode = 'color';
        target.hue = 0;
        if (!Number.isFinite(target.saturation)) target.saturation = 1;
      }
    } else if (this.tempOverride && this.tempOverride.expiresAt && this.tempOverride.expiresAt <= now) {
      this.tempOverride = null;
    }

    if (this.redModeOverride && (!this.redModeOverride.expiresAt || this.redModeOverride.expiresAt > now)) {
      if (this.redModeOverride.value === true) {
        target.mode = 'color';
        target.hue = 0;
        if (!Number.isFinite(target.saturation)) target.saturation = 1;
      } else {
        target.mode = 'temperature';
        target.hue = null;
        target.saturation = null;
      }
    } else if (this.redModeOverride && this.redModeOverride.expiresAt && this.redModeOverride.expiresAt <= now) {
      this.redModeOverride = null;
    }
  }

  async fireOnoffTrigger(value) {
    const cardId = value ? 'clg_turned_on' : 'clg_turned_off';
    this.homey.flow.getDeviceTriggerCard(cardId).trigger(this).catch(this.error);
  }

  async firePauseTrigger(value) {
    const cardId = value ? 'clg_paused' : 'clg_resumed';
    this.homey.flow.getDeviceTriggerCard(cardId).trigger(this).catch(this.error);
  }

  resolveSolarEventToFutureMs(event, offsetMinutes = 0) {
    const SunCalc = require('suncalc');
    const { eventToDateLike } = this._solarHelpers();
    const geo = this.getGeo();
    const lat = Number(geo.latitude);
    const lon = Number(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const tryDay = (offsetDays) => {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      const times = SunCalc.getTimes(date, lat, lon);
      const eventDate = eventToDateLike(event, times);
      if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) return null;
      return new Date(eventDate.getTime() + (Number(offsetMinutes) || 0) * 60000);
    };

    for (let day = 0; day <= 2; day++) {
      const candidate = tryDay(day);
      if (candidate && candidate.getTime() > Date.now()) return candidate;
    }
    return null;
  }

  _solarHelpers() {
    function midpoint(a, b) {
      if (!(a instanceof Date) || !(b instanceof Date)) return null;
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
      return new Date((a.getTime() + b.getTime()) / 2);
    }
    return {
      eventToDateLike(event, t) {
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
          case 'blue_hour_morning': return midpoint(t.nauticalDawn, t.dawn);
          case 'blue_hour_evening': return midpoint(t.dusk, t.nauticalDusk);
          case 'solar_noon': return t.solarNoon;
          case 'solar_midnight': return t.nadir;
          default: return null;
        }
      },
    };
  }

  async onFlowTurnOnMember(args) {
    const memberId = args.member?.id;
    if (!memberId) throw new Error('No light selected');

    const config = this.getConfig();
    const item = (Array.isArray(config.devices) ? config.devices : []).find(d => d.id === memberId);
    if (!item) throw new Error('Light is not a member of this group');

    const target = await this.computeCurrentTarget(config);
    await this.turnOnMemberToTarget(item, target);
    return true;
  }

  async onFlowTurnOnAllMembers() {
    const config = this.getConfig();
    const members = (Array.isArray(config.devices) ? config.devices : []).filter(d => d.enabled !== false);
    if (members.length === 0) return true;

    const target = await this.computeCurrentTarget(config);
    for (const item of members) {
      try {
        await this.turnOnMemberToTarget(item, target);
      } catch (error) {
        if (isTransientDeviceError(error)) {
          this.debug(`turn_on_all_members[${item.name || item.id}]: transient error ignored — ${error.message}`);
          continue;
        }
        this.error(`turn_on_all_members[${item.name || item.id}] failed:`, error);
      }
    }
    return true;
  }

  async onFlowTurnOffAllMembers() {
    const config = this.getConfig();
    const members = (Array.isArray(config.devices) ? config.devices : []).filter(d => d.enabled !== false);
    if (members.length === 0) return true;

    for (const item of members) {
      try {
        const apiDevice = await this.homey.app.api.devices.getDevice({ id: item.id });
        if (apiDevice.capabilitiesObj?.onoff?.setable && apiDevice.capabilitiesObj.onoff.value !== false) {
          await apiDevice.setCapabilityValue('onoff', false);
        }
      } catch (error) {
        if (isTransientDeviceError(error)) {
          this.debug(`turn_off_all_members[${item.name || item.id}]: transient error ignored — ${error.message}`);
          continue;
        }
        this.error(`turn_off_all_members[${item.name || item.id}] failed:`, error);
      }
    }
    return true;
  }

  async computeCurrentTarget(config) {
    let outdoor;
    try {
      outdoor = await this.outdoorProvider.getOutdoorLight(config.outdoorLight || {});
    } catch (error) {
      outdoor = await this.outdoorProvider.getAstronomical(config.outdoorLight || {}, new Date(), 'fallback');
    }
    const geo = this.getGeo();
    const luxCrossings = await this.getStoreValue('luxCrossings') || {};
    const target = calculateTarget(config.profile || {}, outdoor, new Date(), { ...geo, luxCrossings });
    this.applyOverridesToTarget(target);
    return target;
  }

  async turnOnMemberToTarget(item, target) {
    const clgActive = this.getCapabilityValue('onoff') === true && this.getCapabilityValue('clg_paused') !== true;
    if (!clgActive) {
      const apiDevice = await this.homey.app.api.devices.getDevice({ id: item.id });
      await this.setMemberOnoff(apiDevice, item, true);
      this.debug(`turn_on_member[${item.name || item.id}]: CLG inactive, only set onoff=true`);
      return;
    }

    const apiDevice = await this.homey.app.api.devices.getDevice({ id: item.id });
    const caps = apiDevice.capabilitiesObj || {};
    const wasOn = this.getLiveMemberOnoff(item, caps);
    const watcher = this.memberOnoffWatchers && this.memberOnoffWatchers.get(item.id);
    const prewarmWrites = wasOn ? [] : this.getCapabilitiesToSet(item, target, caps, false);

    if (prewarmWrites.length > 0) {
      this.debug(`turn_on_member[${item.name || item.id}]: prewarm before on writes=${JSON.stringify(prewarmWrites)}`);
      for (const [capability, value] of prewarmWrites) {
        await apiDevice.setCapabilityValue(capability, value);
        if (watcher) {
          watcher.lastClgWriteAt = Date.now();
          watcher.lastClgWriteCapability = capability;
        }
        await new Promise(resolve => setTimeout(resolve, APPLY_CAPABILITY_DELAY));
      }
    }

    await this.setMemberOnoff(apiDevice, item, true);
    await new Promise(resolve => setTimeout(resolve, APPLY_CAPABILITY_DELAY));

    const writes = this.getCapabilitiesToSet(item, target, caps, true);
    this.debug(`turn_on_member[${item.name || item.id}]: apply after on writes=${JSON.stringify(writes)}`);
    for (const [capability, value] of writes) {
      await apiDevice.setCapabilityValue(capability, value);
      if (watcher) {
        watcher.lastClgWriteAt = Date.now();
        watcher.lastClgWriteCapability = capability;
      }
      await new Promise(resolve => setTimeout(resolve, APPLY_CAPABILITY_DELAY));
    }
  }

  async setMemberOnoff(apiDevice, item, value) {
    const caps = apiDevice.capabilitiesObj || {};
    const watcher = this.memberOnoffWatchers && this.memberOnoffWatchers.get(item.id);
    if (watcher && value === true) {
      watcher.allowOnUntil = Date.now() + RECENT_OFF_REVERT_WINDOW_MS;
    }
    if (caps.onoff?.setable && caps.onoff.value !== value) {
      await apiDevice.setCapabilityValue('onoff', value);
    }
    if (watcher) {
      watcher.value = value === true;
      if (value === true) watcher.lastOffAt = null;
    }
  }

  // ---- Flow action handlers ----

  async onFlowApplyNow() {
    return this.applyCurrentProfile({ reason: 'flow' });
  }

  async onFlowTurnOn() {
    if (this.getCapabilityValue('onoff') !== true) {
      await this.setCapabilityValue('onoff', true);
      await this.persistOnoffState(true);
      await this.fireOnoffTrigger(true);
      await this.applyCurrentProfile({ reason: 'flow-turn-on' });
    }
    return true;
  }

  async onFlowTurnOff() {
    if (this.getCapabilityValue('onoff') !== false) {
      await this.setCapabilityValue('onoff', false);
      await this.persistOnoffState(false);
      await this.fireOnoffTrigger(false);
      await this.applyCurrentProfile({ reason: 'flow-turn-off' });
    }
    return true;
  }

  async onFlowToggle() {
    const next = this.getCapabilityValue('onoff') !== true;
    await this.setCapabilityValue('onoff', next);
    await this.persistOnoffState(next);
    await this.fireOnoffTrigger(next);
    await this.applyCurrentProfile({ reason: 'flow-toggle' });
    return true;
  }

  async onFlowPauseUntilTime(args) {
    const match = String(args.until_time || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new Error('Invalid time format');
    const targetHours = Number(match[1]);
    const targetMinutes = Number(match[2]);

    const now = new Date();
    const target = new Date(now);
    target.setHours(targetHours, targetMinutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1); // tomorrow
    }
    const minutes = Math.max(1, Math.round((target.getTime() - now.getTime()) / 60000));
    return this.onFlowPause({ amount: minutes, unit: 'minutes' });
  }

  async onFlowPauseUntilSolar(args) {
    const target = this.resolveSolarEventToFutureMs(args.event, args.offset_minutes);
    if (!target) throw new Error('Could not resolve solar event (missing geolocation or polar conditions)');
    const minutes = Math.max(1, Math.round((target.getTime() - Date.now()) / 60000));
    return this.onFlowPause({ amount: minutes, unit: 'minutes' });
  }

  async onFlowSetRedThreshold(args) {
    const value = Number(args.threshold);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Threshold must be between 0 and 1');
    }
    const config = this.getConfig();
    config.profile = config.profile || {};
    config.profile.redThreshold = value;
    await this.setSettings({ config_json: JSON.stringify(config, null, 2) });
    return true;
  }

  async onFlowApplyState(args) {
    const expiresAt = Date.now() + (60 * 1000 * 30); // 30 min cap; usually overwritten by next tick
    this.tempOverride = {
      dim: Number.isFinite(Number(args.dim)) && args.dim !== '' ? Number(args.dim) : undefined,
      temperature: Number.isFinite(Number(args.temperature)) && args.temperature !== '' ? Number(args.temperature) : undefined,
      saturation: Number.isFinite(Number(args.saturation)) && args.saturation !== '' ? Number(args.saturation) : undefined,
      forceRed: args.force_red === true,
      expiresAt,
    };
    await this.applyCurrentProfile({ reason: 'flow-apply-state' });
    return true;
  }

  async onFlowForceRedMode(args) {
    if (this.redOverrideTimer) {
      clearTimeout(this.redOverrideTimer);
      this.redOverrideTimer = null;
    }

    if (args.state === 'clear') {
      this.redModeOverride = null;
    } else {
      const duration = Number(args.duration_minutes) || 0;
      this.redModeOverride = {
        value: args.state === 'on',
        expiresAt: duration > 0 ? Date.now() + duration * 60000 : null,
      };
      if (duration > 0) {
        this.redOverrideTimer = setTimeout(() => {
          this.redModeOverride = null;
          this.applyCurrentProfile({ reason: 'red-override-expired' }).catch(this.error);
        }, duration * 60000);
      }
    }
    await this.applyCurrentProfile({ reason: 'flow-force-red' });
    return true;
  }

  // ---- Flow condition handlers ----

  async onConditionIsInPhase(args) {
    return this.previousPhase === args.phase;
  }

  async onConditionRedModeActive() {
    return this.previousRedMode === true;
  }

  async onConditionIsPaused() {
    return this.getCapabilityValue('clg_paused') === true;
  }

  async onConditionIsOn() {
    return this.getCapabilityValue('onoff') === true;
  }

  async onFlowPause(args) {
    // Backwards compatibility: old card used { minutes }, new card uses { amount, unit }.
    let ms = 0;
    if (args && (args.amount !== undefined || args.unit !== undefined)) {
      const amount = Number(args.amount) || 0;
      const unit = args.unit || 'minutes';
      const factor = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
      ms = amount * factor;
    } else {
      ms = (Number(args.minutes) || 0) * 60000;
    }

    const wasPaused = this.getCapabilityValue('clg_paused') === true;
    await this.setCapabilityValue('clg_paused', true);
    if (!wasPaused) await this.firePauseTrigger(true);

    if (ms > 0) {
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.onFlowResume({}).catch(this.error);
      }, ms);
    }

    return true;
  }

  async onFlowResume() {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }

    const wasPaused = this.getCapabilityValue('clg_paused') === true;
    await this.setCapabilityValue('clg_paused', false);
    if (wasPaused) await this.firePauseTrigger(false);
    await this.applyCurrentProfile({ reason: 'flow-resume' });
    return true;
  }

  async onFlowSetExternalLux(args) {
    const lux = Number(args.lux);
    if (!Number.isFinite(lux)) throw new Error('Lux must be a number');

    const validMinutes = Number(args.valid_minutes) || 15;
    const source = args.source || 'external-flow';
    const value = this.outdoorProvider.setExternalValue(lux, validMinutes, source);

    await this.setCapabilityValue('measure_outdoor_lux', value.outdoorComputedLux).catch(this.error);
    await this.applyCurrentProfile({ reason: 'external-lux' });
    return true;
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('config_json')) {
      try {
        JSON.parse(newSettings.config_json);
        await this.setCapabilityValue('alarm_config', false).catch(this.error);
        await this.setupLuxWatchers();
        await this.setupMemberOnoffWatchers();
        await this.startScheduler(true);
      } catch (error) {
        await this.setCapabilityValue('alarm_config', true).catch(this.error);
        throw new Error(`Invalid JSON: ${error.message}`);
      }
    }
  }

  async onDeleted() {
    this.deleted = true;
    this.stopScheduler();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    await this.teardownLuxWatchers();
    await this.teardownMemberOnoffWatchers();
  }
}

module.exports = CircadianLightGroupDevice;
