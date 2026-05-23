'use strict';

const CircadianLightGroupDevice = require('../circadian-light-group/device');

class CircadianLightGroupCollectionDevice extends CircadianLightGroupDevice {
  async setupLuxWatchers() {}

  async teardownLuxWatchers() {}

  async setupMemberOnoffWatchers() {}

  async teardownMemberOnoffWatchers() {}

  getMemberItems() {
    const config = this.getConfig();
    return (Array.isArray(config.devices) ? config.devices : []).filter(item => item.enabled !== false);
  }

  getAvailableCircadianGroups() {
    const drivers = this.homey.drivers.getDrivers();
    const driver = drivers['circadian-light-group']
      || Object.values(drivers).find(candidate => candidate.id === 'circadian-light-group');
    return driver && typeof driver.getDevices === 'function' ? driver.getDevices() : [];
  }

  async resolveMemberEntries() {
    const byDataId = new Map();
    this.getAvailableCircadianGroups().forEach(device => {
      const dataId = device.getData?.().id;
      if (dataId) byDataId.set(dataId, device);
    });

    const items = this.getMemberItems();
    const unresolved = items.filter(item => !byDataId.has(item.id));

    let uuidToDataId = null;
    if (unresolved.length > 0) {
      try {
        const api = this.homey.app && this.homey.app.api;
        if (api) {
          const all = await api.devices.getDevices();
          uuidToDataId = new Map();
          Object.values(all).forEach(d => {
            const driverRef = `${d.driverUri || ''}|${d.driverId || ''}|${d.driver?.id || ''}`;
            if (!driverRef.includes('circadian-light-group')) return;
            if (driverRef.includes('circadian-light-group-collection')) return;
            const dataId = d.data?.id;
            if (d.id && dataId) uuidToDataId.set(d.id, dataId);
          });
        }
      } catch (error) {
        this.debug(`resolveMemberEntries: API lookup failed: ${error.message}`);
      }
    }

    const entries = items.map(item => {
      let memberDevice = byDataId.get(item.id) || null;
      if (!memberDevice && uuidToDataId) {
        const dataId = uuidToDataId.get(item.id);
        if (dataId) memberDevice = byDataId.get(dataId) || null;
      }
      return {
        id: item.id,
        name: item.name || item.id,
        item,
        memberDevice,
      };
    });

    const missing = entries.filter(e => !e.memberDevice).map(e => e.name || e.id);
    if (missing.length > 0) {
      this.debug(`resolveMemberEntries: ${missing.length} member(s) not found locally: ${missing.join(', ')}`);
    }
    return entries;
  }

  async runForMemberGroups(label, taskFn, verifyFn = null) {
    const entries = await this.resolveMemberEntries();
    if (entries.length === 0) {
      this.debug(`${label}: no Circadian Light Group members configured`);
      return { ok: [], failed: [] };
    }

    const op = this.acquireOp(`collection_${label}`);
    const result = await this.runDeviceTasksParallel(entries, async (entry, attempt) => {
      if (!entry.memberDevice) throw new Error('Circadian Light Group member not found');
      await taskFn(entry.memberDevice, entry.item, attempt);
    }, {
      label: `collection_${label}`,
      verifyFn: verifyFn
        ? async (entry) => {
          if (!entry.memberDevice) return false;
          return verifyFn(entry.memberDevice, entry.item);
        }
        : null,
      isCurrent: op.isCurrent,
    });

    const failed = result.failed || [];
    await this.setCapabilityValue('alarm_config', failed.length > 0).catch(this.error);
    if (failed.length > 0) {
      await this.triggerError(`${failed.length} Circadian Light Group member(s) failed during ${label}`);
    }
    return result;
  }

  async applyCurrentProfile({ reason = 'manual' } = {}) {
    if (this.deleted) return false;
    const result = await this.runForMemberGroups(`apply_${reason}`, async (device) => {
      await device.applyCurrentProfile({ reason: `collection-${reason}` });
    });
    return (result.failed || []).length === 0;
  }

  async onFlowApplyNow() {
    return this.applyCurrentProfile({ reason: 'flow' });
  }

  async setCollectionOnoff(value) {
    const next = value === true;
    const wasOn = this.getCapabilityValue('onoff') === true;
    if (wasOn !== next) {
      await this.setCapabilityValue('onoff', next);
      await this.persistOnoffState(next);
      await this.fireOnoffTrigger(next);
    } else {
      await this.persistOnoffState(next);
    }
  }

  async onFlowTurnOn() {
    await this.setCollectionOnoff(true);
    await this.runForMemberGroups('turn_on', async (device) => {
      await device.onFlowTurnOn();
    }, async (device) => device.getCapabilityValue('onoff') === true);
    return true;
  }

  async onFlowTurnOff() {
    await this.setCollectionOnoff(false);
    await this.runForMemberGroups('turn_off', async (device) => {
      await device.onFlowTurnOff();
    }, async (device) => device.getCapabilityValue('onoff') === false);
    return true;
  }

  async onFlowToggle() {
    return this.getCapabilityValue('onoff') === true
      ? this.onFlowTurnOff()
      : this.onFlowTurnOn();
  }

  async onFlowTurnOnMember(args) {
    const memberId = args.member?.id;
    if (!memberId) throw new Error('No Circadian Light Group selected');

    const entries = await this.resolveMemberEntries();
    const entry = entries.find(candidate => candidate.id === memberId);
    if (!entry || !entry.memberDevice) throw new Error('Circadian Light Group member not found');

    await entry.memberDevice.onFlowTurnOn();
    return true;
  }

  async onFlowTurnOnAllMembers() {
    await this.runForMemberGroups('turn_on_all_members', async (device) => {
      await device.onFlowTurnOnAllMembers();
    });
    return true;
  }

  async onFlowTurnOffAllMembers() {
    await this.runForMemberGroups('turn_off_all_members', async (device) => {
      await device.onFlowTurnOffAllMembers();
    });
    return true;
  }

  async onFlowPause(args) {
    await super.onFlowPause(args);
    await this.runForMemberGroups('pause', async (device) => {
      await device.onFlowPause(args);
    }, async (device) => device.getCapabilityValue('clg_paused') === true);
    return true;
  }

  async onFlowResume() {
    await this.runForMemberGroups('resume', async (device) => {
      await device.onFlowResume();
    }, async (device) => device.getCapabilityValue('clg_paused') !== true);
    await super.onFlowResume();
    return true;
  }

  async onFlowSetExternalLux(args) {
    await this.runForMemberGroups('set_external_lux', async (device) => {
      await device.onFlowSetExternalLux(args);
    });
    return true;
  }

  async onFlowSetRedThreshold(args) {
    await this.runForMemberGroups('set_red_threshold', async (device) => {
      await device.onFlowSetRedThreshold(args);
    });
    return true;
  }

  async onFlowApplyState(args) {
    await this.runForMemberGroups('apply_state', async (device) => {
      await device.onFlowApplyState(args);
    });
    return true;
  }

  async onFlowForceRedMode(args) {
    await this.runForMemberGroups('force_red_mode', async (device) => {
      await device.onFlowForceRedMode(args);
    });
    return true;
  }

  async onConditionIsInPhase(args) {
    const entries = (await this.resolveMemberEntries()).filter(entry => entry.memberDevice);
    if (entries.length === 0) return false;
    return entries.every(entry => entry.memberDevice.previousPhase === args.phase);
  }

  async onConditionRedModeActive() {
    const entries = await this.resolveMemberEntries();
    return entries
      .filter(entry => entry.memberDevice)
      .some(entry => entry.memberDevice.previousRedMode === true);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.includes('config_json')) return;
    try {
      JSON.parse(newSettings.config_json);
      await this.setCapabilityValue('alarm_config', false).catch(this.error);
      await this.startScheduler(true);
    } catch (error) {
      await this.setCapabilityValue('alarm_config', true).catch(this.error);
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  }
}

module.exports = CircadianLightGroupCollectionDevice;
