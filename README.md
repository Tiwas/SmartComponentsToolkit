# Smart (Components) Toolkit for Homey

> **Name Change:** This app was previously known as "Boolean Toolbox". The name was changed to "Smart (Components) Toolkit" to better reflect the expanded functionality beyond just boolean logic - now including state management, scene control, and flow utilities.

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Advanced logic and state management for your Homey automations. Create smart devices that react to multiple inputs with customizable formulas, and manage device states with powerful capture/restore functionality.

[![Stable](https://img.shields.io/badge/stable-1.9.2-blue.svg)](https://homey.app/en-no/app/no.tiwas.booleantoolbox/)
[![Test](https://img.shields.io/badge/test-1.10.0-orange.svg)](https://homey.app/a/no.tiwas.booleantoolbox/test/)
[![Homey](https://img.shields.io/badge/Homey-5.0+-green.svg)](https://homey.app)

> **🧪 v1.10.0 in test channel** — adds the new **Circadian Light Group** virtual device with time/solar/lux anchors, red mode threshold, outdoor light providers and a wide set of new flow cards. Install via [test channel](https://homey.app/a/no.tiwas.booleantoolbox/test/). [Read the guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html)

---

## 🛠️ Interactive Tools

Test and build your logic before deploying:

- **[Boolean Logic Emulator](https://tiwas.github.io/SmartComponentsToolkit/tools/emulator.html)** - Test expressions with live truth tables
- **[Formula Builder](https://tiwas.github.io/SmartComponentsToolkit/tools/formula-builder.html)** - Visual formula editor with validation
- **[Boolean Editor](https://tiwas.github.io/SmartComponentsToolkit/tools/boolean-editor.html)** - Advanced editor for boolean device configurations
- **[State Editor](https://tiwas.github.io/SmartComponentsToolkit/tools/state-editor.html)** - Visual editor for State Device configurations
- **[State Editor (API)](https://tiwas.github.io/SmartComponentsToolkit/tools/state-editor-api.html)** - State editor with Homey API integration *(eternal beta)*

---

## 📦 Device Types

### Logic Device

The easiest way to create boolean logic with a visual pairing wizard.

| Feature | Description |
|---------|-------------|
| **Setup** | Visual pairing wizard - select zone → device → capability |
| **Inputs** | Dynamic (2-10, auto-expands based on formula) |
| **Formulas** | Single formula per device |
| **Best for** | Simple setups, beginners |

[📚 Read Logic Device guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html)

---

### Logic Unit

Powerful device for advanced users who need multiple formulas or prefer JSON configuration.

| Feature | Description |
|---------|-------------|
| **Setup** | Quick add with manual JSON configuration |
| **Inputs** | Dynamic (2-10, auto-expands based on formula) |
| **Formulas** | Multiple independent formulas per device |
| **Best for** | Advanced users, multi-formula needs |

*Note: Logic Unit X (2, 3, 4...10 inputs) are legacy devices with fixed input counts - use the new Logic Unit instead.*

[📚 Read Logic Unit guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html)

---

### State Device

Capture and restore device states. Create "scenes" by storing the current state of multiple devices and applying them later with a single action.

| Feature | Description |
|---------|-------------|
| **Setup** | Visual pairing wizard - select zones and devices |
| **Values** | Fixed at setup time |
| **Use case** | Predefined scenes (Movie Night, Cleaning, etc.) |

**Key features:**
- Capture current state of multiple devices across zones
- Apply stored state with a single flow action
- "Reset All" option to turn off other State Devices first
- Hierarchical execution with configurable delays

[📚 Read State Device guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html)

---

### State Capture Device

Dynamic state capture with templates, named slots, and push/pop stack operations.

| Feature | Description |
|---------|-------------|
| **Setup** | Visual pairing wizard - define template of devices/capabilities |
| **Values** | Captured at runtime (not fixed) |
| **Named states** | Store multiple named snapshots |
| **Stack** | Push/pop for temporary state management |

**Key features:**
- Capture current device states to named slots at runtime
- Push/pop stack for temporary state changes (e.g., doorbell interruption)
- Dynamic state names with Homey tokens support
- Max 50 named states, max 20 stack depth per device

**Example use case:**
```
WHEN: Doorbell rings
THEN: Push current state to stack
THEN: Set all lights to 100%
THEN: Wait 5 minutes
THEN: Pop state (restore previous)
```

[📚 Read State Capture Device guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html)

---

### Circadian Light Group 🧪 *(test channel only — v1.10.0)*

Virtual light device that adjusts brightness and color temperature for a group of real lights based on time, sun position or ambient lux.

| Feature | Description |
|---------|-------------|
| **Schedule** | Per anchor: clock time / solar event / lux sensor crossing |
| **Solar events** | Sunrise, sunset, civil/nautical/astronomical dawn/dusk, golden hour, blue hour, solar noon/midnight — with offset and polar fallback |
| **Light profile** | Per-phase dim + temperature, red mode threshold |
| **Outdoor source** | Astronomical / lux sensor / Open-Meteo / MET.no / external |
| **Per-light** | Enable, prewarm, allow red mode, min/max dim |

**Key features:**
- Mix-and-match anchor modes per phase (e.g. morning by clock, evening by sunset)
- Red mode threshold: lights with color support shift to red when calculated temperature drops below threshold
- Live tile shows calculated values regardless of on/off or paused state
- 24 flow cards: pause-until, force red, apply temporary state, phase-changed trigger, app-level solar event trigger and more

**Install via test channel:** [homey.app/a/no.tiwas.booleantoolbox/test/](https://homey.app/a/no.tiwas.booleantoolbox/test/)

[📚 Read Circadian Light Group guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html)

---

## 🎛️ Flow Cards (No Device Needed)

These flow cards work independently - no device setup required.

### Conditional Gates

Simple GO/NO GO flow control without needing variables or devices. Gates persist in memory until changed.

| Feature | Description |
|---------|-------------|
| **States** | GO (open) or NO GO (closed) |
| **Wait condition** | Pause flow until gate becomes GO (with timeout) |
| **Control** | Open/close gates from any flow |

**Flow Cards:**
- **Gate is GO/NO GO** *(condition)* - Check gate state instantly
- **Conditional Gate: Wait for GO** *(condition)* - Pause until gate opens or timeout
- **Modify Conditional Gate** *(action)* - Set gate to GO, NO GO, or Toggle

**Example:**
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

[📚 Read Conditional Gates guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html)

---

### Waiter Gates

Waiter Gates let your flows pause and wait for device states to change, with YES/NO outputs:

| Feature | Description |
|---------|-------------|
| **Wait condition** | Pause flow until device capability reaches target value |
| **YES path** | Value matches (or already matched) |
| **NO path** | Timeout expired before match |

**Flow Cards:**
- **Wait until device capability becomes value** *(condition)* - Waits with timeout
- **Control waiter gate** *(action)* - Enable/disable/stop a waiter by ID
- **Wait** *(action)* - Simple delay (basic pause without device monitoring)

[📚 Read Waiter Gates guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html)

---

### Evaluate Expression

Range checking and value mapping with AND/OR logic.

- Check if a value is within a range (e.g., temperature between 18-22°C)
- Use AND/OR logic for complex conditions
- Returns output value and error message tokens

**Example:** Check if temperature is comfortable (18-24°C):
- Input: temperature token
- Rules: `18,24` (min, max)
- Operators: `≥` AND `≤`

[📚 Read Flow Cards reference →](https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html)

---

## 🚀 Quick Start

### 1. Add a Device

**Logic Device (recommended for beginners):**
- Go to **Devices** → **Add Device** → **Smart (Components) Toolkit** → **Logic Device**
- Follow the pairing wizard to select inputs
- Configure formula in device settings

**Other devices:**
- Logic Unit, State Device, State Capture Device - same process, different wizards

### 2. Write Formulas (Logic devices)

```json
[
  {
    "id": "formula_1",
    "name": "Motion & Dark",
    "expression": "A AND B",
    "enabled": true,
    "timeout": 60
  }
]
```

**Operators:** `AND`, `OR`, `XOR`, `NOT` (plus `&`, `|`, `^`, `!`)

### 3. Use in Flows

```
WHEN: Formula [motion_detected] changed to TRUE
THEN: Turn on lights
```

[📚 Read complete setup guide →](https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html)

---

## 🎮 Flow Cards

### Triggers (WHEN)
- Formula result changed to TRUE/FALSE
- Formula timed out
- State changed *(Logic Device only)*
- State was captured/applied *(State Capture Device)*

### Conditions (AND)
- Formula result is...
- Formula has timed out
- Gate is GO / NO GO *(Conditional Gates)*
- Conditional Gate: Wait for GO *(Conditional Gates)*
- Captured state exists *(State Capture Device)*
- Stack is empty / Stack depth is... *(State Capture Device)*
- Wait until device capability becomes value *(Waiter Gates)*

### Actions (THEN)
- Set input value for formula
- Evaluate formula / Re-evaluate all
- Evaluate expression *(Range checking)*
- Apply state *(State Device)*
- Capture/Apply/Delete state, Push/Pop/Peek/Clear stack *(State Capture Device)*
- Modify Conditional Gate *(Conditional Gates)*
- Control waiter gate *(Waiter Gates)*
- Wait *(Simple delay)*

[📚 See all flow cards →](https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html)

---

## 💡 Key Features

### Dynamic Input Expansion
Start with 2 inputs, grow to 10 automatically:
```json
{"expression": "A AND B AND C AND D"}
// Device auto-expands to 4 inputs!
```

### First Impression Mode
Lock inputs at first value for sequence-based logic:
```json
{"firstImpression": true, "timeout": 30}
```

### Multiple Independent Formulas (Logic Unit only)
Each formula maintains its own input states:
```json
[
  {"id": "day_mode", "expression": "A AND B"},
  {"id": "night_mode", "expression": "A OR B"}
]
```

### JSON Auto-Formatting
Paste ugly JSON, get beautiful formatting on save. Works in all settings fields.

---

## 📚 Documentation

- [Getting Started](https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html)
- [Device Types Guide](https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html)
- [State Device](https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html)
- [State Capture Device](https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html)
- [Conditional Gates](https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html)
- [Waiter Gates](https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html)
- [Flow Cards Reference](https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html)

---

## 🤝 Support & Community

- **Forum:** [Homey Community](https://community.homey.app/t/app-boolean-toolbox-create-advanced-logic-with-simple-formulas/143906)
- **Issues:** [GitHub Issues](https://github.com/Tiwas/SmartComponentsToolkit/issues)
- **Source:** [GitHub Repository](https://github.com/Tiwas/SmartComponentsToolkit)

### Support Development

If this app makes your life easier, consider buying me a coffee ☕

[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/paypalme/tiwasno)

---

## 📄 License & Credits

Created by **Lars Kvanum** ([@Tiwas](https://github.com/Tiwas))

This app is provided as-is. Use at your own risk.

---

**Smart (Components) Toolkit** - Smarter automations with advanced logic and state management 🚀
