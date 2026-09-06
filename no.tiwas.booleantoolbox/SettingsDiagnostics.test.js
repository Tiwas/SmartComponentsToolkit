"use strict";

const fs = require("fs");
const path = require("path");

describe("settings diagnostics UI", () => {
    test("opens the diagnostic payload that the user already reviewed", () => {
        const html = fs.readFileSync(path.join(__dirname, "settings", "index.html"), "utf8");
        const handlerStart = html.indexOf("openGitHubIssueButton.addEventListener");
        const handlerEnd = html.indexOf("saveButton.addEventListener", handlerStart);
        const handler = html.slice(handlerStart, handlerEnd);

        expect(handler).toContain("Homey.openURL(diagnosticsPayload.issueUrl)");
        expect(handler).not.toContain("await generateDiagnostics()");
    });
});
