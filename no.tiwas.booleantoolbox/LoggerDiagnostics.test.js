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

    test("records the app-relative caller location for warnings and stackless errors", () => {
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

        const warnLine = new Error().stack.split("\n")[1].match(/:(\d+):\d+\)?$/)[1];
        logger.warn("Kitchen sensor offline", { device: "Kitchen" });
        logger.error("Could not update Bedroom", { device: "Bedroom" });
        logger.error("with stack", new Error("Private label"));

        const [warning, stacklessError, stackError] = recordDiagnosticEvent.mock.calls.map(([event]) => event);
        expect(warning.source).toBe(`LoggerDiagnostics.test.js:${Number(warnLine) + 1}`);
        expect(stacklessError.source).toMatch(/^LoggerDiagnostics\.test\.js:\d+$/);
        expect(stackError.source).toBe("");
        expect(stackError.stack).toContain("LoggerDiagnostics.test.js");
        expect(JSON.stringify(recordDiagnosticEvent.mock.calls)).not.toMatch(/Kitchen|Bedroom|Private label|Logger\.js/);
    });

    test("finds the first stack frame outside the logger", () => {
        const appRoot = require("node:path").resolve(__dirname);
        const stack = [
            "Error",
            `    at Logger._recordDiagnosticEvent (${appRoot}/lib/Logger.js:10:5)`,
            `    at Logger.warn (${appRoot}/lib/Logger.js:20:5)`,
            "    at /app/drivers/logic-device/driver.js:273:38",
        ].join("\n");

        expect(Logger._findCallerLocation(stack)).toBe("driver.js:273");
        expect(Logger._findCallerLocation(stack.replace("/app/drivers", `${appRoot}/drivers`)))
            .toBe("drivers/logic-device/driver.js:273");
        expect(Logger._findCallerLocation([
            "Error",
            "    at Object.<anonymous> (/app/node_modules/homey-api/lib/Util.js:5:1)",
        ].join("\n"))).toBe("node_modules/homey-api/lib/Util.js:5");
        expect(Logger._findCallerLocation("Error\n    at async Promise.all (index 0)")).toBe("");
    });
});
