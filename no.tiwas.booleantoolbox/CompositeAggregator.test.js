"use strict";

const {
  CompositeAggregationError,
  aggregateEntries,
  getOperationsForType,
  getOutputSpec,
  parseTimeOfDay,
} = require("./lib/CompositeAggregator");

describe("CompositeAggregator", () => {
  describe("numeric values", () => {
    const entries = [
      { value: 40 },
      { value: 55 },
      { value: 70 },
      { value: null },
      { value: Number.NaN },
    ];

    test.each([
      ["average", 55],
      ["min", 40],
      ["max", 70],
      ["sum", 165],
      ["median", 55],
    ])("calculates %s", (operation, expected) => {
      expect(aggregateEntries(entries, "number", operation)).toEqual({
        value: expected,
        count: 3,
      });
    });

    test("calculates the median for an even number of values", () => {
      expect(aggregateEntries([
        { value: 10 },
        { value: 20 },
        { value: 30 },
        { value: 100 },
      ], "number", "median").value).toBe(25);
    });
  });

  describe("boolean values", () => {
    const entries = [
      { value: false },
      { value: true },
      { value: true },
      { value: null },
    ];

    test("maps maximum to any active alarm", () => {
      expect(aggregateEntries(entries, "boolean", "max")).toEqual({
        value: true,
        count: 3,
      });
    });

    test("maps minimum to all active alarms", () => {
      expect(aggregateEntries(entries, "boolean", "min").value).toBe(false);
    });

    test("calculates majority, count, and percentage", () => {
      expect(aggregateEntries(entries, "boolean", "majority").value).toBe(true);
      expect(aggregateEntries(entries, "boolean", "count_true").value).toBe(2);
      expect(aggregateEntries(entries, "boolean", "percentage_true").value)
        .toBeCloseTo(66.6666667);
    });
  });

  describe("clock and text values", () => {
    test("averages clock times across midnight", () => {
      const result = aggregateEntries([
        { value: "23:00" },
        { value: "01:00" },
      ], "string", "average_time");
      expect(result).toEqual({ value: "00:00", count: 2 });
    });

    test("preserves seconds when any source includes seconds", () => {
      const result = aggregateEntries([
        { value: "10:00:10" },
        { value: "10:00:20" },
      ], "string", "average_time");
      expect(result.value).toBe("10:00:15");
    });

    test("uses clock order for min and max", () => {
      const entries = [{ value: "23:30" }, { value: "01:15" }];
      expect(aggregateEntries(entries, "string", "min").value).toBe("01:15");
      expect(aggregateEntries(entries, "string", "max").value).toBe("23:30");
    });

    test("selects the mode and resolves ties by newest update", () => {
      const entries = [
        { value: "home", updatedAt: 100 },
        { value: "away", updatedAt: 300 },
      ];
      expect(aggregateEntries(entries, "enum", "mode").value).toBe("away");
    });

    test("selects the newest source value", () => {
      const entries = [
        { value: "old", updatedAt: 100 },
        { value: "new", updatedAt: 200 },
      ];
      expect(aggregateEntries(entries, "string", "newest").value).toBe("new");
    });

    test("rejects invalid time strings", () => {
      expect(() => aggregateEntries([
        { value: "10:30" },
        { value: "not a time" },
      ], "string", "average_time")).toThrow(CompositeAggregationError);
    });

    test("rejects an undefined circular average", () => {
      expect(() => aggregateEntries([
        { value: "06:00" },
        { value: "18:00" },
      ], "string", "average_time")).toThrow("no single circular average");
    });

    test("parses valid 24-hour values only", () => {
      expect(parseTimeOfDay("07:05")).toEqual({ seconds: 25500, includeSeconds: false });
      expect(parseTimeOfDay("23:59:10")).toEqual({ seconds: 86350, includeSeconds: true });
      expect(parseTimeOfDay("24:00")).toBeNull();
    });
  });

  describe("metadata and validation", () => {
    test("exposes type-specific operation lists", () => {
      expect(getOperationsForType("number").map(operation => operation.id))
        .toEqual(["average", "min", "max", "sum", "median"]);
      expect(getOperationsForType("enum").map(operation => operation.id))
        .toContain("average_time");
    });

    test("preserves numeric source units in the output", () => {
      expect(getOutputSpec("number", "max", {
        title: "Humidity",
        units: "%",
        decimals: 1,
      })).toMatchObject({
        capabilityId: "measure_composite",
        outputType: "number",
        title: "Maximum Humidity",
        units: "%",
        decimals: 1,
      });
    });

    test("uses an alarm output for boolean max", () => {
      expect(getOutputSpec("boolean", "max", { title: "Contact Alarm" }))
        .toMatchObject({ capabilityId: "alarm_composite", outputType: "boolean" });
    });

    test("reports missing valid values", () => {
      expect(() => aggregateEntries([{ value: null }], "number", "average"))
        .toThrow("No selected source");
    });

    test("reports unsupported operations", () => {
      expect(() => aggregateEntries([{ value: 1 }], "number", "mode"))
        .toThrow("not supported");
    });
  });
});
