# Worklog

## 2026-08-11 — Composite Device and Logic Unit documentation

### Requested
- Add a universal Homey device that combines the same capability from multiple devices.
- Support humidity min/max and broader numeric, boolean/alarm, text, enum, and clock-time use cases.
- Verify and improve the published Logic Unit usage documentation.
- Create the Composite Device image assets and publish the app.

### Implemented
- Added the `composite-device` driver with a visual capability, operation, source-device, and name pairing page.
- Added `CompositeAggregator.js` with numeric average/min/max/sum/median; boolean any/all/majority/count/percentage; text/enum mode/min/max/newest; and circular average clock time.
- Added dynamic numeric, alarm, and text capabilities plus realtime source listeners, partial-source error reporting, periodic reconnection, and listener cleanup.
- Added unit/device/driver tests and retained the pending Logic Device restart and Circadian Light Group member-verification fixes already present in the worktree.
- Added a Composite Device guide, updated the device overview and README, and added existing Logic Unit settings/Flow screenshots to the published documentation.
- Reworked the supplied Composite Device raster into a transparent master and derived 500 × 500 and 75 × 75 Homey assets; verified the enclosed background gaps between pins are transparent.

### Verification
- `npm test -- --runInBand`: 7 suites, 133 tests passed.
- `homey app validate`: passed at publish level.
- `homey app run --remote`: installed and initialized successfully on the configured Homey Pro; the Composite Device driver initialized without errors.

### Release
- Published Homey Build 49 as version 1.10.20 in the test channel.
- Installed version 1.10.20 on the configured Homey Pro after the remote development run.
- Committed the implementation and documentation for GitHub publication.

## 2026-08-11 — Composite Device listing and small image refresh

### Requested
- Replace the generated Composite Device small asset with the supplied final `small.png`.
- Publish a new Homey test version and update GitHub, the community listing source, and online documentation.

### Implemented
- Replaced the 75 × 75 Composite Device driver image with the supplied final image.
- Replaced the partial Homey Store README with a complete overview of all current and legacy devices plus every standalone Flow-card family.
- Added Composite Device to the Homey Store description and updated the community listing source.
- Updated the README, changelog, Composite Device guide, device overview, and version badges for v1.10.21.

### Verification
- `npm test -- --runInBand`: 7 suites, 133 tests passed.
- `homey app validate`: passed at publish level after the final Store README update.
- Source and runtime `small.png` files have identical SHA-256 hashes and are 75 × 75 RGBA PNGs.
- Changed documentation pages passed local-link checks and all edited JSON files parsed successfully.

### Release
- Uploaded Homey Build 50 as v1.10.21 and published it to the test channel.
- Confirmed in Homey Developer Tools that the test submission contains the complete Store README and updated Composite Device image.
- Installed v1.10.21 successfully on the configured Homey Pro.
- Prepared the v1.10.21 release commit with the documentation, community listing source, and image assets required for GitHub Pages.

## 2026-08-11 — Composite Device value-change Flow triggers

### Requested
- Add a Composite Device trigger that fires whenever the exposed value changes.
- Add a second trigger that fires only when a numeric change is larger than a user-selected fixed or percentage threshold.

### Implemented
- Added the device trigger `composite_value_changed` for numeric, boolean/alarm, and text/clock outputs, with current value, previous value, value type, and device-name tags.
- Added `composite_value_changed_larger_than` for numeric Composite Devices, with per-Flow fixed-unit or percentage thresholds and current, previous, signed-change, absolute-change, and percentage-change tags.
- Suppressed both triggers for the first successful aggregate after app/device startup so initialization only establishes the comparison baseline.
- Defined percentage change against the absolute previous value; zero-to-nonzero transitions are represented as 100%, and thresholds compare consecutive values rather than accumulating smaller changes.
- Isolated Flow trigger failures from aggregate capability updates and source-error reporting.
- Updated the Composite Device guide, Flow-card reference, project documentation, Store README, root README, and changelog.

### Verification
- `npm test -- --runInBand`: 7 suites, 136 tests passed.
- `homey app validate`: passed at publish level with both new trigger cards included.
- JavaScript syntax, Flow-card JSON parsing, local documentation links, and `git diff --check` passed.

### Release
- Implemented and validated locally; no new version was published in this session.

## 2026-08-11 — Composite Device trigger release v1.10.22

### Requested
- Publish the Composite Device value-change triggers as a new Homey test version and install it locally.
- Update `HOMEY_COMMUNITY_LISTING.md`, push the release to GitHub, and leave `main` in the merged release state.

### Implemented
- Versioned the app and documentation as v1.10.22 and added the two new Composite Device triggers to the app changelog.
- Updated the community listing source, Store README, root README, device guide, Flow-card reference, and version labels for the test release.

### Verification
- `npm test -- --runInBand`: 7 suites, 136 tests passed.
- Homey publish validation passed and included both Composite Device trigger cards.
- Homey Developer Tools confirmed Build 51 as v1.10.22 with the updated changelog and Store README.

### Release
- Uploaded Homey Build 51 as v1.10.22 and published it to the test channel.
- Installed v1.10.22 successfully on `Lars's New Homey` after debug-level validation.
- Prepared the v1.10.22 source, documentation, and community listing update for the GitHub release commit.

## 2026-08-12 — Logic Unit generic-alarm trigger diagnosis

### Requested
- Determine whether a Logic Unit using `A+B` should trigger Homey's generic-alarm-turned-on card after an input is set to TRUE, or whether the wrong Flow card was used.

### Findings
- Confirmed that `+` is a supported OR operator, so either A or B being TRUE makes `A+B` TRUE once both required inputs have values.
- Confirmed that the current Logic Unit evaluator stores the formula result but never writes the aggregate result to `alarm_generic`; even the aggregate state calculated during full reevaluation is unused.
- Confirmed that published documentation defines `alarm_generic` as the formula result and that the older backup implementation updated it, identifying this as a Logic Unit regression rather than user misuse.
- Found a second inconsistency in the formula-specific trigger path: the evaluator triggers undeclared device-card IDs while the registered combined card has a different app-trigger ID. It should therefore not be presented as a reliable workaround until fixed.
- The generic alarm card should work according to the exposed capability contract; for multiple formulas, its intended state is the aggregate OR result (TRUE when any enabled formula is TRUE).

### Verification
- `npm test -- --runTestsByPath FormulaEvaluator.test.js --runInBand`: 1 suite, 52 tests passed, including `A + B` tokenization and evaluation coverage.
- No production code was changed during this diagnostic session.

## 2026-08-12 — Logic Unit formula-change Flow cards and alarm fix

### Requested
- Add a new **Formula changed to...** card and repair the **Formula changed** behavior.

### Implemented
- Added a formula-specific **Formula changed** trigger for every TRUE/FALSE transition and repaired **Formula changed to...** with correct device-trigger registration, formula matching, and result filtering.
- Added current and previous boolean result tokens to both cards.
- Restored the original pre-Compose TRUE/FALSE trigger IDs as deprecated compatibility cards and retained the newer deprecated aliases.
- Synchronized `alarm_generic` with the aggregate Logic Unit result, defined as TRUE whenever any enabled formula is TRUE, so Homey's standard alarm turned on/off cards work again.
- Renamed the Dynamic Logic Unit capability from the generic Homey label to **Formula result** and updated Flow-card/device documentation.

### Verification
- Added Logic Unit regression tests covering `A+B`, aggregate alarm behavior, trigger payloads, selected-formula filtering, and TRUE/FALSE result filtering.
- Focused test run: 2 suites and 55 tests passed.
- Full test run: 8 suites and 139 tests passed.
- All changed Flow-card and driver Compose JSON parsed successfully; changed JavaScript files passed `node --check`.
- `homey app validate` passed at publish level with both current cards and all compatibility IDs included for every Logic Unit driver.

## 2026-08-12 — Logic Unit fix release v1.10.23

### Requested
- Publish and install the Logic Unit fix, update GitHub, and update the existing Homey Community topic.

### Implemented
- Versioned the Homey app and release documentation as v1.10.23.
- Added the Logic Unit alarm and formula-trigger fixes to the Homey changelog, repository changelog, README, documentation version badges, and community-listing source.

### Verification
- `npm test -- --runInBand`: 8 suites, 139 tests passed.
- `homey app validate`: passed at publish level.
- Homey Developer Tools confirmed Build 52 as v1.10.23 and showed both `Formula changed` and `Formula changed to...` in the submitted manifest.

### Release
- Uploaded Homey Build 52 and published v1.10.23 to the test channel.
- Installed the app successfully on `Lars's New Homey` with `homey app install`.
- Updated and verified the existing Homey Community topic with the v1.10.23 title and release notes.
