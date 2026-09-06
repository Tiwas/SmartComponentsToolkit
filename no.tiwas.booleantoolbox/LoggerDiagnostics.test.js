"use strict";

const Logger = require("./lib/Logger");

describe("Logger diagnostics capture", () => {
    test("captures warnings and errors, including error stack traces", () => {
        const recordDiagnosticEvent = jest.fn();
        const homey = {
            __: jest.fn((key) => key),
            app: {
                log: jest.fn(),
                error: jest.fn(),
                recordDiagnosticEvent,
            },
        };
        const logger = new Logger({ homey }, "Test", { level: "DEBUG" });
        const error = new Error("failure");

        logger.debug("debug message");
        logger.warn("warning message");
        logger.error("error message", error);
        logger.error(error);

        expect(recordDiagnosticEvent).toHaveBeenCalledTimes(3);
        expect(recordDiagnosticEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
            level: "WARN",
            category: "Test",
            message: "Warning recorded.",
        }));
        expect(recordDiagnosticEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
            level: "ERROR",
            message: "Error recorded.",
            stack: expect.stringContaining("at "),
        }));
        expect(recordDiagnosticEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
            level: "ERROR",
            message: "Error recorded.",
            stack: expect.stringContaining("at "),
        }));
        expect(recordDiagnosticEvent.mock.calls[1][0].stack).not.toContain("failure");
        expect(recordDiagnosticEvent.mock.calls[2][0].stack).not.toContain("failure");
        expect(JSON.stringify(recordDiagnosticEvent.mock.calls)).not.toContain("warning message");
        expect(JSON.stringify(recordDiagnosticEvent.mock.calls)).not.toContain("error message");
    });
});
