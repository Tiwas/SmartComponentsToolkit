"use strict";

const {
    buildDiagnosticsReport,
    buildGitHubIssueUrl,
    formatDriverId,
    redactDiagnosticText,
    sanitizeEvent,
    sanitizeSession,
} = require("./lib/DiagnosticsReport");

describe("DiagnosticsReport", () => {
    test("redacts common private identifiers and credentials", () => {
        const value = redactDiagnosticText(
            "device 123e4567-e89b-12d3-a456-426614174000 at 192.168.1.12 " +
            "for owner@example.com token=super-secret Bearer abc.def.ghi " +
            "{\"password\":\"hunter two\"}; secret=two word value; done",
        );

        expect(value).toContain("<redacted-id>");
        expect(value).toContain("<redacted-ip>");
        expect(value).toContain("<redacted-email>");
        expect(value).toContain("token=<redacted>");
        expect(value).toContain("Bearer <redacted-token>");
        expect(value).not.toContain("123e4567-e89b-12d3-a456-426614174000");
        expect(value).not.toContain("super-secret");
        expect(value).not.toContain("hunter two");
        expect(value).not.toContain("two word value");
    });

    test("builds a bounded report with device and Circadian load details", () => {
        const report = buildDiagnosticsReport({
            generatedAt: "2026-09-06T20:00:00.000Z",
            appVersion: "1.10.28",
            nodeVersion: "v22.0.0",
            startedAt: "2026-09-06T19:00:00.000Z",
            uptimeSeconds: 3600,
            debugMode: true,
            memory: { rss: 50 * 1024 * 1024, heapUsed: 10 * 1024 * 1024, heapTotal: 20 * 1024 * 1024 },
            deviceSummary: {
                total: 5,
                configAlarms: 1,
                drivers: [{ id: "circadian-light-group", count: 2 }],
            },
            registry: { currentCount: 42, knownCount: 45, missingCount: 3 },
            clgGroups: [{
                totalMembers: 12,
                enabledMembers: 10,
                updateIntervalSeconds: 30,
                transitionSeconds: 20,
                watchers: 10,
                paused: false,
            }],
            events: [{
                timestamp: "2026-09-06T19:59:00.000Z",
                level: "ERROR",
                category: "Device",
                message: "Failed device 123e4567-e89b-12d3-a456-426614174000",
                stack: "Error: failed\n    at test.js:1:1",
            }],
        }, { maxReportLength: 1800 });

        expect(report).toContain("App version: 1.10.28");
        expect(report).toContain("App devices: 5");
        expect(report).toContain("10/12 members enabled");
        expect(report).toContain("update 30s");
        expect(report).toContain("<redacted-id>");
        expect(report).toContain("Error: failed");
        expect(report.length).toBeLessThanOrEqual(1800);
    });

    test("creates a prefilled GitHub issue URL with standard query parameters", () => {
        const url = new URL(buildGitHubIssueUrl({
            appVersion: "1.10.28",
            report: "diagnostic body",
            summary: "Resets every 30 seconds\nignored line break",
        }));

        expect(url.origin).toBe("https://github.com");
        expect(url.pathname).toBe("/Tiwas/SmartComponentsToolkit/issues/new");
        expect(url.searchParams.has("template")).toBe(false);
        expect(url.searchParams.has("app-version")).toBe(false);
        expect(url.searchParams.has("logs")).toBe(false);
        expect(url.searchParams.get("title")).toBe("[Bug]: Resets every 30 seconds ignored line break");
        expect(url.searchParams.get("body")).toContain("## App version\n\n1.10.28");
        expect(url.searchParams.get("body")).toContain("## Diagnostic report\n\ndiagnostic body");
    });

    test("keeps the newest diagnostic event when a long report must be shortened", () => {
        const report = buildDiagnosticsReport({
            appVersion: "1.10.28",
            deviceSummary: {
                drivers: Array.from({ length: 30 }, (_, index) => ({ id: `driver-${index}`, count: index })),
            },
            events: [
                { timestamp: "2026-09-06T10:00:00.000Z", level: "ERROR", message: "OLDEST-EVENT", stack: Array(80).fill("at oldest-file.js:1:1").join("\n") },
                { timestamp: "2026-09-06T10:01:00.000Z", level: "ERROR", message: "MIDDLE-EVENT", stack: Array(80).fill("at middle-file.js:1:1").join("\n") },
                { timestamp: "2026-09-06T10:02:00.000Z", level: "ERROR", message: "NEWEST-EVENT", stack: Array(80).fill("at newest-file.js:1:1").join("\n") },
            ],
        }, { maxReportLength: 1800 });

        expect(report).toContain("NEWEST-EVENT");
        expect(report).not.toContain("OLDEST-EVENT");
        expect(report).toContain("Privacy notice");
        expect(report.length).toBeLessThanOrEqual(1800);
    });

    test("marks unavailable resource metrics instead of reporting zero", () => {
        const report = buildDiagnosticsReport({
            systemResources: {
                appCpu: null,
                appMemory: null,
                storageTotal: null,
                storageFree: null,
            },
        });

        expect(report).toContain("Homey-reported app memory: unavailable");
        expect(report).toContain("Homey-reported app CPU metric: unavailable");
        expect(report).toContain("Homey storage: unavailable used of unavailable");
    });

    test("never redacts this app's driver ids, including long collection ids in code paths", () => {
        const drivers = [
            "circadian-light-group-collection",
            "circadian-light-group",
            "composite-device",
            "logic-device",
            "logic-unit-10",
            "state-capture-device",
        ];
        const report = buildDiagnosticsReport({
            deviceSummary: { drivers: drivers.map((id) => ({ id, count: 1 })) },
            knownDriverIds: drivers,
            events: [{
                timestamp: "2026-09-29T10:00:00.000Z",
                level: "ERROR",
                message: "Error recorded.",
                stack: "    at /app/drivers/circadian-light-group-collection/device.js:59:12",
            }],
        });

        drivers.forEach((id) => expect(report).toContain(`- Driver ${id}: 1`));
        expect(report).toContain("/app/drivers/circadian-light-group-collection/device.js:59:12");
        expect(report).not.toContain("<redacted-value>");
        expect(formatDriverId("circadian-light-group-collection")).toBe("circadian-light-group-collection");
        expect(formatDriverId("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", ["logic-device"])).toBe("<redacted-value>");
        expect(redactDiagnosticText("key AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("key <redacted-value>");
    });

    test("renders the caller location of label-free warnings", () => {
        const event = sanitizeEvent({
            timestamp: "2026-09-29T10:00:00.000Z",
            level: "WARN",
            category: "Device: logic-device",
            message: "Warning recorded.",
            source: "drivers/logic-device/device.js:603",
        });
        const report = buildDiagnosticsReport({ events: [event] });

        expect(event.source).toBe("drivers/logic-device/device.js:603");
        expect(report).toContain(
            "[WARN] [Device: logic-device] Warning recorded. (at drivers/logic-device/device.js:603)",
        );
        expect(sanitizeEvent({ level: "WARN", message: "Warning recorded." })).not.toHaveProperty("source");
    });

    test("renders process hooks and current and previous session memory samples", () => {
        const report = buildDiagnosticsReport({
            processHandlers: { unhandledRejection: 1, uncaughtException: 0 },
            session: {
                startedAt: "2026-09-29T10:00:00.000Z",
                memorySamples: [
                    { at: "2026-09-29T10:00:00.000Z", heapUsed: 40 * 1048576, rss: 80 * 1048576 },
                    { at: "2026-09-29T10:15:00.000Z", heapUsed: 42 * 1048576, rss: null },
                ],
                previous: {
                    startedAt: "2026-09-29T00:00:00.000Z",
                    lastSeenAt: "2026-09-29T09:45:00.000Z",
                    cleanShutdown: false,
                    memorySamples: [
                        { at: "2026-09-29T00:00:00.000Z", heapUsed: 40 * 1048576, rss: 85 * 1048576 },
                        { at: "2026-09-29T09:45:00.000Z", heapUsed: 95 * 1048576, rss: 140 * 1048576 },
                    ],
                },
            },
        });

        expect(report).toContain("- Process error handlers before app start: unhandledRejection 1, uncaughtException 0");
        expect(report).toContain("- Memory samples this session (UTC time heap/RSS MB): 10:00 40.0/80.0, 10:15 42.0/?");
        expect(report).toContain(
            "- Previous session: started 2026-09-29T00:00:00.000Z, last heartbeat 2026-09-29T09:45:00.000Z, " +
            "clean shutdown no; heap/RSS MB 00:00 40.0/85.0 -> 09:45 95.0/140.0 (2 samples)",
        );
    });

    test("sanitizes persisted sessions to plain label-free values", () => {
        expect(sanitizeSession(null)).toBeNull();
        expect(sanitizeSession({ startedAt: "not a date" })).toBeNull();
        expect(sanitizeSession({
            startedAt: "2026-09-29T00:00:00.000Z",
            appVersion: "1.10.29 <script>",
            cleanShutdown: "yes",
            memorySamples: [{ at: "2026-09-29T00:15:00.000Z", heapUsed: "12", rss: "x", name: "Kitchen" }, null],
            previous: { startedAt: "2026-09-28T00:00:00.000Z" },
        })).toEqual({
            startedAt: "2026-09-29T00:00:00.000Z",
            appVersion: "1.10.29script",
            lastSeenAt: null,
            stoppedAt: null,
            cleanShutdown: false,
            memorySamples: [{ at: "2026-09-29T00:15:00.000Z", heapUsed: 12, heapTotal: null, rss: null }],
        });
    });
});
