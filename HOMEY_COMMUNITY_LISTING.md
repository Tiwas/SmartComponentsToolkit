![xlarge|690x483](upload://iSxhJPUltgcgPQ7gy4z5iisCv5F.jpeg)

# Smart (Components) Toolkit v1.9.2

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Replace complex flow networks with powerful logic devices controlled by dynamic formulas. Make your flows cleaner, more readable, and easier to maintain.

<a href="https://tiwas.github.io/SmartComponentsToolkit/" target="_blank">→ Full Documentation & Interactive Tools</a>

---

## Device Types at a Glance

| Device | Purpose |
|--------|---------|
| **Logic Device** | Boolean logic with visual wizard. Combine device states into TRUE/FALSE using formulas like `A AND B`. |
| **Logic Unit** | Advanced boolean logic with multiple formulas per device. JSON configuration. |
| **State Device** | Scene management. Capture states at setup, apply with one action. "Virtual device". |
| **State Capture Device** | Dynamic state capture at runtime. Push/pop stack for temporary changes. |

## Flow Cards (no device needed)

| Flow Card | Purpose |
|-----------|---------|
| **Conditional Gates** | Simple GO/NO GO flow control without needing variables or devices. |
| **Waiter Gates** | Pause flow until a device capability reaches a specific value. |
| **Evaluate Expression** | Range checking and value mapping with AND/OR logic. |

---

## State Capture Device

A device type for dynamic state capture with templates, named slots, and push/pop stack operations:

- **Template-based:** Define which devices/capabilities to capture (values read at runtime)
- **Named states:** Store up to 50 named snapshots per device
- **Push/Pop stack:** Temporary state management with up to 20 levels
- **Backup/Restore:** Export all named states as JSON, import to restore or transfer
- **Homey tokens:** Use dynamic state names from flow variables

**Example use case:**
```
WHEN: Doorbell rings
THEN: Push current state to stack
THEN: Set all lights to 100%
THEN: Wait 5 minutes
THEN: Pop state (restore previous)
```

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html" target="_blank">→ Read State Capture Device Documentation</a>

---

## Conditional Gates (NEW in v1.9.0) — Flow Cards

A lightweight alternative to variables and virtual switches for flow control. **No device needed** - just use the flow cards directly. Gates have two states: **GO** or **NO GO**.

**Why use Conditional Gates?**
- No need to create devices or variables just to control flow execution
- Named gates give you overview of all your flow controls in one place
- Simple GO/NO GO logic is perfect for many automation scenarios

**Flow Cards:**

| Card Type | Card | Description |
|-----------|------|-------------|
| **Condition** | Gate is GO/NO GO | Check if a gate is currently GO or NO GO |
| **Then** | Conditional Gate: Wait for GO | Pauses flow until the gate becomes GO (with timeout) |
| **Then** | Modify Conditional Gate | Set a gate to GO or NO GO by name |

**Example use case:**
```
Flow 1 - Motion detected:
WHEN: Motion sensor triggered
THEN: Modify Conditional Gate "allow_lights" → GO

Flow 2 - Turn on lights:
WHEN: Door opened
AND: Gate "allow_lights" is GO
THEN: Turn on lights

Flow 3 - Disable at night:
WHEN: Time is 23:00
THEN: Modify Conditional Gate "allow_lights" → NO GO
```

---

## Waiter Gates — Flow Cards

Flow cards that pause execution until a device capability reaches a target value. **No device needed** - just use the flow cards directly.

**Flow Cards:**

| Card Type | Card | Description |
|-----------|------|-------------|
| **Then** | Wait until device capability becomes X | Pauses flow until capability matches target (YES) or timeout (NO) |
| **Then** | Control Waiter Gate | Enable, disable or stop a waiter gate by ID |

**Example use case:**
```
WHEN: Button pressed
THEN: Turn on coffee machine
THEN: Wait until coffee machine temperature ≥ 90°C (timeout: 5 min)
  → YES: Send notification "Coffee ready!"
  → NO: Send notification "Coffee machine timeout"
```

---

## Evaluate Expression — Flow Card

A powerful flow card for range checking and value mapping. **No device needed** - use directly in your flows.

**Flow Card:** `Evaluate [[input]] [[op1]] min [[logical_op]] [[op2]] max with rules [[rules]]`

- Check if a value is within a range (e.g., temperature between 18-22°C)
- Use AND/OR logic for complex conditions
- Returns output value and error message tokens

**Example:** Check if temperature is comfortable (18-24°C):
- Input: temperature token
- Rules: `18,24` (min, max)
- Operators: `≥` AND `≤`

---

## Device Types

**Logic Device** - Recommended for beginners
- Visual pairing wizard with zone/room selection
- Single formula per device
- State changed trigger

**Logic Unit** - For advanced users
- Multiple formulas per device
- Full JSON configuration
- Dynamic input expansion (2-10 inputs)

**State Device** - Pre-defined scene management
- Configure device states during setup
- Apply states with a single flow action
- Ideal for fixed scenes (movie mode, away mode, etc.)

**State Capture Device** - Dynamic state management
- Capture device states at runtime using templates
- Named states for scene snapshots
- Push/pop stack for temporary interruptions
- Backup/restore via JSON export/import

**Logic Unit X** - Deprecated
- Fixed input counts (2, 3, 4...10)
- Still functional but not recommended for new setups

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">→ Complete Device Guide</a>

---

## Documentation

- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html" target="_blank">**Getting Started Guide**</a> - Create your first logic device in 5 minutes
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">**Device Types Guide**</a> - Understanding all device types
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html" target="_blank">**State Device**</a> - Pre-defined scene management
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html" target="_blank">**State Capture Device**</a> - Dynamic state capture and restore
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">**Waiter Gates**</a> - Flow control with wait conditions
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">**Conditional Gates**</a> - Simple GO/NO GO flow control
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html" target="_blank">**Flow Cards Reference**</a> - Complete guide to all available cards


---

## Installation and Links

* **Homey App Store:** <a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">Install Smart (Components) Toolkit</a>
* **Install test version:** <a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">Install test version</a>
* **GitHub Repo (source code):** <a href="https://github.com/tiwas/SmartComponentsToolkit" target="_blank">https://github.com/tiwas/SmartComponentsToolkit</a>
* **Online Emulator:** <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/emulator.html" target="_blank">https://tiwas.github.io/SmartComponentsToolkit/tools/emulator.html</a>
* **Formula Builder:** <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/formula-builder.html" target="_blank">https://tiwas.github.io/SmartComponentsToolkit/tools/formula-builder.html</a>

---

## Feedback & Support

Found a bug or have a suggestion? Please report it:

* **GitHub Issues:** <a href="https://github.com/tiwas/SmartComponentsToolkit/issues" target="_blank">Report here</a>
* **This Forum Thread:** Reply below!

All feedback is greatly appreciated and helps shape the future of this app.

---

## Support the Project

If you find Smart (Components) Toolkit useful, consider supporting its development:

<a href="https://paypal.me/tiwasno" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-blue.svg" alt="PayPal"></a>

---

**Smart (Components) Toolkit** - Simplify complex logic and state management in your Homey flows ⚡