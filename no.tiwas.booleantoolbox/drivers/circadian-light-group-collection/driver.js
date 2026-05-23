'use strict';

const CircadianLightGroupDriver = require('../circadian-light-group/driver');

class CircadianLightGroupCollectionDriver extends CircadianLightGroupDriver {
  async onInit() {
    this.debug('CircadianLightGroupCollectionDriver has been initialized');
    await super.onInit();
  }

  getDefaultDeviceName() {
    return 'Circadian Light Group Collection';
  }

  createDeviceId() {
    return `circadian-light-group-collection-${Date.now()}`;
  }

  getDefaultConfigMeta() {
    return {
      device: 'Circadian Light Group Collection',
      version: 1,
      collection: true,
    };
  }

  createDefaultConfig(devices) {
    return {
      _meta: this.getDefaultConfigMeta(),
      profile: {
        updateIntervalSeconds: 120,
      },
      devices: devices.map(device => ({
        id: device.id,
        name: device.name,
        zoneName: device.zoneName,
        enabled: true,
        capabilities: Object.keys(device.capabilities || {}),
      })),
    };
  }

  async onPair(session) {
    this.debug('Circadian Light Group Collection pairing started');

    let candidateItems = [];

    session.setHandler('get_snapshot_candidates', async () => {
      candidateItems = await this.getLightCandidates({ wholeHouse: true });
      return candidateItems.map(item => ({
        id: item.id,
        name: item.name,
        zoneName: item.zoneName,
        capabilitySummary: item.capabilitySummary,
      }));
    });

    session.setHandler('create_device', async (data = {}) => {
      const selectedIds = new Set(data.selectedIds || []);
      const selectedItems = candidateItems.filter(item => selectedIds.has(item.id));
      const configJson = JSON.stringify(this.createDefaultConfig(selectedItems), null, 2);

      return {
        name: data.name || this.getDefaultDeviceName(),
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
      if (!driverRef.includes('circadian-light-group')) continue;
      if (driverRef.includes('circadian-light-group-collection')) continue;

      const supportedCapabilities = {};
      const capabilityIds = ['onoff', 'dim', 'light_temperature', 'clg_paused'];
      for (const capId of capabilityIds) {
        const capDef = homeyDevice.capabilitiesObj?.[capId];
        if (!capDef) continue;
        supportedCapabilities[capId] = {
          value: capDef.value,
          title: capDef.title || capId,
          type: capDef.type || 'unknown',
        };
      }

      const dataId = homeyDevice.data?.id || homeyDevice.id;
      candidates.push({
        id: dataId,
        homeyDeviceId: homeyDevice.id,
        name: homeyDevice.name,
        zoneName: allZones[homeyDevice.zone] ? allZones[homeyDevice.zone].name : 'Unknown',
        capabilities: supportedCapabilities,
        capabilitySummary: Object.keys(supportedCapabilities).join(', '),
      });
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name));
    return candidates;
  }
}

module.exports = CircadianLightGroupCollectionDriver;
