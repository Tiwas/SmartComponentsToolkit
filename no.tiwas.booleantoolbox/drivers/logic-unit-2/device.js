'use strict';

const BaseLogicUnit = require('../../lib/BaseLogicUnit');

/**
 * LogicUnit2Device - Logic Unit device with 2 boolean inputs (A, B)
 *
 * A concrete implementation of BaseLogicUnit configured for 2 inputs.
 * All functionality is inherited from BaseLogicUnit.
 *
 * Called by:
 *   - Homey runtime - Device lifecycle management
 *   - Flow cards - Via inherited handlers from BaseLogicUnit
 *
 * Calls:
 *   - BaseLogicUnit (all methods inherited)
 *
 * @class LogicUnit2Device
 * @extends BaseLogicUnit
 */
module.exports = class LogicUnit2Device extends BaseLogicUnit {
  // Everything else is inherited from BaseLogicUnit
  // Methods can be overridden here if necessary
};
