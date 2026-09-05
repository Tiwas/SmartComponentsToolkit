'use strict';

/**
 * Global Logger Configuration for Boolean Toolbox
 *
 * This is the central configuration for all logging in the app.
 * Place this file in: lib/loggerConfig.js
 *
 * USAGE:
 * - Adjust `defaultLevel` to change the standard log level for all modules.
 * - Add specific class names to `categoryLevels` for finer control over individual modules.
 * - The Logger will automatically pick up this file if it exists.
 */
module.exports = {
  // Default log level for any logger not specified below.
  // Options: 'DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'
  defaultLevel: 'INFO',

  // Override log levels for specific categories (class names).
  // This helps in reducing noise or enabling detailed logs for specific parts of the app.
  categoryLevels: {
    // Example: Show detailed logging for a specific driver during debugging.
    // 'MyDeviceName': 'DEBUG',

    // Reduce noise from base classes which are generally stable.
    // 'BaseLogicDriver': 'INFO',
    // 'BaseLogicUnit': 'INFO',

    // Always show important app-level messages.
    // 'App': 'INFO',
  },

  // Global options (rarely needed).
  options: {
    timestamps: false, // Homey already adds timestamps to its logs.
    colors: false,     // Not supported in the Homey development console.
  },
};
