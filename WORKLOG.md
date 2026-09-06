# Worklog

## 2026-09-06 — GitHub diagnostic reports and test release v1.10.28

### Requested
- Add a way for users to submit a diagnostic report directly to GitHub Issues.
- Include available device/app CPU, memory, storage and Circadian Light Group load information.
- Prepare a reviewed PR, merge it when green, upload a Homey test build, install it on the configured Homey, and update the Community post source.

### Implemented
- Added a private App Settings diagnostics endpoint and UI for generating, previewing, copying, and opening a prefilled GitHub issue without embedding GitHub credentials.
- Added bounded persistence of recent warnings/errors with stack traces and redaction of common device IDs, email/IP values, credentials, and long token-like values.
- Added anonymous per-driver device counts, configuration-alarm counts, Circadian Light Group member/watcher/update-interval details, process and Homey-reported memory, system load averages, app CPU metric, and Homey storage totals when exposed by the platform.
- Aligned the runtime startup banner and npm package metadata with Homey app version 1.10.28.
- Updated README, Store README, changelog, project documentation, and Homey Community post source.

### Verification
- JavaScript syntax and changed locale/manifest JSON parsing passed.
- `npm test -- --runInBand`: 18 suites and 206 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.51 MB) and all 17 manifest assets were verified.
- `homey app run --remote`: v1.10.28 initialized successfully with the correct version banner and remained running without an app restart during the smoke-test window.
- GitHub review, Homey upload/install, and final release result are recorded below when completed.

## 2026-09-05 — Test release v1.10.27

### Requested
- Publish the latest test version, update the Homey Community post, and install the newest version locally.

### Implemented
- Prepared the v1.10.27 release notes for serialized Logic Device evaluations, reduced Logic Unit logging, and the leaner validated app bundle.
- Updated the repository README, changelog, Homey changelog, and Community-listing source for the new test version.
- Uploaded Homey Build 56 as version 1.10.27; the user published it to the test channel.
- Posted the v1.10.27 release announcement to the existing Homey Community topic.

### Verification
- `npm test -- --runInBand`: 14 suites and 197 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 764 files (8.16 MB) and all 17 manifest assets were verified.
- `homey app install`: version 1.10.27 installed successfully on the configured Homey Pro.

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

## 2026-09-06 — 30-second restart/reset diagnosis

### Requested
- Investigate a user report that the app resets itself every 30 seconds by running the app remotely over time.
- Determine what diagnostics the user can submit and whether the app should expose stack traces or additional logs.

### Findings
- Ran `homey app run --remote` for approximately 5 minutes and 16 seconds. The app completed one initialization and remained running through more than ten reported 30-second windows without a restart, repeated `onInit`, unhandled rejection, fatal error, or memory/heap error.
- The only runtime errors were handled Homey API failures for unavailable Z-Wave devices (`TRANSMIT_COMPLETE_NO_ACK` and `This device is currently unavailable`) during Circadian Light Group updates. The retry path completed without terminating the app.
- Found a stronger explanation if "reset" means that light values are restored: Circadian Light Group reapplies its target on a configurable scheduler whose hard minimum is exactly 30 seconds. The local configuration uses 120 seconds, and the remote log showed normal `apply[timer]` cycles at that interval without app reinitialization.
- Reviewed five earlier long-running remote logs. Each contained exactly one startup banner and one completed initialization, with no app uninitialization or fatal/unhandled/heap markers. The longest session logged activity continuously for almost three days.
- Confirmed that the app already logs stack traces when a real `Error` object reaches `Logger.error`, but it has no user-downloadable persistent ring buffer or diagnostic snapshot. The startup banner currently reads the stale package version (1.10.25) while the generated/Compose manifest is 1.10.27, which can confuse incident reports.
- Homey's built-in app management offers **Send diagnostics to developer**; a separate Homey system diagnostics report can also be created for Homey Support.

### Recommendation
- First ask the reporter whether the app itself shows a crash/restart or whether controlled device values revert, and whether a Circadian Light Group is configured with a 30-second update interval.
- Ask the user to enable the app's Debug Mode, reproduce the issue, immediately send app diagnostics, and include the exact local time, app version, affected device/group, and what visibly resets.
- Add a bounded in-memory diagnostic ring buffer and a redacted downloadable diagnostic snapshot with startup/session ID, manifest version, uptime, last scheduler operations, last errors with stacks, and lightweight memory counters. Do not rely on global `uncaughtException` handlers to keep a damaged process alive.

### Verification
- Current remote observation: one startup, normal 120-second scheduler cycles, no restart or fatal process signal.
- Historical log scan: five sessions, one initialization per session, zero fatal/unhandled/heap markers.
- No production code was changed during this diagnostic session.
