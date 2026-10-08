# Project Documentation: Smart (Components) Toolkit

## Overview
**Smart (Components) Toolkit** (`no.tiwas.booleantoolbox`) is a Homey application for advanced logic, capability aggregation, state handling, and automation utilities. It includes virtual Logic Devices, Logic Units, Composite Devices, state devices, and Circadian Light Groups.

## Core Components

### 1. Logic Devices & Units
*   **Logic Device:** A user-friendly device with a visual pairing wizard. Best for simple setups and single formulas. Features dynamic inputs (2-10).
*   **Logic Unit:** Targeted at advanced users. Configured via JSON settings. Supports multiple independent formulas within a single unit.
*   **Legacy Units:** Supports legacy "Logic Unit X" devices (fixed input counts).
*   **Logic Unit output and triggers:** `alarm_generic` exposes the aggregate result (TRUE when any enabled formula is TRUE). `formula_changed_lu` fires on any selected-formula transition, while `formula_changed_to_lu` additionally filters by the selected TRUE/FALSE result. Deprecated trigger IDs remain registered for saved Flow compatibility.

### 2. Formula Engine
*   **Location:** `no.tiwas.booleantoolbox/lib/FormulaEvaluator.js`
*   **Capabilities:** Handles boolean operations (`AND`, `OR`, `XOR`, `NOT`) and bitwise equivalents.
*   **Features:**
    *   Dynamic variable parsing (A, B, C...).
    *   Timeout handling (reset to false after X seconds).
    *   "First Impression" mode (locks inputs for sequence logic).

### 3. Waiter Gates (BETA) and Conditional Gates
*   **Purpose:** Allows flows to pause and wait for specific device state changes or for an in-memory GO/NO GO gate.
*   **Mechanism:** Registers listeners and routes flow based on success (YES) or timeout (NO).
*   **Homey Flow card limit:** Homey stops every app Flow card run after ~60 seconds. In-card waits (`wait_until_becomes_true`, `conditional_gate_start`) are ended with a guidance error after `WaiterManager.FLOW_CARD_SAFE_WAIT_MS` (55 s); the `wait` action rejects delays above 55 s.
*   **Background waits:** `conditional_gate_start_wait` and `wait_until_start` return immediately and let `WaiterManager.startBackgroundWaiter()` wait without the card limit; `conditional_gate_wait_finished` and `wait_until_finished` fire when the wait ends. Starting again with the same gate/waiter ID restarts the wait; stopping it does not fire the trigger.
*   **State:** Gates and pending waits are in memory only and are lost when the app restarts.
*   **Waiter IDs:** Homey gives a Flow card no Flow id, so every in-card wait uses the context `WaiterManager.CARD_FLOW_ID` and background waits use `BACKGROUND_FLOW_ID`. Starting an in-card wait with an ID that is already waiting takes the ID over, also from another Flow: the earlier wait ends on its NO path, logged at INFO (not WARN, because it is expected behaviour and should not add a diagnostic event). An in-card wait and a background wait cannot share an ID ("Waiter ID already exists").
*   **Key Files:** `WaiterManager.js`, `app.js` (flow card registration), `WaiterManager.test.js`, `LongWaitFlowCards.test.js`.

### 4. Composite Device
*   **Purpose:** Combines one capability shared by two or more Homey devices into a live virtual sensor, alarm, or text value.
*   **Driver:** `no.tiwas.booleantoolbox/drivers/composite-device/` contains discovery, the visual pairing page, realtime source listeners, and recovery handling.
*   **Aggregation Engine:** `no.tiwas.booleantoolbox/lib/CompositeAggregator.js` implements numeric, boolean, text, enum, and circular clock-time calculations without Homey runtime dependencies.
*   **Capabilities:** `measure_composite`, `alarm_composite`, and `composite_text` are selected dynamically during pairing; `alarm_config` reports missing sources.
*   **Flow Triggers:** `composite_value_changed` fires for subsequent numeric, boolean, or text output changes. `composite_value_changed_larger_than` filters numeric changes using a per-Flow fixed or percentage threshold.
*   **Tests:** `CompositeAggregator.test.js` verifies calculation semantics and `CompositeDevice.test.js` verifies pairing, realtime updates, change triggers, threshold filters, partial failures, and cleanup.

### 5. Diagnostics and GitHub issue reporting
*   **Settings UI:** `no.tiwas.booleantoolbox/settings/index.html` generates an on-demand report, shows it for review, supports copying, and opens a new repository issue prefilled.
*   **API:** the private `POST /diagnostics` app endpoint in `api.js` delegates report creation to `app.js`; no GitHub credentials are stored in the app.
*   **Report data:** `lib/DiagnosticsReport.js` formats/redacts version, session uptime, label-free warning/error events with stack frames, anonymous driver and Circadian Light Group load, and available app/Homey CPU, memory, and storage metrics.

### 6. Flow name card (`flow_whoami`)
*   **Purpose:** Returns the name, id and folder of the Advanced Flow the card is in (`flow_name`, `flow_id`, `folder_name`, plus `has_error` and `error_message`). Advanced Flow only, because THEN cards with tokens are hidden in standard Flows.
*   **Why it works this way:** A run listener gets no Flow context (`state` holds only `manual`), and the app's Web API token may read Flows but not write them (`updateAdvancedFlow` fails with `Missing Scopes`). The required autocomplete argument `flow` therefore offers one choice, "this Flow", with a new random UUID each time the list opens. Homey stores the picked id with the card.
*   **Run:** `lib/FlowIdentity.js` reads the Advanced Flows on every run (`$cache: false`, no memory between runs, so renames show at once) and finds the Flow holding the card with that id. Nothing picked, no saved Flow, or the id in several Flows (a copied card or duplicated Flow) returns a marker name such as `[Duplicate]`, `has_error: true` and an explanation in `error_message`, instead of throwing, because Homey drops tokens on the error output. It only throws when the Flows cannot be read.
*   **Key Files:** `lib/FlowIdentity.js`, `.homeycompose/flow/actions/flow_whoami.json`, `app.js` (registration), `FlowIdentity.test.js`.

### 7. Circadian Light Group and the Flow card limit
*   **Retries after the card:** member on/off commands and profile updates call `runDeviceTasksParallel` with `deferRetries`. It returns after the first parallel pass and one verification; with a verify step, unconfirmed lights are checked once more after 1.5 s (`SETTLE_CHECK_MS`) before the call returns. Lights still unconfirmed are listed in `pending`, and the reduced parallel retry and final serial retry run in `background`. A newer command stops them through the operation generation (`acquireOp`), also during the final serial pass, so a superseded command reports nothing. A member command (`runMemberCommand`) stays active, so the scheduler waits, until its background retries finish; verification, `alarm_config`, `clg_error_occurred` and `clg_target_changed` are reported then.
*   **Time budget:** every Circadian action card and the `onoff`/`clg_paused` capability listeners go through `runWithinCardTimeBudget` (50 s). Work still running after that goes on in the background.
*   **Outcome and tokens:** operations return an outcome (`completed`, `ok`, `total`, `pending`, `failed`, `skipped`, `superseded`, `budgetExceeded`, `background`, and `groups` for a Collection). `ok` keeps the boolean each operation returned before, so the Collection's group error reporting is unchanged, and cards without tokens still return it. Only `clg_turn_on`, `clg_turn_off` and `clg_toggle` return `completed` and `status` (`toCardTokens`, texts under `circadian_outcome` in the locales). They are no longer deprecated, because the device's own On/Off/Toggle cards cannot return tokens. Homey shows THEN cards with tokens only in Advanced Flows, so cards that may be in standard Flows (Apply now, Resume, Apply temporary state and the others) get no tokens; `CircadianLightGroupDriver.test.js` checks this.
*   **Collection:** `runAwaitedMemberGroups` merges the member groups' outcomes and reports group failures once their background retries have finished. The Collection queue is released when the card's part is done.
*   **Key Files:** `drivers/circadian-light-group/device.js`, `drivers/circadian-light-group/driver.js`, `drivers/circadian-light-group-collection/device.js`, `CircadianLightGroupDevice.test.js`, `CircadianLightGroupCollectionDevice.test.js`, `CircadianLightGroupDriver.test.js`.

## Project Structure
*   `no.tiwas.booleantoolbox/`: Main Homey app source.
    *   `app.js`: Application entry point and diagnostics collector.
    *   `api.js`: Private settings endpoint for generating diagnostic reports.
    *   `drivers/`: Device drivers (`composite-device`, `logic-device`, `logic-unit`, state and Circadian Light Group drivers).
    *   `lib/`: Core logic libraries (`CompositeAggregator.js`, `DiagnosticsReport.js`, `FlowIdentity.js`, `FormulaEvaluator.js`, `Logger.js`).
    *   `locales/`: Translation files.
*   `docs/`: Documentation and web tools for the GitHub Pages site, published by `.github/workflows/pages.yml` on every push to `main` that changes `docs/` (Pages source: GitHub Actions).
*   `.github/workflows/message-check.yml` with `.github/scripts/message-check.js`: checks commit messages, branch names, PR, issue and comment text against `AI_RULES.md` §7 on every pull request, push, issue, comment and review. Tests: `node --test .github/scripts/message-check.test.js`.
*   `.claude/settings.json`: shared project settings for the coding assistant; turns off its commit and PR attribution. Everything else under `.claude/` stays local and ignored.
*   Jest test files live beside the app source, including `CompositeAggregator.test.js`, `CompositeDevice.test.js`, `FormulaEvaluator.test.js`, and `LogicUnit.test.js`.

## Key Technologies
*   **Platform:** Homey (Athom).
*   **Language:** JavaScript (Node.js environment).
*   **Testing:** Jest.

## Constraints (See AI_RULES.md)
*   **Production Status:** Live app.
*   **Modifications:** Only strictly requested changes. No refactoring.
