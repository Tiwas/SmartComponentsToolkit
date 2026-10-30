URL: https://community.homey.app/t/app-smart-components-toolkit-was-boolean-toolbox-create-advanced-logic-with-simple-formulas-v1-10-16-store-v1-10-27-test-logic-device-reliability/143906

Title: [APP] Smart (Components) Toolkit (was: Boolean Toolbox) - Create advanced logic with simple formulas [v1.10.38 store & test - Presence+, Circadian Light Group, Composite Device]

Content:
![xlarge|690x483](upload://iSxhJPUltgcgPQ7gy4z5iisCv5F.jpeg)

# Smart (Components) Toolkit — v1.10.38 (store and test)

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Replace complex flow networks with powerful logic devices controlled by dynamic formulas. Make your flows cleaner, more readable, and easier to maintain.

<a href="https://tiwas.github.io/SmartComponentsToolkit/" target="_blank">→ Full Documentation & Interactive Tools</a>

---

## What's new in v1.10.38

v1.10.38 is now live in the Homey App Store, and the store and the test channel run the same version. If you come from the previous store version (v1.10.16), this is what you get:

- **Presence+.** Start a Flow only after one selected person, or everyone, has stayed away for a chosen number of minutes. A return cancels the pending trigger, so brief Home/Away glitches are filtered out. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/presence-plus.html" target="_blank">Presence+ guide</a>
- **Composite Device.** Combine the same capability from several devices into one live value: average, minimum or maximum of numbers, any/all of alarms, or text and clock values, with triggers for every change or for changes above a threshold. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/composite-device.html" target="_blank">Composite Device guide</a>
- **Circadian Light Group.** The schedule follows your Homey's time zone, mornings can have their own profile, and cards no longer hit Homey's 60-second timeout. New *… and report the result* cards tell you which lights did not answer, and Collections pause, resume and switch more reliably. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">Circadian Light Group guide</a>
- **Waits longer than one minute.** *Start waiting…* cards wait in the background and a *…wait finished* trigger continues your Flow, for both Conditional Gates and Waiter Gates. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">Conditional Gates</a> · <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">Waiter Gates</a>
- **New Flow cards.** Math Compare, Gradient Map and *Get the name of this Flow*. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html" target="_blank">Flow Cards Reference</a>
- **Logic Unit and Logic Device.** The *Formula result* alarm works with Homey's standard alarm cards again, new *Formula changed* triggers fire on every TRUE/FALSE change, and Logic Devices that depend on other Logic Devices keep working after an app restart.
- **Diagnostic report.** Generate a privacy-conscious report from App Settings and open a prefilled GitHub issue. Nothing is uploaded automatically.
- **Reliability.** Shared realtime subscriptions keep devices updated after network hiccups and stop the memory growth that could make Homey restart the app.

<a href="https://github.com/tiwas/SmartComponentsToolkit/blob/main/CHANGELOG.md" target="_blank">Full version history (CHANGELOG)</a>

---

## 🏠 Presence+

Homey's presence can flicker between Home and Away. Presence+ waits until a person, or everyone, has really been away for the number of minutes you choose before it starts your Flow. A return before the delay expires cancels the pending trigger, a new departure starts a new countdown, and countdowns survive an app restart.

```
WHEN: Everyone has been away for 15 minutes
THEN: Turn off all lights
THEN: Set the thermostat to 17 °C
```

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/presence-plus.html" target="_blank">→ Read the Presence+ guide</a>

---

## 🔎 Debugging across Flows — *Get the name of this Flow* + Flow Doctor

When Flows start each other, or several Flows send notifications, log lines or variables to the same place, it is hard to see which Flow actually did what.

***Get the name of [this Flow]*** (Advanced Flow)
- Put it in any Advanced Flow and use the *Flow name* tag in notifications, timeline entries, log lines or values you pass on to a shared Flow. You see at once which Flow sent each message.
- No hard-coded names that go stale: the name is read every time the card runs, so it follows when you rename the Flow. *Flow id* and *Folder* tags are there too, for example to group log lines by folder.
- A log never names the wrong Flow: if you copy the card or duplicate the Flow, *Flow name* shows *[Duplicate]*, *Has error* turns yes and *Error message* names the Flows until you pick *this Flow* again in the copy.

```
WHEN: This Flow is started
THEN: Get the name of this Flow
THEN: Create a notification with "[Flow name] ran"
```

**Flow Doctor: Flow tree and loop check**
- The *Flow tree* tab shows all your Flows in their folders. Select one to see every Flow that starts, enables or disables it, through the whole chain, with flags for disabled Flows, unconnected cards, *else* branches and delays.
- **Circular references:** Flow Doctor warns about Flows that start each other in a loop, which can keep running forever. It tells active loops from inactive ones (through a disabled Flow or an unconnected card). The Flows view also reports references to deleted Flows.
- **Deleted devices:** the app keeps a record of Homey device IDs and names, so Flow Doctor can tell you which deleted device a broken Flow refers to.

Together they cover both sides: Flow Doctor shows how your Flows are wired, and the card shows at run time which Flow actually ran.

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html#action-flow-name" target="_blank">Get this Flow's name — reference</a> · <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html" target="_blank">Open Flow Doctor</a>

---

## 💡 Circadian Light Group

A virtual **light device** that adjusts brightness and color temperature for a group of real lights — automatically following a circadian rhythm.

### Highlights

- **No 60-second timeouts.** Cards let the Flow continue as soon as every light has its commands; lights that don't answer are retried in the background, and no card waits more than 50 seconds. *Turn on / Turn off / Toggle and report the result* (Advanced Flow) add *All lights confirmed* and *Status* tags, so you can see which lamps did not answer.
- **Local time and morning profile.** The schedule follows your Homey's time zone, including daylight saving time. Tick *Own morning profile* to give mornings their own brightness and colour temperature.
- **Fast, predictable group commands.** Up to 5 lights are switched at the same time, and the newest command wins: "all off" right after "all on" supersedes the on instead of fighting it. The on/off state is verified afterwards and transient Z-Wave / Zigbee timeouts are retried.
- **Collections.** Combine several groups into one virtual light. Pausing or resuming a Collection reaches every member group, and Collection cards wait for all members before the Flow continues.
- **Pre-warm auto-detection during pairing.** A wizard step tests each light by briefly cycling it off, pre-setting `dim` / `light_temperature` / `light_hue` / `light_saturation`, then turning it back on to verify the value persisted. Each capability is marked ✓/✗ per device, with a re-test button available later via Repair.
- **Smart light detection.** Lights registered as `socket` with `virtualClass: light` (Hue/Z2M-bridged lamps) and Z-Wave dimmer modules with a `dim` capability are picked up automatically.
- **"Turn on light at current circadian level".** Pick any member of the group from a dropdown — the action sets temperature/colour and dim, then turns the light on, in one step. Avoids the brief flash at the previous brightness for lamps that don't support pre-warming.

**Why use it?**
- Bright cool light during the day, warm dim light in the evening, deep red at night to preserve melatonin and night vision.
- Works at any latitude — pick clock times, solar events, or lux-sensor thresholds per phase.
- Doesn't turn lights on or off; it only adjusts already-on lights, so it never fights with your other automations.

### Anchor modes (mix and match per phase)

| Mode | Description |
|------|-------------|
| **Time** | Fixed clock time (HH:MM) in your Homey's time zone. Best near the equator. |
| **Solar event** | Sunrise, sunset, civil/nautical/astronomical dawn/dusk, golden hour, blue hour, solar noon/midnight — with offset minutes and a polar fallback time. |
| **Lux sensor** | A real lux sensor crosses a configurable threshold (rising or falling). Falls back to a fixed time until the first crossing of the day. |

### Light profile

- Per-phase **dim** and **temperature** with smooth interpolation between anchors, and an optional own **morning** profile.
- **Red mode threshold**: when the calculated temperature drops below the threshold, color-capable lights shift to red. Saturation scales with how deep below the threshold you are.
- Per-light tweaks: enable/disable, prewarm before on, allow red mode, min/max dim.

### Outdoor light source

Choose how the device knows how bright it is outside:
- **Astronomical** (sun-elevation calculation)
- **Homey lux sensor**
- **Open-Meteo / MET.no** (radiation-based estimate)
- **External value** pushed from a Flow

### Flow cards

**Triggers**: phase changed, red mode started/ended, paused/resumed, turned on/off, target changed, error, outdoor light requested. Plus an **app-level "Solar event occurred"** card with all 14 events + offset, usable from any flow.

**Conditions**: is in phase, red mode active, is paused, is on.

**Actions**: pause (sec/min/hour), pause until time, pause until solar event, resume, turn on/off/toggle (also as **… and report the result** with *All lights confirmed* and *Status* tags, Advanced Flow), set red threshold, **apply temporary state** (override dim/temp/saturation/red — restored on next tick, perfect for testing or quick "moods"), **force red mode** (with optional duration), apply now, set outdoor lux, **turn on light at current circadian level** (pick any group member from dropdown), **turn on / off all members** (group-level convenience).

```
WHEN: Button "All on" pressed
THEN: Turn on and report the result (Circadian Light Group Collection)
AND:  All lights confirmed is no
THEN: Create a notification with "Lights: [Status]"
```

> **Tip:** a lamp that is unplugged slows every command down. Untick *Enabled* for it in the group's light settings until it works again; the *Status* tag tells you which lamps don't answer.

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">→ Read full Circadian Light Group guide</a>

---

## Other devices and flow cards

| Device | Purpose |
|--------|---------|
| **Composite Device** | Aggregate a shared capability across multiple devices as min/max/average, alarm, count, text, or clock time. |
| **Logic Device** | Boolean logic with visual wizard. Combine device states into TRUE/FALSE using formulas like `A AND B`. |
| **Logic Unit** | Advanced boolean logic with multiple formulas per device. JSON configuration. |
| **State Device** | Scene management — capture states at setup, apply with one action. |
| **State Capture Device** | Dynamic state capture at runtime. Push/pop stack for temporary changes, named slots, JSON backup/restore. |

| Flow Card (no device needed) | Purpose |
|------------------------------|---------|
| **Conditional Gates** | Simple GO/NO GO flow control without variables or devices. Short waits in the card, long waits in the background with a "wait finished" trigger. |
| **Waiter Gates** | Wait until a device capability reaches a target value — in the card (up to 55 s) or in the background with a "wait finished" trigger. |
| **Presence+** | Wait until one selected person, or everyone, has remained away for the configured minutes; any return cancels the pending trigger. |
| **Evaluate Expression** | Range checking and value mapping with AND/OR logic. |
| **Math Compare** | Compare a calculated number, e.g. `Temperature + 3` against a threshold. |
| **Gradient Map** | Map a number from one range to another and pass the `Mapped value` tag to the next card. |
| **Get this Flow's name** | Return the name, id and folder of the Advanced Flow the card is in as tags, e.g. for notifications and logs. |

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">→ Complete Device Guide</a>

### Quick examples

**Doorbell ring → push state, change lights, restore:**
```
WHEN: Doorbell rings
THEN: Push current state to stack
THEN: Set all lights to 100%
THEN: Pop state (restore previous) [Homey Flow delay: 5 minutes]
```

**Conditional Gate gating two flows:**
```
Flow 1 — WHEN: Motion sensor triggered
        THEN: Modify Conditional Gate "allow_lights" → GO

Flow 2 — WHEN: Door opened
        AND:  Gate "allow_lights" is GO
        THEN: Turn on lights
```

**Long wait with a Conditional Gate (more than 60 seconds):**
```
Flow 1 — WHEN: Razor turned on
        THEN: Modify Conditional Gate "Razor" → NO GO
        THEN: Start waiting for Conditional Gate GO "Razor" (timeout 2 minutes)

Flow 2 — WHEN: Conditional Gate wait finished "Razor"
        THEN: Turn off Razor   (Result tag: GO = released early, TIMEOUT = 2 minutes passed)
```

**Waiter Gate waiting for a device (more than 60 seconds):**
```
Flow 1 — WHEN: Button pressed
        THEN: Turn on kettle
        THEN: Start waiting until Kettle onoff becomes false (timeout 10 min, id kettle_boil)

Flow 2 — WHEN: Capability wait finished "kettle_boil"
        AND:  "Value matched" tag is Yes
        THEN: Send notification "Water is ready!"
```

**Heat pump / aircondition fan speed with Math Compare and Gradient Map:**
```
WHEN: Temperature changes
AND:  Temperature is less than low_threshold_livingroom
THEN: Set fan speed to 0%

WHEN: Temperature changes
AND:  Temperature is greater than or equal to low_threshold_livingroom
THEN: Map Temperature in range low_threshold_livingroom to high_threshold_livingroom into 100-500, round to 1
THEN: Set fan speed to Mapped value
```

> Homey stops every app Flow card after 60 seconds. The in-card waits (*Conditional Gate: Wait for GO*, *Wait until device capability becomes value*, *Wait*) therefore end after at most 55 seconds; use the **Start waiting…** cards plus their **…wait finished** trigger for anything longer. In an Advanced Flow both parts can live on one canvas. Pending waits are kept in memory and are lost if the app restarts.

---

## Documentation

- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html" target="_blank">**Getting Started Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">**Device Types Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/composite-device.html" target="_blank">**Composite Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">**Circadian Light Group**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/presence-plus.html" target="_blank">**Presence+**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html" target="_blank">**State Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html" target="_blank">**State Capture Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">**Conditional Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">**Waiter Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html" target="_blank">**Flow Cards Reference**</a>

---

## Installation and Links

* **Homey App Store (v1.10.38):** <a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">Install Smart (Components) Toolkit</a>
* **Test channel (v1.10.38, same as the store):** <a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">Install test version</a>
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
