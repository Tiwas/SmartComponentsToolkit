"use strict";

const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

jest.mock("homey", () => ({
    App: class {},
}), { virtual: true });

jest.mock("./lib/Logger", () => class MockLogger {});
jest.mock("./lib/WaiterManager", () => jest.fn());
jest.mock("./lib/CapturedStateManager", () => jest.fn());

const BooleanToolboxApp = require("./app");

/**
 * Creates a socket whose "subscribe"/"unsubscribe" emits model Homey's
 * server: acknowledgements arrive asynchronously, "unsubscribe" is URI-wide,
 * and events are only delivered for subscribed URIs.
 */
function createWireSocket() {
    const wire = [];
    const failures = { subscribe: 0 };
    const serverSubscriptions = new Set();
    const homeySocket = new EventEmitter();
    homeySocket.setMaxListeners(0);
    homeySocket.emit = function emit(event, ...args) {
        if (event === "subscribe" || event === "unsubscribe") {
            const uri = args[0];
            const failed = event === "subscribe" && failures.subscribe > 0;
            if (failed) failures.subscribe -= 1;
            wire.push(`${failed ? "failed-" : ""}${event}:${uri}`);
            if (event === "unsubscribe") serverSubscriptions.delete(uri);
            if (event === "subscribe" && !failed) serverSubscriptions.add(uri);
            const acknowledge = args[1];
            if (typeof acknowledge === "function") {
                setImmediate(() => acknowledge(failed ? new Error("subscribe failed") : null));
            }
            return true;
        }
        return EventEmitter.prototype.emit.call(this, event, ...args);
    };
    const pushCapability = (id, value, capabilityId = "alarm_motion") => {
        const uri = `homey:device:${id}`;
        // Homey only delivers events for URIs this socket is subscribed to.
        if (!serverSubscriptions.has(uri)) return;
        EventEmitter.prototype.emit.call(homeySocket, uri, "capability", {
            capabilityId,
            value,
            transactionId: `t-${Math.random()}`,
            transactionTime: Date.now(),
        });
    };
    return { wire, failures, serverSubscriptions, homeySocket, pushCapability };
}

async function settle() {
    for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function configure(api) {
    const app = new BooleanToolboxApp();
    app.logger = { error: jest.fn() };
    app.configureHomeyApi(api);
    return app;
}

describe("installed homey-api realtime subscriptions", () => {
    const homeyApiVersion = require("homey-api/package.json").version;
    const HomeyAPIV3Local = require("homey-api/lib/HomeyAPI/HomeyAPIV3Local");
    const Device = require("homey-api/lib/HomeyAPI/HomeyAPIV3/ManagerDevices/Device");
    const SubscriptionRegistry = require("homey-api/lib/HomeyAPI/HomeyAPIV3/SubscriptionRegistry");

    /**
     * Runs the installed homey-api SubscriptionRegistry, Item, Device, and
     * DeviceCapability code; only the Homey socket session is simulated.
     */
    function createRegistryRealtime() {
        const wireSocket = createWireSocket();
        const session = new EventEmitter();
        session.revision = 1;
        session.homeySocket = wireSocket.homeySocket;
        session.isConnected = () => true;
        session.ensureConnected = async () => ({ homeySocket: wireSocket.homeySocket, revision: 1 });
        const homey = { constructor: { SUBSCRIBE_TIMEOUT: 1000 }, __debug() {} };
        const registry = new SubscriptionRegistry({ homey, session });
        homey.subscribe = (uri, handlers) => registry.subscribe(uri, handlers);
        const manager = { __debug() {}, scheduleRefresh() {} };
        Device.ID = "device";
        const newDevice = (id) => new Device({
            id,
            homey,
            manager,
            properties: {
                capabilities: ["alarm_motion"],
                capabilitiesObj: { alarm_motion: { id: "alarm_motion", value: false, lastUpdated: null } },
            },
        });
        return { ...wireSocket, registry, newDevice };
    }

    test("uses homey-api 3.20 or newer", () => {
        const [major, minor] = homeyApiVersion.split(".").map(Number);
        expect(major > 3 || (major === 3 && minor >= 20)).toBe(true);
    });

    test("configureHomeyApi leaves the installed HomeyAPIV3 subscription registry in charge", () => {
        const api = new HomeyAPIV3Local({
            properties: { id: "homey-test" },
            baseUrl: "http://127.0.0.1",
            token: "test-token",
            strategy: [],
        });
        try {
            configure(api);

            expect(api.__subscriptionRegistry).toBeInstanceOf(SubscriptionRegistry);
            expect(Object.prototype.hasOwnProperty.call(api, "subscribe")).toBe(false);
            expect(api.subscribe).toBe(HomeyAPIV3Local.prototype.subscribe);
        } finally {
            api.destroy();
        }
    });

    test("destroying one Device object keeps another consumer of the same device subscribed", async () => {
        const realtime = createRegistryRealtime();
        const remainingListener = jest.fn();
        const destroyedListener = jest.fn();
        realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", remainingListener);
        const destroyedInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", destroyedListener);
        await settle();

        destroyedInstance.destroy();
        await settle();
        realtime.pushCapability("sensor", true);

        expect(realtime.wire).toEqual(["subscribe:homey:device:sensor"]);
        expect(remainingListener).toHaveBeenCalledWith(true, expect.anything());
        expect(destroyedListener).not.toHaveBeenCalled();
        // 3.20 removes the once("disconnect") listener after subscribing.
        expect(realtime.homeySocket.listeners("disconnect")).toHaveLength(0);
        realtime.registry.destroy();
    });
});

describe("Homey API device driver references", () => {
    function createApiDevice(properties) {
        const device = { ...properties };
        Object.defineProperty(device, "driverUri", {
            get() {
                throw new Error("Device.driverUri is deprecated. Please use Device.driverId instead.");
            },
        });
        return device;
    }

    function createApp(devices) {
        const app = new BooleanToolboxApp();
        const values = {};
        app.logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
        app.homey = {
            settings: {
                get: jest.fn((key) => values[key]),
                set: jest.fn((key, value) => {
                    values[key] = value;
                }),
            },
        };
        app.api = {
            __sctConfigured: true,
            zones: { getZones: jest.fn(async () => ({ zone: { name: "Private zone" } })) },
            devices: { getDevices: jest.fn(async () => devices) },
        };
        return { app, values };
    }

    test("registry refresh stores driverId without reading the deprecated driverUri", async () => {
        const { app } = createApp({
            one: createApiDevice({
                id: "one",
                name: "Sensor",
                zone: "zone",
                driverId: "homey:app:com.example:motion",
            }),
        });

        const registry = await app.refreshDeviceRegistry("test");

        expect(registry.entries.one).toEqual(expect.objectContaining({
            driverUri: "homey:app:com.example:motion",
            driverId: "motion",
        }));
    });

    test("input device lists derive driver names from driverId and keep Logic Devices selectable", async () => {
        const { app } = createApp({
            sensor: createApiDevice({
                id: "sensor",
                name: "Sensor",
                zone: "zone",
                driverId: "homey:app:com.example:motion",
                capabilities: ["alarm_motion"],
            }),
            logic: createApiDevice({
                id: "logic",
                name: "Motion group",
                zone: "zone",
                driverId: "homey:app:no.tiwas.booleantoolbox:logic-device",
                capabilities: ["alarm_generic"],
            }),
        });

        const devices = await app.getDevicesInZone("zone");

        expect(devices.map((device) => [device.id, device.driverName])).toEqual([
            ["logic", "logic-device"],
            ["sensor", "motion"],
        ]);
        expect(app.logger.error).not.toHaveBeenCalled();
    });

    test("app code reads driverUri only from stored registry entries", () => {
        const listFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listFiles(entryPath);
            return entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") ? [entryPath] : [];
        });
        const offenders = [
            path.join(__dirname, "app.js"),
            ...listFiles(path.join(__dirname, "lib")),
            ...listFiles(path.join(__dirname, "drivers")),
        ].flatMap((filePath) => fs.readFileSync(filePath, "utf8")
            .split(/\r?\n/)
            .map((line, index) => ({ line, location: `${path.relative(__dirname, filePath)}:${index + 1}` }))
            .filter(({ line }) => /\.driverUri\b/.test(line) && !/\bexisting\.driverUri\b/.test(line))
            .map(({ location }) => location));

        expect(offenders).toEqual([]);
    });
});
