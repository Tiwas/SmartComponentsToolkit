'use strict';

const Homey = require('homey');

class StateCaptureDriver extends Homey.Driver {

    async onInit() {
        this.debug('StateCaptureDriver has been initialized');
        this.registerFlowCards();
    }

    debug(...args) {
        if (this.homey.settings.get('debug_mode')) {
            this.log('[DEBUG]', ...args);
        }
    }

    registerFlowCards() {
        // === NAMED STATE ACTIONS ===

        // Action: Capture state
        this.homey.flow.getActionCard('capture_state_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowCaptureState(args);
            });

        // Action: Apply captured state
        const applyCard = this.homey.flow.getActionCard('apply_captured_state_scd');
        applyCard.registerRunListener(async (args, state) => {
            return args.device.onFlowApplyState(args);
        });
        applyCard.registerArgumentAutocompleteListener('state_name', async (query, args) => {
            if (!args.device) return [];
            return args.device.getStateNamesForAutocomplete(query);
        });

        // Action: Delete captured state
        const deleteCard = this.homey.flow.getActionCard('delete_captured_state_scd');
        deleteCard.registerRunListener(async (args, state) => {
            return args.device.onFlowDeleteState(args);
        });
        deleteCard.registerArgumentAutocompleteListener('state_name', async (query, args) => {
            if (!args.device) return [];
            return args.device.getStateNamesForAutocomplete(query);
        });

        // === STACK ACTIONS ===

        // Action: Push state
        this.homey.flow.getActionCard('push_state_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowPushState(args);
            });

        // Action: Pop state
        this.homey.flow.getActionCard('pop_state_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowPopState(args);
            });

        // Action: Peek and apply state
        this.homey.flow.getActionCard('peek_apply_state_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowPeekApplyState(args);
            });

        // Action: Clear stack
        this.homey.flow.getActionCard('clear_stack_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowClearStack(args);
            });

        // === EXPORT/IMPORT ACTIONS ===

        // Action: Export named states
        this.homey.flow.getActionCard('export_named_states_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowExportStates(args);
            });

        // Action: Import named states
        this.homey.flow.getActionCard('import_named_states_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowImportStates(args);
            });

        // === GET/SET STATE JSON ===

        // Action: Get state as JSON
        const getStateJsonCard = this.homey.flow.getActionCard('get_state_json_scd');
        getStateJsonCard.registerRunListener(async (args, state) => {
            return args.device.onFlowGetStateJson(args);
        });
        getStateJsonCard.registerArgumentAutocompleteListener('state_name', async (query, args) => {
            if (!args.device) return [];
            return args.device.getStateNamesForAutocomplete(query);
        });

        // Action: Set state from JSON
        this.homey.flow.getActionCard('set_state_json_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowSetStateJson(args);
            });

        // === CONDITIONS ===

        // Condition: State exists
        this.homey.flow.getConditionCard('captured_state_exists_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowConditionStateExists(args);
            });

        // Condition: Stack is empty
        this.homey.flow.getConditionCard('stack_is_empty_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowConditionStackEmpty(args);
            });

        // Condition: Stack depth is
        this.homey.flow.getConditionCard('stack_depth_is_scd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowConditionStackDepth(args);
            });
    }

    async onPair(session) {
        this.debug('StateCaptureDriver pairing started');

        let generatedTemplate = null;
        let candidateItems = [];

        // Handler: Get Zones
        session.setHandler('get_zones', async () => {
            try {
                if (!this.homey.app || typeof this.homey.app.getAvailableZones !== 'function') {
                    return [];
                }

                const result = await this.homey.app.getAvailableZones();

                if (!result || !Array.isArray(result)) {
                    return [];
                }

                return result;
            } catch (e) {
                this.error('Error getting zones:', e);
                throw new Error(this.homey.__('errors.connection_failed') + ': ' + e.message);
            }
        });

        // Handler: Generate Snapshot Candidates
        session.setHandler('generate_snapshot', async (data) => {
            this.debug('Generating snapshot candidates...', data);

            try {
                const api = this.homey.app.api;
                if (!api) {
                    throw new Error('Homey API not ready. Please try again in a few seconds.');
                }

                const allDevices = await api.devices.getDevices();
                const allZones = await api.zones.getZones();

                const zoneMap = {};
                Object.values(allZones).forEach(zone => {
                    zoneMap[zone.id] = zone;
                });

                const selectedZones = new Set(data.zones || []);
                const wholeHouse = data.wholeHouse === true;

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

                candidateItems = [];

                for (const deviceId in allDevices) {
                    const device = allDevices[deviceId];

                    if (!isZoneSelected(device.zone)) {
                        continue;
                    }

                    // Skip state devices to avoid recursion. Homey API devices
                    // expose driverId ("homey:app:<appId>:<driver>"); the
                    // deprecated driverUri getter only warns and returns undefined.
                    const driverRef = String(device.driverId || '');
                    if (driverRef.includes('state-device') || driverRef.includes('state-capture-device')) {
                        continue;
                    }

                    const setableCapabilities = [];

                    if (device.capabilitiesObj) {
                        for (const capId in device.capabilitiesObj) {
                            const capDef = device.capabilitiesObj[capId];

                            if (capDef.setable) {
                                setableCapabilities.push(capId);
                            }
                        }
                    }

                    if (setableCapabilities.length > 0) {
                        const zoneName = allZones[device.zone] ? allZones[device.zone].name : 'Unknown';
                        candidateItems.push({
                            name: device.name,
                            id: device.id,
                            zoneName: zoneName,
                            capabilities: setableCapabilities
                        });
                    }
                }

                candidateItems.sort((a, b) => a.name.localeCompare(b.name));

                this.debug(`Found ${candidateItems.length} candidate devices.`);
                return { success: true, count: candidateItems.length };

            } catch (e) {
                this.error('Error generating snapshot:', e);
                throw e;
            }
        });

        // Handler: Get Candidates for Selection View
        session.setHandler('get_snapshot_candidates', async () => {
            this.debug('get_snapshot_candidates called. Items:', candidateItems.length);
            try {
                const mapped = candidateItems.map(item => ({
                    id: item.id,
                    name: item.name,
                    zoneName: item.zoneName
                }));
                return mapped;
            } catch (e) {
                this.error('Error mapping candidates:', e);
                throw e;
            }
        });

        // Handler: Save Device Selection (Step 2)
        session.setHandler('save_device_selection', async (data) => {
            const selectedIds = new Set(data.selectedIds || []);
            this.currentSelection = candidateItems.filter(item => selectedIds.has(item.id));
            this.debug(`Saved device selection: ${this.currentSelection.length} devices.`);
            return { success: true };
        });

        // Handler: Get Detailed Selection for Capabilities View (Step 3)
        session.setHandler('get_selected_devices_detailed', async () => {
            // Return devices with capabilities as array (for template - no values)
            return (this.currentSelection || []).map(item => ({
                id: item.id,
                name: item.name,
                zoneName: item.zoneName,
                capabilities: item.capabilities.map(capId => ({
                    id: capId,
                    selected: true
                }))
            }));
        });

        // Handler: Save Final Configuration (Step 3 -> 4)
        session.setHandler('save_final_configuration', async (data) => {
            const devices = data.devices || [];

            // Build template (no values, just structure)
            generatedTemplate = {
                items: devices.map(device => ({
                    device_id: device.id,
                    device_name: device.name,
                    capabilities: device.capabilities
                        .filter(cap => cap.selected !== false)
                        .map(cap => cap.id)
                }))
            };

            this.debug('Final template generated:', generatedTemplate);
            return { success: true };
        });

        // Handler: Get Generated JSON (for the edit view)
        session.setHandler('get_generated_json', async () => {
            return generatedTemplate || { items: [] };
        });

        // Handler: Create Device
        session.setHandler('create_device', async (data) => {
            const name = data.name;
            const templateJson = data.json_data;

            this.debug('Creating device:', name);

            return {
                name: name,
                data: {
                    id: `state-capture-device-${Date.now()}`
                },
                settings: {
                    template_json: templateJson,
                    log_errors: true
                }
            };
        });
    }

}

module.exports = StateCaptureDriver;
