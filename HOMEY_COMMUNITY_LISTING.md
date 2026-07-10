URL: https://community.homey.app/t/app-smart-components-toolkit-was-boolean-toolbox-create-advanced-logic-with-simple-formulas/143906

Title: [APP] Smart (Components) Toolkit (was: Boolean Toolbox) - Create advanced logic with simple formulas [v1.10.16 store / v1.10.17 test - Math Compare and Gradient Map]

Content:
![xlarge|690x483](upload://iSxhJPUltgcgPQ7gy4z5iisCv5F.jpeg)

# Smart (Components) Toolkit — store v1.10.16 / test v1.10.17

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Replace complex flow networks with powerful logic devices controlled by dynamic formulas. Make your flows cleaner, more readable, and easier to maintain.

<a href="https://tiwas.github.io/SmartComponentsToolkit/" target="_blank">→ Full Documentation & Interactive Tools</a>

---

## What's new

### v1.10.17 (test channel)

- **Math Compare (And card).** Calculate one value with `+`, `-`, `*` or `/`, then compare the result with another value. Useful for rules like `temperature + 3 is greater than high_threshold`.
- **Gradient Map (Then card).** Map an input value from one range to another and expose the result as a `Mapped value` tag for the next card. Supports range offsets and configurable rounding, for example mapping `18-23` degrees into fan speed `100-500`.

---

## ✨ Circadian Light Group — now on stable

A virtual **light device** that adjusts brightness and color temperature for a group of real lights — automatically following a circadian rhythm. Store is currently v1.10.16; v1.10.17 is available on the test channel.

### Circadian Light Group highlights

- **Device ID resolver (v1.10.16).** The app now captures Homey device IDs and names so <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html" target="_blank">Flow Doctor</a> can resolve references to previously deleted devices.
- **Parallel device writes (v1.10.7).** Multi-device flow actions and the scheduler push to up to 5 lights at the same time instead of one-after-another. A 16-light "turn on all" goes from minute-scale to seconds.
- **Last-write-wins on conflicting commands (v1.10.7).** Trigger "all off" right after "all on" and the off command supersedes the in-flight on, instead of fighting it on every lamp. Each pass also verifies the on/off state afterwards and serially retries transient Z-Wave / Zigbee timeouts.
- **Group-level "Turn on / off all members" actions (v1.10.7).** Convenience cards that switch every enabled light in the group, respecting the current circadian dim/temperature when turning on.
- **Tunable-light fix (v1.10.5).** Tuneable bulbs now correctly become warmer (not cooler) towards evening.
- **Pre-warm auto-detection during pairing (v1.10.2).** A wizard step tests each light by briefly cycling it off, pre-setting `dim` / `light_temperature` / `light_hue` / `light_saturation`, then turning back on to verify the value persisted. Each capability is marked ✓/✗ per device, with a re-test button available later via Repair.
- **Smarter candidate filter (v1.10.2).** Lights registered as `socket` with `virtualClass: light` (Hue/Z2M-bridged lamps) and Z-Wave dimmer modules with a `dim` capability are now picked up automatically.
- **"Turn on light at current circadian level" action (v1.10.2).** Pick any member of the group from a dropdown — the action sets temperature/colour and dim, then turns the light on, in one step. Avoids the brief flash at the previous brightness for lamps that don't support pre-warming.

**Why use it?**
- Bright cool light during the day, warm dim light in the evening, deep red at night to preserve melatonin and night vision.
- Works at any latitude — pick clock times, solar events, or lux-sensor thresholds per phase.
- Doesn't turn lights on or off; it only adjusts already-on lights, so it never fights with your other automations.

### Anchor modes (mix and match per phase)

| Mode | Description |
|------|-------------|
| **Time** | Fixed clock time (HH:MM). Best near the equator. |
| **Solar event** | Sunrise, sunset, civil/nautical/astronomical dawn/dusk, golden hour, blue hour, solar noon/midnight — with offset minutes and a polar fallback time. |
| **Lux sensor** | A real lux sensor crosses a configurable threshold (rising or falling). Falls back to a fixed time until the first crossing of the day. |

### Light profile

- Per-phase **dim** and **temperature** with smooth interpolation between anchors.
- **Red mode threshold**: when the calculated temperature drops below the threshold, color-capable lights shift to red. Saturation scales with how deep below the threshold you are.
- Per-light tweaks: enable/disable, prewarm before on, allow red mode, min/max dim.

### Outdoor light source

Choose how the device knows how bright it is outside:
- **Astronomical** (sun-elevation calculation)
- **Homey lux sensor**
- **Open-Meteo / MET.no** (radiation-based estimate)
- **External value** pushed from a Flow

### 25 new flow cards

**Triggers**: phase changed, red mode started/ended, paused/resumed, turned on/off, target changed, error, outdoor light requested. Plus an **app-level "Solar event occurred"** card with all 14 events + offset, usable from any flow.

**Conditions**: is in phase, red mode active, is paused, is on.

**Actions**: pause (sec/min/hour), pause until time, pause until solar event, resume, turn on/off/toggle, set red threshold, **apply temporary state** (override dim/temp/saturation/red — restored on next tick, perfect for testing or quick "moods"), **force red mode** (with optional duration), apply now, set outdoor lux, **turn on light at current circadian level** (pick any group member from dropdown), **turn on / off all members** (group-level convenience).

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">→ Read full Circadian Light Group guide</a>

<a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">→ Install store v1.10.16</a>
<br>
<a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">→ Install test v1.10.17</a>

---

## Other devices and flow cards

| Device | Purpose |
|--------|---------|
| **Logic Device** | Boolean logic with visual wizard. Combine device states into TRUE/FALSE using formulas like `A AND B`. |
| **Logic Unit** | Advanced boolean logic with multiple formulas per device. JSON configuration. |
| **State Device** | Scene management — capture states at setup, apply with one action. |
| **State Capture Device** | Dynamic state capture at runtime. Push/pop stack for temporary changes, named slots, JSON backup/restore. |

| Flow Card (no device needed) | Purpose |
|------------------------------|---------|
| **Conditional Gates** | Simple GO/NO GO flow control without variables or devices. |
| **Waiter Gates** | Pause flow until a device capability reaches a target value. |
| **Evaluate Expression** | Range checking and value mapping with AND/OR logic. |

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">→ Complete Device Guide</a>

### Quick examples

**Doorbell ring → push state, change lights, restore:**
```
WHEN: Doorbell rings
THEN: Push current state to stack
THEN: Set all lights to 100%
THEN: Wait 5 minutes
THEN: Pop state (restore previous)
```

**Conditional Gate gating two flows:**
```
Flow 1 — WHEN: Motion sensor triggered
        THEN: Modify Conditional Gate "allow_lights" → GO

Flow 2 — WHEN: Door opened
        AND:  Gate "allow_lights" is GO
        THEN: Turn on lights
```

**Waiter Gate waiting for temperature:**
```
WHEN: Button pressed
THEN: Turn on coffee machine
THEN: Wait until coffee machine temperature ≥ 90°C (timeout 5 min)
  → YES: Send notification "Coffee ready!"
  → NO:  Send notification "Coffee machine timeout"
```

---

## Documentation

- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html" target="_blank">**Getting Started Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">**Device Types Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">**Circadian Light Group**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html" target="_blank">**State Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html" target="_blank">**State Capture Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">**Conditional Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">**Waiter Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html" target="_blank">**Flow Cards Reference**</a>

---

## Installation and Links

* **Homey App Store (v1.10.16):** <a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">Install Smart (Components) Toolkit</a>
* **Test channel (v1.10.17):** <a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">Install test version</a>
* **GitHub Repo:** <a href="https://github.com/tiwas/SmartComponentsToolkit" target="_blank">github.com/tiwas/SmartComponentsToolkit</a>
* **Online Emulator:** <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/emulator.html" target="_blank">Boolean Logic Emulator</a>
* **Formula Builder:** <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/formula-builder.html" target="_blank">Formula Builder</a>

---

## Feedback & Support

Found a bug or have a suggestion? Please report it:

* **GitHub Issues:** <a href="https://github.com/tiwas/SmartComponentsToolkit/issues" target="_blank">Report here</a>
* **This Forum Thread:** Reply below!

Circadian Light Group feedback is especially appreciated — Z-Wave/Zigbee mesh behaviour varies a lot between setups, so real-world reports help tuning.

---

## Support the Project

If you find Smart (Components) Toolkit useful, consider supporting its development:

<a href="https://paypal.me/tiwasno" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-blue.svg" alt="PayPal"></a>

---

**Smart (Components) Toolkit** — Simplify complex logic, state management and circadian lighting in your Homey flows ⚡
