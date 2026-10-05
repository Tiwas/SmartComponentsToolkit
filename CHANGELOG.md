# Changelog

All notable changes to Smart (Components) Toolkit for Homey will be documented in this file.

> **Note:** This app was previously known as "Boolean Toolbox" until v1.7.0.

---

## [1.10.34] - October 2026 (Test channel)

### Changed
- Waiter Gates: when a new wait takes over a Waiter ID that is already waiting, the app log now says so ([#69](https://github.com/Tiwas/SmartComponentsToolkit/pull/69)). The earlier wait still ends on its NO path, as documented in the [Waiter Gates guide](https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html). Waits inside a card no longer read a Flow id that Homey never supplies; a fixed context now tells them apart from background waits. Nothing changes in your Flows.

## [1.10.33] - October 2026 (Test channel)

### Added
- New Advanced Flow card *Get the name of [this Flow]* ([#66](https://github.com/Tiwas/SmartComponentsToolkit/pull/66)). It returns the name, id and folder of the Flow it is in as tags, plus *Has error* (yes/no) and *Error message* tags, for example to show in notifications and logs which Flow sent them. Click the field and pick *this Flow* once. The name is read each time the card runs, so it follows a rename. A copied card or duplicated Flow gives *[Duplicate]* in *Flow name* until you pick *this Flow* again in the copy, and a Flow that is not saved yet gives *[Unknown – save the Flow]*. In those cases *Has error* is yes, so a Logic condition can branch. The card and its messages are translated into all 11 app languages. See the [Flow card reference](https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html#action-flow-name).
- The stable and test badges in the README and on the documentation site now read the versions from the Homey App Store, so they no longer go stale.

## [1.10.32] - September 2026 (Test channel)

### Fixed
- Circadian Light Group: the schedule follows the Homey's time zone ([#53](https://github.com/Tiwas/SmartComponentsToolkit/pull/53)). Homey runs apps on UTC, so clock-time anchors, lux-anchor crossings and *Pause until time* ran 1–2 hours late (2 hours in Norwegian summer time), and mornings stayed dim and red. If you moved your anchors earlier to compensate, move them back.
- Circadian Light Group: the astronomical outdoor-light estimate (the default outdoor source, also the base for MET.no) follows the real sun at the Homey's location ([#53](https://github.com/Tiwas/SmartComponentsToolkit/pull/53)). It was up to an hour off in Norway and several hours off in the Americas.
- Circadian Light Group pairing and Repair editors keep lux anchors instead of turning them back into clock times ([#54](https://github.com/Tiwas/SmartComponentsToolkit/pull/54)). A saved lux sensor that is missing from the sensor list (deleted, or not loaded yet) shows as *Unknown sensor* and is kept on save instead of being cleared ([#55](https://github.com/Tiwas/SmartComponentsToolkit/pull/55)).

### Added
- Optional morning profile for Circadian Light Groups ([#53](https://github.com/Tiwas/SmartComponentsToolkit/pull/53)): tick *Own morning profile* under Repair → Light Profile to give mornings their own brightness and colour temperature. It applies from the Morning anchor and fades into Day. It is off by default, so existing groups behave exactly as before. With it on, *Is in phase* and *Phase changed* also use a Morning phase.

### Changed
- Removed the homey-api subscription wrapper added in 1.10.30. It has been inactive since homey-api 3.20.0 (1.10.31), so behaviour does not change ([#52](https://github.com/Tiwas/SmartComponentsToolkit/pull/52)).

### Known issues
- On the update day only, a lux crossing already stored with the old UTC date and minutes can be ignored or read up to 2 hours early.

## [1.10.31] - September 2026 (Test channel)

### Changed
- Updated the Homey Web API library (`homey-api`) from 3.17.0 to 3.20.0 ([#50](https://github.com/Tiwas/SmartComponentsToolkit/pull/50)). It shares one realtime subscription per device and restores subscriptions automatically after a connection drop, so Logic Devices, Circadian Light Groups and capability waiters keep receiving device changes after network hiccups. The app's own subscription safeguard from 1.10.30 stays in place as a fallback and switches off automatically on this library version.

### Verified
- Live-tested on a Homey Pro (Early 2023): Logic Devices, Circadian Light Group "All on" from all-off and after "All on (flood)", Conditional Gate and capability background waits beyond 60 seconds, and the in-card 55-second limit.

## [1.10.30] - September 2026 (Test channel)

### Fixed
- App restarts and Logic Devices that randomly stopped reacting ([#44](https://github.com/Tiwas/SmartComponentsToolkit/issues/44)). Realtime device subscriptions are now shared per device: the periodic Logic Device link health check no longer leaks memory with every refresh, and one listener finishing (a waiter, a reconfigured Logic Device or a Circadian watcher) no longer silently stops updates for every other listener on the same device. The health check also replays values it missed.
- `Conditional Gate: Wait for GO` and `Wait until device capability becomes value` failed with `Timeout after 60000ms` for timeouts above one minute ([#46](https://github.com/Tiwas/SmartComponentsToolkit/issues/46)). Homey stops every app Flow card after ~60 seconds; these cards now end with a clear message at 55 seconds, and the timeout counts from the moment the card starts.
- Mutually linked Logic Devices can no longer re-trigger each other when their result does not change.
- A formula with a timeout but no expression could crash the app from the one-second timeout check.
- Removed a stale Logic Device condition registration that logged an error on every start, and the deprecated `driverUri` reads that flooded the Homey log.

### Added
- **Long waits:** new actions *Start waiting for Conditional Gate GO* and *Start waiting until device capability becomes value* return immediately and wait in the background (minutes or hours). The new triggers *Conditional Gate wait finished* and *Capability wait finished* continue the Flow with `opened`/`matched`, `result` and `waited_seconds` tokens. See the [Conditional Gates](https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html) and [Waiter Gates](https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html) guides.
- **Diagnostics:** warnings show the code location they come from, memory is sampled every 15 minutes, and a previous session that ended without a clean shutdown is reported. App driver ids are no longer redacted.

### Changed
- Re-starting a waiter ID that is still waiting now sends the previous card run through its NO path instead of leaving it hanging.
- Disabled waiters stay waiting as documented; timeouts, matching values and gate changes are completed when the waiter is re-enabled.
- New *Conditional Gate: Wait for GO* cards default to a 30-second timeout. The *Wait* action rejects durations above 55 seconds; use Homey's built-in Flow delay for longer pauses.

## [1.10.29] - September 2026 (Test channel)

### Fixed
- Diagnostic reports no longer fail when Homey cannot expose process memory or another resource metric. Unavailable CPU, memory, and storage values are now reported as unavailable while the rest of the report is preserved.

## [1.10.28] - September 2026 (Test channel)

### Added
- App Settings can now generate a privacy-conscious diagnostic report and open a new GitHub issue with the report prefilled.
- Reports include app version and uptime, recent persisted warnings/errors with stack traces, anonymous app-device counts, Circadian Light Group member/scheduler load, and available app/Homey CPU, memory, and storage data.

### Changed
- The startup banner now uses the manifest version, keeping runtime diagnostics aligned with the installed app version.

## [1.10.27] - September 2026 (Test channel)

### Fixed
- Logic Device now serializes formula evaluations and discards stale results, preventing bursts of linked-device updates from leaving the device on an old result.

### Changed
- Reduced routine Logic Unit logging so normal device updates do not flood the app log.
- The packaged app now excludes development material and validates manifest assets before release.

## [1.10.26] - September 2026 (Test channel)

### Fixed
- Linked-input listeners recover safely when Homey reconnects or a replacement listener fails, without dropping the last working listener.

## [1.10.25] - September 2026 (Test channel)

### Fixed
- Circadian Light Group Collection Flow cards now stay pending until every member-group operation, retry and verification has finished, so downstream Advanced Flow cards run in the intended order.
- Simultaneous Collection operations are serialized with pause/resume ahead of on/off.
- Collection pause changes now cascade to every member Circadian Light Group from both Flow cards and the device capability.

### Tests
- Added regression coverage for awaited Collection fan-out, pause/resume priority, queue recovery and pause propagation.

## [1.10.24] - August 2026 (Test channel)

### Fixed
- Circadian Light Group now waits for a member light to acknowledge that it is on before applying dim and colour targets, making activation from an all-off state converge to the same result as activation from already-on lights.
- Intentional member turn-on remains valid through short off/on settling bounces, while an explicit off immediately cancels that allowance.
- Scheduler profile updates are deferred while an explicit member on/off command is being verified, and superseded commands stop between individual capability writes.
- Circadian Light Group Collection no longer runs a duplicate scheduler or performs a second profile apply during resume; member groups retain their own schedulers.

### Tests
- Added regression coverage for collection timer duplication, resume duplication, scheduler/command overlap, member settling bounces, explicit-off precedence, and per-capability cancellation.

## [1.10.23] - August 2026 (Test channel)

### Added
- Added a Logic Unit **Formula changed** trigger for every TRUE/FALSE transition, with current and previous result tags.
- Added a working **Formula changed to...** trigger filtered by selected formula and TRUE/FALSE result.

### Fixed
- Logic Unit now synchronizes its read-only **Formula result** (`alarm_generic`) alarm with the aggregate result, restoring Homey's standard alarm turned on/off triggers.
- Restored the original pre-Compose formula trigger IDs for existing flows and corrected current trigger registration and formula filtering.

---

## [1.10.22] - August 2026 (Test channel)

### Added
- Added a **Composite value changed** device trigger with current value, previous value, value type, and device-name tags.
- Added a numeric **Composite value changed by more than** trigger with fixed-unit or percentage thresholds plus signed, absolute, and percentage change tags.
- Composite change triggers ignore the initial aggregate after app/device startup and only fire for real subsequent changes.

---

## [1.10.21] - August 2026 (Test channel)

### Changed
- Expanded the Homey Store description with every current and legacy device plus all standalone Flow-card families.
- Refreshed the **Composite Device** small driver image.
- Updated the community listing and online documentation to identify Composite Device as available in test version 1.10.21.

---

## [1.10.20] - August 2026 (Test channel)

### Added
- Added **Composite Device**, a visual pairing wizard that combines the same capability from two or more Homey devices.
- Numeric aggregation supports average, minimum, maximum, sum, and median while preserving source units and precision.
- Boolean aggregation supports any/all, majority, count on, and percentage on; contact alarms can therefore be grouped without a separate Group app.
- Text and enum aggregation supports most common, min/max, newest, and circular average clock time across midnight.
- Added an illustrated Composite Device guide and screenshots explaining Logic Unit setup and Flow usage.

### Reliability
- Composite Device continues with available sources, exposes a Source Error alarm for partial failures, and reconnects sources periodically.
- Includes the pending v1.10.19 Logic Device restart and Circadian Light Group verification fixes.

---

## [1.10.16] - July 2026 (Test channel)

### Added
- Captures Homey device IDs and names in the app so [Flow Doctor](https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html) can resolve references to previously deleted devices.
- [Flow Doctor](https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html) now shows resolved device names, or `N/A (ID: ...)` when a deleted device was never captured.

---

## [1.10.0] - May 2026 (Test channel)

> Initial 1.10.x test-channel release.

### ✨ New Device: Circadian Light Group
A virtual light device that follows a circadian rhythm — adjusts dim and color temperature for a group of real lights based on time, sun position or ambient lux, with optional red mode at night.

- **Anchor modes (per phase)**: clock time, solar event (sunrise, sunset, civil/nautical/astronomical dawn/dusk, golden hour morning/evening, blue hour morning/evening, solar noon, solar midnight) with offset and polar fallback, or lux sensor crossing (rising/falling) with polar/cloudy fallback.
- **Light profile**: per-phase dim + temperature, smooth interpolation, red mode threshold (lower temperature → more saturated red on color-capable lights).
- **Outdoor source**: astronomical, Homey lux sensor, weather API (Open-Meteo, MET.no) or external value pushed via Flow.
- **Per-light settings**: enable, prewarm before on, allow red mode, min/max dim.
- **Form-based pair + repair**: full UI for schedule, profile, sensors and per-light tuning. JSON config kept available as advanced fallback.
- **Live tile**: dim/temperature on the device tile always reflects the calculated target, regardless of on/off or paused state.

### ✨ New Flow Cards
**Triggers**: phase changed, red mode started/ended, paused/resumed, turned on/off, target changed, error occurred, outdoor light requested. Plus app-level **Solar event occurred** with all 14 events and offset, usable from any flow.

**Conditions**: is in phase, red mode active, is paused, is on.

**Actions**: pause (with seconds/minutes/hours unit), pause until time, pause until solar event, resume, turn on/off/toggle, set red threshold, apply temporary state (dim/temp/saturation/force red — overwritten on next scheduler tick), force red mode (on/off/clear with optional duration), apply now, set outdoor lux.

---

## [1.9.2] - February 2026

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
