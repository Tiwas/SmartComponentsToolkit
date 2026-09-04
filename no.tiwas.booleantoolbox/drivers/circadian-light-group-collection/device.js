'use strict';

const CircadianLightGroupDevice = require('../circadian-light-group/device');

const COLLECTION_OPERATION_BATCH_MS = 50;
const COLLECTION_OPERATION_PRIORITY = Object.freeze({
  pause: 0,
  resume: 0,
  default: 10,
});

class CircadianLightGroupCollectionDevice extends CircadianLightGroupDevice {
  async startScheduler() {
    // Member Circadian Light Groups already maintain their own schedulers. A second
    // collection timer sends duplicate writes and can supersede an in-flight member
    // command at exactly the same tick.
    this.stopScheduler();
    this.debug('Collection scheduler disabled; member groups schedule their own profile updates');
  }

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
      const names = failed.map(e => e.name || e.id).join(', ');
      await this.triggerError(`${label}: ${failed.length} group(s) had unresponsive members: ${names}`);
    }
    return result;
  }

  getCollectionOperationPriority(label) {
    return COLLECTION_OPERATION_PRIORITY[label] ?? COLLECTION_OPERATION_PRIORITY.default;
  }

  scheduleCollectionOperationDrain() {
    if (this.collectionOperationRunning || this.collectionOperationDispatchTimer) return;
    if (!Array.isArray(this.collectionOperationQueue) || this.collectionOperationQueue.length === 0) return;

    const configuredDelay = Number(this.collectionOperationBatchDelayMs);
    const delay = Number.isFinite(configuredDelay)
      ? Math.max(0, configuredDelay)
      : COLLECTION_OPERATION_BATCH_MS;
    this.collectionOperationDispatchTimer = setTimeout(() => {
      this.collectionOperationDispatchTimer = null;
      this.drainCollectionOperationQueue().catch(error => {
        this.error('Collection operation queue failed:', error);
      });
    }, delay);
  }

  async drainCollectionOperationQueue() {
    if (this.collectionOperationRunning) return;
    const queue = Array.isArray(this.collectionOperationQueue) ? this.collectionOperationQueue : [];
    if (queue.length === 0) return;

    queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    const next = queue.shift();
    this.collectionOperationRunning = true;
    try {
      this.debug(`collection operation started: ${next.label} (priority=${next.priority})`);
      next.resolve(await next.taskFn());
    } catch (error) {
      next.reject(error);
    } finally {
      this.collectionOperationRunning = false;
      this.scheduleCollectionOperationDrain();
    }
  }

  runCollectionOperation(label, taskFn) {
    // Advanced Flow can start multiple cards for the same Collection in parallel.
    // Batch near-simultaneous calls briefly, then run pause/resume before on/off.
    // Return the actual operation promise so Homey does not advance the card's
    // outgoing connection before fan-out, retries and verification finish.
    if (!Array.isArray(this.collectionOperationQueue)) this.collectionOperationQueue = [];
    this.collectionOperationSequence = (this.collectionOperationSequence || 0) + 1;

    const operation = new Promise((resolve, reject) => {
      this.collectionOperationQueue.push({
        label,
        taskFn,
        priority: this.getCollectionOperationPriority(label),
        sequence: this.collectionOperationSequence,
        resolve,
        reject,
      });
    });
    this.scheduleCollectionOperationDrain();
    return operation;
  }

  async runAwaitedMemberGroups(label, taskFn) {
    const result = await this.runForMemberGroups(label, async (device, item, attempt) => {
      const completed = await taskFn(device, item, attempt);
      if (completed === false) {
        throw new Error(`${item?.name || item?.id || 'Circadian Light Group'} reported an incomplete operation`);
      }
    });
    return result?.superseded !== true && (result?.failed || []).length === 0;
  }

  async applyCurrentProfile({ reason = 'manual' } = {}) {
    if (this.deleted) return false;
    return this.runCollectionOperation(`apply_${reason}`, async () => this.runAwaitedMemberGroups(`apply_${reason}`, async (device) => {
      return device.applyCurrentProfile({ reason: `collection-${reason}` });
    }));
  }

  async turnCollectionOn() {
    await this.setCollectionOnoff(true);
    return this.runAwaitedMemberGroups('turn_on', async (device) => {
      return device.onFlowTurnOn();
    });
  }

  async turnCollectionOff() {
    await this.setCollectionOnoff(false);
    return this.runAwaitedMemberGroups('turn_off', async (device) => {
      return device.onFlowTurnOff();
    });
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
    return this.runCollectionOperation('turn_on', async () => this.turnCollectionOn());
  }

  async onFlowTurnOff() {
    return this.runCollectionOperation('turn_off', async () => this.turnCollectionOff());
  }

  async onFlowToggle() {
    return this.runCollectionOperation('toggle', async () => (
      this.getCapabilityValue('onoff') === true
        ? this.turnCollectionOff()
        : this.turnCollectionOn()
    ));
  }

  async onFlowTurnOnMember(args) {
    return this.runCollectionOperation('turn_on_member', async () => {
      const memberId = args.member?.id;
      if (!memberId) throw new Error('No Circadian Light Group selected');

      const entries = await this.resolveMemberEntries();
      const entry = entries.find(candidate => candidate.id === memberId);
      if (!entry || !entry.memberDevice) throw new Error('Circadian Light Group member not found');

      return entry.memberDevice.onFlowTurnOn();
    });
  }

  async onFlowTurnOnAllMembers() {
    // For a Collection, "all members" = the member CLG devices themselves.
    return this.runCollectionOperation('turn_on_all_members', async () => this.runAwaitedMemberGroups('turn_on_all_members', async (device) => {
      return device.onFlowTurnOn();
    }));
  }

  async onFlowTurnOffAllMembers() {
    return this.runCollectionOperation('turn_off_all_members', async () => this.runAwaitedMemberGroups('turn_off_all_members', async (device) => {
      return device.onFlowTurnOff();
    }));
  }

  async onPausedCapabilityChanged(value) {
    const paused = value === true;
    const label = paused ? 'pause' : 'resume';
    return this.runCollectionOperation(label, async () => {
      this.pauseDebug(`collection capability changed value=${paused}`);
      this.clearPauseTimer();
      if (this.getCapabilityValue('clg_paused') !== paused) {
        await this.setCapabilityValue('clg_paused', paused);
      }
      if (paused) {
        await this.persistPauseState(null);
      } else {
        await this.clearPersistedPauseState();
      }
      await this.firePauseTrigger(paused);

      return this.runAwaitedMemberGroups(label, async (device) => {
        return paused ? device.onFlowPause({}) : device.onFlowResume();
      });
    });
  }

  async onFlowPause(args) {
    return this.runCollectionOperation('pause', async () => {
      await super.onFlowPause(args);
      return this.runAwaitedMemberGroups('pause', async (device) => {
        return device.onFlowPause(args);
      });
    });
  }

  async onFlowResume() {
    return this.runCollectionOperation('resume', async () => {
      this.clearPauseTimer();
      const wasPaused = this.getCapabilityValue('clg_paused') === true;
      this.pauseDebug(`collection flow resume wasPaused=${wasPaused}`);
      await this.setCapabilityValue('clg_paused', false);
      await this.clearPersistedPauseState();
      if (wasPaused) await this.firePauseTrigger(false);

      return this.runAwaitedMemberGroups('resume', async (device) => {
        return device.onFlowResume();
      });
    });
  }

  async onFlowSetExternalLux(args) {
    return this.runCollectionOperation('set_external_lux', async () => this.runAwaitedMemberGroups('set_external_lux', async (device) => {
      return device.onFlowSetExternalLux(args);
    }));
  }

  async onFlowSetRedThreshold(args) {
    return this.runCollectionOperation('set_red_threshold', async () => this.runAwaitedMemberGroups('set_red_threshold', async (device) => {
      return device.onFlowSetRedThreshold(args);
    }));
  }

  async onFlowApplyState(args) {
    return this.runCollectionOperation('apply_state', async () => this.runAwaitedMemberGroups('apply_state', async (device) => {
      return device.onFlowApplyState(args);
    }));
  }

  async onFlowForceRedMode(args) {
    return this.runCollectionOperation('force_red_mode', async () => this.runAwaitedMemberGroups('force_red_mode', async (device) => {
      return device.onFlowForceRedMode(args);
    }));
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
