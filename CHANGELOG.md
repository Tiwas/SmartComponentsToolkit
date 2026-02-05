# Changelog

All notable changes to Smart (Components) Toolkit for Homey will be documented in this file.

> **Note:** This app was previously known as "Boolean Toolbox" until v1.7.0.

---

## [1.9.2] - February 2026 (Current)

### 🐛 Bug Fixes
- Fixed conditional gate condition cards to correctly return boolean values
- Fixed dropdown argument extraction for gate state and modify cards
- Improved gate state handling in WaiterManager

---

## [1.9.1] - January 2026

### 🐛 Bug Fixes
- Minor fixes

---

## [1.9.0] - January 2026

### ✨ New Features
- **Conditional Gates** - Simple GO/NO GO flow control without needing variables or devices
  - Gate is GO/NO GO condition card - instant state check
  - Conditional Gate: Wait for GO - pause flow until gate opens (with timeout)
  - Modify Conditional Gate action - set GO, NO GO, or Toggle
  - Gates persist in memory until explicitly changed
  - Named gates for easy management across flows

---

## [1.8.2] - December 2025

### 🐛 Bug Fixes
- Fixed some errors with IDs in waiter gates

---

## [1.8.1] - December 2025

### 🐛 Bug Fixes
- Bug fix + better hints

---

## [1.8.0] - December 2025

### 📦 Name Change & Scene Functionality
- Name change from "Boolean Toolbox" to "Smart (Components) Toolkit"
- Scene functionality live

### 📦 Device Types Overview
- **Logic Device** - Boolean logic with visual pairing wizard
- **Logic Unit** - Advanced boolean logic with multiple formulas per device
- **State Device** - Scene management with predefined states
- **State Capture Device** - Dynamic state capture at runtime
- **Waiter Gates** - Flow control that pauses and waits for device states to change

### 🔗 Documentation
- Full documentation available at: https://tiwas.github.io/SmartComponentsToolkit/
- GitHub repository renamed from HomeyBooleanToolbox to SmartComponentsToolkit

---

## [1.7.0] - December 2025

### 🎨 Rebranding
- **App renamed from "Boolean Toolbox" to "Smart (Components) Toolkit"**
  - The app has grown beyond just boolean logic to include state management, scene control, and flow utilities
  - App ID remains `no.tiwas.booleantoolbox` for compatibility with existing installations
  - All existing devices and flows continue to work without changes

### ✨ New Features
- State Capture Device improvements
- Updated app store images and branding

---

## [1.5.0] - November 2025

### ✨ New Features
- **Waiter Gates (BETA)** - Reactive flow cards that pause flows and wait for device capability changes
  - Wait until device capability becomes value (condition card with YES/NO paths)
  - Control waiter gate (enable/disable/stop by ID)
  - Auto-generate waiter IDs when not specified
  - Immediate resolution if value already matches
- **Wait action card** - Simple delay without device monitoring (BONUS feature)

### 🌍 Localization
- Complete translation coverage for all flow cards
- 12 languages supported: English, Norwegian, Danish, German, Spanish, French, Italian, Dutch, Swedish, Polish, Finnish, Russian

### 🔧 Improvements
- Reduced logging verbosity (13 statements changed from info to debug)
- Code quality improvements:
  - Translated Norwegian comments to English
  - Removed unnecessary comments
  - Improved code documentation

---

## [1.2.0] - 2025

### ✨ New Features
- **Logic Device** - New device type with completely redesigned pairing experience
  - Visual setup wizard with zone/room selection
  - Browse devices by location
  - Direct device linking during pairing
  - One-click configuration
- **Dynamic Input Capacity** - Devices automatically expand from 2-10 inputs based on formula requirements
- **JSON Auto-Formatting** - Automatic beautification of JSON in settings fields

### 🔧 Improvements
- Event-driven architecture (removed polling)
- "State changed" trigger with state token (Logic Device only)
- Better initial value detection
- Shared base classes for maintainability

### 📚 Documentation
- Enhanced documentation with interactive tools
- Updated examples and use cases

---

## [1.1.1] - 2025

### 🌍 Localization
- Added machine-generated translations for multiple languages

### 📚 Documentation
- Documentation improvements and clarifications

---

## [1.1.0] - 2025

### ✨ New Features
- **Isolated Input States Per Formula** - Each formula maintains its own input states
- **First Impression Mode** - Lock inputs at first received value
- **Timeout Detection** - Formulas can timeout if inputs not received within specified time
- **Manual Re-evaluation Actions** - Force formula re-evaluation via flow cards

### ⚠️ Breaking Changes
- Flow cards structure changed
- **Recommendation:** Create new devices for smooth transition

---

## [1.0.0] - 2025

### ✨ New Features
- Support for up to 10 inputs (A-J)
- Advanced flow cards for formula control
- Multiple formulas per Logic Unit

### 🔧 Improvements
- Enhanced expression parser
- Better error handling

---

## [0.7.0] - 2025

### 🐛 Bug Fixes
- Major stability improvements
- Fixed critical issues affecting reliability

---

## [0.5.1] - 2025

### 🎨 Visual Improvements
- UI/UX enhancements
- Better visual feedback

---

## [0.5.0] - 2025

### 🎉 Initial Release
- Logic Units (2-10 inputs) with boolean logic
- Basic flow cards (triggers, conditions, actions)
- Formula configuration via JSON
- Support for AND, OR, XOR, NOT operators
- Interactive Boolean Logic Emulator tool
- Formula Builder tool

---

## Version Notes

### Deprecated Features
- **Logic Unit X (2, 3, 4...10 inputs)** - Legacy devices with fixed input counts
  - Still functional but no longer recommended
  - Use new Logic Unit or Logic Device instead for dynamic input expansion

### Migration Guide

**From Logic Unit X to Logic Unit/Logic Device:**
1. Create new Logic Unit or Logic Device
2. Copy formula JSON from old device settings
3. Configure input links (Logic Device) or use manual JSON (Logic Unit)
4. Test formulas work as expected
5. Update flows to use new device
6. Remove old device once verified

**From v1.0.0 to v1.1.0:**
- Flow card structure changed - recommended to create new devices
- Input states are now isolated per formula
- Update flows to use new flow card structure

---

## Roadmap (Future Considerations)

- Improvements based on user feedback
- Enhanced error reporting
- Performance optimizations
- More interactive documentation

---

## Support

- **Forum:** [Homey Community](https://community.homey.app/t/app-boolean-toolbox-create-advanced-logic-with-simple-formulas/143906)
- **Issues:** [GitHub Issues](https://github.com/Tiwas/SmartComponentsToolkit/issues)
- **Source:** [GitHub Repository](https://github.com/Tiwas/SmartComponentsToolkit)

---

**Note:** This changelog follows [Keep a Changelog](https://keepachangelog.com/) principles.
