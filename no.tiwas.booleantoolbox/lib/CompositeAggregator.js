"use strict";

/**
 * CompositeAggregator - Pure aggregation helpers for Composite Device.
 *
 * Values are aggregated according to the source capability type. Time-of-day
 * strings use circular arithmetic, so values on either side of midnight are
 * handled as neighbouring times rather than values twelve hours apart.
 *
 * Called by:
 *   - drivers/composite-device/driver.js - Validate pairing choices and build output metadata
 *   - drivers/composite-device/device.js - Recalculate the live composite value
 *   - CompositeAggregator.test.js - Verify aggregation behaviour
 *
 * Calls:
 *   - parseTimeOfDay() - Convert clock strings to seconds since midnight
 *   - formatTimeOfDay() - Convert aggregated clock seconds back to text
 */

class CompositeAggregationError extends Error {
  /**
   * Create an aggregation error with a stable machine-readable code.
   *
   * @param {string} code - Stable error identifier.
   * @param {string} message - Human-readable error message.
   * @returns {CompositeAggregationError} Aggregation error instance.
   */
  constructor(code, message) {
    super(message);
    this.name = "CompositeAggregationError";
    this.code = code;
  }
}

const OPERATION_DEFINITIONS = {
  number: [
    {
      id: "average",
      label: "Average",
      description: "Arithmetic mean of all available values.",
    },
    {
      id: "min",
      label: "Minimum",
      description: "Lowest available value.",
    },
    {
      id: "max",
      label: "Maximum",
      description: "Highest available value.",
    },
    {
      id: "sum",
      label: "Sum",
      description: "Total of all available values.",
    },
    {
      id: "median",
      label: "Median",
      description: "Middle value, resistant to individual outliers.",
    },
  ],
  boolean: [
    {
      id: "max",
      label: "Any / Maximum",
      description: "On when at least one source is on, for example any contact alarm.",
    },
    {
      id: "min",
      label: "All / Minimum",
      description: "On only when every available source is on.",
    },
    {
      id: "majority",
      label: "Majority",
      description: "On when more than half of the available sources are on.",
    },
    {
      id: "count_true",
      label: "Count On",
      description: "Number of available sources that are on.",
    },
    {
      id: "percentage_true",
      label: "Percentage On",
      description: "Percentage of available sources that are on.",
    },
  ],
  string: [
    {
      id: "mode",
      label: "Most Common",
      description: "Value reported by the largest number of sources.",
    },
    {
      id: "min",
      label: "Minimum / Earliest",
      description: "Alphabetically lowest value, or earliest clock value.",
    },
    {
      id: "max",
      label: "Maximum / Latest",
      description: "Alphabetically highest value, or latest clock value.",
    },
    {
      id: "newest",
      label: "Most Recently Updated",
      description: "Value from the source with the newest update timestamp.",
    },
    {
      id: "average_time",
      label: "Average Clock Time",
      description: "Circular average of HH:mm or HH:mm:ss values across midnight.",
    },
  ],
};

/**
 * Normalize Homey enum capabilities to the string aggregation family.
 *
 * @param {string} sourceType - Homey capability type.
 * @returns {string} Supported aggregation family.
 */
function normalizeSourceType(sourceType) {
  return sourceType === "enum" ? "string" : sourceType;
}

/**
 * Return supported operation metadata for a capability type.
 *
 * @param {string} sourceType - Homey capability type.
 * @returns {Array<object>} Operation definitions.
 */
function getOperationsForType(sourceType) {
  const normalizedType = normalizeSourceType(sourceType);
  return (OPERATION_DEFINITIONS[normalizedType] || []).map(operation => ({
    ...operation,
  }));
}

/**
 * Check whether an operation is valid for a capability type.
 *
 * @param {string} sourceType - Homey capability type.
 * @param {string} operation - Operation identifier.
 * @returns {boolean} True when the combination is supported.
 */
function isOperationSupported(sourceType, operation) {
  return getOperationsForType(sourceType).some(candidate => candidate.id === operation);
}

/**
 * Parse a 24-hour clock value.
 *
 * @param {unknown} value - Candidate HH:mm or HH:mm:ss value.
 * @returns {{seconds: number, includeSeconds: boolean}|null} Parsed value or null.
 */
function parseTimeOfDay(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  return {
    seconds: (hours * 3600) + (minutes * 60) + seconds,
    includeSeconds: match[3] !== undefined,
  };
}

/**
 * Format seconds since midnight as a 24-hour clock value.
 *
 * @param {number} seconds - Seconds since midnight.
 * @param {boolean} includeSeconds - Whether seconds should be included.
 * @returns {string} HH:mm or HH:mm:ss value.
 */
function formatTimeOfDay(seconds, includeSeconds) {
  const daySeconds = 24 * 60 * 60;
  const rounded = includeSeconds
    ? Math.round(seconds)
    : Math.round(seconds / 60) * 60;
  const normalized = ((rounded % daySeconds) + daySeconds) % daySeconds;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remainingSeconds = normalized % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return includeSeconds
    ? `${base}:${String(remainingSeconds).padStart(2, "0")}`
    : base;
}

/**
 * Select values that match the configured source type.
 *
 * @param {Array<object>} entries - Source value entries.
 * @param {string} sourceType - Homey capability type.
 * @returns {Array<object>} Entries with valid values.
 */
function getValidEntries(entries, sourceType) {
  const normalizedType = normalizeSourceType(sourceType);
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    if (!entry || entry.value === null || entry.value === undefined) return false;
    if (normalizedType === "number") {
      return typeof entry.value === "number" && Number.isFinite(entry.value);
    }
    if (normalizedType === "boolean") return typeof entry.value === "boolean";
    if (normalizedType === "string") return typeof entry.value === "string";
    return false;
  });
}

/**
 * Aggregate numeric entries.
 *
 * @param {Array<object>} entries - Valid numeric entries.
 * @param {string} operation - Numeric operation identifier.
 * @returns {number} Aggregated number.
 */
function aggregateNumbers(entries, operation) {
  const values = entries.map(entry => entry.value);
  if (operation === "average") {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  if (operation === "min") return Math.min(...values);
  if (operation === "max") return Math.max(...values);
  if (operation === "sum") return values.reduce((total, value) => total + value, 0);
  if (operation === "median") {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  throw new CompositeAggregationError(
    "UNSUPPORTED_OPERATION",
    `Unsupported number operation: ${operation}`,
  );
}

/**
 * Aggregate boolean entries.
 *
 * @param {Array<object>} entries - Valid boolean entries.
 * @param {string} operation - Boolean operation identifier.
 * @returns {boolean|number} Aggregated alarm or count value.
 */
function aggregateBooleans(entries, operation) {
  const values = entries.map(entry => entry.value);
  const trueCount = values.filter(Boolean).length;
  if (operation === "max") return trueCount > 0;
  if (operation === "min") return trueCount === values.length;
  if (operation === "majority") return trueCount > values.length / 2;
  if (operation === "count_true") return trueCount;
  if (operation === "percentage_true") return (trueCount / values.length) * 100;
  throw new CompositeAggregationError(
    "UNSUPPORTED_OPERATION",
    `Unsupported boolean operation: ${operation}`,
  );
}

/**
 * Aggregate time strings with circular clock arithmetic.
 *
 * @param {Array<object>} entries - Valid string entries.
 * @returns {string} Circular average clock time.
 */
function aggregateAverageTime(entries) {
  const parsed = entries.map(entry => parseTimeOfDay(entry.value));
  if (parsed.some(value => value === null)) {
    throw new CompositeAggregationError(
      "INVALID_TIME_VALUE",
      "Average Clock Time requires every available value to use HH:mm or HH:mm:ss.",
    );
  }

  const daySeconds = 24 * 60 * 60;
  let x = 0;
  let y = 0;
  parsed.forEach(value => {
    const angle = (value.seconds / daySeconds) * Math.PI * 2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  });

  if (Math.hypot(x, y) < 1e-9) {
    throw new CompositeAggregationError(
      "AMBIGUOUS_TIME_AVERAGE",
      "The selected clock values have no single circular average.",
    );
  }

  let angle = Math.atan2(y, x);
  if (angle < 0) angle += Math.PI * 2;
  const seconds = (angle / (Math.PI * 2)) * daySeconds;
  return formatTimeOfDay(seconds, parsed.some(value => value.includeSeconds));
}

/**
 * Compare two strings as clock values when possible, otherwise alphabetically.
 *
 * @param {string} left - Left value.
 * @param {string} right - Right value.
 * @returns {number} Negative, zero, or positive comparison result.
 */
function compareStrings(left, right) {
  const leftTime = parseTimeOfDay(left);
  const rightTime = parseTimeOfDay(right);
  if (leftTime && rightTime) return leftTime.seconds - rightTime.seconds;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Aggregate string or enum entries.
 *
 * @param {Array<object>} entries - Valid string entries.
 * @param {string} operation - String operation identifier.
 * @returns {string} Aggregated text.
 */
function aggregateStrings(entries, operation) {
  if (operation === "average_time") return aggregateAverageTime(entries);
  if (operation === "min") {
    return entries.map(entry => entry.value).reduce((best, value) => (
      compareStrings(value, best) < 0 ? value : best
    ));
  }
  if (operation === "max") {
    return entries.map(entry => entry.value).reduce((best, value) => (
      compareStrings(value, best) > 0 ? value : best
    ));
  }
  if (operation === "newest") {
    return entries.reduce((best, entry) => {
      const bestUpdatedAt = Number(best.updatedAt) || 0;
      const entryUpdatedAt = Number(entry.updatedAt) || 0;
      return entryUpdatedAt >= bestUpdatedAt ? entry : best;
    }).value;
  }
  if (operation === "mode") {
    const frequencies = new Map();
    entries.forEach((entry, index) => {
      const current = frequencies.get(entry.value) || {
        count: 0,
        newest: 0,
        firstIndex: index,
      };
      current.count += 1;
      current.newest = Math.max(current.newest, Number(entry.updatedAt) || 0);
      frequencies.set(entry.value, current);
    });

    return [...frequencies.entries()]
      .sort((left, right) => (
        right[1].count - left[1].count
        || right[1].newest - left[1].newest
        || left[1].firstIndex - right[1].firstIndex
      ))[0][0];
  }
  throw new CompositeAggregationError(
    "UNSUPPORTED_OPERATION",
    `Unsupported string operation: ${operation}`,
  );
}

/**
 * Aggregate source values and report how many valid sources contributed.
 *
 * @param {Array<object>} entries - Objects containing value and optional updatedAt.
 * @param {string} sourceType - Homey capability type.
 * @param {string} operation - Operation identifier.
 * @returns {{value: boolean|number|string, count: number}} Aggregated result.
 */
function aggregateEntries(entries, sourceType, operation) {
  const normalizedType = normalizeSourceType(sourceType);
  if (!isOperationSupported(normalizedType, operation)) {
    throw new CompositeAggregationError(
      "UNSUPPORTED_OPERATION",
      `Operation '${operation}' is not supported for ${sourceType} values.`,
    );
  }

  const validEntries = getValidEntries(entries, normalizedType);
  if (validEntries.length === 0) {
    throw new CompositeAggregationError(
      "NO_VALID_VALUES",
      "No selected source currently has a valid value.",
    );
  }

  let value;
  if (normalizedType === "number") value = aggregateNumbers(validEntries, operation);
  else if (normalizedType === "boolean") value = aggregateBooleans(validEntries, operation);
  else value = aggregateStrings(validEntries, operation);

  return {
    value,
    count: validEntries.length,
  };
}

/**
 * Determine the Composite Device output capability and display properties.
 *
 * @param {string} sourceType - Homey capability type.
 * @param {string} operation - Operation identifier.
 * @param {object} sourceMetadata - Source title, units, and decimals.
 * @returns {object} Output capability metadata.
 */
function getOutputSpec(sourceType, operation, sourceMetadata = {}) {
  const normalizedType = normalizeSourceType(sourceType);
  if (!isOperationSupported(normalizedType, operation)) {
    throw new CompositeAggregationError(
      "UNSUPPORTED_OPERATION",
      `Operation '${operation}' is not supported for ${sourceType} values.`,
    );
  }

  const operationDefinition = getOperationsForType(normalizedType)
    .find(candidate => candidate.id === operation);
  const sourceTitle = sourceMetadata.title || sourceMetadata.capabilityId || "Value";
  const title = `${operationDefinition.label} ${sourceTitle}`;

  if (normalizedType === "boolean" && ["max", "min", "majority"].includes(operation)) {
    return {
      capabilityId: "alarm_composite",
      outputType: "boolean",
      title,
      units: "",
      decimals: 0,
    };
  }

  if (normalizedType === "number" || normalizedType === "boolean") {
    const percentage = operation === "percentage_true";
    const count = operation === "count_true";
    return {
      capabilityId: "measure_composite",
      outputType: "number",
      title,
      units: percentage ? "%" : (count ? "" : (sourceMetadata.units || "")),
      decimals: percentage ? 1 : (count ? 0 : Number(sourceMetadata.decimals) || 0),
    };
  }

  return {
    capabilityId: "composite_text",
    outputType: "string",
    title,
    units: "",
    decimals: 0,
  };
}

module.exports = {
  CompositeAggregationError,
  aggregateEntries,
  formatTimeOfDay,
  getOperationsForType,
  getOutputSpec,
  isOperationSupported,
  normalizeSourceType,
  parseTimeOfDay,
};
