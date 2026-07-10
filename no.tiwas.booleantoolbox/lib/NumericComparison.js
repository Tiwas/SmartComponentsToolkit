"use strict";

const COMPARISON_EPSILON = 1e-9;

function getArgId(value) {
  if (value && typeof value === "object") {
    return value.id || value.value || value.name;
  }
  return value;
}

function toFiniteNumber(value, label) {
  const raw = getArgId(value);
  const normalized =
    typeof raw === "string" ? raw.trim().replace(",", ".") : raw;
  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a valid number`);
  }

  return number;
}

function toOptionalFiniteNumber(value, label, fallback = 0) {
  const raw = getArgId(value);

  if (raw === undefined || raw === null) {
    return fallback;
  }

  if (typeof raw === "string" && raw.trim() === "") {
    return fallback;
  }

  return toFiniteNumber(value, label);
}

function getDecimalPlaces(value) {
  const normalized = String(value).toLowerCase();
  const exponentMatch = normalized.match(/e-(\d+)$/);
  if (exponentMatch) {
    return Number(exponentMatch[1]);
  }

  const decimalPart = normalized.split(".")[1];
  return decimalPart ? decimalPart.length : 0;
}

function roundToStep(value, step) {
  const finiteValue = toFiniteNumber(value, "Output value");
  const finiteStep = toFiniteNumber(step, "Round to");

  if (finiteStep <= 0) {
    throw new Error("Round to must be greater than zero");
  }

  const rounded = Math.round(finiteValue / finiteStep) * finiteStep;
  const decimals = Math.min(12, getDecimalPlaces(finiteStep));
  return Number(rounded.toFixed(decimals));
}

function applyMathOperator(leftValue, operator, operandValue) {
  const left = toFiniteNumber(leftValue, "Left value");
  const operand = toFiniteNumber(operandValue, "Operand value");
  const op = String(getArgId(operator) || "").toLowerCase();

  switch (op) {
    case "add":
    case "+":
      return left + operand;
    case "subtract":
    case "-":
      return left - operand;
    case "multiply":
    case "*":
      return left * operand;
    case "divide":
    case "/":
      if (operand === 0) {
        throw new Error("Cannot divide by zero");
      }
      return left / operand;
    default:
      throw new Error(`Unsupported math operator: ${op}`);
  }
}

function compareNumbers(leftValue, operator, rightValue) {
  const left = toFiniteNumber(leftValue, "Calculated value");
  const right = toFiniteNumber(rightValue, "Right value");
  const op = String(getArgId(operator) || "").toLowerCase();

  switch (op) {
    case "gt":
    case ">":
      return left > right;
    case "gte":
    case ">=":
      return left >= right;
    case "lt":
    case "<":
      return left < right;
    case "lte":
    case "<=":
      return left <= right;
    case "eq":
    case "=":
    case "==":
      return Math.abs(left - right) <= COMPARISON_EPSILON;
    case "neq":
    case "!=":
      return Math.abs(left - right) > COMPARISON_EPSILON;
    default:
      throw new Error(`Unsupported comparison operator: ${op}`);
  }
}

function evaluateNumericComparison(args) {
  const calculatedValue = applyMathOperator(
    args.leftValue,
    args.mathOperator,
    args.operandValue,
  );
  const rightValue = toFiniteNumber(args.rightValue, "Right value");

  return {
    calculatedValue,
    rightValue,
    result: compareNumbers(
      calculatedValue,
      args.comparisonOperator,
      rightValue,
    ),
  };
}

function mapGradient(args) {
  const inputValue = toFiniteNumber(args.inputValue, "Input value");
  const fromNum = toFiniteNumber(args.fromNum, "From number");
  const toNum = toFiniteNumber(args.toNum, "To number");
  const fromNumOffset = toOptionalFiniteNumber(
    args.fromNumOffset,
    "From number offset",
  );
  const toNumOffset = toOptionalFiniteNumber(
    args.toNumOffset,
    "To number offset",
  );
  const fromOut = toFiniteNumber(args.fromOut, "From output");
  const toOut = toFiniteNumber(args.toOut, "To output");
  const roundTo = toOptionalFiniteNumber(args.roundTo, "Round to", 1);
  const effectiveFromNum = fromNum + fromNumOffset;
  const effectiveToNum = toNum + toNumOffset;

  if (effectiveFromNum === effectiveToNum) {
    throw new Error("Input range cannot have identical from/to values");
  }

  const rawRatio =
    (inputValue - effectiveFromNum) / (effectiveToNum - effectiveFromNum);
  const ratio = Math.min(1, Math.max(0, rawRatio));
  const outputValue = roundToStep(fromOut + ratio * (toOut - fromOut), roundTo);

  return {
    inputValue,
    outputValue,
    ratio,
  };
}

module.exports = {
  applyMathOperator,
  compareNumbers,
  evaluateNumericComparison,
  mapGradient,
  roundToStep,
  toFiniteNumber,
};
