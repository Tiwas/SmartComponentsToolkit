'use strict';

/**
 * CapturedStateManager - Singleton class for managing captured device states
 *
 * Stores and retrieves snapshots of device capability states for later restoration.
 * Enables "scene" functionality where the current state of multiple devices can be
 * captured and later restored exactly.
 *
 * Features:
 * - Named states: Key-value storage for named snapshots (e.g., "morning", "evening")
 * - Stack-based states: Push/pop/peek operations for undo-like functionality
 * - Persistent storage: Data survives app restarts via Homey settings
 * - Per-device namespacing: Each State Capture Device has isolated storage
 * - Format conversion: Supports both flat and hierarchical state formats
 *
 * Called by:
 *   - app.js - Creates singleton instance
 *   - state-capture-device/device.js - Capture/restore operations
 *   - Flow card handlers - Capture, restore, import/export actions
 *
 * @class CapturedStateManager
 * @singleton
 */
class CapturedStateManager {
    /**
     * Creates or returns the singleton CapturedStateManager instance.
     *
     * @param {Object} homey - Homey API instance (for settings access)
     * @param {Logger} logger - Logger instance for output
     *
     * Called by:
     *   - app.js onInit() - During application startup
     *
     * Calls:
     *   - Logger.info() - Initialization logging
     */
    constructor(homey, logger) {
        if (CapturedStateManager.instance) {
            return CapturedStateManager.instance;
        }

        this.homey = homey;
        this.logger = logger;

        // Configuration
        this.STORAGE_PREFIX = 'captured_states_';
        this.MAX_NAMED_STATES = 50;
        this.MAX_STACK_DEPTH = 20;
        this.MAX_STATE_SIZE_BYTES = 100000; // ~100KB per device

        CapturedStateManager.instance = this;
        this.logger.info('🔧 CapturedStateManager initialized');
    }

    /**
     * Get storage key for a device
     */
    _getStorageKey(deviceId) {
        return `${this.STORAGE_PREFIX}${deviceId}`;
    }

    /**
     * Get all data for a device (both named and stack)
     */
    _getDeviceData(deviceId) {
        const key = this._getStorageKey(deviceId);
        const raw = this.homey.settings.get(key);
        if (!raw) {
            return { named: {}, stack: [] };
        }
        try {
            const data = JSON.parse(raw);
            // Ensure structure exists
            return {
                named: data.named || {},
                stack: data.stack || []
            };
        } catch (e) {
            this.logger.error(`Failed to parse stored data for device ${deviceId}`, e);
            return { named: {}, stack: [] };
        }
    }

    /**
     * Save all data for a device
     */
    _saveDeviceData(deviceId, data) {
        const key = this._getStorageKey(deviceId);
        const json = JSON.stringify(data);
        if (json.length > this.MAX_STATE_SIZE_BYTES) {
            throw new Error(`Storage limit exceeded for device ${deviceId}`);
        }
        this.homey.settings.set(key, json);
    }

    /**
     * Convert flat state format to hierarchical format (compatible with state-editor)
     * @param {object} flatState - State in flat format { values: { device_id: { cap: val } } }
     * @param {object} template - Template with device names and zone info
     * @returns {object} - State in hierarchical format { zones: { ... } }
     */
    _convertFlatToHierarchical(flatState, template) {
        // Build device lookup from template
        const deviceLookup = {};
        for (const item of template.items || []) {
            deviceLookup[item.device_id] = {
                name: item.device_name || 'Unknown Device',
                zone: item.zone_name || 'Captured',
                capabilities: item.capabilities || []
            };
        }

        // Group items by zone
        const zoneItems = {};

        for (const [deviceId, capValues] of Object.entries(flatState.values || {})) {
            const deviceInfo = deviceLookup[deviceId] || {
                name: 'Unknown Device',
                zone: 'Captured',
                capabilities: Object.keys(capValues)
            };
            const zoneName = deviceInfo.zone;

            if (!zoneItems[zoneName]) {
                zoneItems[zoneName] = [];
            }

            // Build capabilities array with values
            const capabilities = [];
            for (const [capId, value] of Object.entries(capValues)) {
                capabilities.push({ capability: capId, value });
            }

            zoneItems[zoneName].push({
                id: deviceId,
                name: deviceInfo.name,
                active: true,
                capabilities
            });
        }

        // Build zones structure
        const zones = {};
        for (const [zoneName, items] of Object.entries(zoneItems)) {
            zones[zoneName] = {
                config: {},
                items
            };
        }

        return {
            captured_at: flatState.captured_at,
            config: flatState.config || { default_delay: 100 },
            zones
        };
    }

    /**
     * Check if state is in flat format (legacy)
     * @param {object} state - State object
     * @returns {boolean} - True if flat format
     */
    _isFlatFormat(state) {
        return state && state.values && !state.zones;
    }

    /**
     * Read current values from devices based on template
     * @param {object} template - Template with items array
     * @param {object} api - Homey API instance
     * @returns {object} - { values, errors }
     */
    async _readCurrentValues(template, api) {
        const values = {};
        const errors = [];

        for (const item of template.items || []) {
            try {
                const apiDevice = await api.devices.getDevice({ id: item.device_id });
                values[item.device_id] = {};

                for (const capId of item.capabilities || []) {
                    if (apiDevice.capabilitiesObj && apiDevice.capabilitiesObj[capId]) {
                        const value = apiDevice.capabilitiesObj[capId].value;
                        if (value !== undefined && value !== null) {
                            values[item.device_id][capId] = value;
                        }
                    }
                }
            } catch (e) {
                errors.push({
                    device_id: item.device_id,
                    device_name: item.device_name,
                    error: e.message
                });
                this.logger.warn(`Failed to read state for device ${item.device_name}: ${e.message}`);
            }
        }

        return { values, errors };
    }

    // ==================== NAMED STATES ====================

    /**
     * Captures current device states to a named slot.
     *
     * Reads the current values of all capabilities defined in the template
     * from their respective devices, converts to hierarchical format, and
     * stores with the given name.
     *
     * @param {string} deviceId - State Capture Device ID (for namespacing)
     * @param {string} stateName - Name for this state (e.g., "morning", "evening")
     * @param {object} template - Template defining devices and capabilities to capture
     * @param {object} api - Homey API instance for device access
     * @returns {Promise<{success: boolean, errors: Array, state: object}>}
     * @throws {Error} If maximum named states limit reached
     *
     * Called by:
     *   - state-capture-device/device.js - Via flow action card
     *   - Flow action "capture_state"
     *
     * Calls:
     *   - CapturedStateManager._getDeviceData() - Load existing data
     *   - CapturedStateManager._readCurrentValues() - Read device values
     *   - CapturedStateManager._convertFlatToHierarchical() - Format conversion
     *   - CapturedStateManager._saveDeviceData() - Persist data
     */
    async captureState(deviceId, stateName, template, api) {
        const data = this._getDeviceData(deviceId);

        // Check limit (only if this is a NEW state)
        if (Object.keys(data.named).length >= this.MAX_NAMED_STATES && !data.named[stateName]) {
            throw new Error(`Maximum ${this.MAX_NAMED_STATES} named states per device reached`);
        }

        // Read current values (flat format)
        const { values, errors } = await this._readCurrentValues(template, api);

        // Convert to hierarchical format for storage
        const flatState = {
            captured_at: new Date().toISOString(),
            values
        };
        const hierarchicalState = this._convertFlatToHierarchical(flatState, template);

        // Store state in hierarchical format
        data.named[stateName] = hierarchicalState;

        this._saveDeviceData(deviceId, data);

        this.logger.info(`✅ Captured state "${stateName}" for device ${deviceId}`);

        return {
            success: true,
            errors,
            state: data.named[stateName]
        };
    }

    /**
     * Get a specific captured state
     * @param {string} deviceId - State capture device ID
     * @param {string} stateName - Name of the state to retrieve
     * @param {object} template - Optional template for legacy format conversion
     * @returns {object|null} - State in hierarchical format, or null if not found
     */
    getState(deviceId, stateName, template = null) {
        const data = this._getDeviceData(deviceId);
        const state = data.named[stateName];

        if (!state) {
            return null;
        }

        // Convert legacy flat format to hierarchical if needed
        if (this._isFlatFormat(state) && template) {
            return this._convertFlatToHierarchical(state, template);
        }

        return state;
    }

    /**
     * Check if a named state exists
     */
    stateExists(deviceId, stateName) {
        const data = this._getDeviceData(deviceId);
        return !!data.named[stateName];
    }

    /**
     * Delete a named state
     */
    deleteState(deviceId, stateName) {
        const data = this._getDeviceData(deviceId);
        if (!data.named[stateName]) {
            return false;
        }
        delete data.named[stateName];
        this._saveDeviceData(deviceId, data);
        this.logger.info(`🗑️  Deleted state "${stateName}" for device ${deviceId}`);
        return true;
    }

    /**
     * Set a named state from JSON data (with validation)
     * Supports both flat format (legacy) and hierarchical format (state-editor compatible)
     * @param {string} deviceId - State capture device ID
     * @param {string} stateName - Name for this state
     * @param {object} stateData - State data object (flat or hierarchical)
     * @returns {object} - { success: true }
     * @throws {Error} - If validation fails
     */
    setStateFromJson(deviceId, stateName, stateData) {
        // Validate stateData is an object
        if (!stateData || typeof stateData !== 'object') {
            throw new Error('Invalid state data: expected object');
        }

        // Detect format and validate accordingly
        const isHierarchical = stateData.zones && typeof stateData.zones === 'object';
        const isFlat = stateData.values && typeof stateData.values === 'object';

        if (!isHierarchical && !isFlat) {
            throw new Error('Missing "zones" or "values" property');
        }

        if (isHierarchical) {
            // Validate hierarchical format (zones structure)
            this._validateHierarchicalState(stateData);
        } else {
            // Validate flat format (legacy)
            this._validateFlatState(stateData);
        }

        const data = this._getDeviceData(deviceId);

        // Check limit (only if this is a NEW state)
        if (Object.keys(data.named).length >= this.MAX_NAMED_STATES && !data.named[stateName]) {
            throw new Error(`Maximum ${this.MAX_NAMED_STATES} named states per device reached`);
        }

        // Store state (hierarchical stored as-is, flat stored as-is for backward compat)
        data.named[stateName] = {
            ...stateData,
            captured_at: stateData.captured_at || new Date().toISOString()
        };

        this._saveDeviceData(deviceId, data);

        this.logger.info(`✅ Set state "${stateName}" from JSON for device ${deviceId}`);

        return { success: true };
    }

    /**
     * Validate flat state format
     */
    _validateFlatState(stateData) {
        for (const [deviceIdKey, deviceValues] of Object.entries(stateData.values)) {
            if (!deviceValues || typeof deviceValues !== 'object' || Array.isArray(deviceValues)) {
                throw new Error(`Invalid values for device "${deviceIdKey}": expected object`);
            }

            for (const [capId, value] of Object.entries(deviceValues)) {
                const valueType = typeof value;
                if (valueType !== 'boolean' && valueType !== 'number' && valueType !== 'string' && value !== null) {
                    throw new Error(`Invalid value for "${capId}": expected boolean, number, string, or null`);
                }
            }
        }
    }

    /**
     * Validate hierarchical state format (state-editor compatible)
     */
    _validateHierarchicalState(stateData) {
        for (const [zoneName, zoneData] of Object.entries(stateData.zones)) {
            if (!zoneData || typeof zoneData !== 'object') {
                throw new Error(`Invalid zone "${zoneName}": expected object`);
            }

            const items = zoneData.items || [];
            if (!Array.isArray(items)) {
                throw new Error(`Invalid items in zone "${zoneName}": expected array`);
            }

            for (const item of items) {
                if (!item.id) {
                    throw new Error(`Item in zone "${zoneName}" missing "id" property`);
                }

                if (!item.capabilities || !Array.isArray(item.capabilities)) {
                    throw new Error(`Item "${item.name || item.id}" missing or invalid "capabilities" array`);
                }

                for (const cap of item.capabilities) {
                    if (!cap.capability) {
                        throw new Error(`Capability in item "${item.name || item.id}" missing "capability" property`);
                    }
                    if (cap.value === undefined) {
                        throw new Error(`Capability "${cap.capability}" in item "${item.name || item.id}" missing "value"`);
                    }
                }
            }
        }
    }

    /**
     * List all named state names for a device
     */
    listStateNames(deviceId) {
        const data = this._getDeviceData(deviceId);
        return Object.keys(data.named).map(name => ({
            name,
            captured_at: data.named[name].captured_at
        }));
    }

    // ==================== STACK OPERATIONS ====================

    /**
     * Push current state onto the stack (saves in hierarchical format)
     * @param {string} deviceId - State capture device ID
     * @param {object} template - Template defining what to capture
     * @param {object} api - Homey API instance
     * @returns {object} - { success, errors, depth }
     */
    async pushState(deviceId, template, api) {
        const data = this._getDeviceData(deviceId);

        // Check stack depth
        if (data.stack.length >= this.MAX_STACK_DEPTH) {
            throw new Error(`Maximum stack depth (${this.MAX_STACK_DEPTH}) reached`);
        }

        // Read current values (flat format)
        const { values, errors } = await this._readCurrentValues(template, api);

        // Convert to hierarchical format
        const flatState = {
            pushed_at: new Date().toISOString(),
            values
        };
        const hierarchicalState = this._convertFlatToHierarchical(flatState, template);
        hierarchicalState.pushed_at = flatState.pushed_at; // Keep pushed_at for stack

        // Push to front of array (top of stack)
        data.stack.unshift(hierarchicalState);

        this._saveDeviceData(deviceId, data);

        this.logger.info(`📥 Pushed state onto stack for device ${deviceId} (depth: ${data.stack.length})`);

        return {
            success: true,
            errors,
            depth: data.stack.length
        };
    }

    /**
     * Pop state from stack (removes and returns top)
     * @param {string} deviceId - State capture device ID
     * @param {object} template - Optional template for legacy format conversion
     * @returns {object|null} - The popped state or null if empty
     */
    popState(deviceId, template = null) {
        const data = this._getDeviceData(deviceId);

        if (data.stack.length === 0) {
            return null;
        }

        // Remove from front (top of stack)
        let state = data.stack.shift();
        this._saveDeviceData(deviceId, data);

        // Convert legacy flat format to hierarchical if needed
        if (this._isFlatFormat(state) && template) {
            state = this._convertFlatToHierarchical(state, template);
        }

        this.logger.info(`📤 Popped state from stack for device ${deviceId} (remaining: ${data.stack.length})`);

        return state;
    }

    /**
     * Peek at top of stack (returns without removing)
     * @param {string} deviceId - State capture device ID
     * @param {object} template - Optional template for legacy format conversion
     * @returns {object|null} - The top state or null if empty
     */
    peekState(deviceId, template = null) {
        const data = this._getDeviceData(deviceId);

        if (data.stack.length === 0) {
            return null;
        }

        let state = data.stack[0];

        // Convert legacy flat format to hierarchical if needed
        if (this._isFlatFormat(state) && template) {
            return this._convertFlatToHierarchical(state, template);
        }

        return state;
    }

    /**
     * Clear the entire stack
     * @param {string} deviceId - State capture device ID
     * @returns {number} - Number of items cleared
     */
    clearStack(deviceId) {
        const data = this._getDeviceData(deviceId);
        const count = data.stack.length;
        data.stack = [];
        this._saveDeviceData(deviceId, data);
        this.logger.info(`🧹 Cleared stack for device ${deviceId} (${count} items)`);
        return count;
    }

    /**
     * Get current stack depth
     */
    getStackDepth(deviceId) {
        const data = this._getDeviceData(deviceId);
        return data.stack.length;
    }

    /**
     * Check if stack is empty
     */
    isStackEmpty(deviceId) {
        const data = this._getDeviceData(deviceId);
        return data.stack.length === 0;
    }

    // ==================== EXPORT/IMPORT ====================

    /**
     * Export all named states as JSON object
     * @param {string} deviceId - State capture device ID
     * @returns {object} - { states: { name: { captured_at, values }, ... } }
     */
    exportNamedStates(deviceId) {
        const data = this._getDeviceData(deviceId);
        this.logger.info(`📤 Exported ${Object.keys(data.named).length} named states for device ${deviceId}`);
        return {
            states: data.named
        };
    }

    /**
     * Import named states from JSON, overwriting existing states with same name
     * @param {string} deviceId - State capture device ID
     * @param {object} statesData - Object with states property containing named states
     * @returns {object} - { imported, overwritten, errors }
     */
    importNamedStates(deviceId, statesData) {
        if (!statesData || typeof statesData !== 'object') {
            throw new Error('Invalid import data: expected object');
        }

        const states = statesData.states;
        if (!states || typeof states !== 'object') {
            throw new Error('Invalid import data: missing or invalid "states" property');
        }

        const data = this._getDeviceData(deviceId);
        let imported = 0;
        let overwritten = 0;
        const errors = [];

        for (const [stateName, stateData] of Object.entries(states)) {
            try {
                // Validate state structure
                if (!stateData || typeof stateData !== 'object') {
                    errors.push({ name: stateName, error: 'Invalid state data' });
                    continue;
                }

                if (!stateData.values || typeof stateData.values !== 'object') {
                    errors.push({ name: stateName, error: 'Missing or invalid values' });
                    continue;
                }

                // Check if we're overwriting
                if (data.named[stateName]) {
                    overwritten++;
                }

                // Import the state
                data.named[stateName] = {
                    captured_at: stateData.captured_at || new Date().toISOString(),
                    values: stateData.values
                };
                imported++;

            } catch (e) {
                errors.push({ name: stateName, error: e.message });
            }
        }

        // Check total count after import
        if (Object.keys(data.named).length > this.MAX_NAMED_STATES) {
            throw new Error(`Import would exceed maximum ${this.MAX_NAMED_STATES} named states`);
        }

        this._saveDeviceData(deviceId, data);

        this.logger.info(`📥 Imported ${imported} states (${overwritten} overwritten) for device ${deviceId}`);

        return { imported, overwritten, errors };
    }

    // ==================== UTILITY ====================

    /**
     * Clean up all data when device is deleted
     */
    cleanupDevice(deviceId) {
        const key = this._getStorageKey(deviceId);
        this.homey.settings.unset(key);
        this.logger.info(`🧹 Cleaned up stored states for deleted device ${deviceId}`);
    }

    /**
     * Get summary of stored data for a device
     */
    getDeviceSummary(deviceId) {
        const data = this._getDeviceData(deviceId);
        return {
            namedStates: Object.keys(data.named).length,
            stackDepth: data.stack.length,
            maxNamedStates: this.MAX_NAMED_STATES,
            maxStackDepth: this.MAX_STACK_DEPTH
        };
    }
}

// Singleton instance
CapturedStateManager.instance = null;

module.exports = CapturedStateManager;
