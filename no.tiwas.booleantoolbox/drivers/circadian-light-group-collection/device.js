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

  resolveMemberEntries() {
    const byDataId = new Map();
    const byHomeyId = new Map();
    this.getAvailableCircadianGroups().forEach(device => {
      const dataId = device.getData?.().id;
      if (dataId) byDataId.set(dataId, device);
      // device.id is the Homey-wide UUID exposed on local device instances
      const homeyId = device.id;
      if (homeyId) byHomeyId.set(homeyId, device);
    });

    return this.getMemberItems().map(item => ({
      id: item.id,
      name: item.name || item.id,
      item,
      memberDevice: byDataId.get(item.id) || byHomeyId.get(item.id) || null,
    }));
  }

  async runForMemberGroups(label, taskFn, verifyFn = null) {
    const entries = this.resolveMemberEntries();
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

    const entry = this.resolveMemberEntries().find(candidate => candidate.id === memberId);
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
    const entries = this.resolveMemberEntries().filter(entry => entry.memberDevice);
    if (entries.length === 0) return false;
    return entries.every(entry => entry.memberDevice.previousPhase === args.phase);
  }

  async onConditionRedModeActive() {
    return this.resolveMemberEntries()
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
