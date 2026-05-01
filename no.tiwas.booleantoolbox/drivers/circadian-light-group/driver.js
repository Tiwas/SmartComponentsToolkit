'use strict';

const Homey = require('homey');

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
  }

  debug(...args) {
    if (this.homey.settings.get('debug_mode')) {
      this.log('[DEBUG]', ...args);
    }
  }

  registerFlowCards() {
    this.homey.flow.getActionCard('clg_apply_now')
      .registerRunListener(async (args) => args.device.onFlowApplyNow(args));

    this.homey.flow.getActionCard('clg_pause')
      .registerRunListener(async (args) => args.device.onFlowPause(args));

    this.homey.flow.getActionCard('clg_resume')
      .registerRunListener(async (args) => args.device.onFlowResume(args));

    this.homey.flow.getActionCard('clg_set_external_lux')
      .registerRunListener(async (args) => args.device.onFlowSetExternalLux(args));

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

      return { success: true, count: candidateItems.length };
    });

    session.setHandler('get_snapshot_candidates', async () => candidateItems.map(item => ({
      id: item.id,
      name: item.name,
      zoneName: item.zoneName,
      capabilitySummary: Object.keys(item.capabilities).join(', '),
    })));

    session.setHandler('save_device_selection', async (data) => {
      const selectedIds = new Set(data.selectedIds || []);
      selectedItems = candidateItems.filter(item => selectedIds.has(item.id));

      generatedConfig = this.createDefaultConfig(selectedItems);
      return { success: true };
    });

    session.setHandler('get_generated_json', async () => generatedConfig || this.createDefaultConfig([]));

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

      if (device.getCapabilityValue('onoff') === true && device.getCapabilityValue('clg_paused') !== true) {
        await device.startScheduler(true);
      }

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
        version: 1,
      },
      profile: {
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
