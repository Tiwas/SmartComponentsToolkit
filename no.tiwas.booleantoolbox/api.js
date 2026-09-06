"use strict";

module.exports = {
    async getDiagnostics({ homey, body }) {
        const summary = body && typeof body.summary === "string"
            ? body.summary
            : "";
        return await homey.app.getDiagnosticsPayload(summary);
    },
};
