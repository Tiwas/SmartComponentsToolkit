# AI Assistant Instructions (robots.md)

This file contains instructions for AI assistants working on the Boolean Toolbox project.

## Core Principles

### 1. Code Compilation
**All code must compile before being presented as a solution.** Before presenting any code changes:
- Ensure syntax is correct
- Verify all imports/requires are valid
- Check that all referenced functions and variables exist
- Test that the code runs without errors where possible

### 2. Existing Code Preservation
**Existing code must not be modified** unless explicitly requested by the user. This includes:
- Function implementations
- Variable names
- File structure
- Comments and documentation (except when adding new documentation)

### 3. Breaking Changes
**Breaking changes must ALWAYS be avoided.** Where breaking changes are unavoidable:
- They must be thoroughly discussed with the user before being made
- This applies even when permission to write freely without code approval has been given
- Document all potential breaking changes clearly
- Propose migration strategies when applicable

## Documentation Maintenance

### Session Start Checklist
At the start of each session:
1. Review PROJECT_DOCUMENTATION.md to understand the project structure
2. Check if any new files have been added that need documentation
3. Verify the dependency map is still accurate

### Session End Checklist
At the end of each session where code changes were made:
1. Update function documentation (JSDoc comments) for any modified functions
2. Update "Called by:" and "Calls:" sections if call relationships changed
3. Update PROJECT_DOCUMENTATION.md if:
   - New files were added
   - File responsibilities changed
   - New dependencies were introduced
   - Architecture changed
4. Ensure all documentation is in English

### Documentation Format

#### Function Documentation
Use JSDoc-style comments before each function:

```javascript
/**
 * Brief description of what the function does.
 *
 * Detailed explanation if needed.
 *
 * @param {Type} paramName - Description of parameter
 * @returns {Type} Description of return value
 *
 * Called by:
 *   - functionName() in file.js - Context of call
 *   - anotherFunction() in other.js - Context of call
 *
 * Calls:
 *   - helperFunction() - Purpose of call
 *   - utilityMethod() - Purpose of call
 */
```

#### New Files
When creating new files:
1. Add file header with description
2. Add to PROJECT_DOCUMENTATION.md file list
3. Update dependency map
4. Document all exported functions/classes

## Code Quality Guidelines

### JavaScript/Node.js
- Use `"use strict";` at the top of all files
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable and function names
- Add error handling for async operations
- Use async/await over raw promises where possible

### Homey-Specific
- Always extend proper Homey base classes
- Use the Logger utility for consistent logging
- Register flow cards in the appropriate driver/app
- Handle device capability updates safely (use safeSetCapabilityValue pattern)
- Clean up intervals and listeners in onDeleted()

### Testing
- Ensure changes don't break existing tests
- Add tests for new functionality where applicable
- Test flow cards manually if automated tests aren't available

## Project-Specific Notes

### Formula Evaluation
- The FormulaEvaluator uses a secure AST-based approach
- NO use of `eval()` or `Function()` constructors
- All formula variables are namespaced per formula to prevent conflicts

### Device Types
- **Logic Unit**: Fixed number of boolean inputs, evaluates formulas
- **Logic Device**: Dynamic inputs linked to other device capabilities
- **State Capture Device**: Captures and restores device states
- **State Device**: Applies predefined state configurations

### Flow Card Registration
- Logic Unit cards are registered once by the first driver instance
- Use `BaseLogicDriver.logicUnitCardsRegistered` static flag to prevent duplicates
- App-level cards are registered in `app.js`

## Forbidden Actions

1. **Never use `eval()` or `new Function()`** for formula evaluation
2. **Never modify the FormulaEvaluator** security model without explicit approval
3. **Never hardcode API keys or secrets** in source files
4. **Never commit node_modules** or build artifacts
5. **Never remove error handling** without replacing it with better handling
6. **Never change public API signatures** without discussing breaking changes

## Contact and Resources

- **Project Repository**: This is a Homey app for the Athom Homey smart home hub
- **Homey SDK Documentation**: https://apps.developer.homey.app/
- **Issue Reporting**: Report issues to the project maintainer

---

*Last updated: December 2024*
*Documentation maintained by AI assistant according to project guidelines*
