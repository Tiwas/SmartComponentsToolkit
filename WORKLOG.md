# Worklog

## 2026-09-29 — Issue #44: app keeps resetting

### Requested
- Fix GitHub issue #44 (v1.10.28/1.10.29, 24 Logic Devices and one Composite Device; the app restarts repeatedly, Homey crash count 8 → 12 in two days, no crash message).
- Remove the stale `formula_result_is_ld` registration, add a regression test for Flow card ids, hunt for crash vectors, and make the next diagnostic report useful without exposing labels.
- Follow-up evidence: `Device.driverUri is deprecated` floods stderr; a Logic Device that uses another Logic Device as input stops reacting after an app restart; Logic Devices randomly stop until the app is restarted; startup takes about 30 seconds.

### Findings
- Most likely restart cause (medium-high confidence): memory growth until Homey terminates the process, which leaves no JavaScript stack or crash message. homey-api 3.17.0 `subscribe()` leaves a `once("disconnect")` listener on the socket for every subscription, and that listener retains the whole HomeyAPI Device object. Every `getDevice()` returns a new Device object, so the five-minute Logic Device listener health refresh added in 1.10.26/1.10.27 created one new subscription per linked input per cycle. A local reproduction with the real homey-api code retained about 10 KB per refresh (7.6 MB per hour for 60 links, 30 MB after four hours). Waiters and Circadian Light Group temporary listeners add further subscriptions.
- The same library version sends a server-side `unsubscribe` for the device URI whenever any Device object disconnects. A finished waiter, a reconfigured or deleted Logic Device, or a temporary Circadian listener therefore silently stopped realtime updates for every other consumer of that device until the next health refresh. This matches Logic Devices that randomly stop reacting and groups that use other Logic Device groups (typical waiter targets). homey-api 3.20.0 fixed both issues with a shared subscription registry.
- `Device.driverUri` is a deprecated getter that always returns undefined and writes a warning. The device registry refresh read it for every Homey device at startup and every six hours; state-device and state-capture-device candidate filters, the Logic Device input picker driver name, and Circadian driver references also read it. With homey-api 3.x the Logic Device exclusion in the input picker never matched, so chaining Logic Devices has been available and is used; it was kept selectable.
- The startup `formula_result_is_ld` error is caused by a card whose definition was removed in December 2025 but whose registration was re-added in 1.10.20.
- A Logic Device formula with a timeout but without an expression threw `TypeError` inside the one-second timeout interval, which terminates the process.
- Logic Devices wrote `alarm_generic` even when the result was unchanged; every write emits a realtime event, so mutually linked Logic Devices could re-trigger each other indefinitely.
- Startup (not changed): the app awaits the device registry refresh before drivers start, and each Logic Device performs two sequential `getDevice()` calls per linked input.
- Waiter timeout warnings in the reporter's log are normal behaviour and are not crash signals.

### Implemented
- Removed the `formula_result_is_ld` condition registration and the dangling `driver.compose.json` reference; "Device alarm is..." remains the Logic Device result condition.
- Added `FlowCardDefinitions.test.js`, which statically resolves literal, looped, ternary, helper, and forwarded Flow card ids in `app.js`, `lib/`, and every driver file and checks them and driver Compose `flow` declarations against `.homeycompose/flow` and `driver.flow.compose.json` definitions.
- Shared one realtime subscription per URI between all HomeyAPI Device objects (`configureHomeyApi`), so replacing or removing one listener never removes another consumer's subscription and periodic listener replacement no longer creates subscriptions. The wrapper is skipped when homey-api provides its own registry (3.20+). Listener exceptions are logged instead of escaping from the socket handler.
- The Logic Device health refresh now compares each freshly fetched linked value with the cached input; a missed update is replayed, logged as a warning, and the shared subscription is recreated. Snapshots older than a received event and first-impression locked inputs are ignored.
- Logic Devices only write `alarm_generic` when the value differs from the current capability value.
- Guarded `parseExpression()` against missing or non-string expressions.
- Replaced every `driverUri` read on HomeyAPI devices with `driverId` (device registry, Logic Device input picker, State Device and State Capture Device candidate filters, Circadian Light Group and collection driver references).
- Diagnostics: persisted warnings and stackless errors now include the app-relative caller location (`file:line`); unhandled promise rejections are recorded and the process is kept alive; uncaught exceptions are observed with `uncaughtExceptionMonitor` (process termination is unchanged) and persisted immediately; a clean-shutdown marker records a warning with the previous session's start, last heartbeat, and uptime when it ended uncleanly; label-free heap/RSS samples are taken every 15 minutes and the report shows current and previous session samples plus the number of pre-existing process error handlers; this app's driver ids and kebab-case code identifiers are no longer redacted.

### Companion tools
- `docs/tools/boolean-editor.html`, `formula-builder.html`, `emulator.html`, and `flow-doctor.html` do not reference `formula_result_is_ld`; no Logic Device settings shape changed. `flow-doctor.html` already reads `driverId` and only uses registry entry names. The State Device filter changes do not affect the stored state JSON used by `state-editor.html` and `state-editor-api.html`.

### Verification
- `npm test -- --runInBand`: 21 suites and 243 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.55 MB) and all 17 manifest assets were verified. The generated manifest no longer contains `formula_result_is_ld`.

### Review follow-up (PR #48)
- Restored the general redaction for long hyphenated values; only this app's exact driver ids (from the bundled `drivers/` directory, plus ids supplied by the app) stay readable, and only in the driver list and code-derived event fields (category, stack, source).
- A shared-subscription consumer whose `onConnect` throws is now removed (and the server subscription released when it was the last consumer) before the error is rethrown.
- The Logic Device health refresh re-checks for a newer realtime event after recreating the subscription, so an event received during the resubscribe is not overwritten by the older snapshot.
- A live `homey app run --remote` on the configured Homey reported one pre-existing `unhandledRejection` and one `uncaughtException` handler, so the Homey SDK installs its own handlers.
- `npm test -- --runInBand`: 21 suites and 246 tests passed.
- Second review round: the health refresh now reads the linked value again after the replacement subscription is active and replays that value, because a change during the unsubscribe/subscribe window produces no event. A failed (re)subscription no longer drops its entry: consumers and their unsubscribe handles are kept, the entry is marked for resubscription and restored on the next subscribe for the URI, on the next health-refresh resubscribe, or by a bounded backoff retry (5 s doubling to 5 min); the socket-reconnect failure path behaves the same. `onUninit` now awaits the clean-shutdown marker write and logs a failure instead of throwing.

### Follow-ups
- Consider upgrading homey-api to 3.20.x after live testing; the shared-subscription wrapper then becomes inactive automatically.
- Consider not awaiting the startup device registry refresh and reusing the listener fetch for initial Logic Device values to shorten startup.
- Oscillating Logic Device cycles (for example A = NOT B and B = A) still loop through Homey by design of the configuration; no automatic cycle breaker was added.
- Verify on a live Homey that memory samples stay flat over several hours.

## 2026-09-07 — Diagnostic resource fallback v1.10.29

### Requested
- Fix the App Settings diagnostic report after a user received `ENOENT: no such file or directory, uv_resident_set_memory`.
- Publish the fix as a new Homey draft release.

### Implemented
- Made Node.js process-memory and operating-system resource probes best effort so unavailable platform metrics cannot abort report generation.
- Wrapped Homey API resource calls so both synchronous exceptions and rejected promises degrade to unavailable values.
- Ensured missing or incomplete load averages are rendered explicitly as unavailable.
- Added regression coverage for the reported process-memory failure and unavailable Homey resource endpoints.
- Prepared the v1.10.29 patch-release metadata and Community post source.

### Verification
- `npm test -- --runInBand`: 19 suites and 210 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.51 MB) and all 17 manifest assets were verified.

## 2026-09-06 — GitHub diagnostic reports and test release v1.10.28

### Requested
- Add a way for users to submit a diagnostic report directly to GitHub Issues.
- Include available device/app CPU, memory, storage and Circadian Light Group load information.
- Prepare a reviewed PR, merge it when green, upload a Homey test build, install it on the configured Homey, and update the Community post source.

### Implemented
- Added a private App Settings diagnostics endpoint and UI for generating, previewing, copying, and opening a prefilled GitHub issue without embedding GitHub credentials.
- Added bounded persistence of recent warnings/errors with stack traces and redaction of common device IDs, email/IP values, credentials, and long token-like values.
- Reduced persisted logger events to label-free messages and stack frames so user-defined device, room, waiter, and formula labels are not copied into public issue drafts.
- Added anonymous per-driver device counts, configuration-alarm counts, Circadian Light Group member/watcher/update-interval details, process and Homey-reported memory, system load averages, app CPU metric, and Homey storage totals when exposed by the platform.
- Aligned the runtime startup banner and npm package metadata with Homey app version 1.10.28.
- Updated README, Store README, changelog, project documentation, and Homey Community post source.

### Verification
- JavaScript syntax and changed locale/manifest JSON parsing passed.
- `npm test -- --runInBand`: 19 suites and 209 tests passed.
- `npm run test:package`: publish-level validation passed; bundle contains 766 files (7.51 MB) and all 17 manifest assets were verified.
- `homey app run --remote`: v1.10.28 initialized successfully with the correct version banner and remained running without an app restart during the smoke-test window.
- GitHub review found six issues across two passes; all findings were addressed with regression coverage before merge. Homey upload/install and the final release result are recorded below when completed.

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
