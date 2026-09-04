'use strict';

const Homey = require('homey');

class StateCaptureDevice extends Homey.Device {

    async onInit() {
        this.debug('StateCaptureDevice has been initialized');

        // Get state manager from app
        this.stateManager = this.homey.app.capturedStateManager;

        this.registerCapabilityListener('onoff', async (value) => {
            this.debug('Device toggled:', value);
            // onoff is just a visual indicator, no action on toggle
        });
    }

    debug(...args) {
        if (this.homey.settings.get('debug_mode')) {
            this.log('[DEBUG]', ...args);
        }
    }

    getDeviceId() {
        return this.getData().id;
    }

    getTemplate() {
        const json = this.getSetting('template_json');
        if (!json) return { items: [] };
        try {
            return JSON.parse(json);
        } catch (e) {
            this.error('Invalid template JSON:', e);
            return { items: [] };
        }
    }

    /**
     * Execute state application (supports both hierarchical and flat formats)
     * Uses same logic as state-device for consistency
     * @param {object} stateData - State data in hierarchical (zones) or flat (values) format
     * @returns {object} - { success, errors }
     */
    async _executeApply(stateData) {
        const api = this.homey.app.api;
        const template = this.getTemplate();
        const errors = [];
        if (!stateData || typeof stateData !== 'object') {
            return { success: false, errors: [{ error: 'Invalid state data' }] };
        }
        if (!api) {
            return { success: false, errors: [{ error: 'Homey API not ready' }] };
        }

        // Build execution queue based on format
        const queue = [];
        const globalDelay = stateData.config?.default_delay ?? template.config?.default_delay ?? 100;
        const ignoreErrors = stateData.config?.ignore_errors !== false;

        if (stateData.zones) {
            // Hierarchical format (state-editor compatible)
            for (const [zoneName, zoneData] of Object.entries(stateData.zones)) {
                if (zoneData.active === false) continue;

                const zoneDelay = zoneData.config?.delay_between ?? globalDelay;
                const items = zoneData.items || [];

                for (const item of items) {
                    if (item.active === false) continue;

                    const delay = item.delay ?? zoneDelay;
                    queue.push({
                        id: item.id,
                        name: item.name || 'Unknown',
                        capabilities: item.capabilities,
                        delay
                    });
                }
            }
        } else if (stateData.values) {
            // Legacy flat format - convert to queue using template for device names
            const templateLookup = {};
            for (const item of template.items || []) {
                templateLookup[item.device_id] = {
                    name: item.device_name || 'Unknown',
                    delay: item.delay ?? globalDelay,
                    active: item.active !== false
                };
            }

            for (const [deviceId, capValues] of Object.entries(stateData.values)) {
                const templateInfo = templateLookup[deviceId];
                if (!templateInfo || !templateInfo.active) continue;

                // Convert capability values to array format
                const capabilities = Object.entries(capValues).map(([capId, value]) => ({
                    capability: capId,
                    value
                }));

                queue.push({
                    id: deviceId,
                    name: templateInfo.name,
                    capabilities,
                    delay: templateInfo.delay
                });
            }
        }

        if (queue.length === 0) {
            return { success: false, errors: [{ error: 'State contains no active changes' }] };
        }

        this.debug(`Starting apply sequence with ${queue.length} items...`);

        // Execute queue
        for (const item of queue) {
            if (!item.id || !item.capabilities) {
                errors.push({ device: item.name || 'Unknown', device_id: item.id, error: 'Invalid item configuration' });
                if (!ignoreErrors) return { success: false, errors };
                continue;
            }

            let apiDevice;
            try {
                apiDevice = await api.devices.getDevice({ id: item.id });
            } catch (e) {
                const errMessage = e.message || 'Unknown error';
                if (errMessage.includes('Could not reach device')) {
                    this.error(`[UNREACHABLE] Failed to get device ${item.name}: ${errMessage}`);
                } else {
                    this.error(`Failed to get device ${item.name}: ${errMessage}`);
                }
                errors.push({ device: item.name, device_id: item.id, error: errMessage });
                if (!ignoreErrors) break;
                continue;
            }

            // Normalize capabilities to array format
            let capsToSet = [];
            if (Array.isArray(item.capabilities)) {
                capsToSet = item.capabilities;
            } else {
                capsToSet = Object.entries(item.capabilities).map(([k, v]) => ({ capability: k, value: v }));
            }

            // Filter for valid/setable capabilities
            const validCaps = [];
            for (const capEntry of capsToSet) {
                const capId = capEntry.capability || capEntry.id;
                if (apiDevice.capabilitiesObj && apiDevice.capabilitiesObj[capId]) {
                    if (apiDevice.capabilitiesObj[capId].setable) {
                        validCaps.push(capEntry);
                    } else {
                        this.debug(`Skipping ${item.name} (${capId}): Capability is read-only`);
                        errors.push({ device: item.name, capability: capId, error: 'Capability is read-only' });
                    }
                } else {
                    this.debug(`Skipping ${item.name} (${capId}): Capability not found`);
                    errors.push({ device: item.name, capability: capId, error: 'Capability not found' });
                }
            }

            if (validCaps.length === 0) {
                this.debug(`Skipping item ${item.name}: No valid/setable capabilities`);
                if (!ignoreErrors) return { success: false, errors };
                continue;
            }
            if (!ignoreErrors && errors.length > 0) return { success: false, errors };

            // Wait delay before processing
            if (item.delay > 0) {
                await new Promise(resolve => setTimeout(resolve, item.delay));
            }

            // Execute capabilities
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

                    if (errMessage.includes('Missing Capability Listener')) {
                        this.log(`[WARN] Skipped ${item.name} (${capId}): Device driver does not support controlling`);
                    } else if (errMessage.includes('TRANSMIT_COMPLETE_NO_ACK')) {
                        this.error(`[NETWORK] Failed to set ${item.name} (${capId}): Device did not respond`);
                        errors.push({ device: item.name, capability: capId, error: errMessage });
                        if (!ignoreErrors) break;
                    } else if (errMessage.includes('device is currently unavailable') || errMessage.includes('Could not reach device')) {
                        this.error(`[UNREACHABLE] Failed to set ${item.name} (${capId}): Device unavailable`);
                        errors.push({ device: item.name, capability: capId, error: errMessage });
                        if (!ignoreErrors) break;
                    } else if (capError.code === 'TIMEOUT' || errMessage.includes('Timed out')) {
                        this.error(`[TIMEOUT] Failed to set ${item.name} (${capId}): Operation timed out`);
                        errors.push({ device: item.name, capability: capId, error: errMessage });
                        if (!ignoreErrors) break;
                    } else {
                        this.error(`Failed to set ${item.name} (${capId}): ${errMessage}`);
                        errors.push({ device: item.name, capability: capId, error: errMessage });
                        if (!ignoreErrors) break;
                    }
                    if (!errors.some(error => error.device === item.name && error.capability === capId && error.error === errMessage)) {
                        errors.push({ device: item.name, capability: capId, error: errMessage });
                    }
                    if (!ignoreErrors) return { success: false, errors };
                }

                // Small delay between capabilities (same as state-device)
                if (i < validCaps.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        this.debug('Apply sequence completed.');
        return { success: errors.length === 0, errors };
    }

    async _finishFlowApply(result, stateName) {
        if (result.success) {
            await this.homey.flow.getTriggerCard('state_applied_scd')
                .trigger(this, { state_name: stateName })
                .catch(this.error);
            return true;
        }

        const error = result.errors.map(item => item.error || String(item)).join('; ') || 'State was not applied';
        this.error(`State application failed: ${error}`);
        await this.homey.flow.getTriggerCard('capture_error_scd')
            .trigger(this, { error, state_name: stateName })
            .catch(this.error);
        return false;
    }

    /**
     * Legacy wrapper for backward compatibility
     * @deprecated Use _executeApply() instead
     */
    async _applyValues(values) {
        return this._executeApply({ values });
    }

    // ==================== FLOW ACTIONS: NAMED STATES ====================

    /**
     * Flow Action: Capture current state to named slot
     */
    async onFlowCaptureState(args) {
        const stateName = args.state_name;

        if (!stateName || stateName.trim() === '') {
            throw new Error(this.homey.__('errors.state_name_required') || 'State name is required');
        }

        const template = this.getTemplate();
        const api = this.homey.app.api;

        try {
            const result = await this.stateManager.captureState(
                this.getDeviceId(),
                stateName.trim(),
                template,
                api
            );

            // Trigger success flow
            await this.homey.flow.getTriggerCard('state_captured_scd')
                .trigger(this, { state_name: stateName })
                .catch(this.error);

            this.debug('State captured:', stateName);
            return true;

        } catch (e) {
            this.error('Capture failed:', e);

            await this.homey.flow.getTriggerCard('capture_error_scd')
                .trigger(this, { error: e.message, state_name: stateName })
                .catch(this.error);

            throw e;
        }
    }

    /**
     * Flow Action: Apply a captured state
     */
    async onFlowApplyState(args) {
        // Handle both autocomplete object and direct string
        const stateName = args.state_name?.name || args.state_name;

        if (!stateName) {
            throw new Error(this.homey.__('errors.state_name_required') || 'State name is required');
        }

        // Get state with template for legacy format conversion
        const template = this.getTemplate();
        const state = this.stateManager.getState(this.getDeviceId(), stateName, template);
        if (!state) {
            throw new Error(this.homey.__('errors.state_not_found') || `State '${stateName}' not found`);
        }

        try {
            // Use _executeApply with full state object (supports both formats)
            const result = await this._executeApply(state);

            return this._finishFlowApply(result, stateName);

        } catch (e) {
            this.error('Apply failed:', e);

            await this.homey.flow.getTriggerCard('capture_error_scd')
                .trigger(this, { error: e.message, state_name: stateName })
                .catch(this.error);

            throw e;
        }
    }

    /**
     * Flow Action: Delete a captured state
     */
    async onFlowDeleteState(args) {
        const stateName = args.state_name?.name || args.state_name;

        if (!stateName) {
            throw new Error('State name is required');
        }

        const deleted = this.stateManager.deleteState(this.getDeviceId(), stateName);
        if (!deleted) {
            throw new Error(`State '${stateName}' not found`);
        }

        this.debug('Deleted state:', stateName);
        return true;
    }

    // ==================== FLOW ACTIONS: STACK ====================

    /**
     * Flow Action: Push current state onto stack
     */
    async onFlowPushState(args) {
        const template = this.getTemplate();
        const api = this.homey.app.api;

        try {
            const result = await this.stateManager.pushState(
                this.getDeviceId(),
                template,
                api
            );

            // Trigger success (state_name is empty for stack operations)
            await this.homey.flow.getTriggerCard('state_captured_scd')
                .trigger(this, { state_name: '' })
                .catch(this.error);

            this.debug(`Pushed state onto stack (depth: ${result.depth})`);
            return true;

        } catch (e) {
            this.error('Push failed:', e);

            await this.homey.flow.getTriggerCard('capture_error_scd')
                .trigger(this, { error: e.message, state_name: '' })
                .catch(this.error);

            throw e;
        }
    }

    /**
     * Flow Action: Pop state from stack and apply it
     */
    async onFlowPopState(args) {
        const previousPop = this.popApplyQueue || Promise.resolve();
        let finishPop;
        const currentPop = new Promise(resolve => { finishPop = resolve; });
        this.popApplyQueue = currentPop;

        try {
            await previousPop;
        // Get state with template for legacy format conversion
            const template = this.getTemplate();
            const state = this.stateManager.peekState(this.getDeviceId(), template);

            if (!state) {
                throw new Error(this.homey.__('errors.stack_empty') || 'Stack is empty');
            }

            // Use _executeApply with full state object
            const result = await this._executeApply(state);

            const applied = await this._finishFlowApply(result, '');
            if (applied) this.stateManager.popState(this.getDeviceId(), template);
            return applied;
        } catch (e) {
            this.error('Pop/Apply failed:', e);

            await this.homey.flow.getTriggerCard('capture_error_scd')
                .trigger(this, { error: e.message, state_name: '' })
                .catch(this.error);

            throw e;
        } finally {
            finishPop();
            if (this.popApplyQueue === currentPop) this.popApplyQueue = null;
        }
    }

    /**
     * Flow Action: Peek at top of stack and apply (without removing)
     */
    async onFlowPeekApplyState(args) {
        // Get state with template for legacy format conversion
        const template = this.getTemplate();
        const state = this.stateManager.peekState(this.getDeviceId(), template);

        if (!state) {
            throw new Error(this.homey.__('errors.stack_empty') || 'Stack is empty');
        }

        try {
            // Use _executeApply with full state object
            const result = await this._executeApply(state);

            return this._finishFlowApply(result, '');

        } catch (e) {
            this.error('Peek/Apply failed:', e);

            await this.homey.flow.getTriggerCard('capture_error_scd')
                .trigger(this, { error: e.message, state_name: '' })
                .catch(this.error);

            throw e;
        }
    }

    /**
     * Flow Action: Clear the stack
     */
    async onFlowClearStack(args) {
        const count = this.stateManager.clearStack(this.getDeviceId());
        this.debug(`Cleared stack (${count} items removed)`);
        return true;
    }

    // ==================== FLOW ACTIONS: EXPORT/IMPORT ====================

    /**
     * Flow Action: Export all named states as JSON
     */
    async onFlowExportStates(args) {
        try {
            const exportData = this.stateManager.exportNamedStates(this.getDeviceId());
            const jsonString = JSON.stringify(exportData);

            this.debug(`Exported ${Object.keys(exportData.states).length} named states`);

            return { json_data: jsonString };

        } catch (e) {
            this.error('Export failed:', e);
            throw e;
        }
    }

    /**
     * Flow Action: Import named states from JSON
     */
    async onFlowImportStates(args) {
        const jsonData = args.json_data;

        if (!jsonData || jsonData.trim() === '') {
            throw new Error('JSON data is required');
        }

        let statesData;
        try {
            statesData = JSON.parse(jsonData);
        } catch (e) {
            throw new Error('Invalid JSON format: ' + e.message);
        }

        try {
            const result = this.stateManager.importNamedStates(this.getDeviceId(), statesData);

            this.debug(`Imported ${result.imported} states (${result.overwritten} overwritten)`);

            if (result.errors.length > 0) {
                this.debug('Import errors:', result.errors);
            }

            return true;

        } catch (e) {
            this.error('Import failed:', e);
            throw e;
        }
    }

    // ==================== FLOW ACTIONS: GET/SET STATE JSON ====================

    /**
     * Flow Action: Get a specific state as JSON
     */
    async onFlowGetStateJson(args) {
        // Handle both autocomplete object and direct string
        const stateName = args.state_name?.name || args.state_name;

        if (!stateName) {
            throw new Error(this.homey.__('errors.state_name_required') || 'State name is required');
        }

        const state = this.stateManager.getState(this.getDeviceId(), stateName);
        if (!state) {
            throw new Error(this.homey.__('errors.state_not_found') || `State '${stateName}' not found`);
        }

        const jsonString = JSON.stringify(state);
        this.debug(`Got state "${stateName}" as JSON (${jsonString.length} chars)`);

        return { json_data: jsonString };
    }

    /**
     * Flow Action: Set a named state from JSON
     */
    async onFlowSetStateJson(args) {
        const stateName = args.state_name;
        const jsonData = args.json_data;

        if (!stateName || stateName.trim() === '') {
            throw new Error(this.homey.__('errors.state_name_required') || 'State name is required');
        }

        if (!jsonData || jsonData.trim() === '') {
            throw new Error('JSON data is required');
        }

        let stateData;
        try {
            stateData = JSON.parse(jsonData);
        } catch (e) {
            throw new Error('Invalid JSON format: ' + e.message);
        }

        try {
            this.stateManager.setStateFromJson(this.getDeviceId(), stateName.trim(), stateData);
            this.debug(`Set state "${stateName}" from JSON`);
            return true;
        } catch (e) {
            this.error('Set state from JSON failed:', e);
            throw e;
        }
    }

    // ==================== FLOW CONDITIONS ====================

    /**
     * Flow Condition: Check if named state exists
     */
    onFlowConditionStateExists(args) {
        const stateName = args.state_name;
        if (!stateName) return false;
        return this.stateManager.stateExists(this.getDeviceId(), stateName);
    }

    /**
     * Flow Condition: Check if stack is empty
     */
    onFlowConditionStackEmpty(args) {
        return this.stateManager.isStackEmpty(this.getDeviceId());
    }

    /**
     * Flow Condition: Check stack depth against operator and value
     */
    onFlowConditionStackDepth(args) {
        const depth = this.stateManager.getStackDepth(this.getDeviceId());
        const targetDepth = Number(args.depth) || 0;
        const operator = args.operator;

        switch (operator) {
            case 'eq':
                return depth === targetDepth;
            case 'gt':
                return depth > targetDepth;
            case 'gte':
                return depth >= targetDepth;
            case 'lt':
                return depth < targetDepth;
            case 'lte':
                return depth <= targetDepth;
            default:
                return depth === targetDepth;
        }
    }

    // ==================== AUTOCOMPLETE ====================

    /**
     * Get state names for autocomplete
     */
    getStateNamesForAutocomplete(query) {
        const states = this.stateManager.listStateNames(this.getDeviceId());
        const lowerQuery = (query || '').toLowerCase();

        return states
            .filter(s => !query || s.name.toLowerCase().includes(lowerQuery))
            .map(s => ({
                name: s.name,
                description: `Captured: ${new Date(s.captured_at).toLocaleString()}`,
                id: s.name
            }));
    }

    // ==================== LIFECYCLE ====================

    async onDeleted() {
        // Clean up stored states when device is deleted
        if (this.stateManager) {
            this.stateManager.cleanupDevice(this.getDeviceId());
        }
    }
}

module.exports = StateCaptureDevice;
