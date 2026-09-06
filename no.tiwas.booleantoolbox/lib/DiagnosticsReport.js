"use strict";

const DEFAULT_MAX_REPORT_LENGTH = 3600;
const DEFAULT_MAX_EVENTS = 12;
const GITHUB_NEW_ISSUE_URL = "https://github.com/Tiwas/SmartComponentsToolkit/issues/new";

function isFiniteMetric(value) {
    return value !== null
        && value !== undefined
        && value !== ""
        && Number.isFinite(Number(value));
}

function redactDiagnosticText(value) {
    return String(value ?? "")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<redacted-id>")
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>")
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<redacted-ip>")
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted-token>")
        .replace(/\b(token|api[_-]?key|password|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=<redacted>")
        .replace(/\b(?:[a-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b/g, "<redacted-value>");
}

function formatBytes(value) {
    if (!isFiniteMetric(value)) return "unavailable";
    const bytes = Number(value);
    if (bytes < 0) return "unavailable";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secondsValue) {
    const totalSeconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(" ");
}

function formatPercent(used, total) {
    if (!isFiniteMetric(used) || !isFiniteMetric(total)) return "unavailable";
    const usedValue = Number(used);
    const totalValue = Number(total);
    if (totalValue <= 0) return "unavailable";
    return `${((usedValue / totalValue) * 100).toFixed(1)}%`;
}

function sanitizeEvent(event) {
    if (!event || typeof event !== "object") return null;

    const level = String(event.level || "INFO").toUpperCase();
    const timestamp = Number.isNaN(new Date(event.timestamp).getTime())
        ? "unknown time"
        : new Date(event.timestamp).toISOString();
    const category = redactDiagnosticText(event.category || "App").slice(0, 80);
    const message = redactDiagnosticText(event.message || "").replace(/\s+/g, " ").trim().slice(0, 320);
    const stack = redactDiagnosticText(event.stack || "").trim().slice(0, 900);

    if (!message && !stack) return null;
    return { level, timestamp, category, message, stack };
}

function buildDiagnosticsReport(data, options = {}) {
    const maxReportLength = Math.max(1200, Number(options.maxReportLength) || DEFAULT_MAX_REPORT_LENGTH);
    const maxEvents = Math.max(0, Number(options.maxEvents) || DEFAULT_MAX_EVENTS);
    const deviceSummary = data.deviceSummary || {};
    const registry = data.registry || {};
    const clgGroups = Array.isArray(data.clgGroups) ? data.clgGroups : [];
    const events = (Array.isArray(data.events) ? data.events : [])
        .map(sanitizeEvent)
        .filter(Boolean)
        .slice(-maxEvents);
    const memory = data.memory || {};
    const resources = data.systemResources || {};
    const systemMemoryUsed = isFiniteMetric(resources.memoryTotal)
        && isFiniteMetric(resources.memoryFree)
        ? Math.max(0, Number(resources.memoryTotal) - Number(resources.memoryFree))
        : null;
    const storageUsed = isFiniteMetric(resources.storageTotal)
        && isFiniteMetric(resources.storageFree)
        ? Math.max(0, Number(resources.storageTotal) - Number(resources.storageFree))
        : null;
    const loadAverage = Array.isArray(resources.loadAverage)
        ? resources.loadAverage.slice(0, 3).map((value) => Number(value).toFixed(2)).join(" / ")
        : "unavailable";

    const lines = [
        "# Smart (Components) Toolkit diagnostic report",
        "",
        `- Generated: ${data.generatedAt || new Date().toISOString()}`,
        `- App version: ${data.appVersion || "unknown"}`,
        `- Node.js: ${data.nodeVersion || "unknown"}`,
        `- Current session started: ${data.startedAt || "unknown"}`,
        `- Current session uptime: ${formatDuration(data.uptimeSeconds)}`,
        `- Debug mode: ${data.debugMode === true ? "enabled" : "disabled"}`,
        `- App state: ${resources.appState || "unavailable"}`,
        `- Homey-reported crash count: ${resources.crashedCount ?? "unavailable"}`,
        "",
        "## Resource load",
        "",
        `- App process memory: RSS ${formatBytes(memory.rss)}, heap used ${formatBytes(memory.heapUsed)} of ${formatBytes(memory.heapTotal)}`,
        `- Homey-reported app memory: ${formatBytes(resources.appMemory)}`,
        `- Homey-reported app CPU metric: ${isFiniteMetric(resources.appCpu) ? Number(resources.appCpu).toFixed(6) : "unavailable"}`,
        `- Homey system load average (1 / 5 / 15 min): ${loadAverage}${resources.cpuCores ? ` across ${resources.cpuCores} CPU core(s)` : ""}`,
        `- Homey memory: ${formatBytes(systemMemoryUsed)} used of ${formatBytes(resources.memoryTotal)} (${formatBytes(resources.memoryFree)} free, ${formatPercent(systemMemoryUsed, resources.memoryTotal)} used)`,
        `- Homey storage: ${formatBytes(storageUsed)} used of ${formatBytes(resources.storageTotal)} (${formatBytes(resources.storageFree)} free, ${formatPercent(storageUsed, resources.storageTotal)} used)`,
        "",
        "## Device load",
        "",
        `- App devices: ${deviceSummary.total || 0}`,
        `- Devices with configuration alarm: ${deviceSummary.configAlarms || 0}`,
        `- Homey registry snapshot: ${registry.currentCount || 0} current / ${registry.knownCount || 0} known / ${registry.missingCount || 0} deleted`,
    ];

    const drivers = Array.isArray(deviceSummary.drivers) ? deviceSummary.drivers : [];
    for (const driver of drivers) {
        lines.push(`- Driver ${redactDiagnosticText(driver.id).slice(0, 80)}: ${Number(driver.count) || 0}`);
    }

    lines.push("", "## Circadian Light Group load", "");
    if (clgGroups.length === 0) {
        lines.push("- No Circadian Light Group devices found.");
    } else {
        clgGroups.forEach((group, index) => {
            lines.push(
                `- Group ${index + 1}: ${group.enabledMembers || 0}/${group.totalMembers || 0} members enabled; ` +
                `update ${group.updateIntervalSeconds || 120}s; transition ${group.transitionSeconds || 0}s; ` +
                `watchers ${group.watchers || 0}; paused ${group.paused === true ? "yes" : "no"}`,
            );
        });
    }

    lines.push("", "## Recent warnings and errors", "");
    if (events.length === 0) {
        lines.push("- No captured warnings or errors.");
    } else {
        for (const event of events) {
            lines.push(`- ${event.timestamp} [${event.level}] [${event.category}] ${event.message || "(no message)"}`);
            if (event.stack) {
                lines.push("```text", event.stack, "```");
            }
        }
    }

    if (resources.crashedMessage) {
        lines.push("", "## Homey crash message", "", redactDiagnosticText(resources.crashedMessage).slice(0, 900));
    }

    const collectionErrors = Array.isArray(data.collectionErrors) ? data.collectionErrors : [];
    if (collectionErrors.length > 0) {
        lines.push("", "## Collection notes", "");
        collectionErrors.forEach((message) => {
            lines.push(`- ${redactDiagnosticText(message).slice(0, 240)}`);
        });
    }

    lines.push(
        "",
        "## Privacy notice",
        "",
        "Device names and IDs are intentionally omitted from the structured data. Common identifiers and secrets are redacted from captured log lines, but please review this report before submitting it.",
    );

    const report = lines.join("\n");
    if (report.length <= maxReportLength) return report;

    const suffix = "\n\n_Report shortened to fit safely in a GitHub issue URL._";
    return `${report.slice(0, maxReportLength - suffix.length).trimEnd()}${suffix}`;
}

function buildGitHubIssueUrl({ appVersion, report, summary }) {
    const issueSummary = String(summary || "Diagnostic report")
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(0, 100) || "Diagnostic report";
    const params = new URLSearchParams({
        template: "01-bug-report.yml",
        title: `[Bug]: ${issueSummary}`,
        "app-version": String(appVersion || "unknown"),
        logs: String(report || ""),
    });

    return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

module.exports = {
    buildDiagnosticsReport,
    buildGitHubIssueUrl,
    redactDiagnosticText,
    sanitizeEvent,
};
