"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Emitter = require("component-emitter");
const HomeyAPIV3 = require("homey-api/lib/HomeyAPI/HomeyAPIV3");
const Device = require("homey-api/lib/HomeyAPI/HomeyAPIV3/ManagerDevices/Device");

jest.mock("homey", () => ({
    App: class {},
}), { virtual: true });

jest.mock("./lib/Logger", () => class MockLogger {});
jest.mock("./lib/WaiterManager", () => jest.fn());
jest.mock("./lib/CapturedStateManager", () => jest.fn());

const BooleanToolboxApp = require("./app");

Device.ID = "device";

/**
 * Builds a HomeyAPI-like object that runs the real homey-api 3.17 subscribe(),
 * Item and DeviceCapability code against an in-memory socket.
 */
function createRealtimeApi() {
    const wire = [];
    const failures = { subscribe: 0 };
    const homeySocket = new Emitter();
    homeySocket.connected = true;
    homeySocket.emit = function emit(event, ...args) {
        if (event === "subscribe" || event === "unsubscribe") {
            const failed = event === "subscribe" && failures.subscribe > 0;
            if (failed) failures.subscribe -= 1;
            wire.push(`${failed ? "failed-" : ""}${event}:${args[0]}`);
            const acknowledge = args[1];
            if (typeof acknowledge === "function") {
                setImmediate(() => acknowledge(failed ? new Error("subscribe failed") : null));
            }
            return this;
        }
        return Emitter.prototype.emit.call(this, event, ...args);
    };

    const api = {
        constructor: HomeyAPIV3,
        __homeySocket: homeySocket,
        __socket: new Emitter(),
        __debug() {},
        isConnected: HomeyAPIV3.prototype.isConnected,
        connect: async () => {},
        subscribe: HomeyAPIV3.prototype.subscribe,
    };
    const manager = { __debug() {}, scheduleRefresh() {} };
    const newDevice = (id) => new Device({
        id,
        homey: api,
        manager,
        properties: {
            name: "Private sensor name",
            capabilities: ["alarm_motion"],
            capabilitiesObj: { alarm_motion: { id: "alarm_motion", value: false, lastUpdated: null } },
        },
    });
    const pushCapability = (id, value, transactionTime = Date.now()) => {
        Emitter.prototype.emit.call(homeySocket, `homey:device:${id}`, "capability", {
            capabilityId: "alarm_motion",
            value,
            transactionId: `t-${transactionTime}-${Math.random()}`,
            transactionTime,
        });
    };

    return { api, wire, failures, homeySocket, newDevice, pushCapability };
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

describe("shared Homey API realtime subscriptions", () => {
    test("one consumer disconnecting does not stop updates for another consumer of the same device", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const logicDeviceListener = jest.fn();
        const waiterListener = jest.fn();

        realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", logicDeviceListener);
        const waiterInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", waiterListener);
        await settle();

        waiterInstance.destroy();
        await settle();
        realtime.pushCapability("sensor", true);

        expect(realtime.wire).toEqual(["subscribe:homey:device:sensor"]);
        expect(logicDeviceListener).toHaveBeenCalledWith(true, expect.anything());
        expect(waiterListener).not.toHaveBeenCalled();
    });

    test("periodic listener replacement neither resubscribes nor accumulates socket listeners", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const ids = ["a", "b", "c"];
        const current = new Map(ids.map((id) => [
            id,
            realtime.newDevice(id).makeCapabilityInstance("alarm_motion", () => {}),
        ]));
        await settle();
        const disconnectListeners = realtime.homeySocket.listeners("disconnect").length;

        for (let round = 0; round < 12; round += 1) {
            for (const id of ids) {
                const replacement = realtime.newDevice(id).makeCapabilityInstance("alarm_motion", () => {});
                current.get(id).destroy();
                current.set(id, replacement);
            }
            await settle();
        }

        expect(realtime.wire.filter((entry) => entry.startsWith("subscribe"))).toHaveLength(ids.length);
        expect(realtime.wire.filter((entry) => entry.startsWith("unsubscribe"))).toHaveLength(0);
        expect(realtime.homeySocket.listeners("disconnect")).toHaveLength(disconnectListeners);
    });

    test("the last consumer releases the server subscription exactly once", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const first = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", () => {});
        const second = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", () => {});
        await settle();

        first.destroy();
        second.destroy();
        await settle();

        expect(realtime.wire).toEqual([
            "subscribe:homey:device:sensor",
            "unsubscribe:homey:device:sensor",
        ]);
        expect(realtime.api.__sctSharedSubscriptions.size).toBe(0);
    });

    test("a throwing consumer does not block delivery to the other consumers", async () => {
        const realtime = createRealtimeApi();
        const app = configure(realtime.api);
        const failure = new Error("listener failed");
        const healthyListener = jest.fn();

        realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", () => {
            throw failure;
        });
        realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", healthyListener);
        await settle();

        expect(() => realtime.pushCapability("sensor", true)).not.toThrow();
        expect(healthyListener).toHaveBeenCalledWith(true, expect.anything());
        expect(app.logger.error).toHaveBeenCalledWith("Realtime capability listener failed", failure);
    });

    test("a consumer whose onConnect throws is removed instead of leaking", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const failure = new Error("connect handler failed");
        const failingConsumerEvents = jest.fn();
        const failingHandlers = () => ({
            onConnect: () => {
                throw failure;
            },
            onEvent: failingConsumerEvents,
        });

        await expect(realtime.api.subscribe("homey:device:alone", failingHandlers())).rejects.toBe(failure);
        expect(realtime.api.__sctSharedSubscriptions.has("homey:device:alone")).toBe(false);
        expect(realtime.wire).toEqual([
            "subscribe:homey:device:alone",
            "unsubscribe:homey:device:alone",
        ]);

        const healthyConsumerEvents = jest.fn();
        const healthy = await realtime.api.subscribe("homey:device:shared", { onEvent: healthyConsumerEvents });
        await expect(realtime.api.subscribe("homey:device:shared", failingHandlers())).rejects.toBe(failure);
        realtime.pushCapability("shared", true);

        expect(healthyConsumerEvents).toHaveBeenCalledTimes(1);
        expect(failingConsumerEvents).not.toHaveBeenCalled();
        expect(realtime.api.__sctSharedSubscriptions.get("homey:device:shared").consumers.size).toBe(1);
        expect(realtime.wire.filter((entry) => entry.endsWith(":homey:device:shared"))).toEqual([
            "subscribe:homey:device:shared",
        ]);

        healthy.unsubscribe();
        expect(realtime.api.__sctSharedSubscriptions.has("homey:device:shared")).toBe(false);
    });

    test("resubscribing replaces the server subscription and keeps every consumer", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const listener = jest.fn();
        realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", listener);
        await settle();

        await expect(realtime.api.__sctResubscribe("homey:device:sensor")).resolves.toBe(true);
        realtime.pushCapability("sensor", true);

        expect(realtime.wire).toEqual([
            "subscribe:homey:device:sensor",
            "unsubscribe:homey:device:sensor",
            "subscribe:homey:device:sensor",
        ]);
        expect(listener).toHaveBeenCalledTimes(1);
        await expect(realtime.api.__sctResubscribe("homey:device:unknown")).resolves.toBe(false);
    });

    test("keeps consumers after a failed resubscribe and restores them on the next subscribe", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const uri = "homey:device:sensor";
        const watcher = jest.fn();
        const watcherInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", watcher);
        await settle();

        realtime.failures.subscribe = 1;
        await expect(realtime.api.__sctResubscribe(uri)).rejects.toThrow("subscribe failed");
        const entry = realtime.api.__sctSharedSubscriptions.get(uri);
        expect(entry.consumers.size).toBe(1);
        expect(entry.needsResubscribe).toBe(true);

        const laterInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", () => {});
        await settle();
        realtime.pushCapability("sensor", true);

        expect(watcher).toHaveBeenCalledWith(true, expect.anything());
        expect(realtime.api.__sctSharedSubscriptions.get(uri)).toBe(entry);
        expect(entry.needsResubscribe).toBe(false);
        expect(realtime.wire).toEqual([
            `subscribe:${uri}`,
            `unsubscribe:${uri}`,
            `failed-subscribe:${uri}`,
            `subscribe:${uri}`,
        ]);
        expect(realtime.homeySocket.listeners(uri)).toHaveLength(1);

        watcherInstance.destroy();
        laterInstance.destroy();
        await settle();
        expect(realtime.api.__sctSharedSubscriptions.size).toBe(0);
        expect(realtime.wire.at(-1)).toBe(`unsubscribe:${uri}`);
    });

    test("restores a failed subscription on the next health-refresh resubscribe", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const uri = "homey:device:sensor";
        const watcher = jest.fn();
        const watcherInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", watcher);
        await settle();

        realtime.failures.subscribe = 1;
        await expect(realtime.api.__sctResubscribe(uri)).rejects.toThrow("subscribe failed");
        await expect(realtime.api.__sctResubscribe(uri)).resolves.toBe(true);
        realtime.pushCapability("sensor", true);

        expect(watcher).toHaveBeenCalledTimes(1);
        expect(realtime.wire.slice(-2)).toEqual([`failed-subscribe:${uri}`, `subscribe:${uri}`]);
        watcherInstance.destroy();
    });

    test("retries a failed subscription with backoff while it has consumers", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
        try {
            const realtime = createRealtimeApi();
            configure(realtime.api);
            const uri = "homey:device:sensor";
            const watcher = jest.fn();
            const watcherInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", watcher);
            await settle();

            realtime.failures.subscribe = 2;
            await expect(realtime.api.__sctResubscribe(uri)).rejects.toThrow("subscribe failed");
            jest.advanceTimersByTime(5000);
            await settle();
            expect(realtime.wire.filter((entry) => entry === `failed-subscribe:${uri}`)).toHaveLength(2);

            jest.advanceTimersByTime(10000);
            await settle();
            realtime.pushCapability("sensor", true);

            expect(watcher).toHaveBeenCalledTimes(1);
            expect(realtime.wire.at(-1)).toBe(`subscribe:${uri}`);
            expect(jest.getTimerCount()).toBe(0);
            watcherInstance.destroy();
        } finally {
            jest.useRealTimers();
        }
    });

    test("an unsubscribe after a failed resubscribe releases the entry without leaks", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
        try {
            const realtime = createRealtimeApi();
            configure(realtime.api);
            const uri = "homey:device:sensor";
            const watcherInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", () => {});
            await settle();

            realtime.failures.subscribe = 1;
            await expect(realtime.api.__sctResubscribe(uri)).rejects.toThrow("subscribe failed");
            const wireBeforeRelease = [...realtime.wire];
            watcherInstance.destroy();
            await settle();

            expect(realtime.api.__sctSharedSubscriptions.size).toBe(0);
            expect(realtime.wire).toEqual(wireBeforeRelease);
            expect(realtime.homeySocket.listeners(uri)).toHaveLength(0);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test("keeps consumers when resubscribing after a socket reconnect fails and restores them", async () => {
        const realtime = createRealtimeApi();
        configure(realtime.api);
        const uri = "homey:device:sensor";
        const watcher = jest.fn();
        const watcherInstance = realtime.newDevice("sensor").makeCapabilityInstance("alarm_motion", watcher);
        await settle();

        realtime.failures.subscribe = 1;
        realtime.api.__socket.emit("reconnect");
        await settle();
        const entry = realtime.api.__sctSharedSubscriptions.get(uri);
        expect(entry.consumers.size).toBe(1);
        expect(entry.needsResubscribe).toBe(true);

        await expect(realtime.api.__sctResubscribe(uri)).resolves.toBe(true);
        realtime.pushCapability("sensor", true);

        expect(watcher).toHaveBeenCalledTimes(1);
        expect(realtime.wire).toEqual([
            `subscribe:${uri}`,
            `failed-subscribe:${uri}`,
            `unsubscribe:${uri}`,
            `subscribe:${uri}`,
        ]);
        expect(realtime.homeySocket.listeners(uri)).toHaveLength(1);
        expect(realtime.api.__socket.listeners("reconnect")).toHaveLength(1);
        watcherInstance.destroy();
    });

    test("leaves homey-api versions with their own subscription registry untouched", () => {
        const subscribe = jest.fn();
        const api = { subscribe, __subscriptionRegistry: {} };

        configure(api);

        expect(api.subscribe).toBe(subscribe);
        expect(api.__sctSharedSubscriptions).toBeUndefined();
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
