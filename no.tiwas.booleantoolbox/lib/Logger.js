"use strict";

/**
 * Advanced Logger for Homey Apps
 *
 * Provides configurable logging with multiple log levels, category filtering,
 * emoji symbols for visual distinction, and support for localized messages.
 * Configuration is loaded from loggerConfig.js or uses sensible defaults.
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR, NONE
 * - Category-based filtering (e.g., "App", "Device:LogicUnit")
 * - Visual symbols for different log types
 * - Timer functionality for performance measurement
 * - Localization support via Homey's __() function
 * - Variable substitution in messages
 *
 * Called by:
 *   - app.js - Creates main app logger
 *   - BaseLogicUnit.js - Creates device-specific loggers
 *   - BaseLogicDriver.js - Creates driver-specific loggers
 *   - All driver files - Create category-specific loggers
 *   - WaiterManager.js - Logging waiter operations
 *   - CapturedStateManager.js - Logging state operations
 *
 * @class Logger
 */
class Logger {
  /**
   * Log level constants mapping level names to numeric priorities.
   * Lower numbers mean more verbose logging.
   * @static
   * @type {Object<string, number>}
   */
  static LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  };

  /**
   * Emoji symbols used as visual prefixes for different log types.
   * @static
   * @type {Object<string, string>}
   */
  static SYMBOLS = {
    DEBUG: "🔍",
    INFO: "✅",
    WARN: "⚠️",
    ERROR: "❌",
    TIMER: "⏱️",
    FORMULA: "📐",
    INPUT: "📥",
    OUTPUT: "📤",
    DEVICE: "🔌",
    API: "🌐",
    FLOW: "🔄",
  };

  /** @static @private */
  static _globalConfig = null;

  /**
   * Gets the default configuration, loading from loggerConfig.js if available.
   *
   * Uses a static cache to avoid re-reading the config file on every Logger instantiation.
   * Falls back to DEBUG level if config file is not found.
   *
   * @private
   * @static
   * @returns {{config: Object, source: string}} Configuration object and its source
   *
   * Called by:
   *   - Logger.constructor() - When creating new Logger instances
   *
   * Calls:
   *   - require('./loggerConfig') - Loads external configuration
   */
  static _getDefaultConfig() {
    // Use cache if available
    if (Logger._globalConfig) {
      return Logger._globalConfig;
    }

    try {
      const config = require("./loggerConfig");
      Logger._globalConfig = { config: config, source: "custom" };
      return Logger._globalConfig;
    } catch (e) {
      const defaultConfig = {
        defaultLevel: "DEBUG", // ENDRET: Fallback til DEBUG
        categoryLevels: {},
        options: {},
      };
      // --- FIKS: Returner samme objektform som i 'try' ---
      Logger._globalConfig = { config: defaultConfig, source: "default" };
      return Logger._globalConfig;
      // --- SLUTT FIKS ---
    }
  }

  /**
   * Creates a new Logger instance.
   *
   * Automatically detects the Homey object from the context (App or Device),
   * loads configuration from loggerConfig.js, and sets up the log level
   * based on priority: options > categoryLevels > defaultLevel.
   *
   * @param {Object} context - The Homey App or Device instance
   * @param {string} [category="App"] - Category name for log filtering and display
   * @param {Object} [options={}] - Override options
   * @param {string} [options.level] - Override log level (DEBUG, INFO, WARN, ERROR, NONE)
   * @param {boolean} [options.timestamps] - Include timestamps in output
   * @param {boolean} [options.colors] - Use colored output (if supported)
   *
   * Called by:
   *   - app.js onInit() - Creates main application logger
   *   - BaseLogicUnit.onInit() - Creates device loggers
   *   - BaseLogicDriver.onInit() - Creates driver loggers
   *   - Logger.child() - Creates sub-category loggers
   *
   * Calls:
   *   - Logger._getDefaultConfig() - Loads configuration
   */
  constructor(context, category = "App", options = {}) {
    // Find the actual homey object whether 'context' is App or Device
    if (context && context.homey) {
      this.homey = context.homey;
    } else if (context && context.app && context.app.homey) {
      // Fallback
      this.homey = context.app.homey;
    } else {
      console.error(
        `Logger: Could not find 'homey' object on context for category '${category}'.`,
      );
      // Oppretter en dummy for å unngå krasj
      this.homey = {
        app: { log: console.log, error: console.error },
        __: (s) => s, // Returnerer bare nøkkelen
      };
    }
    // --- SLUTT FIKS ---

    this.context = context;
    this.category = category;

    // Load global config
    const { config: globalConfig, source: configSource } =
      Logger._getDefaultConfig();
    this.configSource = configSource; // Lagrer kilden for bruk i banner()

    // Determine log level (priority: options > categoryLevels > defaultLevel)
    let level = options.level;
    if (!level && globalConfig.categoryLevels[category]) {
      level = globalConfig.categoryLevels[category];
    }
    if (!level) {
      level = globalConfig.defaultLevel || "DEBUG"; // ENDRET: Fallback til DEBUG
    }

    this.options = {
      level: level.toUpperCase(),
      timestamps:
        options.timestamps || globalConfig.options.timestamps || false,
      colors: options.colors || globalConfig.options.colors || false,
    }; // --- FIKS: Manglende } lagt til ---

    // --- FIKS: Korrekt sjekk for 0 (DEBUG) ---
    if (Logger.LEVELS[this.options.level] !== undefined) {
      this.minLevel = Logger.LEVELS[this.options.level];
    } else {
      this.minLevel = Logger.LEVELS.DEBUG; // Fallback
    }
    // --- SLUTT FIKS ---

    this.timers = new Map();
  }

  /**
   * Dynamically changes the log level at runtime.
   *
   * @param {string} level - New log level (DEBUG, INFO, WARN, ERROR, NONE)
   *
   * Called by:
   *   - External code when log level needs to change dynamically
   *
   * Calls:
   *   - (none)
   */
  setLevel(level) {
    const upperLevel = level.toUpperCase();
    if (Logger.LEVELS[upperLevel] !== undefined) {
      this.minLevel = Logger.LEVELS[upperLevel];
      this.options.level = upperLevel;
    }
  }

  /**
   * Returns the current log level as a string.
   *
   * @returns {string} Current log level (DEBUG, INFO, WARN, ERROR, NONE)
   *
   * Called by:
   *   - External code for log level inspection
   *
   * Calls:
   *   - (none)
   */
  getLevel() {
    return this.options.level;
  }

  /**
   * Checks if a message at the given level should be logged.
   *
   * @private
   * @param {string} level - The log level to check
   * @returns {boolean} True if the message should be logged
   *
   * Called by:
   *   - Logger._log() - Before outputting messages
   *   - Logger._logError() - Before outputting errors
   *   - Logger.timeStart/timeEnd() - Before timing output
   *   - Logger.dump() - Before dumping objects
   *   - Logger.separator() - Before drawing separators
   *   - Logger.banner() - Before displaying banners
   *
   * Calls:
   *   - (none)
   */
  _shouldLog(level) {
    return Logger.LEVELS[level] >= this.minLevel;
  }

  /**
   * Builds the log message prefix with symbol and category.
   *
   * @private
   * @param {string} symbol - Emoji symbol for this log type
   * @returns {string} Formatted prefix like "🔍 [App]"
   *
   * Called by:
   *   - Logger._log() - For standard log messages
   *   - Logger._logError() - For error messages
   *
   * Calls:
   *   - (none)
   */
  _getPrefix(symbol) {
    return `${symbol} [${this.category}]`;
  }

  /**
   * Formats a message with optional localization and variable substitution.
   *
   * Attempts to translate keys that look like locale keys (contain dots),
   * then performs manual variable substitution for {placeholder} patterns.
   *
   * @private
   * @param {string} keyOrMessage - Message string or locale key
   * @param {Object} [data] - Data object for variable substitution
   * @returns {string} Formatted message string
   *
   * Called by:
   *   - Logger._log() - For standard messages
   *   - Logger._logError() - For error messages
   *
   * Calls:
   *   - this.homey.__() - For localization (if available)
   */
  _formatMessage(keyOrMessage, data) {
    let message = keyOrMessage; // Start with the original key/message

    // 1. Attempt Translation IF it looks like a key and __ exists
    if (
      typeof keyOrMessage === "string" &&
      keyOrMessage.includes(".") &&
      this.homey &&
      typeof this.homey.__ === "function"
    ) {
      try {
        const translated = this.homey.__(keyOrMessage, data);
        // Use translation ONLY if it's a non-empty string and DIFFERENT from the key
        if (
          typeof translated === "string" &&
          translated.trim() !== "" &&
          translated !== keyOrMessage
        ) {
          message = translated;
        }
        // If translated is null, undefined, empty, or same as key, 'message' remains keyOrMessage
      } catch (e) {
        // If translation throws error, 'message' remains keyOrMessage
        // console.error(`Logger: Error during this.homey.__ for key '${keyOrMessage}'. Using key.`, e);
      }
    }

    // 2. Ensure 'message' is now DEFINITELY a string (fallback if translation failed badly)
    let messageStr = String(message ?? keyOrMessage); // Use keyOrMessage if message became null/undefined

    // 3. Perform Manual Substitution on the resulting string
    if (data && typeof data === "object" && data !== null) {
      try {
        messageStr = messageStr.replace(/\{([^{}]+)\}/g, (match, key) => {
          // Use value from data if exists and is not null/undefined, otherwise keep placeholder
          return data.hasOwnProperty(key) &&
            data[key] !== null &&
            data[key] !== undefined
            ? String(data[key]) // Ensure replacement is a string
            : match;
        });
      } catch (e) {
        console.error(
          `Logger: Manual substitution failed for: "${messageStr}"`,
          e,
        );
        // messageStr remains as it was before substitution attempt
      }
    }

    // Return the final string
    return messageStr;
  }

  /**
   * Internal method that outputs a log message at the specified level.
   *
   * Formats the message with level prefix, symbol, category, and content,
   * then outputs via Homey's app.log() with fallback to console.log().
   *
   * @private
   * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
   * @param {string} symbol - Emoji symbol for this message type
   * @param {string} keyOrMessage - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Logger.debug() - DEBUG level messages
   *   - Logger.info() - INFO level messages
   *   - Logger.warn() - WARN level messages
   *   - Logger.formula() - Formula-related debug messages
   *   - Logger.input() - Input-related debug messages
   *   - Logger.output() - Output-related debug messages
   *   - Logger.device() - Device-related debug messages
   *   - Logger.api() - API-related debug messages
   *   - Logger.flow() - Flow-related debug messages
   *   - Logger.timeStart/timeEnd() - Timer messages
   *   - Logger.dump() - Object dump messages
   *   - Logger.separator() - Separator lines
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._getPrefix() - Build prefix
   *   - Logger._formatMessage() - Format message content
   *   - this.homey.app.log() - Homey logging API
   */
  _log(level, symbol, keyOrMessage, data) {
    if (!this._shouldLog(level)) {
      return;
    }

    const levelString = `[${level.padEnd(5)}]`;
    const prefix = this._getPrefix(symbol);
    const formattedMessage = this._formatMessage(keyOrMessage, data);

    try {
      this.homey.app.log(levelString, prefix, formattedMessage);
    } catch (error) {
      console.error("Logger internal error:", error);
      console.log(levelString, prefix, formattedMessage);
    }
  }

  /**
   * Internal method for logging error messages with optional Error objects.
   *
   * Handles both string messages with data substitution and actual Error objects
   * (logging stack traces). Uses Homey's app.error() for output.
   *
   * @private
   * @param {string} keyOrMessage - Error message or locale key
   * @param {Error|Object} [error] - Error object (logs stack) or data object
   *
   * Called by:
   *   - Logger.error() - Public error logging method
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._getPrefix() - Build prefix
   *   - Logger._formatMessage() - Format message content
   *   - this.homey.app.error() - Homey error logging API
   */
  _logError(keyOrMessage, error) {
    if (!this._shouldLog("ERROR")) {
      return;
    }

    // --- FIKS: Log-nivå lagt til ---
    const levelString = `[${"ERROR".padEnd(5)}]`;

    const prefix = this._getPrefix(Logger.SYMBOLS.ERROR);

    // Data-objektet kan være gjemt i 'error' hvis det ikke er en ekte Error
    let data = error instanceof Error ? null : error;
    const formattedMessage = this._formatMessage(keyOrMessage, data);

    try {
      // --- FIKS: Flyttet levelString FØRST ---
      this.homey.app.error(levelString, prefix, formattedMessage);
      if (error instanceof Error) {
        this.homey.app.error(error); // Logg stack trace hvis det er en Error
      } else if (data) {
        // Hvis 'error' bare var data, er den allerede i formattedMessage
      }
    } catch (err) {
      console.error("Logger internal error (error):", err);
      console.error(levelString, prefix, formattedMessage);
      if (error) {
        console.error(error);
      }
    }
  }

  /**
   * Logs a DEBUG level message with the debug symbol (🔍).
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Throughout codebase for detailed debugging information
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  debug(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.DEBUG, message, data);
  }

  /**
   * Logs an INFO level message with the info symbol (✅).
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Throughout codebase for important status information
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  info(message, data) {
    this._log("INFO", Logger.SYMBOLS.INFO, message, data);
  }

  /**
   * Logs a WARN level message with the warning symbol (⚠️).
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Throughout codebase for warning conditions
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  warn(message, data) {
    this._log("WARN", Logger.SYMBOLS.WARN, message, data);
  }

  /**
   * Logs an ERROR level message with the error symbol (❌).
   *
   * @param {string} message - Message or locale key
   * @param {Error|Object} [error] - Error object or data for substitution
   *
   * Called by:
   *   - Throughout codebase for error conditions
   *
   * Calls:
   *   - Logger._logError() - Internal error logging method
   */
  error(message, error) {
    this._logError(message, error);
  }

  /**
   * Logs a DEBUG level message with the formula symbol (📐).
   * Used for formula evaluation related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - BaseLogicUnit.evaluateFormula() - Formula evaluation logging
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  formula(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.FORMULA, message, data);
  }

  /**
   * Logs a DEBUG level message with the input symbol (📥).
   * Used for input-related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - BaseLogicUnit - When inputs are set or changed
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  input(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.INPUT, message, data);
  }

  /**
   * Logs a DEBUG level message with the output symbol (📤).
   * Used for output-related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - BaseLogicUnit - When formula results change
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  output(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.OUTPUT, message, data);
  }

  /**
   * Logs a DEBUG level message with the device symbol (🔌).
   * Used for device-related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Device classes - For device lifecycle events
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  device(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.DEVICE, message, data);
  }

  /**
   * Logs a DEBUG level message with the API symbol (🌐).
   * Used for API-related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - app.js - For API endpoint logging
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  api(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.API, message, data);
  }

  /**
   * Logs a DEBUG level message with the flow symbol (🔄).
   * Used for flow card related messages.
   *
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Flow card handlers in app.js and drivers
   *
   * Calls:
   *   - Logger._log() - Internal logging method
   */
  flow(message, data) {
    this._log("DEBUG", Logger.SYMBOLS.FLOW, message, data);
  }

  /**
   * Starts a named timer for performance measurement.
   *
   * @param {string} label - Unique label for this timer
   *
   * Called by:
   *   - Performance measurement code
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._log() - Output start message
   */
  timeStart(label) {
    this.timers.set(label, Date.now());
    if (this._shouldLog("DEBUG")) {
      this._log("DEBUG", Logger.SYMBOLS.TIMER, `Timer started: ${label}`);
    }
  }

  /**
   * Ends a named timer and logs the elapsed time.
   *
   * @param {string} label - Label of the timer to end
   * @returns {number} Elapsed time in milliseconds, or 0 if timer not found
   *
   * Called by:
   *   - Performance measurement code
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._log() - Output duration message
   *   - Logger.warn() - If timer wasn't started
   */
  timeEnd(label) {
    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer '${label}' was not started`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);

    if (this._shouldLog("DEBUG")) {
      this._log(
        "DEBUG",
        Logger.SYMBOLS.TIMER,
        `Timer '${label}': ${duration}ms`,
      );
    }

    return duration;
  }

  /**
   * Dumps an object as formatted JSON for debugging.
   *
   * @param {string} label - Label describing the object
   * @param {Object} object - Object to dump
   *
   * Called by:
   *   - Debug code for inspecting complex objects
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._log() - Output the dump
   */
  dump(label, object) {
    if (!this._shouldLog("DEBUG")) {
      return;
    }

    try {
      const formatted = JSON.stringify(object, null, 2);
      this._log("DEBUG", Logger.SYMBOLS.DEBUG, `${label}:\n${formatted}`);
    } catch (error) {
      this._log("DEBUG", Logger.SYMBOLS.DEBUG, `${label}:`, object);
    }
  }

  /**
   * Logs a message only once per key (per Logger instance lifetime).
   *
   * Useful for warnings that shouldn't spam the log on repeated occurrences.
   *
   * @param {string} key - Unique key to identify this message
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Message or locale key
   * @param {Object} [data] - Data for variable substitution
   *
   * Called by:
   *   - Code that needs to warn once about a condition
   *
   * Calls:
   *   - Logger[level]() - Appropriate log method based on level
   */
  once(key, level, message, data) {
    if (!this._onceKeys) {
      this._onceKeys = new Set();
    }

    if (this._onceKeys.has(key)) {
      return;
    }

    this._onceKeys.add(key);
    const method = level.toLowerCase();
    if (typeof this[method] === "function") {
      this[method](message, data);
    } else {
      console.warn(
        `Logger: Invalid level "${level}" provided to 'once' method.`,
      );
    }
  }

  /**
   * Creates a child logger with a sub-category appended to the current category.
   *
   * Example: If parent is "App", child("Flow") creates "App:Flow"
   *
   * @param {string} subCategory - Sub-category name to append
   * @returns {Logger} New Logger instance with combined category
   *
   * Called by:
   *   - Code that needs more specific category filtering
   *
   * Calls:
   *   - Logger.constructor() - Creates new Logger instance
   */
  child(subCategory) {
    return new Logger(
      this.context,
      `${this.category}:${subCategory}`,
      this.options,
    );
  }

  /**
   * Logs a visual separator line for log organization.
   *
   * Called by:
   *   - Code that wants to visually separate log sections
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - Logger._log() - Output the separator
   */
  separator() {
    if (this._shouldLog("DEBUG")) {
      this._log("DEBUG", "", "─".repeat(50));
    }
  }

  /**
   * Logs a prominent banner message with decorative borders.
   *
   * Used for startup messages and major state changes.
   * Also logs configuration source on first call.
   *
   * @param {string} message - Banner message text
   *
   * Called by:
   *   - app.js onInit() - Application startup banner
   *
   * Calls:
   *   - Logger._shouldLog() - Check if should output
   *   - this.homey.app.log() - Direct Homey logging
   */
  banner(message) {
    if (this._shouldLog("INFO")) {
      const line = "═".repeat(message.length + 4);
      // Banner kaller logg-funksjonen direkte for å unngå prefiks
      try {
        this.homey.app.log(line);
        this.homey.app.log(`  ${message}  `);
        this.homey.app.log(line);

        // --- FIKS: Bruker this.homey.app.log direkte ---
        // _log() feilet fordi this.homey.__() ikke var klar for strenger
        // som ikke var locale-nøkler på dette tidlige stadiet.
        if (this.configSource) {
          const configMessage =
            this.configSource === "custom"
              ? "Loaded custom configuration from ./loggerConfig.js"
              : "Using default log settings (./loggerConfig.js not found)";

          // Logger med [INFO] og 🔍-symbolet, som du foreslo
          // Bruker this.homey.app.log direkte for å unngå _formatMessage-feil
          this.homey.app.log(
            `[INFO ] ${Logger.SYMBOLS.DEBUG} [${this.category}]`,
            configMessage,
          );

          // Nullstill, så den ikke logger dette igjen hvis banner() kalles på nytt
          this.configSource = null;
        }
        // --- SLUTT FIKS ---
      } catch (e) {
        console.log(line);
        console.log(`  ${message}  `);
        console.log(line);
      }
    }
  }
}

module.exports = Logger;