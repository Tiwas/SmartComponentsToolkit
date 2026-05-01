'use strict';

const Homey = require('homey');
const { calculateTarget, clamp } = require('../../lib/CircadianProfile');
const { OutdoorLightProvider } = require('../../lib/OutdoorLightProvider');

const APPLY_CAPABILITY_DELAY = 150;

class CircadianLightGroupDevice extends Homey.Device {
  async onInit() {
    this.debug('CircadianLightGroupDevice has been initialized');

    this.outdoorProvider = new OutdoorLightProvider({
      homey: this.homey,
      logger: this,
    });
    this.timer = null;
    this.deleted = false;

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        await this.startScheduler(true);
      } else {
        this.stopScheduler();
      }
    });

    this.registerCapabilityListener('clg_paused', async (value) => {
      if (value) {
        this.stopScheduler();
      } else if (this.getCapabilityValue('onoff') === true) {
        await this.startScheduler(true);
      }
    });

    await this.ensureDefaultCapabilityValues();

    if (this.getCapabilityValue('onoff') === true && this.getCapabilityValue('clg_paused') !== true) {
      await this.startScheduler(false);
    }
  }

  debug(...args) {
    if (this.homey.settings.get('debug_mode')) {
      this.log('[DEBUG]', ...args);
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
    if (this.getCapabilityValue('onoff') !== true) return false;
    if (this.getCapabilityValue('clg_paused') === true) return false;

    const config = this.getConfig();
    const devices = Array.isArray(config.devices) ? config.devices.filter(device => device.enabled !== false) : [];

    if (devices.length === 0) {
      await this.setCapabilityValue('alarm_config', true).catch(this.error);
      return false;
    }

    let outdoor;
    try {
      outdoor = await this.outdoorProvider.getOutdoorLight(config.outdoorLight || {});
    } catch (error) {
      this.error('Failed to resolve outdoor light, using astronomical fallback:', error);
      outdoor = await this.outdoorProvider.getAstronomical(config.outdoorLight || {}, new Date(), 'fallback-after-error');
    }

    const target = calculateTarget(config.profile || {}, outdoor, new Date());

    await this.setCapabilityValue('dim', target.dim).catch(this.error);
    await this.setCapabilityValue('light_temperature', target.temperature).catch(this.error);
    await this.setCapabilityValue('measure_outdoor_lux', outdoor.outdoorComputedLux || 0).catch(this.error);

    await this.requestExternalOutdoorLightIfNeeded(config);

    const errors = [];
    for (const item of devices) {
      try {
        await this.applyTargetToDevice(item, target);
      } catch (error) {
        errors.push({ device: item.name || item.id, error: error.message });
        this.error(`Failed to apply target to ${item.name || item.id}:`, error);
      }
    }

    await this.setCapabilityValue('alarm_config', errors.length > 0).catch(this.error);

    if (errors.length > 0) {
      await this.triggerError(`${errors.length} light(s) failed during ${reason}`);
    }

    await this.homey.flow.getTriggerCard('clg_target_changed')
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

    await this.homey.flow.getTriggerCard('clg_outdoor_light_requested')
      .trigger(this, {}, { deviceId: this.getData().id })
      .catch(this.error);
  }

  async applyTargetToDevice(item, target) {
    if (!item.id) return;

    const apiDevice = await this.homey.app.api.devices.getDevice({ id: item.id });
    const caps = apiDevice.capabilitiesObj || {};
    const isOn = caps.onoff?.value === true;
    const unsafePrewarmDevices = await this.getStoreValue('unsafe_prewarm_devices') || {};
    const prewarmBeforeOn = item.prewarmBeforeOn !== false && !unsafePrewarmDevices[item.id];

    if (!isOn && !prewarmBeforeOn) return;

    const capabilitiesToSet = this.getCapabilitiesToSet(item, target, caps, isOn);
    if (capabilitiesToSet.length === 0) return;

    for (const [capability, value] of capabilitiesToSet) {
      await apiDevice.setCapabilityValue(capability, value);
      await new Promise(resolve => setTimeout(resolve, APPLY_CAPABILITY_DELAY));
    }

    if (!isOn && prewarmBeforeOn) {
      await this.detectUnsafePrewarm(item);
    }
  }

  getCapabilitiesToSet(item, target, caps, isOn) {
    const result = [];
    const minDim = Number.isFinite(Number(item.minDim)) ? Number(item.minDim) : 0.05;
    const maxDim = Number.isFinite(Number(item.maxDim)) ? Number(item.maxDim) : 1;
    const canUseRed = item.redModeAllowed !== false;
    const mode = target.mode === 'color' && canUseRed ? 'color' : 'temperature';

    if (caps.light_mode?.setable && caps.light_mode.value !== mode) {
      result.push(['light_mode', mode]);
    }

    if (mode === 'color' && caps.light_hue?.setable && caps.light_saturation?.setable) {
      result.push(['light_hue', target.hue]);
      result.push(['light_saturation', target.saturation]);
    } else if (caps.light_temperature?.setable) {
      const temperature = item.invertTemperature === true ? 1 - target.temperature : target.temperature;
      result.push(['light_temperature', clamp(temperature)]);
    }

    if (isOn && caps.dim?.setable) {
      result.push(['dim', clamp(target.dim, minDim, maxDim)]);
    }

    return result;
  }

  async detectUnsafePrewarm(item) {
    const refreshed = await this.homey.app.api.devices.getDevice({ id: item.id });
    if (refreshed.capabilitiesObj?.onoff?.value !== true) return;

    const unsafe = await this.getStoreValue('unsafe_prewarm_devices') || {};
    unsafe[item.id] = {
      name: item.name,
      detectedAt: new Date().toISOString(),
    };
    await this.setStoreValue('unsafe_prewarm_devices', unsafe);
    await this.triggerError(`Prewarm turned on ${item.name || item.id}. Disable prewarm for this light.`);
  }

  async triggerError(error) {
    if (this.getSetting('log_errors') !== false) {
      await this.homey.flow.getTriggerCard('clg_error_occurred')
        .trigger(this, { error })
        .catch(this.error);
    }
  }

  async onFlowApplyNow() {
    return this.applyCurrentProfile({ reason: 'flow' });
  }

  async onFlowPause(args) {
    const minutes = Number(args.minutes) || 0;
    await this.setCapabilityValue('clg_paused', true);
    this.stopScheduler();

    if (minutes > 0) {
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.onFlowResume({}).catch(this.error);
      }, minutes * 60 * 1000);
    }

    return true;
  }

  async onFlowResume() {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }

    await this.setCapabilityValue('clg_paused', false);
    if (this.getCapabilityValue('onoff') === true) {
      await this.startScheduler(true);
    }
    return true;
  }

  async onFlowSetExternalLux(args) {
    const lux = Number(args.lux);
    if (!Number.isFinite(lux)) throw new Error('Lux must be a number');

    const validMinutes = Number(args.valid_minutes) || 15;
    const source = args.source || 'external-flow';
    const value = this.outdoorProvider.setExternalValue(lux, validMinutes, source);

    await this.setCapabilityValue('measure_outdoor_lux', value.outdoorComputedLux).catch(this.error);
    if (this.getCapabilityValue('onoff') === true && this.getCapabilityValue('clg_paused') !== true) {
      await this.applyCurrentProfile({ reason: 'external-lux' });
    }

    return true;
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('config_json')) {
      try {
        JSON.parse(newSettings.config_json);
        await this.setCapabilityValue('alarm_config', false).catch(this.error);
        if (this.getCapabilityValue('onoff') === true && this.getCapabilityValue('clg_paused') !== true) {
          await this.startScheduler(true);
        }
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
  }
}

module.exports = CircadianLightGroupDevice;
