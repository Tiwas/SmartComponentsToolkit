'use strict';

const Homey = require('homey');

class StateDevice extends Homey.Device {

  async onInit() {
    this.debug('StateDevice has been initialized');
    
    // Listen for the onoff capability change
    this.registerCapabilityListener('onoff', async (value) => {
        if (value) {
            // Activated: Apply state
            // Note: If triggered via Flow "Apply State", this might be redundant if not handled carefully.
            // But usually Flows call the Action Card, not set the capability directly.
            // If user clicks the button in UI, this triggers.
            this.applyState().catch(e => this.error('Error applying state:', e));
        } else {
            // Deactivated: Just state change, or should we "undo"?
            // User requirement: "Stays on until turned off". 
            // Usually this means the active state is cleared.
            this.debug('Device turned off manually.');
        }
    });
  }

  debug(...args) {
      if (this.homey.settings.get('debug_mode')) {
          this.log('[DEBUG]', ...args);
      }
  }
  
  async onDeleted() {
      // Cleanup if needed
  }

  async applyState() {
      // Default apply without reset
      return this._executeApply({ reset_all: false });
  }

  async onFlowActionApplyState(args) {
    const resetAll = args.reset_all === true;
    return this._executeApply({ reset_all: resetAll });
  }

  async _finishApply(errors, logErrors) {
    if (errors.length > 0) {
      const error = errors.join('; ');
      this.error(`State application completed with ${errors.length} error(s): ${error}`);
      if (logErrors) {
        await this.homey.flow.getTriggerCard('state_error_occurred_sd')
          .trigger(this, { error })
          .catch(this.error);
      }
      return false;
    }

    await this.homey.flow.getTriggerCard('state_applied_successfully_sd')
      .trigger(this)
      .catch(this.error);
    return true;
  }

  async _executeApply(options = {}) {
    this.debug('Applying state configuration...', options);
    const preApplyErrors = [];
    
    // 1. Handle Reset All
    if (options.reset_all) {
        this.debug('Resetting all other state devices...');
        try {
            const allDevices = this.driver.getDevices();
            for (const device of allDevices) {
                if (device.getData().id === this.getData().id) continue; // Skip self
                
                // Turn off without triggering logic? Or just set value.
                // Using setCapabilityValue triggers listeners usually.
                // We just want to visually turn them off.
                await device.setCapabilityValue('onoff', false).catch((error) => {
                    preApplyErrors.push(`Failed to reset ${device.getName?.() || device.getData().id}: ${error.message || error}`);
                });
            }
        } catch (e) {
            this.error('Error resetting other devices:', e);
            preApplyErrors.push(`Failed to reset other state devices: ${e.message || e}`);
        }
    }

    // 2. Set Self to ON
    await this.setCapabilityValue('onoff', true).catch((error) => {
      this.error(error);
      preApplyErrors.push(`Failed to activate this state device: ${error.message || error}`);
    });
    
    const jsonStr = this.getSetting('json_data');
    const logErrors = this.getSetting('log_errors');
    const errors = [...preApplyErrors];

    if (!jsonStr) {
      this.error('No configuration data found.');
      return this._finishApply([...errors, 'No configuration data found'], logErrors);
    }

    let configObj;
    try {
        configObj = JSON.parse(jsonStr);
    } catch (e) {
        this.error('Invalid JSON configuration:', e);
        return this._finishApply([...errors, 'Invalid JSON configuration'], logErrors);
    }

    // 3. Build Execution Queue (Handle Hierarchical vs Flat)
    const queue = [];
    const globalDelay = configObj.config?.default_delay || 200;
    const ignoreErrors = configObj.config?.ignore_errors !== false;

    // Logic to parse zones/items
    if (configObj.zones) {
        // New Hierarchical Structure
        for (const [zoneName, zoneData] of Object.entries(configObj.zones)) {
            const zoneDelay = zoneData.config?.delay_between ?? globalDelay;
            const items = zoneData.items || [];
            
            // Support for zone-level active flag? (Not explicitly requested but good practice)
            if (zoneData.active === false) continue;

            for (const item of items) {
                if (item.active === false) continue; // Skip inactive items

                // Determine delay for this item
                // Priority: Item specific > Zone specific > Global
                const delay = item.delay ?? zoneDelay;
                
                queue.push({
                    ...item,
                    delay: delay
                });
            }
        }
    } else if (configObj.items) {
        // Legacy Flat Structure
        for (const item of configObj.items) {
            if (item.active === false) continue;
            queue.push({
                ...item,
                delay: item.delay ?? globalDelay
            });
        }
    }

    if (queue.length === 0) {
        return this._finishApply([...errors, 'Configuration contains no active state changes'], logErrors);
    }

    // 4. Execute Queue
    const api = this.homey.app.api;
    if (!api) {
        return this._finishApply([...errors, 'Homey API not ready'], logErrors);
    }

    this.debug(`Starting sequence with ${queue.length} items...`);

    for (const item of queue) {
        // Execute Item
        if (!item.id || !item.capabilities) {
            errors.push(`Invalid item configuration for ${item.name || 'unnamed device'}`);
            if (!ignoreErrors) return this._finishApply(errors, logErrors);
            continue;
        }

        let apiDevice;
        try {
            apiDevice = await api.devices.getDevice({ id: item.id });
        } catch (e) {
             const errMessage = e.message || e.error || 'Unknown error';
             if (typeof errMessage === 'string' && errMessage.includes('Could not reach device')) {
                 this.error(`[UNREACHABLE] Failed to get device ${item.name}: ${errMessage}`);
             } else {
                 this.error(`Failed to get device ${item.name}:`, e);
             }
             if (!ignoreErrors) {
                 errors.push(errMessage);
                 return this._finishApply(errors, logErrors);
             }
             errors.push(errMessage);
             continue; // Skip processing this item
        }

        // capabilities can be an Object (legacy) or Array (new ordered)
        let capsToSet = [];
        if (Array.isArray(item.capabilities)) {
            capsToSet = item.capabilities;
        } else {
            // Convert legacy object to array
            capsToSet = Object.entries(item.capabilities).map(([k, v]) => ({ capability: k, value: v }));
        }

        // Filter for valid capabilities BEFORE waiting
        const validCaps = [];
        const errorsBeforeCapabilities = errors.length;
        for (const capEntry of capsToSet) {
            const capId = capEntry.capability || capEntry.id;
            
            // Check if capability exists on device
            if (apiDevice.capabilitiesObj && apiDevice.capabilitiesObj[capId]) {
                // Check if setable (optional but good practice)
                if (apiDevice.capabilitiesObj[capId].setable) {
                    validCaps.push(capEntry);
                } else {
                    this.warn(`Skipping ${item.name} (${capId}): Capability is read-only.`);
                    errors.push(`${item.name || item.id}: ${capId} is read-only`);
                }
            } else {
                this.warn(`Skipping ${item.name} (${capId}): Capability not found on device.`);
                errors.push(`${item.name || item.id}: ${capId} is not available`);
            }
        }

        if (validCaps.length === 0) {
            this.debug(`Skipping item ${item.name}: No valid/setable capabilities found.`);
            if (!ignoreErrors) return this._finishApply(errors, logErrors);
            continue; // Skip delay!
        }
        if (!ignoreErrors && errors.length > errorsBeforeCapabilities) {
            return this._finishApply(errors, logErrors);
        }

        // Wait Delay (Only if we actually have work to do)
        if (item.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, item.delay));
        }

        // Execute valid capabilities
        for (let i = 0; i < validCaps.length; i++) {
            const capEntry = validCaps[i];
            const capId = capEntry.capability || capEntry.id;
            const value = capEntry.value;
            
            try {
                await apiDevice.setCapabilityValue(capId, value);
                this.debug(`Set ${item.name} (${capId}) -> ${value}`);
            } catch (capError) {
                const errParams = capError.cause || capError;
                const errMessage = errParams.message || errParams.error || 'Unknown error';

                if (typeof errMessage === 'string' && errMessage.includes('Missing Capability Listener')) {
                    this.log(`[WARN] Skipped ${item.name} (${capId}): Device driver does not support controlling this capability.`);
                } else if (typeof errMessage === 'string' && errMessage.includes('TRANSMIT_COMPLETE_NO_ACK')) {
                    this.error(`[NETWORK] Failed to set ${item.name} (${capId}): Device did not respond.`);
                } else if (typeof errMessage === 'string' && (errMessage.includes('device is currently unavailable') || errMessage.includes('Could not reach device'))) {
                    this.error(`[UNREACHABLE] Failed to set ${item.name} (${capId}): Device is unavailable or unreachable.`);
                } else if (capError.code === 'TIMEOUT' || (typeof errMessage === 'string' && errMessage.includes('Timed out'))) {
                    this.error(`[TIMEOUT] Failed to set ${item.name} (${capId}): Operation timed out.`);
                } else {
                    this.error(`Failed to set ${item.name} (${capId}):`, capError);
                }
                errors.push(`${item.name || item.id}: failed to set ${capId}: ${errMessage}`);
                if (!ignoreErrors) return this._finishApply(errors, logErrors);
            }

            // Add a small delay between capabilities
            if (i < validCaps.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    return this._finishApply(errors, logErrors);
  }

}

module.exports = StateDevice;
