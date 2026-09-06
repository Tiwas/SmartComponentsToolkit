"use strict";

const {
    buildDiagnosticsReport,
    buildGitHubIssueUrl,
    redactDiagnosticText,
} = require("./lib/DiagnosticsReport");

describe("DiagnosticsReport", () => {
    test("redacts common private identifiers and credentials", () => {
        const value = redactDiagnosticText(
            "device 123e4567-e89b-12d3-a456-426614174000 at 192.168.1.12 " +
            "for owner@example.com token=super-secret Bearer abc.def.ghi",
        );

        expect(value).toContain("<redacted-id>");
        expect(value).toContain("<redacted-ip>");
        expect(value).toContain("<redacted-email>");
        expect(value).toContain("token=<redacted>");
        expect(value).toContain("Bearer <redacted-token>");
        expect(value).not.toContain("123e4567-e89b-12d3-a456-426614174000");
        expect(value).not.toContain("super-secret");
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

    test("creates a prefilled GitHub issue form URL", () => {
        const url = new URL(buildGitHubIssueUrl({
            appVersion: "1.10.28",
            report: "diagnostic body",
            summary: "Resets every 30 seconds\nignored line break",
        }));

        expect(url.origin).toBe("https://github.com");
        expect(url.pathname).toBe("/Tiwas/SmartComponentsToolkit/issues/new");
        expect(url.searchParams.get("template")).toBe("01-bug-report.yml");
        expect(url.searchParams.get("app-version")).toBe("1.10.28");
        expect(url.searchParams.get("logs")).toBe("diagnostic body");
        expect(url.searchParams.get("title")).toBe("[Bug]: Resets every 30 seconds ignored line break");
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
});
