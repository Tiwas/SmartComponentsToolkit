'use strict';

const BaseLogicDriver = require('../../lib/BaseLogicDriver');

/**
 * LogicUnit2Driver - Driver for Logic Unit devices with 2 inputs
 *
 * A concrete implementation of BaseLogicDriver. The numInputs (2) is
 * automatically determined from the driver ID "logic-unit-2" by the
 * base class.
 *
 * Called by:
 *   - Homey runtime - Driver lifecycle management
 *   - Device pairing - Via inherited onPair from BaseLogicDriver
 *
 * Calls:
 *   - BaseLogicDriver (all methods inherited)
 *
 * @class LogicUnit2Driver
 * @extends BaseLogicDriver
 */
module.exports = class LogicUnit2Driver extends BaseLogicDriver {
  // Everything else is inherited
};
