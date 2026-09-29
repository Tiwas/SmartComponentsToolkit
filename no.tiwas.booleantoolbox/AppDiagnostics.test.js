"use strict";

const os = require("node:os");

jest.mock("homey", () => ({
    App: class {},
    manifest: { version: "1.10.29" },
}), { virtual: true });

jest.mock("./lib/Logger", () => class MockLogger {});
jest.mock("./lib/WaiterManager", () => jest.fn());
jest.mock("./lib/CapturedStateManager", () => jest.fn());

const BooleanToolboxApp = require("./app");

function createSettings(values = {}) {
    return {
        get: jest.fn((key) => values[key]),
        set: jest.fn(async (key, value) => {
            values[key] = value;
        }),
    };
}

describe("BooleanToolboxApp diagnostics", () => {
    test("collects anonymous device and resource load and returns a GitHub issue URL", async () => {
        const app = new BooleanToolboxApp();
        const settings = createSettings({
            debug_mode: true,
            device_registry: { currentCount: 70, knownCount: 72, missingCount: 2 },
        });
        const group = {
            hasCapability: jest.fn(() => true),
            getCapabilityValue: jest.fn((capability) => capability === "clg_paused" ? false : true),
            getSetting: jest.fn(() => JSON.stringify({
                profile: { updateIntervalSeconds: 30, transitionSeconds: 20 },
                devices: [
                    { id: "secret-light-id", name: "Private bedroom", enabled: true },
                    { id: "other-light-id", name: "Private kitchen", enabled: false },
                ],
            })),
            memberOnoffWatchers: new Map([["secret-light-id", {}]]),
        };
        app.homey = {
            manifest: { version: "1.10.29" },
            settings,
            drivers: {
                getDrivers: jest.fn(() => ({
                    "circadian-light-group": {
                        id: "circadian-light-group",
                        getDevices: jest.fn(() => [group]),
                    },
                    "logic-device": {
                        id: "logic-device",
                        getDevices: jest.fn(() => []),
                    },
                })),
            },
        };
        app.api = {
            system: {
                getInfo: jest.fn().mockResolvedValue({
                    loadavg: [0.25, 0.2, 0.1],
                    totalmem: 2 * 1024 * 1024 * 1024,
                    freemem: 512 * 1024 * 1024,
                }),
                getMemoryInfo: jest.fn().mockResolvedValue(null),
                getStorageInfo: jest.fn().mockResolvedValue({
                    root: {
                        total: 8 * 1024 * 1024 * 1024,
                        free: 2 * 1024 * 1024 * 1024,
                    },
                }),
            },
            apps: {
                getApp: jest.fn().mockResolvedValue({
                    state: "running",
                    crashedCount: 0,
                    usage: { cpu: 0.001, mem: 48 * 1024 * 1024 },
                }),
            },
        };
        app.startedAt = new Date(Date.now() - 60000);
        app.diagnosticEvents = [];

        const payload = await app.getDiagnosticsPayload("Group resets");
        const issueUrl = new URL(payload.issueUrl);

        expect(payload.appVersion).toBe("1.10.29");
        expect(payload.report).toContain("App devices: 1");
        expect(payload.report).toContain("1/2 members enabled");
        expect(payload.report).toContain("update 30s");
        expect(payload.report).toContain("Homey system load average (1 / 5 / 15 min): 0.25 / 0.20 / 0.10");
        expect(payload.report).toContain("Homey storage: 6144.0 MB used of 8192.0 MB");
        expect(payload.report).toContain("Homey-reported app memory: 48.0 MB");
        expect(payload.report).not.toContain("Private bedroom");
        expect(payload.report).not.toContain("secret-light-id");
        expect(issueUrl.searchParams.get("body")).toContain(payload.report);
        expect(issueUrl.searchParams.get("body")).toContain("## App version\n\n1.10.29");
        expect(issueUrl.searchParams.get("title")).toBe("[Bug]: Group resets");
    });

    test("keeps only sanitized persisted warning and error events", async () => {
        jest.useFakeTimers();
        const app = new BooleanToolboxApp();
        const settings = createSettings({});
        app.homey = { settings };
        app.diagnosticEvents = [];
        app.diagnosticPersistTimer = null;

        app.recordDiagnosticEvent({
            level: "ERROR",
            category: "Test",
            message: "Failed 123e4567-e89b-12d3-a456-426614174000",
        });
        await jest.runAllTimersAsync();

        expect(app.diagnosticEvents).toHaveLength(1);
        expect(app.diagnosticEvents[0].message).toContain("<redacted-id>");
        expect(settings.set).toHaveBeenCalledWith("diagnostic_events", app.diagnosticEvents);
        jest.useRealTimers();
    });

    test("treats a null Circadian configuration as a collection note", () => {
        const app = new BooleanToolboxApp();
        app.homey = {
            drivers: {
                getDrivers: jest.fn(() => ({
                    "circadian-light-group": {
                        id: "circadian-light-group",
                        getDevices: jest.fn(() => [{
                            hasCapability: jest.fn(() => false),
                            getCapabilityValue: jest.fn(() => false),
                            getSetting: jest.fn(() => "null"),
                            memberOnoffWatchers: new Map(),
                        }]),
                    },
                })),
            },
        };

        const result = app.collectDeviceDiagnostics();

        expect(result.clgGroups).toEqual([expect.objectContaining({
            totalMembers: 0,
            enabledMembers: 0,
            updateIntervalSeconds: 120,
        })]);
        expect(result.collectionErrors).toContain("A Circadian Light Group has a non-object configuration.");
    });

    test("generates a report when process memory and Homey resource probes are unavailable", async () => {
        const memoryError = Object.assign(
            new Error("ENOENT: no such file or directory, uv_resident_set_memory"),
            { code: "ENOENT" },
        );
        const memorySpy = jest.spyOn(process, "memoryUsage").mockImplementation(() => {
            throw memoryError;
        });
        const loadAverageSpy = jest.spyOn(os, "loadavg").mockImplementation(() => {
            throw new Error("load average unavailable");
        });
        const app = new BooleanToolboxApp();
        app.homey = {
            manifest: { version: "1.10.29" },
            settings: createSettings({}),
            drivers: { getDrivers: jest.fn(() => ({})) },
        };
        app.api = {
            system: {
                getInfo: jest.fn(() => { throw new Error("info unavailable"); }),
                getMemoryInfo: jest.fn(() => { throw new Error("memory unavailable"); }),
                getStorageInfo: jest.fn(() => { throw new Error("storage unavailable"); }),
            },
            apps: {
                getApp: jest.fn(() => { throw new Error("app metrics unavailable"); }),
            },
        };
        app.startedAt = new Date();
        app.diagnosticEvents = [];

        try {
            const payload = await app.getDiagnosticsPayload("Resource probe failure");

            expect(payload.report).toContain("App version: 1.10.29");
            expect(payload.report).toContain(
                "App process memory: RSS unavailable, heap used unavailable of unavailable",
            );
            expect(payload.report).toContain("Homey-reported app memory: unavailable");
            expect(payload.report).toContain(
                "Homey system load average (1 / 5 / 15 min): unavailable",
            );
            expect(payload.report).toContain("Homey storage: unavailable used of unavailable");
            expect(new URL(payload.issueUrl).searchParams.get("body")).toContain(payload.report);
        } finally {
            memorySpy.mockRestore();
            loadAverageSpy.mockRestore();
        }
    });

    test("renders every app driver id verbatim in the report", async () => {
        const app = new BooleanToolboxApp();
        const driverIds = ["circadian-light-group-collection", "composite-device", "logic-device"];
        app.homey = {
            manifest: { version: "1.10.29", drivers: driverIds.map((id) => ({ id })) },
            settings: createSettings({}),
            drivers: {
                getDrivers: jest.fn(() => Object.fromEntries(driverIds.map((id) => [id, {
                    id,
                    getDevices: jest.fn(() => []),
                }]))),
            },
        };
        app.api = { system: {}, apps: {} };
        app.startedAt = new Date();
        app.diagnosticEvents = [];

        const payload = await app.getDiagnosticsPayload("Driver ids");

        driverIds.forEach((id) => expect(payload.report).toContain(`- Driver ${id}: 0`));
        expect(payload.report).not.toContain("<redacted-value>");
    });
});

describe("BooleanToolboxApp process and session diagnostics", () => {
    let consoleErrorSpy;

    beforeEach(() => {
        jest.useFakeTimers();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        consoleErrorSpy.mockRestore();
    });

    function createApp(values = {}) {
        const app = new BooleanToolboxApp();
        app.homey = {
            manifest: { version: "1.10.30" },
            settings: createSettings(values),
        };
        app.startedAt = new Date("2026-09-29T12:00:00.000Z");
        app.diagnosticEvents = [];
        app.diagnosticPersistTimer = null;
        return app;
    }

    function lastListener(eventName) {
        const listeners = process.listeners(eventName);
        return listeners[listeners.length - 1];
    }

    test("registers process error hooks once per process and removes them on uninit", () => {
        const before = {
            unhandledRejection: process.listenerCount("unhandledRejection"),
            uncaughtExceptionMonitor: process.listenerCount("uncaughtExceptionMonitor"),
            uncaughtException: process.listenerCount("uncaughtException"),
        };
        const first = createApp();
        const second = createApp();

        const registration = first.registerProcessDiagnostics();
        expect(first.registerProcessDiagnostics()).toBe(registration);
        second.registerProcessDiagnostics();

        expect(process.listenerCount("unhandledRejection")).toBe(before.unhandledRejection + 1);
        expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(before.uncaughtExceptionMonitor + 1);
        expect(process.listenerCount("uncaughtException")).toBe(before.uncaughtException);
        expect(registration.preexistingHandlers).toEqual({
            unhandledRejection: before.unhandledRejection,
            uncaughtException: before.uncaughtException,
        });

        first.unregisterProcessDiagnostics();
        second.unregisterProcessDiagnostics();

        expect(process.listenerCount("unhandledRejection")).toBe(before.unhandledRejection);
        expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(before.uncaughtExceptionMonitor);
    });

    test("records unhandled rejections without their message text", () => {
        const app = createApp();
        app.error = jest.fn();
        app.registerProcessDiagnostics();
        try {
            const reason = new TypeError("Kitchen sensor failed");
            lastListener("unhandledRejection")(reason, Promise.resolve());

            const event = app.diagnosticEvents.at(-1);
            expect(event).toEqual(expect.objectContaining({
                level: "ERROR",
                category: "Process",
                message: "Unhandled promise rejection recorded (TypeError).",
            }));
            expect(event.stack).toContain("AppDiagnostics.test.js");
            expect(JSON.stringify(app.diagnosticEvents)).not.toContain("Kitchen");
            expect(app.error).toHaveBeenCalledWith(
                "[Process] Unhandled promise rejection recorded (TypeError).",
                reason,
            );
        } finally {
            app.unregisterProcessDiagnostics();
        }
    });

    test("persists uncaught exceptions immediately without handling them", () => {
        const values = {};
        const app = createApp(values);
        app.registerProcessDiagnostics();
        try {
            lastListener("uncaughtExceptionMonitor")(new RangeError("Bedroom overflow"), "uncaughtException");

            expect(app.homey.settings.set).toHaveBeenCalledWith("diagnostic_events", app.diagnosticEvents);
            expect(app.diagnosticPersistTimer).toBeNull();
            expect(values.diagnostic_events.at(-1)).toEqual(expect.objectContaining({
                level: "ERROR",
                category: "Process",
                message: "Uncaught exception recorded (RangeError).",
            }));
            expect(JSON.stringify(values.diagnostic_events)).not.toContain("Bedroom");
        } finally {
            app.unregisterProcessDiagnostics();
        }
    });

    test("warns about a previous session without a clean shutdown and tracks the new session", () => {
        const values = {
            diagnostic_session: {
                startedAt: "2026-09-29T00:00:00.000Z",
                lastSeenAt: "2026-09-29T09:45:00.000Z",
                appVersion: "1.10.29",
                cleanShutdown: false,
                memorySamples: [{ at: "2026-09-29T09:45:00.000Z", heapUsed: 1024, rss: 2048 }],
                previous: { startedAt: "2026-09-28T00:00:00.000Z" },
            },
        };
        const app = createApp(values);

        app.startDiagnosticSession();

        expect(app.diagnosticEvents).toEqual([expect.objectContaining({
            level: "WARN",
            category: "App",
            message: "Previous app session ended without a clean shutdown (version 1.10.29, "
                + "started 2026-09-29T00:00:00.000Z, last heartbeat 2026-09-29T09:45:00.000Z, "
                + "uptime at least 9h 45m 0s).",
        })]);
        expect(values.diagnostic_session).toEqual(expect.objectContaining({
            startedAt: "2026-09-29T12:00:00.000Z",
            appVersion: "1.10.30",
            cleanShutdown: false,
            previous: expect.objectContaining({
                startedAt: "2026-09-29T00:00:00.000Z",
                cleanShutdown: false,
                memorySamples: [{ at: "2026-09-29T09:45:00.000Z", heapUsed: 1024, heapTotal: null, rss: 2048 }],
            }),
        }));
        expect(values.diagnostic_session.previous).not.toHaveProperty("previous");

        const sample = app.recordMemorySample();
        expect(sample.heapUsed).toEqual(expect.any(Number));
        expect(values.diagnostic_session.memorySamples).toEqual([sample]);
        expect(values.diagnostic_session.lastSeenAt).toBe(sample.at);

        app.markDiagnosticSessionStopped();
        expect(values.diagnostic_session.cleanShutdown).toBe(true);

        const restarted = createApp(values);
        restarted.startDiagnosticSession();
        expect(restarted.diagnosticEvents).toEqual([]);
        expect(values.diagnostic_session.previous.cleanShutdown).toBe(true);
    });

    test("onUninit waits until the clean-shutdown marker is persisted", async () => {
        jest.useRealTimers();
        const stored = {};
        const app = createApp();
        app.logger = { error: jest.fn(), info: jest.fn() };
        app.homey.settings.set = jest.fn((key, value) => new Promise((resolve) => {
            const snapshot = JSON.parse(JSON.stringify(value));
            // The session write is slower than the event write, so an
            // un-awaited marker would still be pending when onUninit returns.
            setTimeout(() => {
                stored[key] = snapshot;
                resolve();
            }, key === "diagnostic_session" ? 30 : 0);
        }));
        app.diagnosticSession = {
            startedAt: "2026-09-29T12:00:00.000Z",
            cleanShutdown: false,
            memorySamples: [],
            previous: null,
        };

        await app.onUninit();

        expect(stored.diagnostic_session).toEqual(expect.objectContaining({ cleanShutdown: true }));
        expect(app.logger.error).not.toHaveBeenCalled();
    });

    test("onUninit logs a failed clean-shutdown write instead of throwing", async () => {
        jest.useRealTimers();
        const app = createApp();
        app.logger = { error: jest.fn(), info: jest.fn() };
        const failure = new Error("settings unavailable");
        app.homey.settings.set = jest.fn(async (key) => {
            if (key === "diagnostic_session") throw failure;
        });
        app.diagnosticSession = {
            startedAt: "2026-09-29T12:00:00.000Z",
            cleanShutdown: false,
            memorySamples: [],
            previous: null,
        };

        await expect(app.onUninit()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith("Failed to persist diagnostic session", failure);
        expect(app.logger.info).toHaveBeenCalledWith("App uninitialized.", {});
    });

    test("keeps memory samples bounded and falls back to V8 heap statistics", () => {
        const memorySpy = jest.spyOn(process, "memoryUsage").mockImplementation(() => {
            throw new Error("ENOENT: no such file or directory, uv_resident_set_memory");
        });
        const app = createApp();
        try {
            app.startDiagnosticSession();
            for (let index = 0; index < 20; index += 1) app.recordMemorySample();

            expect(app.diagnosticSession.memorySamples).toHaveLength(16);
            expect(app.diagnosticSession.memorySamples.at(-1)).toEqual(expect.objectContaining({
                heapUsed: expect.any(Number),
                rss: null,
            }));
        } finally {
            memorySpy.mockRestore();
        }
    });
});
