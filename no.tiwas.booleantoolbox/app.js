"use strict";

const Homey = require("homey");
const os = require("node:os");
const Logger = require("./lib/Logger");
const WaiterManager = require("./lib/WaiterManager");
const CapturedStateManager = require("./lib/CapturedStateManager");
const {
    buildDiagnosticsReport,
    buildGitHubIssueUrl,
    redactDiagnosticText,
    sanitizeEvent,
} = require("./lib/DiagnosticsReport");
const {
    compareNumbers,
    evaluateNumericComparison,
    mapGradient,
} = require("./lib/NumericComparison");

const DEVICE_REGISTRY_KEY = "device_registry";
const DEVICE_REGISTRY_REFRESH_REQUEST_KEY = "device_registry_refresh_requested_at";
const DEVICE_REGISTRY_PURGE_REQUEST_KEY = "device_registry_purge_requested_at";
const DEVICE_REGISTRY_RETENTION_MONTHS_KEY = "device_registry_retention_months";
const DEVICE_REGISTRY_DEFAULT_RETENTION_MONTHS = 12;
const DEVICE_REGISTRY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HOMEY_API_MANAGER_MAX_LISTENERS = 50;
const API_DEVICES_CACHE_TTL_MS = 1000;
const DIAGNOSTIC_EVENTS_KEY = "diagnostic_events";
const DIAGNOSTIC_EVENTS_LIMIT = 40;
const DIAGNOSTIC_PERSIST_DELAY_MS = 2000;

function isFiniteDiagnosticMetric(value) {
    return value !== null
        && value !== undefined
        && value !== ""
        && Number.isFinite(Number(value));
}

/**
 * Helper function for evaluate_expression action card.
 *
 * Compares an input value against a rule value using the specified operator.
 *
 * @param {number} inputValue - The value to compare
 * @param {string} operator - Comparison operator (gt, gte, lt, lte)
 * @param {number} ruleValue - The value to compare against
 * @returns {boolean} Result of comparison
 *
 * Called by:
 *   - evaluate_expression flow action card
 *
 * Calls:
 *   - (none)
 */
function evaluateCondition(inputValue, operator, ruleValue) {
    return compareNumbers(inputValue, operator, ruleValue);
}

/**
 * Evaluates the rule string used by the app-level evaluate_expression Flow
 * action. Each rule has the form "min,max,output" and the first matching
 * rule supplies the output token.
 *
 * @param {Object} args Flow card arguments
 * @param {string} outsideLogicMessage Localized message for no matching rule
 * @returns {{outputValue: number, errorMessage: string}} Flow token values
 */
function evaluateExpression(args, outsideLogicMessage) {
    const input = Number(args.input);
    if (!Number.isFinite(input)) {
        throw new Error("Input value must be a valid number.");
    }

    const logicalOperator = String(args.logical_op?.id || args.logical_op || "").toUpperCase();
    if (logicalOperator !== "AND" && logicalOperator !== "OR") {
        throw new Error("Logical operator must be AND or OR.");
    }

    const rules = String(args.rules || "").trim();
    if (!rules) {
        throw new Error("Rule string cannot be empty.");
    }

    const ruleSets = rules
        .split(";")
        .map((rule) => rule.trim())
        .filter(Boolean);

    const parsedRules = ruleSets.map((ruleSet) => {
        const parts = ruleSet.split(",").map((part) => part.trim());
        if (parts.length !== 3 || parts.some((part) => !part)) {
            throw new Error(
                `Invalid rule '${ruleSet}'. Expected 'min,max,output'.`,
            );
        }

        const [min, max, outputValue] = parts.map(Number);
        if (![min, max, outputValue].every(Number.isFinite)) {
            throw new Error(`Invalid numeric value in rule '${ruleSet}'.`);
        }

        return { min, max, outputValue };
    });

    for (const { min, max, outputValue } of parsedRules) {
        const lowerMatch = evaluateCondition(input, args.op1, min);
        const upperMatch = evaluateCondition(input, args.op2, max);
        const matches = logicalOperator === "AND"
            ? lowerMatch && upperMatch
            : lowerMatch || upperMatch;

        if (matches) {
            return { outputValue, errorMessage: "" };
        }
    }

    return {
        outputValue: 0,
        errorMessage: outsideLogicMessage,
    };
}

/**
 * BooleanToolboxApp - Main application class for Boolean Toolbox
 *
 * The central coordinator for the Boolean Toolbox Homey app. Manages:
 * - Application initialization and shutdown
 * - Global flow card registration (app-level triggers, conditions, actions)
 * - WaiterManager singleton for async flow gates
 * - CapturedStateManager singleton for device state capture
 * - Homey API connection for device/zone queries
 *
 * Called by:
 *   - Homey runtime - Application lifecycle
 *   - Flow cards - Via registered handlers
 *
 * Calls:
 *   - Logger - For logging operations
 *   - WaiterManager - For async flow management
 *   - CapturedStateManager - For state capture/restore
 *   - Homey SDK - Flow card registration, settings, etc.
 *
 * @class BooleanToolboxApp
 * @extends Homey.App
 */
module.exports = class BooleanToolboxApp extends Homey.App {
    /**
     * Initializes the application when Homey starts.
     *
     * Performs:
     * 1. Logger initialization with app version banner
     * 2. Debug mode setting from user preferences
     * 3. Homey API connection for device queries
     * 4. WaiterManager and CapturedStateManager initialization
     * 5. Global flow card registration
     *
     * Called by:
     *   - Homey runtime - On app start
     *
     * Calls:
     *   - Logger constructor and banner()
     *   - WaiterManager constructor
     *   - CapturedStateManager constructor
     *   - BooleanToolboxApp.registerAllFlowCards()
     */
    async onInit() {
        this.startedAt = new Date();
        this.diagnosticEvents = this.loadDiagnosticEvents();
        this.diagnosticPersistTimer = null;
        this.logger = new Logger(this, "App");
        try {
            const version = this.getAppVersion();
            this.logger.banner(`BOOLEAN TOOLBOX v${version}`);
        } catch (e) {
            this.logger.error(
                "Failed to load package.json or display banner",
                e,
            );
            this.logger.banner(`BOOLEAN TOOLBOX vUNKNOWN`); // Fallback banner
        }

        // --- DEBUG SETTING ---
        // Respect user's debug_mode setting from app settings
        const debugMode = this.homey.settings.get('debug_mode') === true;
        this.logger.setLevel(debugMode ? 'DEBUG' : 'INFO');

        this.homey.settings.on('set', (key, value) => {
            if (key === 'debug_mode') {
                const level = value ? 'DEBUG' : 'INFO';
                this.logger.setLevel(level);
                this.logger.info(`Log level updated to ${level}`);
            } else if (key === DEVICE_REGISTRY_REFRESH_REQUEST_KEY) {
                this.refreshDeviceRegistry("manual").catch((error) => {
                    this.logger.error("Device registry refresh failed", error);
                });
            } else if (key === DEVICE_REGISTRY_PURGE_REQUEST_KEY) {
                this.purgeAndRebuildDeviceRegistry().catch((error) => {
                    this.logger.error("Device registry purge failed", error);
                });
            } else if (key === DEVICE_REGISTRY_RETENTION_MONTHS_KEY) {
                this.refreshDeviceRegistry("retention_changed").catch((error) => {
                    this.logger.error("Device registry retention refresh failed", error);
                });
            }
        });

        // Initialize API
        try {
            this.logger.debug("app.initializing_homey_api");
            this.api = this.configureHomeyApi(await this.createHomeyApi());
        } catch (e) {
            this.logger.error("errors.connection_failed", {
                message: e.message,
            });

            this.logger.debug("app.error_stack", {
                stack: e.stack,
            });
        }

        if (this.homey.settings.get(DEVICE_REGISTRY_RETENTION_MONTHS_KEY) === undefined) {
            this.homey.settings.set(
                DEVICE_REGISTRY_RETENTION_MONTHS_KEY,
                DEVICE_REGISTRY_DEFAULT_RETENTION_MONTHS,
            );
        }

        // Initialize WaiterManager
        this.waiterManager = new WaiterManager(this.homey, this.logger);

        // Initialize CapturedStateManager
        this.capturedStateManager = new CapturedStateManager(this.homey, this.logger);

        // Register ALL Flow Cards here using generic methods
        await this.registerAllFlowCards();

        await this.refreshDeviceRegistry("startup").catch((error) => {
            this.logger.error("Device registry startup refresh failed", error);
        });

        this.deviceRegistryInterval = setInterval(() => {
            this.refreshDeviceRegistry("scheduled").catch((error) => {
                this.logger.error("Device registry scheduled refresh failed", error);
            });
        }, DEVICE_REGISTRY_REFRESH_INTERVAL_MS);

        this.logger.info("App initialization complete.", {});
    }

    async onUninit() {
        if (this.deviceRegistryInterval) {
            clearInterval(this.deviceRegistryInterval);
            this.deviceRegistryInterval = null;
        }

        // Cleanup WaiterManager
        if (this.waiterManager) {
            this.waiterManager.destroy();
        }
        await this.persistDiagnosticEvents();
        this.logger.info("App uninitialized.", {});
    }

    getAppVersion() {
        return this.homey?.manifest?.version
            || Homey.manifest?.version
            || require("./package.json").version
            || "unknown";
    }

    loadDiagnosticEvents() {
        let storedEvents;
        try {
            storedEvents = this.homey.settings.get(DIAGNOSTIC_EVENTS_KEY);
        } catch (error) {
            return [];
        }
        if (!Array.isArray(storedEvents)) return [];

        return storedEvents
            .map(sanitizeEvent)
            .filter(Boolean)
            .slice(-DIAGNOSTIC_EVENTS_LIMIT);
    }

    recordDiagnosticEvent(event) {
        const sanitized = sanitizeEvent({
            ...event,
            timestamp: event?.timestamp || new Date().toISOString(),
        });
        if (!sanitized) return;

        this.diagnosticEvents = Array.isArray(this.diagnosticEvents)
            ? this.diagnosticEvents
            : [];
        this.diagnosticEvents.push(sanitized);
        this.diagnosticEvents = this.diagnosticEvents.slice(-DIAGNOSTIC_EVENTS_LIMIT);

        if (this.diagnosticPersistTimer) return;
        this.diagnosticPersistTimer = setTimeout(() => {
            this.diagnosticPersistTimer = null;
            this.persistDiagnosticEvents().catch((error) => {
                console.error("Failed to persist diagnostic events", error);
            });
        }, DIAGNOSTIC_PERSIST_DELAY_MS);
    }

    async persistDiagnosticEvents() {
        if (this.diagnosticPersistTimer) {
            clearTimeout(this.diagnosticPersistTimer);
            this.diagnosticPersistTimer = null;
        }
        await this.homey.settings.set(
            DIAGNOSTIC_EVENTS_KEY,
            (this.diagnosticEvents || []).slice(-DIAGNOSTIC_EVENTS_LIMIT),
        );
    }

    collectDeviceDiagnostics() {
        const summary = {
            total: 0,
            configAlarms: 0,
            drivers: [],
        };
        const clgGroups = [];
        const collectionErrors = [];

        let driverEntries = [];
        try {
            driverEntries = Object.entries(this.homey.drivers.getDrivers() || {});
        } catch (error) {
            collectionErrors.push(`Could not enumerate app drivers: ${error.message}`);
        }

        for (const [driverKey, driver] of driverEntries) {
            const driverId = String(driver?.id || driverKey || "unknown");
            let devices = [];
            try {
                const driverDevices = driver.getDevices();
                devices = Array.isArray(driverDevices) ? driverDevices : [];
            } catch (error) {
                collectionErrors.push(`Could not inspect driver ${redactDiagnosticText(driverId)}: ${error.message}`);
            }

            summary.total += devices.length;
            summary.drivers.push({ id: driverId, count: devices.length });

            for (const device of devices) {
                try {
                    if (device.hasCapability?.("alarm_config") && device.getCapabilityValue("alarm_config") === true) {
                        summary.configAlarms += 1;
                    }
                } catch (error) {
                    collectionErrors.push(`Could not read a configuration alarm for driver ${redactDiagnosticText(driverId)}.`);
                }

                if (driverId !== "circadian-light-group") continue;

                let config = {};
                try {
                    config = JSON.parse(device.getSetting("config_json") || "{}");
                } catch (error) {
                    collectionErrors.push("A Circadian Light Group has invalid configuration JSON.");
                }
                const members = Array.isArray(config.devices) ? config.devices : [];
                const profile = config.profile || {};
                let paused = false;
                try {
                    paused = device.getCapabilityValue("clg_paused") === true;
                } catch (error) {}

                clgGroups.push({
                    totalMembers: members.length,
                    enabledMembers: members.filter((member) => member.enabled !== false).length,
                    updateIntervalSeconds: Math.max(30, Number(profile.updateIntervalSeconds) || 120),
                    transitionSeconds: Math.max(0, Number(profile.transitionSeconds) || 0),
                    watchers: Number(device.memberOnoffWatchers?.size) || 0,
                    paused,
                });
            }
        }

        summary.drivers.sort((a, b) => a.id.localeCompare(b.id));
        return { summary, clgGroups, collectionErrors };
    }

    async collectResourceDiagnostics() {
        const systemResources = {
            cpuCores: os.cpus().length || null,
            loadAverage: os.loadavg(),
            memoryTotal: os.totalmem(),
            memoryFree: os.freemem(),
            storageTotal: null,
            storageFree: null,
            appCpu: null,
            appMemory: null,
            appState: null,
            crashedCount: null,
            crashedMessage: null,
        };

        let api;
        try {
            api = await this.ensureHomeyApi();
        } catch (error) {
            return systemResources;
        }

        const calls = [
            typeof api.system?.getInfo === "function" ? api.system.getInfo() : Promise.resolve(null),
            typeof api.system?.getMemoryInfo === "function" ? api.system.getMemoryInfo() : Promise.resolve(null),
            typeof api.system?.getStorageInfo === "function" ? api.system.getStorageInfo() : Promise.resolve(null),
            typeof api.apps?.getApp === "function"
                ? api.apps.getApp({ id: "no.tiwas.booleantoolbox" })
                : Promise.resolve(null),
        ];
        const [infoResult, memoryResult, storageResult, appResult] = await Promise.allSettled(calls);

        if (infoResult.status === "fulfilled" && infoResult.value) {
            const info = infoResult.value;
            if (Array.isArray(info.loadavg)) systemResources.loadAverage = info.loadavg;
            if (isFiniteDiagnosticMetric(info.totalmem)) systemResources.memoryTotal = Number(info.totalmem);
            if (isFiniteDiagnosticMetric(info.freemem)) systemResources.memoryFree = Number(info.freemem);
        }

        if (memoryResult.status === "fulfilled" && memoryResult.value) {
            const memory = memoryResult.value;
            if (isFiniteDiagnosticMetric(memory.total)) {
                const used = Array.isArray(memory.types)
                    ? memory.types.reduce((total, item) => total + (Number(item?.size) || 0), 0)
                    : null;
                systemResources.memoryTotal = Number(memory.total);
                if (used !== null) systemResources.memoryFree = Math.max(0, Number(memory.total) - used);
            }
        }

        if (storageResult.status === "fulfilled" && storageResult.value) {
            const storage = storageResult.value.root || storageResult.value;
            if (isFiniteDiagnosticMetric(storage.total)) systemResources.storageTotal = Number(storage.total);
            if (isFiniteDiagnosticMetric(storage.free)) systemResources.storageFree = Number(storage.free);
        }

        if (appResult.status === "fulfilled" && appResult.value) {
            const appInfo = appResult.value;
            if (isFiniteDiagnosticMetric(appInfo.usage?.cpu)) {
                systemResources.appCpu = Number(appInfo.usage.cpu);
            }
            if (isFiniteDiagnosticMetric(appInfo.usage?.mem)) {
                systemResources.appMemory = Number(appInfo.usage.mem);
            }
            systemResources.appState = appInfo.state || null;
            systemResources.crashedCount = isFiniteDiagnosticMetric(appInfo.crashedCount)
                ? Number(appInfo.crashedCount)
                : null;
            systemResources.crashedMessage = appInfo.crashedMessage || null;
        }

        return systemResources;
    }

    async getDiagnosticsPayload(summary = "") {
        const appVersion = this.getAppVersion();
        const deviceDiagnostics = this.collectDeviceDiagnostics();
        const systemResources = await this.collectResourceDiagnostics();
        const registry = this.homey.settings.get(DEVICE_REGISTRY_KEY) || {};
        const startedAt = this.startedAt instanceof Date
            ? this.startedAt
            : new Date(this.startedAt || Date.now());
        const generatedAt = new Date();
        const report = buildDiagnosticsReport({
            appVersion,
            generatedAt: generatedAt.toISOString(),
            startedAt: startedAt.toISOString(),
            uptimeSeconds: Math.max(0, (generatedAt.getTime() - startedAt.getTime()) / 1000),
            nodeVersion: process.version,
            debugMode: this.homey.settings.get("debug_mode") === true,
            memory: process.memoryUsage(),
            systemResources,
            deviceSummary: deviceDiagnostics.summary,
            clgGroups: deviceDiagnostics.clgGroups,
            collectionErrors: deviceDiagnostics.collectionErrors,
            registry,
            events: this.diagnosticEvents,
        });

        return {
            appVersion,
            generatedAt: generatedAt.toISOString(),
            report,
            issueUrl: buildGitHubIssueUrl({ appVersion, report, summary }),
        };
    }

    async createHomeyApi() {
        const { HomeyAPI } = require("homey-api");
        if (!HomeyAPI || typeof HomeyAPI.createAppAPI !== "function") {
            throw new Error("homey-api createAppAPI is not available");
        }

        return HomeyAPI.createAppAPI({
            homey: this.homey,
        });
    }

    async ensureHomeyApi() {
        if (this.api) {
            return this.configureHomeyApi(this.api);
        }

        if (this.homeyApiPromise) {
            return this.homeyApiPromise;
        }

        this.homeyApiPromise = (async () => {
            this.api = this.configureHomeyApi(await this.createHomeyApi());
            return this.api;
        })().finally(() => {
            this.homeyApiPromise = null;
        });

        return this.homeyApiPromise;
    }

    configureHomeyApi(api) {
        if (!api || api.__sctConfigured) return api;

        [
            api.devices,
            api.zones,
            api.flow,
            api.flowAdv,
            api.apps,
        ].forEach((manager) => {
            if (!manager || typeof manager.setMaxListeners !== "function") {
                return;
            }

            if (typeof manager.getMaxListeners !== "function") {
                manager.setMaxListeners(HOMEY_API_MANAGER_MAX_LISTENERS);
                return;
            }

            const currentMax = manager.getMaxListeners();
            if (currentMax !== 0 && currentMax < HOMEY_API_MANAGER_MAX_LISTENERS) {
                manager.setMaxListeners(HOMEY_API_MANAGER_MAX_LISTENERS);
            }
        });

        Object.defineProperty(api, "__sctConfigured", {
            value: true,
            enumerable: false,
            configurable: true,
        });
        return api;
    }

    async getApiDevices(options = {}) {
        const maxAgeMs = typeof options.maxAgeMs === "number"
            ? options.maxAgeMs
            : API_DEVICES_CACHE_TTL_MS;
        const now = Date.now();

        if (
            maxAgeMs > 0 &&
            this.apiDevicesCache &&
            now - this.apiDevicesCache.createdAt <= maxAgeMs
        ) {
            return this.apiDevicesCache.devices;
        }

        if (this.apiDevicesPromise) {
            return this.apiDevicesPromise;
        }

        this.apiDevicesPromise = (async () => {
            const api = await this.ensureHomeyApi();
            const devices = await api.devices.getDevices();
            this.apiDevicesCache = {
                createdAt: Date.now(),
                devices,
            };
            return devices;
        })().finally(() => {
            this.apiDevicesPromise = null;
        });

        return this.apiDevicesPromise;
    }

    async getApiDevice(id, options = {}) {
        const deviceId = String(id || "").trim();
        if (!deviceId) return null;

        const devices = await this.getApiDevices(options);
        if (devices && devices[deviceId]) {
            return devices[deviceId];
        }

        const api = await this.ensureHomeyApi();
        return api.devices.getDevice({ id: deviceId });
    }

    getDeviceRegistryRetentionMonths() {
        const raw = this.homey.settings.get(DEVICE_REGISTRY_RETENTION_MONTHS_KEY);
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
            return DEVICE_REGISTRY_DEFAULT_RETENTION_MONTHS;
        }
        return Math.floor(value);
    }

    async refreshDeviceRegistry(reason = "manual") {
        if (this.deviceRegistryRefreshPromise) {
            return this.deviceRegistryRefreshPromise;
        }

        this.deviceRegistryRefreshPromise = this._refreshDeviceRegistry(reason)
            .finally(() => {
                this.deviceRegistryRefreshPromise = null;
            });

        return this.deviceRegistryRefreshPromise;
    }

    async _refreshDeviceRegistry(reason) {
        const api = await this.ensureHomeyApi();
        const now = new Date();
        const nowIso = now.toISOString();
        const retentionMonths = this.getDeviceRegistryRetentionMonths();
        const previous = this.homey.settings.get(DEVICE_REGISTRY_KEY) || {};
        const previousEntries = previous.entries && typeof previous.entries === "object"
            ? previous.entries
            : {};

        const entries = {};
        Object.keys(previousEntries).forEach((id) => {
            entries[id] = { ...previousEntries[id], id };
        });

        let zones = {};
        try {
            zones = await api.zones.getZones();
        } catch (error) {
            this.logger.warn("Device registry could not load zones", {
                message: error.message,
            });
        }

        const devices = await this.getApiDevices({ maxAgeMs: 0 });
        const currentIds = new Set(Object.keys(devices || {}));

        for (const [id, device] of Object.entries(devices || {})) {
            const existing = entries[id] || {};
            const zoneId = device.zone || existing.zoneId || null;
            const zoneName = zoneId && zones[zoneId] ? zones[zoneId].name : existing.zoneName || null;
            const driverUri = device.driverUri || existing.driverUri || null;

            entries[id] = {
                id,
                name: device.name || existing.name || id,
                zoneId,
                zoneName,
                class: device.class || existing.class || null,
                driverUri,
                driverId: driverUri ? String(driverUri).split(":").pop() : existing.driverId || null,
                appUri: device.ownerUri || device.appUri || existing.appUri || null,
                appName: device.ownerName || device.appName || null,
                firstSeenAt: existing.firstSeenAt || nowIso,
                lastSeenAt: nowIso,
                missingSince: null,
                present: true,
            };
        }

        Object.keys(entries).forEach((id) => {
            if (currentIds.has(id)) return;
            const entry = entries[id];
            entries[id] = {
                ...entry,
                present: false,
                missingSince: entry.missingSince || nowIso,
            };
        });

        let prunedCount = 0;
        if (retentionMonths > 0) {
            const cutoff = new Date(now.getTime());
            cutoff.setMonth(cutoff.getMonth() - retentionMonths);

            Object.keys(entries).forEach((id) => {
                const entry = entries[id];
                if (entry.present !== false) return;

                const lastSeen = entry.lastSeenAt ? new Date(entry.lastSeenAt) : null;
                if (!lastSeen || Number.isNaN(lastSeen.getTime()) || lastSeen < cutoff) {
                    delete entries[id];
                    prunedCount += 1;
                }
            });
        }

        const knownCount = Object.keys(entries).length;
        const missingCount = Object.values(entries).filter((entry) => entry.present === false).length;
        const registry = {
            version: 1,
            updatedAt: nowIso,
            updateReason: reason,
            retentionMonths,
            currentCount: currentIds.size,
            knownCount,
            missingCount,
            prunedCount,
            entries,
        };

        this.homey.settings.set(DEVICE_REGISTRY_KEY, registry);
        this.logger.info(
            `Device registry refreshed (${reason}): ${currentIds.size} current, ${knownCount} known, ${missingCount} missing, ${prunedCount} pruned`,
        );

        return registry;
    }

    async purgeAndRebuildDeviceRegistry() {
        const nowIso = new Date().toISOString();
        this.homey.settings.set(DEVICE_REGISTRY_KEY, {
            version: 1,
            updatedAt: nowIso,
            updateReason: "purged",
            retentionMonths: this.getDeviceRegistryRetentionMonths(),
            currentCount: 0,
            knownCount: 0,
            missingCount: 0,
            prunedCount: 0,
            entries: {},
        });

        this.logger.warn("Device registry purged by user request");
        return this.refreshDeviceRegistry("purge_rebuild");
    }

    async getAvailableZones() {
        this.logger.debug("app.getting_zones");
        try {
            await this.ensureHomeyApi();

            const zones = await this.api.zones.getZones();
            
            if (!zones) {
                return [];
            }
            
            const zoneList = Object.values(zones).map((zone) => ({
                id: zone.id,
                name: zone.name,
            }));
            zoneList.sort((a, b) => a.name.localeCompare(b.name));

            this.logger.debug("app.found_zones", {
                count: zoneList.length,
            });
            return zoneList;
        } catch (e) {
            this.logger.error("app.error_getting_zones", {
                message: e.message,
            });
            return [];
        }
    }

    async getDevicesInZone(zoneId) {
        this.logger.debug("app.getting_devices_for_zone", {
            zoneId,
        });
        const deviceList = [];
        try {
            await this.ensureHomeyApi();

            const allDevices = await this.getApiDevices();
            for (const deviceId in allDevices) {
                const device = allDevices[deviceId];
                if (device.zone !== zoneId) continue;
                if (device.driverUri?.includes("logic-device")) continue;

                const capabilities = device.capabilities || [];
                if (capabilities.length === 0) continue;

                const capabilityList = capabilities.map((cap) => {
                    const capObj = device.capabilitiesObj?.[cap];
                    return {
                        id: cap,
                        name:
                            capObj?.title ||
                            cap
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (l) => l.toUpperCase()),
                        type: capObj?.type || "unknown",
                    };
                });

                deviceList.push({
                    id: deviceId,
                    name: device.name,
                    driverName: device.driverUri?.split(":").pop() || "Unknown",
                    capabilities: capabilityList,
                });
            }

            deviceList.sort((a, b) => a.name.localeCompare(b.name));

            this.logger.debug("app.found_devices_in_zone", {
                count: deviceList.length,
                zoneId,
            });
        } catch (e) {
            this.logger.error("app.error_getting_devices", {
                zoneId,
                message: e.message,
            });
        }
        return deviceList;
    }

    // --- Register ALL Flow Cards Here ---
    async registerAllFlowCards() {
        this.logger.debug("app.registering_flow_cards", {});

        // --- App-level actions ---
        try {
            const evaluateExpressionCard = this.homey.flow.getActionCard(
                "evaluate_expression",
            );
            evaluateExpressionCard.registerRunListener(async (args) => {
                try {
                    const result = evaluateExpression(
                        args,
                        this.homey.__("app.value_outside_logic", {
                            input: args.input,
                        }),
                    );
                    this.logger.flow("Executing ACTION 'evaluate_expression'", {
                        inputValue: args.input,
                        ...result,
                    });
                    return result;
                } catch (error) {
                    const result = {
                        outputValue: 0,
                        errorMessage: `Configuration error: ${error.message}`,
                    };
                    this.logger.warn(
                        "Failed to evaluate expression Flow card",
                        error,
                    );
                    return result;
                }
            });
            this.logger.debug(
                " -> OK: ACTION card registered: 'evaluate_expression'",
            );
        } catch (e) {
            this.logger.error(
                " -> FAILED: Registering ACTION card 'evaluate_expression'",
                e,
            );
        }

        try {
            const gradientCard = this.homey.flow.getActionCard("calculate_gradient");
            gradientCard.registerRunListener(async (args) => {
                const gradient = mapGradient({
                    inputValue: args.input_value,
                    fromNum: args.from_num,
                    fromNumOffset: args.from_num_offset,
                    toNum: args.to_num,
                    toNumOffset: args.to_num_offset,
                    fromOut: args.from_out,
                    toOut: args.to_out,
                    roundTo: args.round_to,
                });

                this.logger.flow("Executing ACTION 'calculate_gradient'", {
                    inputValue: gradient.inputValue,
                    outputValue: gradient.outputValue,
                });

                return {
                    mapped_value: gradient.outputValue,
                };
            });
            this.logger.debug(" -> OK: ACTION card registered: 'calculate_gradient'");
        } catch (e) {
            this.logger.error(" -> FAILED: Registering ACTION card 'calculate_gradient'", e);
        }

        // --- App-level conditions ---
        try {
            const hasErrorCard = this.homey.flow.getConditionCard("has_error");
            hasErrorCard.registerRunListener(async (args) => {
                const textInput = args.text_input;
                const hasError = Boolean(
                    textInput && String(textInput).length > 0,
                );
                this.logger.flow("Executing CONDITION 'has_error'", {
                    hasError,
                });
                return hasError;
            });
            this.logger.debug(
                " -> OK: CONDITION card registered: 'has_error'",
            );
        } catch (e) {
            this.logger.error(
                " -> FAILED: Registering CONDITION card 'has_error'",
                e,
            );
        }

        try {
            const mathCompareCard = this.homey.flow.getConditionCard("math_compare");
            mathCompareCard.registerRunListener(async (args) => {
                const evaluation = evaluateNumericComparison({
                    leftValue: args.left_value,
                    mathOperator: args.math_operator,
                    operandValue: args.operand_value,
                    comparisonOperator: args.comparison_operator,
                    rightValue: args.right_value,
                });

                this.logger.flow("Executing CONDITION 'math_compare'", {
                    calculatedValue: evaluation.calculatedValue,
                    comparisonOperator: args.comparison_operator?.id || args.comparison_operator,
                    rightValue: evaluation.rightValue,
                    result: evaluation.result,
                });

                return evaluation.result;
            });
            this.logger.debug(" -> OK: CONDITION card registered: 'math_compare'");
        } catch (e) {
            this.logger.error(" -> FAILED: Registering CONDITION card 'math_compare'", e);
        }

        // --- App-level Triggers ---
        try {
            const anyConfigAlarmCard = this.homey.flow.getTriggerCard("any_config_alarm_changed");
            anyConfigAlarmCard.registerRunListener(async (args, state) => {
                const expectedDeviceType = args.device_type;
                const expectedAlarmState = args.alarm_state === "true";

                // Match device type filter
                let deviceTypeMatches = false;
                if (expectedDeviceType === "any") {
                    deviceTypeMatches = true;
                } else if (expectedDeviceType === "logic-unit") {
                    deviceTypeMatches = state?.driver_id?.startsWith("logic-unit");
                } else if (expectedDeviceType === "logic-device") {
                    deviceTypeMatches = state?.driver_id === "logic-device";
                }

                // Match alarm state
                const alarmStateMatches = state?.alarm_state === expectedAlarmState;

                return deviceTypeMatches && alarmStateMatches;
            });
            this.logger.debug(` -> OK: APP TRIGGER registered: 'any_config_alarm_changed'`);
        } catch (e) {
            this.logger.error(` -> FAILED: Registering APP TRIGGER 'any_config_alarm_changed'`, e);
        }

        // Register any_config_alarm_state_changed trigger (no alarm_state filter)
        try {
            const anyConfigAlarmStateChangedCard = this.homey.flow.getTriggerCard("any_config_alarm_state_changed");
            anyConfigAlarmStateChangedCard.registerRunListener(async (args, state) => {
                const expectedDeviceType = args.device_type;

                // Match device type filter
                let deviceTypeMatches = false;
                if (expectedDeviceType === "any") {
                    deviceTypeMatches = true;
                } else if (expectedDeviceType === "logic-unit") {
                    deviceTypeMatches = state?.driver_id?.startsWith("logic-unit");
                } else if (expectedDeviceType === "logic-device") {
                    deviceTypeMatches = state?.driver_id === "logic-device";
                }

                return deviceTypeMatches;
            });
            this.logger.debug(` -> OK: APP TRIGGER registered: 'any_config_alarm_state_changed'`);
        } catch (e) {
            this.logger.error(` -> FAILED: Registering APP TRIGGER 'any_config_alarm_state_changed'`, e);
        }

        // Action: Wait (simple delay)
        try {
            const waitCard = this.homey.flow.getActionCard("wait");
            waitCard.registerRunListener(async (args, state) => {
                const timeoutValue = Number(args.timeout_value) || 0;
                const timeoutUnit = args.timeout_unit || 's';

                // Convert to milliseconds
                const multipliers = {
                    'ms': 1,
                    's': 1000,
                    'm': 60000,
                    'h': 3600000
                };
                const timeoutMs = timeoutValue * (multipliers[timeoutUnit] || 1000);

                this.logger.debug(`⏸️  Waiting ${timeoutValue} ${timeoutUnit} (${timeoutMs}ms)...`);

                // Simple promise-based wait
                await new Promise(resolve => setTimeout(resolve, timeoutMs));

                this.logger.debug(`✅ Wait complete, continuing flow`);
                return true;
            });

            this.logger.debug(` -> OK: ACTION registered: 'wait'`);
        } catch (e) {
            this.logger.error(` -> FAILED: Registering ACTION 'wait'`, e);
        }

        // --- Waiter Gates ---

        // Condition: Wait until becomes true
        try {
            const waitUntilCard = this.homey.flow.getConditionCard("wait_until_becomes_true");

            // Register autocomplete for capability argument
            waitUntilCard.registerArgumentAutocompleteListener('capability', async (query, args) => {
                try {
                    const device = args.device; // Get selected device
                    if (!device) return [];

                    const capabilities = device.capabilities || [];
                    const results = capabilities.map(capId => {
                        return {
                            name: capId,
                            description: `Capability: ${capId}`,
                            id: capId
                        };
                    });

                    // Filter by query if provided
                    if (query) {
                        return results.filter(r =>
                            r.name.toLowerCase().includes(query.toLowerCase())
                        );
                    }

                    return results;
                } catch (error) {
                    this.logger.error('Capability autocomplete error:', error);
                    return [];
                }
            });

            // Register autocomplete for device argument
            waitUntilCard.registerArgumentAutocompleteListener('device', async (query, args) => {
                try {
                    const allDevices = await this.getApiDevices();

                    return Object.values(allDevices)
                        .filter(device => {
                            const capabilities = device.capabilities || [];
                            if (capabilities.length === 0) return false;
                            if (query) {
                                return device.name.toLowerCase().includes(query.toLowerCase());
                            }
                            return true;
                        })
                        .map(device => ({
                            name: device.name,
                            description: `${device.capabilities.length} capabilities`,
                            id: device.id,
                            capabilities: device.capabilities
                        }));
                } catch (error) {
                    this.logger.error('Device autocomplete error:', error);
                    return [];
                }
            });

            // Register autocomplete for waiter_id argument - generates unique ID
            waitUntilCard.registerArgumentAutocompleteListener('waiter_id', async (query, args) => {
                try {
                    const results = [];

                    // Generate a new unique ID as first option
                    const newId = `wait_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
                    results.push({
                        name: newId,
                        description: 'New auto-generated ID',
                        id: newId
                    });

                    // Get existing waiter IDs from flows
                    const definedIds = await this.getAllDefinedWaiterIds();
                    for (const id of definedIds) {
                        if (!query || id.toLowerCase().includes(query.toLowerCase())) {
                            results.push({
                                name: id,
                                description: 'Existing ID from flows',
                                id: id
                            });
                        }
                    }

                    // If user typed a custom query, add it as an option
                    if (query && query.trim() && !results.some(r => r.id === query.trim())) {
                        results.push({
                            name: query.trim(),
                            description: 'Custom ID',
                            id: query.trim()
                        });
                    }

                    return results;
                } catch (error) {
                    this.logger.error('Waiter ID autocomplete error:', error);
                    // Return a generated ID even on error
                    const fallbackId = `wait_${Date.now().toString(36)}`;
                    return [{ name: fallbackId, description: 'Auto-generated ID', id: fallbackId }];
                }
            });

            waitUntilCard.registerRunListener(async (args, state) => {
                try {
                    // Extract waiter_id from autocomplete object or string
                    let waiterId = args.waiter_id?.id || args.waiter_id?.name || args.waiter_id;
                    if (typeof waiterId === 'string') {
                        waiterId = waiterId.trim();
                    }
                    if (!waiterId) {
                        waiterId = `waiter_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                        this.logger.debug(`🆔 Auto-generated waiter id: ${waiterId}`);
                    }

                    const timeoutValue = Number(args.timeout_value) || 0;
                    const timeoutUnit = args.timeout_unit || 's';

                    // Extract device config
                    const device = args.device;
                    const capability = args.capability?.id || args.capability;
                    const targetValue = args.target_value;

                    // Validate capability exists on device
                    if (!device.capabilities || !device.capabilities.includes(capability)) {
                        const availableCaps = device.capabilities ? device.capabilities.join(', ') : 'none';
                        throw new Error(`Capability "${capability}" not found on device "${device.name}". Available capabilities: ${availableCaps}`);
                    }

                    this.logger.info(`🔷 Waiter condition triggered: ${waiterId}`);
                    this.logger.info(`📡 Listening for: ${device.name}.${capability} = ${targetValue}`);

                    // Create a promise that will be resolved when the waiter is triggered
                    return new Promise((resolve, reject) => {
                        // Use IIFE to allow async/await inside Promise constructor
                        (async () => {
                            try {
                                // Check current value first - if already matches, resolve immediately
                                try {
                                    const apiDevice = await this.getApiDevice(device.id, { maxAgeMs: 0 });
                                    const currentValue = apiDevice.capabilitiesObj[capability]?.value;

                                    if (this.waiterManager.valueMatches(currentValue, targetValue)) {
                                        this.logger.info(`✅ Value already matches! ${device.name}.${capability} = ${currentValue} (target: ${targetValue})`);
                                        this.logger.info(`🎯 Resolving immediately to YES-output (no wait needed)`);
                                        resolve(true);
                                        return;
                                    }

                                    this.logger.debug(`⏳ Current value: ${currentValue}, waiting for: ${targetValue}`);
                                } catch (error) {
                                    this.logger.warn(`⚠️  Could not check current value, will wait for change: ${error.message}`);
                                }

                                // Create waiter with flow context
                                const flowContext = {
                                    flowId: state?.flowId || 'unknown',
                                    flowToken: state?.flowToken || null
                                };

                                const config = {
                                    timeoutValue,
                                    timeoutUnit
                                };

                                // NEW: Device config for capability listening
                                const deviceConfig = {
                                    deviceId: device.id,
                                    capability,
                                    targetValue
                                };

                                const actualWaiterId = await this.waiterManager.createWaiter(
                                    waiterId,
                                    config,
                                    flowContext,
                                    deviceConfig  // NEW parameter
                                );

                                // Store resolver in waiter data so it can be called later
                                const waiterData = this.waiterManager.waiters.get(actualWaiterId);
                                if (waiterData) {
                                    waiterData.resolver = resolve;
                                }

                                // NEW: Register capability listener (pass Homey API, not SDK)
                                await this.waiterManager.registerCapabilityListener(
                                    actualWaiterId,
                                    this.api
                                );

                                // Promise stays open until resolver is called by capability listener or timeout
                                // DO NOT call resolve/reject here - let waiter handle it
                                this.logger.debug(`⏸️  Waiter ${actualWaiterId} waiting for capability change...`);

                            } catch (error) {
                                this.logger.error(`❌ Failed to create waiter:`, error);
                                reject(error);
                            }
                        })();
                    });
                } catch (error) {
                    this.logger.error(`❌ Waiter condition error:`, error);
                    throw error;
                }
            });
            this.logger.debug(` -> OK: CONDITION registered: 'wait_until_becomes_true'`);
        } catch (e) {
            this.logger.error(` -> FAILED: Registering CONDITION 'wait_until_becomes_true'`, e);
        }

        // --- Virtual Gates ---

        // Condition: Conditional Gate
        try {
            const gateCard = this.homey.flow.getConditionCard("conditional_gate_start");
            const self = this;

            // Autocomplete gate_name (with suggestion)
            const gateAutocomplete = async (query, args) => {
                const results = [];
                if (!query) {
                    const generated = `Gate_${Date.now().toString(36).substr(-4).toUpperCase()}`;
                    results.push({ name: generated, description: 'Suggested Name', id: generated });
                }
                try {
                    const definedGates = await self.getAllDefinedGateNames();
                    for (const gate of definedGates) {
                        if (!query || gate.toLowerCase().includes(query.toLowerCase())) {
                            results.push({ name: gate, id: gate });
                        }
                    }
                } catch (e) { self.logger.error(e); }
                
                if (query && !results.some(r => r.name === query)) results.push({ name: query, id: query });
                return results;
            };

            gateCard.registerArgumentAutocompleteListener('gate_name', gateAutocomplete);

            gateCard.registerRunListener(async (args, state) => {
                this.logger.debug(`🎯 conditional_gate_start: raw args.gate_name = ${JSON.stringify(args.gate_name)}`);
                this.logger.debug(`🎯 conditional_gate_start: raw args.default_state = ${JSON.stringify(args.default_state)}`);

                const gateName = args.gate_name?.name || args.gate_name;
                const defaultState = args.default_state?.id || args.default_state || 'NO_GO';
                const timeoutValue = Number(args.timeout_value) || 0;
                const timeoutUnit = args.timeout_unit || 's';

                this.logger.debug(`🎯 conditional_gate_start: extracted gateName="${gateName}", defaultState="${defaultState}", timeout=${timeoutValue}${timeoutUnit}`);

                if (!gateName) throw new Error('Gate Name is required');

                const currentState = this.waiterManager.getGateState(gateName, defaultState);

                this.logger.debug(`🎯 conditional_gate_start: getGateState returned "${currentState}"`);

                if (currentState === 'GO') {
                    this.logger.info(`✅ Gate "${gateName}" is GO - continuing`);
                    return true;  // Condition cards MUST return true/false, not objects
                }

                if (timeoutValue === 0) {
                    this.logger.debug(`🎯 conditional_gate_start: timeout=0 and gate is NO_GO, returning false`);
                    return false;
                }

                // Wait for gate to become GO
                return new Promise((resolve, reject) => {
                    (async () => {
                        try {
                            const uniqueWaiterId = `gate_${gateName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                            const config = { timeoutValue, timeoutUnit };
                            const virtualGateConfig = { gateName, targetState: 'GO' };

                            const actualId = await this.waiterManager.createWaiter(
                                uniqueWaiterId,
                                config,
                                { flowId: state?.flowId, flowToken: state?.flowToken },
                                null,
                                virtualGateConfig
                            );

                            const waiterData = this.waiterManager.waiters.get(actualId);
                            if (waiterData) {
                                // Wrap resolver to convert object responses to boolean
                                waiterData.resolver = (result) => {
                                    // If result is an object (from setGateState), convert to true
                                    // If result is false (timeout), keep as false
                                    const boolResult = result === false ? false : true;
                                    this.logger.debug(`🎯 conditional_gate_start: waiter resolved with ${JSON.stringify(result)} -> ${boolResult}`);
                                    resolve(boolResult);
                                };
                            }
                        } catch (err) { reject(err); }
                    })();
                });
            });
            this.logger.debug(` -> OK: CONDITION registered: 'conditional_gate_start'`);
        } catch (e) { this.logger.error(` -> FAILED: 'conditional_gate_start'`, e); }

        // Condition: Check Gate State
        try {
            const checkCard = this.homey.flow.getConditionCard("conditional_gate_check");
            const self = this;
            
            // Re-use autocomplete helper
            const gateAutocomplete = async (query, args) => {
                const results = [];
                try {
                    const definedGates = await self.getAllDefinedGateNames();
                    for (const gate of definedGates) {
                        if (!query || gate.toLowerCase().includes(query.toLowerCase())) {
                            results.push({ name: gate, id: gate });
                        }
                    }
                } catch (e) { self.logger.error(e); }
                if (query && !results.some(r => r.name === query)) results.push({ name: query, id: query });
                return results;
            };
            
            checkCard.registerArgumentAutocompleteListener('gate_name', gateAutocomplete);
            
            checkCard.registerRunListener(async (args, state) => {
                const gateName = args.gate_name?.name || args.gate_name;
                // Extract id from dropdown object if needed
                const expectedState = args.state?.id || args.state || 'GO';

                this.logger.debug(`🔍 conditional_gate_check: gateName="${gateName}", expectedState="${expectedState}"`);

                if (!gateName) throw new Error('Gate Name is required');

                const currentState = this.waiterManager.getGateState(gateName); // Default NO_GO if not exists

                this.logger.debug(`🔍 conditional_gate_check: currentState="${currentState}", match=${currentState === expectedState}`);

                return currentState === expectedState;
            });
            this.logger.debug(` -> OK: CONDITION registered: 'conditional_gate_check'`);
        } catch (e) { this.logger.error(` -> FAILED: 'conditional_gate_check'`, e); }

        // Action: Modify Conditional Gate
        try {
            const modifyCard = this.homey.flow.getActionCard("conditional_gate_modify");
            const self = this;
            
            // Autocomplete gate_name (Use same helper)
             const gateAutocomplete = async (query, args) => {
                const results = [];
                try {
                    const definedGates = await self.getAllDefinedGateNames();
                    for (const gate of definedGates) {
                        if (!query || gate.toLowerCase().includes(query.toLowerCase())) {
                            results.push({ name: gate, id: gate });
                        }
                    }
                } catch (e) { self.logger.error(e); }
                if (query && !results.some(r => r.name === query)) results.push({ name: query, id: query });
                return results;
            };
            
            modifyCard.registerArgumentAutocompleteListener('gate_name', gateAutocomplete);

            modifyCard.registerRunListener(async (args, state) => {
                this.logger.debug(`🔧 conditional_gate_modify: raw args.gate_name = ${JSON.stringify(args.gate_name)}`);
                this.logger.debug(`🔧 conditional_gate_modify: raw args.new_state = ${JSON.stringify(args.new_state)}`);

                const gateName = args.gate_name?.name || args.gate_name;

                this.logger.debug(`🔧 conditional_gate_modify: extracted gateName="${gateName}"`);

                if (!gateName) throw new Error('Gate Name is required');

                // 1. Update Timeout if provided (Update ALL waiters for this gate)
                // -1 is the default for "No Change"
                const val = Number(args.new_timeout_value);
                if (!isNaN(val) && val >= 0) {
                    const unit = args.new_timeout_unit || 's';
                    const timeoutMs = this.waiterManager.convertToMs(val, unit);

                    const count = this.waiterManager.updateGateWaiters(gateName, { timeoutMs });
                    this.logger.info(`Updated timeout for ${count} waiters on gate "${gateName}"`);
                }

                // 2. Update State if provided
                // Extract id from dropdown object if needed (dropdown may return object or string)
                const newState = args.new_state?.id || args.new_state;
                this.logger.debug(`🔧 conditional_gate_modify: newState="${newState}" (raw was: ${JSON.stringify(args.new_state)})`);

                if (newState && newState !== 'NO_CHANGE') {
                    this.logger.debug(`🔧 conditional_gate_modify: calling setGateState("${gateName}", "${newState}")`);
                    this.waiterManager.setGateState(gateName, newState);
                } else {
                    this.logger.debug(`🔧 conditional_gate_modify: NOT calling setGateState (newState="${newState}")`);
                }

                // Return Tokens
                const finalState = this.waiterManager.getGateState(gateName);
                this.logger.debug(`🔧 conditional_gate_modify: finalState="${finalState}", returning gate_state=${finalState === 'GO'}`);

                return {
                    gate_state: finalState === 'GO'
                };
            });
             this.logger.debug(` -> OK: ACTION registered: 'conditional_gate_modify'`);
        } catch (e) { this.logger.error(` -> FAILED: 'conditional_gate_modify'`, e); }

        // Action: Control waiter
        try {
            const controlWaiterCard = this.homey.flow.getActionCard("control_waiter");
            controlWaiterCard.registerRunListener(async (args, state) => {
                try {
                    // Extract waiter_id from autocomplete object or string
                    const waiterIdArg = args.waiter_id;
                    let waiterId = null;
                    if (typeof waiterIdArg === 'string') {
                        waiterId = waiterIdArg.trim();
                    } else if (waiterIdArg && typeof waiterIdArg === 'object') {
                        waiterId = (waiterIdArg.id || waiterIdArg.name || '').toString().trim();
                    }
                    const action = args.action;

                    if (!waiterId) {
                        throw new Error('Waiter ID is required');
                    }

                    this.logger.info(`🎛️  Control waiter: ${waiterId} -> ${action}`);

                    switch (action) {
                        case 'enable':
                            const enabled = this.waiterManager.enableWaiter(waiterId, true);
                            this.logger.info(`✅ Enabled ${enabled} waiter(s)`);
                            return true;

                        case 'disable':
                            const disabled = this.waiterManager.enableWaiter(waiterId, false);
                            this.logger.info(`⏸️  Disabled ${disabled} waiter(s)`);
                            return true;

                        case 'stop':  // NEW ACTION
                            const stopped = this.waiterManager.stopWaiter(waiterId);
                            this.logger.info(`🛑 Stopped ${stopped} waiter(s)`);
                            return true;

                        default:
                            throw new Error(`Unknown action: ${action}`);
                    }
                } catch (error) {
                    this.logger.error(`❌ Control waiter error:`, error);
                    throw error;
                }
            });

            // Register autocomplete for waiter_id argument
            controlWaiterCard.registerArgumentAutocompleteListener('waiter_id', async (query, args) => {
                try {
                    const results = [];
                    const seenIds = new Set();

                    // Get all defined waiter IDs from flows
                    const definedIds = await this.getAllDefinedWaiterIds();

                    // Get active waiters from WaiterManager
                    const activeWaiters = this.waiterManager.getWaitersForAutocomplete(query);

                    // Add active waiters first (with status info)
                    for (const waiter of activeWaiters) {
                        if (!query || waiter.id.toLowerCase().includes(query.toLowerCase())) {
                            results.push(waiter);
                            seenIds.add(waiter.id);
                        }
                    }

                    // Add defined waiters that aren't currently active
                    for (const id of definedIds) {
                        if (!seenIds.has(id)) {
                            if (!query || id.toLowerCase().includes(query.toLowerCase())) {
                                results.push({
                                    name: id,
                                    description: 'Defined in flow (not active)',
                                    id: id
                                });
                                seenIds.add(id);
                            }
                        }
                    }

                    return results;
                } catch (error) {
                    this.logger.error('Waiter autocomplete error:', error);
                    return [];
                }
            });

            this.logger.debug(` -> OK: ACTION registered: 'control_waiter'`);
        } catch (e) {
            this.logger.error(` -> FAILED: Registering ACTION 'control_waiter'`, e);
        }

        this.logger.info("app.flow_cards_registered", {});
    }

    /**
     * Get all waiter IDs defined in flows (from wait_until_becomes_true cards)
     * @returns {Promise<Array>} Array of waiter IDs found in flows
     */
    async getAllDefinedWaiterIds() {
        try {
            await this.ensureHomeyApi();

            const waiterIds = new Set();

            // Search regular flows
            const flows = await this.api.flow.getFlows();

            // Also search advanced flows if available
            let advancedFlows = {};
            try {
                if (this.api.flowAdv && typeof this.api.flowAdv.getFlows === 'function') {
                    advancedFlows = await this.api.flowAdv.getFlows();
                } else if (this.api.flow && typeof this.api.flow.getAdvancedFlows === 'function') {
                    advancedFlows = await this.api.flow.getAdvancedFlows();
                }
            } catch (advErr) {
                // Advanced flows not available - ignore
            }

            // Search through all flows for wait_until_becomes_true cards
            for (const flowId in flows) {
                const flow = flows[flowId];

                // Check conditions (AND cards)
                if (flow.conditions && Array.isArray(flow.conditions)) {
                    for (const condition of flow.conditions) {
                        const isWaiterCard =
                            condition.id === 'wait_until_becomes_true' ||
                            condition.id?.endsWith(':wait_until_becomes_true') ||
                            condition.id?.includes('wait_until_becomes_true');

                        if (isWaiterCard) {
                            const waiterId = this.extractWaiterId(condition.args?.waiter_id);
                            if (waiterId) waiterIds.add(waiterId);
                        }
                    }
                }

                // Check actions (THEN cards)
                if (flow.actions && Array.isArray(flow.actions)) {
                    for (const action of flow.actions) {
                        if (action.uri?.includes('wait_until_becomes_true') || action.id === 'wait_until_becomes_true') {
                            const waiterIdArg = action.args?.waiter_id;
                            const waiterId = this.extractWaiterId(waiterIdArg);
                            if (waiterId) waiterIds.add(waiterId);
                        }
                    }
                }

                // Also check legacy 'cards' array if it exists
                if (flow.cards && Array.isArray(flow.cards)) {
                    for (const card of flow.cards) {
                        if (card.uri?.includes('wait_until_becomes_true') || card.id === 'wait_until_becomes_true') {
                            const waiterIdArg = card.args?.waiter_id;
                            const waiterId = this.extractWaiterId(waiterIdArg);
                            if (waiterId) waiterIds.add(waiterId);
                        }
                    }
                }
            }

            // Search advanced flows (different structure - cards are in a 'cards' object keyed by cardId)
            for (const flowId in advancedFlows) {
                const flow = advancedFlows[flowId];

                // Advanced flows have cards in a 'cards' object (not array)
                if (flow.cards && typeof flow.cards === 'object') {
                    for (const cardId in flow.cards) {
                        const card = flow.cards[cardId];

                        // In advanced flows, card.id is the full URI like "homey:app:no.tiwas.booleantoolbox:wait_until_becomes_true"
                        const isWaiterCard =
                            card.id === 'wait_until_becomes_true' ||
                            card.id?.endsWith(':wait_until_becomes_true') ||
                            card.id?.includes('wait_until_becomes_true');

                        if (isWaiterCard) {
                            const waiterId = this.extractWaiterId(card.args?.waiter_id);
                            if (waiterId) waiterIds.add(waiterId);
                        }
                    }
                }
            }

            this.logger.debug(`Found ${waiterIds.size} waiter IDs from flows`);
            return Array.from(waiterIds).sort();
        } catch (error) {
            this.logger.error('Failed to get defined waiter IDs from flows:', error);
            return [];
        }
    }

    /**
     * Extract waiter ID from various formats (string or autocomplete object)
     */
    extractWaiterId(waiterIdArg) {
        if (!waiterIdArg) return null;

        if (typeof waiterIdArg === 'string') {
            return waiterIdArg.trim() || null;
        }

        if (typeof waiterIdArg === 'object') {
            const id = (waiterIdArg.id || waiterIdArg.name || '').toString().trim();
            return id || null;
        }

        return null;
    }

    /**
     * Get all devices with configuration errors
     * @param {string} driverFilter - 'any', 'logic-unit', or 'logic-device'
     * @returns {Array} Array of devices with errors
     */
    async getDevicesWithConfigErrors(driverFilter = 'any') {
        const devicesWithErrors = [];

        try {
            const drivers = this.homey.drivers.getDrivers();

            for (const driver of Object.values(drivers)) {
                const driverId = driver.id;

                // Apply filter
                let shouldInclude = false;
                if (driverFilter === 'any') {
                    shouldInclude = driverId.startsWith('logic-unit') || driverId === 'logic-device';
                } else if (driverFilter === 'logic-unit') {
                    shouldInclude = driverId.startsWith('logic-unit');
                } else if (driverFilter === 'logic-device') {
                    shouldInclude = driverId === 'logic-device';
                }

                if (!shouldInclude) continue;

                const devices = driver.getDevices();
                for (const device of devices) {
                    if (device.hasCapability && device.hasCapability('alarm_config')) {
                        const alarmConfig = device.getCapabilityValue('alarm_config');
                        if (alarmConfig === true) {
                            devicesWithErrors.push({
                                id: device.getData().id,
                                name: device.getName(),
                                driverId: driverId,
                            });
                        }
                    }
                }
            }
        } catch (e) {
            this.logger.error('Failed to get devices with config errors', e);
        }

        return devicesWithErrors;
    }

    /**
     * Get all gate names defined in flows
     */
    async getAllDefinedGateNames() {
        try {
            await this.ensureHomeyApi();

            const gateNames = new Set();
            
            // Add currently active gates from memory
            const activeGates = this.waiterManager.getDefinedGates();
            activeGates.forEach(g => gateNames.add(g));

            // Helper to extract gate name
            const extractName = (arg) => arg?.name || arg;

            const flows = await this.api.flow.getFlows();
            let advancedFlows = {};
            try {
                if (this.api.flowAdv) advancedFlows = await this.api.flowAdv.getFlows();
                else if (this.api.flow?.getAdvancedFlows) advancedFlows = await this.api.flow.getAdvancedFlows();
            } catch (e) {}

            const isGateCard = (cardId) => {
                if (!cardId) return false;
                return cardId === 'conditional_gate_start' ||
                       cardId === 'conditional_gate_modify' ||
                       cardId === 'conditional_gate_check' ||
                       cardId.endsWith(':conditional_gate_start') ||
                       cardId.endsWith(':conditional_gate_modify') ||
                       cardId.endsWith(':conditional_gate_check') ||
                       cardId.includes('conditional_gate_start') ||
                       cardId.includes('conditional_gate_modify') ||
                       cardId.includes('conditional_gate_check');
            };

            const processCard = (card) => {
                if (isGateCard(card.id) || isGateCard(card.uri)) {
                    const name = extractName(card.args?.gate_name);
                    if (name) gateNames.add(name);
                }
            };

            // Regular flows
            for (const flow of Object.values(flows)) {
                if (flow.conditions) flow.conditions.forEach(processCard);
                if (flow.actions) flow.actions.forEach(processCard);
                if (flow.cards) flow.cards.forEach(processCard); // Legacy format
            }

            // Advanced flows
            for (const flow of Object.values(advancedFlows)) {
                if (flow.cards) Object.values(flow.cards).forEach(processCard);
            }

            return Array.from(gateNames).sort();
        } catch (error) {
            this.logger.error('Failed to get defined gate names:', error);
            return [];
        }
    }
};
