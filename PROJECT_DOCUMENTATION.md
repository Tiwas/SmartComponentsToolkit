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

### 3. Waiter Gates (BETA)
*   **Purpose:** Allows flows to pause and wait for specific device state changes.
*   **Mechanism:** Registers listeners and routes flow based on success (YES) or timeout (NO).
*   **Key Files:** `WaiterManager.js`.

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

## Project Structure
*   `no.tiwas.booleantoolbox/`: Main Homey app source.
    *   `app.js`: Application entry point and diagnostics collector.
    *   `api.js`: Private settings endpoint for generating diagnostic reports.
    *   `drivers/`: Device drivers (`composite-device`, `logic-device`, `logic-unit`, state and Circadian Light Group drivers).
    *   `lib/`: Core logic libraries (`CompositeAggregator.js`, `DiagnosticsReport.js`, `FormulaEvaluator.js`, `Logger.js`).
    *   `locales/`: Translation files.
*   `docs/`: Documentation for the GitHub Pages site.
*   Jest test files live beside the app source, including `CompositeAggregator.test.js`, `CompositeDevice.test.js`, `FormulaEvaluator.test.js`, and `LogicUnit.test.js`.

## Key Technologies
*   **Platform:** Homey (Athom).
*   **Language:** JavaScript (Node.js environment).
*   **Testing:** Jest.

## Constraints (See AI_RULES.md)
*   **Production Status:** Live app.
*   **Modifications:** Only strictly requested changes. No refactoring.
