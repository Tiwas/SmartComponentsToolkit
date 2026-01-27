# Smart (Components) Toolkit for Homey

> **Name Change:** This app was previously known as "Boolean Toolbox". The name was changed to "Smart (Components) Toolkit" to better reflect the expanded functionality beyond just boolean logic - now including state management, scene control, and flow utilities.

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Advanced logic and state management for your Homey automations. Create smart devices that react to multiple inputs with customizable formulas, and manage device states with powerful capture/restore functionality.

[![Version](https://img.shields.io/badge/version-1.9.0-blue.svg)](https://github.com/Tiwas/SmartComponentsToolkit)
[![Homey](https://img.shields.io/badge/Homey-5.0+-green.svg)](https://homey.app)

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

### Waiter Gates (BETA)

**⚠️ Experimental feature** - Feedback welcome!

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
- Captured state exists *(State Capture Device)*
- Stack is empty / Stack depth is... *(State Capture Device)*
- **Wait until device capability becomes value** *(Waiter Gates - BETA)*

### Actions (THEN)
- Set input value for formula
- Evaluate formula / Re-evaluate all
- Apply state *(State Device)*
- Capture/Apply/Delete state, Push/Pop/Peek/Clear stack *(State Capture Device)*
- **Control waiter gate** *(Waiter Gates - BETA)*
- **Wait** *(Simple delay)*

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
- [Waiter Gates (BETA)](https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html)
- [Flow Cards Reference](https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html)
- [Changelog](https://tiwas.github.io/SmartComponentsToolkit/docs/changelog.html)

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
