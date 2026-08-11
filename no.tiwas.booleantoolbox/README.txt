== DEVICES ==

Composite Device
  Combine the same capability from two or more devices into one continuously updated virtual value.
  - Numbers: average, minimum, maximum, sum, and median
  - Booleans and alarms: any/all, majority, count on, and percentage on
  - Text and clock values: most common, min/max, newest, and circular average time
  - Continues with available sources and reports missing sources
  - Flow triggers: every value change, or numeric change above a fixed/percentage threshold

Circadian Light Group
  Control a group of lights as one virtual light with automatic brightness and color-temperature targets.
  - Build schedules from clock times, solar events, or lux thresholds
  - Supports red mode, per-light limits, pausing, temporary states, and outdoor-light sources
  - Includes Flow cards for phases, targets, pause/resume, solar events, and member control

Circadian Light Group Collection
  Combine multiple Circadian Light Groups into one virtual light for shared on/off and Flow control.

Logic Device
  Create a single boolean formula using a visual pairing wizard.
  - Select Homey devices and capabilities as inputs
  - Dynamic input expansion and state-change triggers

Logic Unit (Dynamic)
  Create advanced boolean logic using text-based formulas.
  - Define formulas such as: (A AND B) OR (NOT C)
  - Multiple formulas per unit, individual timeouts, and first-impression mode
  - Dynamic input linking, validation, and error reporting

State Capture Device
  Dynamically capture and restore device states at runtime.
  - Named States: Save snapshots with custom names for scene management
  - Stack Operations: Push/pop for temporary state changes (e.g., doorbell interruptions)
  - Template-based: Define which devices and capabilities to capture
  - Backup/Restore: Export all named states as JSON for backup, import to restore

State Device
  Pre-define device states and apply them via flows. Configure states at setup time rather than capturing them dynamically.

Legacy Logic Unit X (2-10 inputs)
  Existing fixed-input Logic Unit devices remain supported but are deprecated. Use Logic Unit (Dynamic) or Logic Device for new setups.

== STANDALONE FLOW CARDS ==

Conditional Gates
  Persistent named GO/NO GO gates for coordinating flows without a virtual device.
  - Check a gate immediately
  - Wait for a gate to become GO, with timeout
  - Open, close, toggle, or update a gate from another Flow

Waiter Gates
  Wait until any selected device capability reaches a target value, with YES/NO timeout branches. Enable, disable, or stop a waiter by ID.

Math Compare
  Calculate a simple numeric expression and compare the result with another value.

Gradient Map
  Map a number from one range to another, clamp out-of-range values, round the result, and expose it as a Flow tag.

Evaluate Expression
  Evaluate range rules with AND/OR logic and return output and error tags.

Wait
  Pause a Flow for a selected number of seconds, minutes, or hours.

Solar Event Occurred
  Trigger a Flow at sunrise, sunset, dawn, dusk, golden hour, blue hour, solar noon, or solar midnight, with an optional offset.

App-wide Configuration Alarm Triggers
  Trigger when a Logic Device or Logic Unit configuration error is detected, resolved, or changes state.

== DOCUMENTATION ==

Full device guides and Flow card reference:
https://tiwas.github.io/SmartComponentsToolkit/
