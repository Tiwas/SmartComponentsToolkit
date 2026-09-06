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

        expect(recordDiagnosticEvent).toHaveBeenCalledTimes(2);
        expect(recordDiagnosticEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
            level: "WARN",
            category: "Test",
            message: "warning message",
        }));
        expect(recordDiagnosticEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
            level: "ERROR",
            message: "error message",
            stack: expect.stringContaining("Error: failure"),
        }));
    });
});
