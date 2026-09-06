"use strict";

jest.mock("homey", () => ({
    App: class {},
    manifest: { version: "1.10.28" },
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
            manifest: { version: "1.10.28" },
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

        expect(payload.appVersion).toBe("1.10.28");
        expect(payload.report).toContain("App devices: 1");
        expect(payload.report).toContain("1/2 members enabled");
        expect(payload.report).toContain("update 30s");
        expect(payload.report).toContain("Homey system load average (1 / 5 / 15 min): 0.25 / 0.20 / 0.10");
        expect(payload.report).toContain("Homey storage: 6144.0 MB used of 8192.0 MB");
        expect(payload.report).toContain("Homey-reported app memory: 48.0 MB");
        expect(payload.report).not.toContain("Private bedroom");
        expect(payload.report).not.toContain("secret-light-id");
        expect(issueUrl.searchParams.get("body")).toContain(payload.report);
        expect(issueUrl.searchParams.get("body")).toContain("## App version\n\n1.10.28");
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
});
