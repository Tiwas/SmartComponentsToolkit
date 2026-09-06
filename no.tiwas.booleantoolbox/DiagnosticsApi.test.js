"use strict";

const api = require("./api");

describe("diagnostics settings API", () => {
    test("delegates report creation to the app with the issue summary", async () => {
        const getDiagnosticsPayload = jest.fn(() => ({ report: "ok" }));
        const result = await api.getDiagnostics({
            homey: { app: { getDiagnosticsPayload } },
            body: { summary: "Lights reset" },
        });

        expect(getDiagnosticsPayload).toHaveBeenCalledWith("Lights reset");
        expect(result).toEqual({ report: "ok" });
    });
});
