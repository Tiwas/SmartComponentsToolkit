const {
  applyMathOperator,
  compareNumbers,
  evaluateNumericComparison,
  mapGradient,
  roundToStep,
  toFiniteNumber,
} = require("./lib/NumericComparison");

describe("NumericComparison", () => {
  describe("toFiniteNumber", () => {
    test("accepts numbers and numeric strings", () => {
      expect(toFiniteNumber(12.5, "Value")).toBe(12.5);
      expect(toFiniteNumber("12.5", "Value")).toBe(12.5);
      expect(toFiniteNumber("12,5", "Value")).toBe(12.5);
    });

    test("rejects invalid numbers", () => {
      expect(() => toFiniteNumber("abc", "Value")).toThrow(
        "Value must be a valid number",
      );
      expect(() => toFiniteNumber(Infinity, "Value")).toThrow(
        "Value must be a valid number",
      );
    });
  });

  describe("applyMathOperator", () => {
    test("calculates supported operations", () => {
      expect(applyMathOperator(10, "add", 3)).toBe(13);
      expect(applyMathOperator(10, "subtract", 3)).toBe(7);
      expect(applyMathOperator(10, "multiply", 3)).toBe(30);
      expect(applyMathOperator(10, "divide", 2)).toBe(5);
    });

    test("accepts Homey dropdown objects", () => {
      expect(applyMathOperator(10, { id: "add" }, 3)).toBe(13);
    });

    test("rejects division by zero and unknown operators", () => {
      expect(() => applyMathOperator(10, "divide", 0)).toThrow(
        "Cannot divide by zero",
      );
      expect(() => applyMathOperator(10, "mod", 3)).toThrow(
        "Unsupported math operator: mod",
      );
    });
  });

  describe("compareNumbers", () => {
    test("compares supported operators", () => {
      expect(compareNumbers(13, "gt", 12)).toBe(true);
      expect(compareNumbers(13, "gte", 13)).toBe(true);
      expect(compareNumbers(13, "lt", 14)).toBe(true);
      expect(compareNumbers(13, "lte", 13)).toBe(true);
      expect(compareNumbers(13, "eq", 13)).toBe(true);
      expect(compareNumbers(13, "neq", 14)).toBe(true);
    });

    test("accepts symbolic operators", () => {
      expect(compareNumbers(13, ">", 12)).toBe(true);
      expect(compareNumbers(13, "<=", 13)).toBe(true);
      expect(compareNumbers(13, "!=", 12)).toBe(true);
    });
  });

  describe("evaluateNumericComparison", () => {
    test("evaluates a calculated comparison", () => {
      expect(
        evaluateNumericComparison({
          leftValue: 20,
          mathOperator: "add",
          operandValue: 3,
          comparisonOperator: "lt",
          rightValue: 25,
        }),
      ).toEqual({
        calculatedValue: 23,
        rightValue: 25,
        result: true,
      });
    });
  });

  describe("mapGradient", () => {
    test("maps an input range to an output range", () => {
      expect(
        mapGradient({
          inputValue: 20.5,
          fromNum: 18,
          toNum: 23,
          fromOut: 100,
          toOut: 500,
        }),
      ).toEqual({
        inputValue: 20.5,
        outputValue: 300,
        ratio: 0.5,
      });
    });

    test("applies offsets to input range endpoints", () => {
      expect(
        mapGradient({
          inputValue: 20.5,
          fromNum: 15,
          fromNumOffset: 3,
          toNum: 26,
          toNumOffset: -3,
          fromOut: 100,
          toOut: 500,
        }),
      ).toEqual({
        inputValue: 20.5,
        outputValue: 300,
        ratio: 0.5,
      });
    });

    test("rounds output to whole numbers by default", () => {
      expect(
        mapGradient({
          inputValue: 1,
          fromNum: 0,
          toNum: 1,
          fromOut: 0,
          toOut: 469.99999999999994,
        }).outputValue,
      ).toBe(470);
    });

    test("rounds output to the configured step", () => {
      expect(
        mapGradient({
          inputValue: 12.346,
          fromNum: 0,
          toNum: 100,
          fromOut: 0,
          toOut: 100,
          roundTo: 0.05,
        }).outputValue,
      ).toBe(12.35);
    });

    test("clamps below and above the input range", () => {
      expect(
        mapGradient({
          inputValue: 17,
          fromNum: 18,
          toNum: 23,
          fromOut: 100,
          toOut: 500,
        }).outputValue,
      ).toBe(100);

      expect(
        mapGradient({
          inputValue: 24,
          fromNum: 18,
          toNum: 23,
          fromOut: 100,
          toOut: 500,
        }).outputValue,
      ).toBe(500);
    });

    test("supports reversed ranges", () => {
      expect(
        mapGradient({
          inputValue: 20.5,
          fromNum: 23,
          toNum: 18,
          fromOut: 100,
          toOut: 500,
        }).outputValue,
      ).toBe(300);
    });

    test("rejects zero-width input ranges", () => {
      expect(() =>
        mapGradient({
          inputValue: 20,
          fromNum: 18,
          toNum: 18,
          fromOut: 100,
          toOut: 500,
        }),
      ).toThrow("Input range cannot have identical from/to values");
    });

    test("rejects invalid rounding steps", () => {
      expect(() =>
        mapGradient({
          inputValue: 20,
          fromNum: 18,
          toNum: 23,
          fromOut: 100,
          toOut: 500,
          roundTo: 0,
        }),
      ).toThrow("Round to must be greater than zero");
    });
  });

  describe("roundToStep", () => {
    test("rounds to arbitrary positive steps", () => {
      expect(roundToStep(469.99999999999994, 1)).toBe(470);
      expect(roundToStep(12.346, 0.05)).toBe(12.35);
      expect(roundToStep(12.34, 0.1)).toBe(12.3);
      expect(roundToStep(46, 15.3)).toBe(45.9);
    });
  });
});
