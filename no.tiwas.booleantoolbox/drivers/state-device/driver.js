'use strict';

const Homey = require('homey');

class StateDriver extends Homey.Driver {

    async onInit() {
        this.debug('StateDriver has been initialized');
        this.registerFlowCards();
    }

    debug(...args) {
        if (this.homey.settings.get('debug_mode')) {
            this.log('[DEBUG]', ...args);
        }
    }

    registerFlowCards() {
        this.homey.flow.getActionCard('apply_state_sd')
            .registerRunListener(async (args, state) => {
                return args.device.onFlowActionApplyState(args);
            });
    }

    async onPair(session) {
        this.debug('StateDriver pairing started');

        let generatedConfig = null;
        let candidateItems = []; // Intermediate storage

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
                const allZones = await api.zones.getZones(); // Get zones for name resolution
                
                // Create a map of zones for easier parent lookup
                const zoneMap = {};
                Object.values(allZones).forEach(zone => {
                    zoneMap[zone.id] = zone;
                });

                const selectedZones = new Set(data.zones || []);
                const wholeHouse = data.wholeHouse === true;

                // Helper to check if a zone or its parents are selected
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

                    // Filter by Zone (Recursive check)
                    if (!isZoneSelected(device.zone)) {
                        continue;
                    }
                    
                    // Skip our own State Devices to avoid recursion loops. Homey
                    // API devices expose driverId; the deprecated driverUri
                    // getter only warns and returns undefined.
                    if (String(device.driverId || '').includes('state-device')) {
                        continue;
                    }

                    // Analyze Capabilities
                    const deviceCapabilities = {};
                    let hasSetableCapabilities = false;

                    if (device.capabilitiesObj) {
                        for (const capId in device.capabilitiesObj) {
                            const capDef = device.capabilitiesObj[capId];
                            
                            // Only include SETABLE capabilities
                            if (capDef.setable) {
                                // Some capabilities might have null value if never set
                                if (capDef.value !== undefined && capDef.value !== null) {
                                    deviceCapabilities[capId] = capDef.value;
                                    hasSetableCapabilities = true;
                                }
                            }
                        }
                    }

                    // Add to list if it has useful capabilities
                    if (hasSetableCapabilities) {
                        const zoneName = allZones[device.zone] ? allZones[device.zone].name : 'Unknown';
                        candidateItems.push({
                            name: device.name,
                            id: device.id,
                            zoneName: zoneName,
                            capabilities: deviceCapabilities
                        });
                    }
                }

                // Sort by name for readability
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
                // Return simplified objects for UI
                const mapped = candidateItems.map(item => ({
                    id: item.id,
                    name: item.name,
                    zoneName: item.zoneName
                }));
                this.debug('Returning mapped items:', mapped.length);
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
            // Return the devices with their capabilities for the UI to render
            // We enrich the capabilities with titles if possible, but we only have values stored
            // The UI will have to do with IDs and values
            return this.currentSelection || [];
        });

        // Handler: Save Final Configuration (Step 3 -> 4)
        session.setHandler('save_final_configuration', async (data) => {
            const orderedDevices = data.devices || []; // Expecting [ { id, name, zoneName, capabilities: [{id, value}] } ]
            
            // Build Hierarchical JSON
            const zonesMap = {};

            orderedDevices.forEach(device => {
                const zoneName = device.zoneName || 'Unknown';
                if (!zonesMap[zoneName]) {
                    zonesMap[zoneName] = {
                        config: {
                            delay_between: 0 // Default, can be overridden by user in JSON
                        },
                        items: []
                    };
                }
                
                // Convert capabilities array back to object for cleaner JSON (or keep as array for order?)
                // User asked for "change order of capabilities".
                // Standard JSON objects are unordered. We MUST use an array for ordered capabilities.
                // Let's use an array of objects: [ { "capability": "onoff", "value": true }, ... ]
                const capabilitiesArr = device.capabilities.map(cap => ({
                    capability: cap.id,
                    value: cap.value
                }));

                zonesMap[zoneName].items.push({
                    id: device.id,
                    name: device.name,
                    active: true, // Default active
                    capabilities: capabilitiesArr
                });
            });

            generatedConfig = {
                _meta: {
                    editor: "https://tiwas.github.io/SmartComponentsToolkit/tools/state-editor.html",
                    documentation: "https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html"
                },
                config: {
                    default_delay: 1000,
                    ignore_errors: true,
                    debug: false
                },
                zones: zonesMap
            };

            this.debug('Final configuration generated.');
            return { success: true };
        });

        // Handler: Get Generated JSON (for the edit view)
        session.setHandler('get_generated_json', async () => {
            return generatedConfig || { config: {}, items: [] };
        });

        // Handler: Create Device
        session.setHandler('create_device', async (data) => {
            const name = data.name;
            const jsonData = data.json_data; // String

            this.debug('Creating device:', name);

            return {
                name: name,
                data: {
                    id: `state-device-${Date.now()}`
                },
                settings: {
                    json_data: jsonData,
                    log_errors: true
                }
            };
        });
    }

}

module.exports = StateDriver;