URL: https://community.homey.app/t/app-smart-components-toolkit-was-boolean-toolbox-create-advanced-logic-with-simple-formulas-v1-10-16-store-v1-10-27-test-logic-device-reliability/143906

Title: [APP] Smart (Components) Toolkit (was: Boolean Toolbox) - Create advanced logic with simple formulas [v1.10.16 store / v1.10.35 test - Circadian cards no longer time out, Flow name card]

Content:
![xlarge|690x483](upload://iSxhJPUltgcgPQ7gy4z5iisCv5F.jpeg)

# Smart (Components) Toolkit — store v1.10.16 / test v1.10.35

> **📚 Full Documentation:** https://tiwas.github.io/SmartComponentsToolkit/

Replace complex flow networks with powerful logic devices controlled by dynamic formulas. Make your flows cleaner, more readable, and easier to maintain.

<a href="https://tiwas.github.io/SmartComponentsToolkit/" target="_blank">→ Full Documentation & Interactive Tools</a>

---

## What's new

### v1.10.35 (test channel)

- **Circadian Light Group: no more "Timeout after 60000ms".** Homey stops an app's Flow card after 60 seconds, and the rest of the Flow then never runs. With a few lights that don't answer (an unplugged bulb, a Z-Wave module out of range), turning a group or Collection on could take almost that long, because the card waited for every retry. Now the card lets the Flow continue as soon as every light has its commands and has been checked, usually within a few seconds. Lights that haven't confirmed are retried in the background, and no Circadian card waits more than 50 seconds.
- **New: *Turn on / Turn off / Toggle and report the result*** (Then cards, Advanced Flow). They work like the device's own On/Off/Toggle cards and add two tags: *All lights confirmed* (yes/no) and *Status* (text), for example *"Continued before everything was confirmed. Lights still being retried in the background (1 of 11): Dining room bulb."*
- **Retries stop when you change your mind:** a newer command, pausing the group or deleting it stops retries that are still running, so a retry never turns a light back on after you paused or switched off.
- **Clearer Collection errors:** the error message for groups with unresponsive lights now names the groups (it said *undefined*).
- **Tip:** a lamp that is unplugged slows every command down. Untick *Enabled* for it in the group's light settings until it works again; the *Status* tag tells you which lamps don't answer.

```
WHEN: Button "All on" pressed
THEN: Turn on and report the result (Circadian Light Group Collection)
AND:  All lights confirmed is no
THEN: Create a notification with "Lights: [Status]"
```

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html#retries" target="_blank">Circadian Light Group guide — retries and result tags</a>

### v1.10.34 (test channel)

- **Clearer waiter log:** when a wait takes over a Waiter ID that is already waiting, the app log now says so. The earlier wait still ends on its NO path, as before. Internal clean-up only; nothing changes in your Flows. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">Waiter Gates guide</a>

### v1.10.33 (test channel)

- **Get the name of [this Flow] (Then card, Advanced Flow).** Returns the name, id and folder of the Flow the card is in as tags, so a notification or log line can say which Flow sent it. No more typing the Flow name by hand.
- **Pick once, rename freely:** click the field and pick the only choice, *this Flow*. The name is read every time the card runs, so it follows when you rename the Flow.
- **Copies are caught:** if you copy the card or duplicate the Flow, *Flow name* shows *[Duplicate]*, *Has error* is yes and the *Error message* tag names the Flows, until you pick *this Flow* again in the copy. A Flow that is not saved yet gives *[Unknown – save the Flow]*. The card always continues on its normal output, so put a Logic condition on *Has error* to branch.
- Translated into all 11 app languages.

```
WHEN: This Flow is started
THEN: Get the name of this Flow
THEN: Create a notification with "[Flow name] ran"
```

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html#action-flow-name" target="_blank">Get this Flow's name — reference</a>

### v1.10.32 (test channel)

- **Circadian schedule on local time:** clock-time anchors, lux anchors and *Pause until time* now follow your Homey's time zone, including daylight saving time. Homey runs apps on UTC, so in Norway the schedule ran 2 hours late in summer (1 hour in winter), and mornings stayed dim and red until about 09:00. **If you moved your anchors earlier to compensate, move them back.**
- **Correct outdoor light estimate:** the astronomical estimate (the default outdoor source, also used for MET.no) now follows the real sun at your location. It was up to an hour off in Norway and several hours off in the Americas.
- **Optional morning profile:** tick *Own morning profile* under Repair → Light Profile to give mornings their own brightness and colour temperature. It applies from the Morning anchor and fades into Day. It is off by default, so existing groups behave exactly as before. With it on, *Is in phase* and *Phase changed* also use a Morning phase.
- **Lux anchors kept in the editors:** the pairing and Repair editors no longer turn lux-sensor anchors back into clock times when you open or save them. A saved lux sensor that is missing from the list (deleted, or not loaded yet) now shows as *Unknown sensor* instead of being cleared on save.

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">Circadian Light Group guide</a>

### v1.10.31 (test channel)

- **More reliable realtime updates:** the Homey Web API library is updated to 3.20.0, which shares device subscriptions and restores them automatically after a connection drop. Logic Devices, Circadian Light Groups and capability waiters keep receiving device changes after network hiccups.

### v1.10.30 (test channel)

- **No more app restarts from leaked subscriptions:** realtime device subscriptions are shared, so the Logic Device health check no longer grows memory until Homey restarts the app, and one listener finishing no longer stops updates for other Logic Devices on the same device.
- **Wait longer than one minute:** *Start waiting for Conditional Gate GO* and *Start waiting until device capability becomes value* wait in the background; the *…wait finished* triggers continue your Flow. <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">Conditional Gates guide</a> · <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">Waiter Gates guide</a>
- **Clear 60-second limit handling:** waits inside a card end with an explanatory message at 55 s instead of Homey's generic `Timeout after 60000ms`.
- **Better diagnostics:** warnings show where they come from, memory is sampled over time, and unclean shutdowns are reported.

### v1.10.29 (test channel)

- **Diagnostic report generation fixed:** Homey models that cannot provide process-memory or other resource metrics can now generate a report successfully.
- **Graceful resource fallback:** unavailable CPU, memory, or storage values are shown as `unavailable`; all other diagnostics remain in the report.

### v1.10.28 (test channel)

- **Diagnostic report from App Settings:** generate a readable report containing the installed version, current-session uptime, recent warnings/errors and stack traces.
- **Resource and setup load:** includes available app/Homey CPU, memory and storage data, anonymous app-device counts, and Circadian Light Group member, watcher and scheduler details.
- **Prefilled GitHub issue:** review the report, then open a new issue with the version and report already filled in. Nothing is uploaded automatically.
- **Privacy-conscious:** device names and IDs are omitted from structured data, and common identifiers and secrets are redacted from captured log lines. Always review before submitting.

### v1.10.27 (test channel)

This test release is a general reliability improvement based on a thorough code review.

- **Reliable Logic Device updates:** formula evaluations are serialized and stale results are discarded, so bursts of linked-device updates cannot leave a Logic Device on an old result.
- **Quieter diagnostics:** normal Logic Unit updates no longer flood the app log.
- **Lean release package:** development-only material is excluded and manifest assets are verified before release.

### v1.10.25 (test channel)

- **Ordered Collection flows:** Collection cards wait for all member work before downstream cards run.
- **Deterministic conflicts:** pause/resume runs before simultaneous on/off operations.
- **Cascading pause:** pausing or resuming a Collection propagates to every member Circadian Light Group.

### v1.10.24 (test channel)

- **Reliable activation from all-off:** member lights now acknowledge on before receiving dim and colour targets.
- **Settling-safe watcher:** short off/on bounces during intentional activation are accepted, while an explicit off still wins immediately.
- **Race-free scheduling:** explicit member commands are no longer superseded by scheduler ticks, and the Collection no longer duplicates member schedulers or resume applies.

### v1.10.23 (test channel)

- **Logic Unit alarm restored:** the read-only Formula result alarm now follows the combined result of all enabled formulas, so Homey's standard generic-alarm turned on/off cards work again.
- **New Formula changed card:** fires on every TRUE/FALSE transition for the selected formula and provides the current and previous result as tags.
- **Fixed Formula changed to... card:** correctly filters on both the selected formula and the chosen TRUE/FALSE result.
- Existing formula-trigger IDs are retained for backwards compatibility with saved flows.

### v1.10.22 (test channel)

- **Composite value changed:** a new device trigger that fires for real numeric, alarm/boolean, text, enum, or clock-value changes and exposes current value, previous value, value type, and device name.
- **Composite value changed by more than:** a numeric trigger with a configurable fixed-unit or percentage threshold plus signed, absolute, and percentage change tags.
- Startup establishes the comparison baseline without firing either card. Thresholds compare consecutive exposed values and do not accumulate smaller changes.

### v1.10.21 (test channel)

- **Composite Device is now included in the app listing.** Its Store description, small device image, community listing, and online guide have all been refreshed.
- **Guide:** <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/composite-device.html" target="_blank">See setup steps, supported calculations, and examples</a>.

### v1.10.20 (test channel)

- **New Composite Device.** Combine the same capability from two or more devices into one live virtual sensor, alarm, or text value.
- **Numbers:** average, minimum, maximum, sum, and median. A five-sensor humidity group can now expose its highest or lowest reading directly.
- **Alarms and booleans:** any/all, majority, count on, and percentage on. For example, a composite contact alarm is active when any selected door or window is open.
- **Text and clock values:** most common, min/max, most recently updated, and circular average clock time. For example, 23:00 and 01:00 average to 00:00.
- **Logic Unit guide:** illustrated Advanced Settings and Flow examples are now included in the online documentation.

### v1.10.19 (test channel)

- **Logic Device restart fix.** Logic Device groups that depend on another Logic Device now re-fetch their linked inputs after an app restart, so nested groups keep working after Smart (Components) Toolkit restarts.
- **Circadian Light Group member verification.** Improved handling around member verification so group state reporting is more reliable when members are checked or temporarily unavailable.

### v1.10.18 (test channel)

- **Math Compare (And card).** Calculate one value with `+`, `-`, `*` or `/`, then compare the result with another value. Useful for rules like `temperature + 3 is greater than high_threshold`.
- **Gradient Map (Then card).** Map an input value from one range to another and expose the result as a `Mapped value` tag for the next card. Supports range offsets and configurable rounding, for example mapping a room temperature into a heat pump / aircondition fan speed.
- **Token fix (v1.10.18).** The Gradient Map token now has a distinct `Mapped value` tag, so it is easier to pick the token from the specific map card that actually ran.

**Heat pump / aircondition example:**
```
WHEN: Temperature changes
AND:  Temperature is less than low_threshold_livingroom
THEN: Set fan speed to 0%

WHEN: Temperature changes
AND:  Temperature is greater than or equal to low_threshold_livingroom
THEN: Map Temperature in range low_threshold_livingroom to high_threshold_livingroom into 100-500, round to 1
THEN: Set fan speed to Mapped value
```

---

## 🔎 Debugging across Flows — *Get the name of this Flow* + Flow Doctor

When Flows start each other, or several Flows send notifications, log lines or variables to the same place, it is hard to see which Flow actually did what.

**New card: *Get the name of [this Flow]*** (Advanced Flow, test v1.10.33 and later)
- Put it in any Advanced Flow and use the *Flow name* tag in notifications, timeline entries, log lines or values you pass on to a shared Flow. You see at once which Flow sent each message.
- No hard-coded names that go stale: the name is read every time the card runs, so it follows when you rename the Flow. *Flow id* and *Folder* tags are there too, for example to group log lines by folder.
- A log never names the wrong Flow: if you copy the card or duplicate the Flow, *Flow name* shows *[Duplicate]*, *Has error* turns yes and *Error message* names the Flows until you pick *this Flow* again in the copy.

**Flow Doctor: Flow tree and loop check**
- The new *Flow tree* tab shows all your Flows in their folders. Select one to see every Flow that starts, enables or disables it, through the whole chain, with flags for disabled Flows, unconnected cards, *else* branches and delays.
- **Circular references:** Flow Doctor warns about Flows that start each other in a loop, which can keep running forever. It tells active loops from inactive ones (through a disabled Flow or an unconnected card). The Flows view also reports references to deleted Flows.

Together they cover both sides: Flow Doctor shows how your Flows are wired, and the new card shows at run time which Flow actually ran.

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html#action-flow-name" target="_blank">Get this Flow's name — reference</a> · <a href="https://tiwas.github.io/SmartComponentsToolkit/tools/flow-doctor.html" target="_blank">Open Flow Doctor</a>

---

## ✨ Circadian Light Group — now on stable

A virtual **light device** that adjusts brightness and color temperature for a group of real lights — automatically following a circadian rhythm. Store is currently v1.10.16; v1.10.35 is available on the test channel.

### Circadian Light Group highlights

- **No more 60-second timeouts (v1.10.35).** Cards let the Flow continue once every light has its commands; lights that don't answer are retried in the background. *Turn on / Turn off / Toggle and report the result* (Advanced Flow) tell you whether every light confirmed.
- **Local time and morning profile (v1.10.32).** The schedule follows your Homey's time zone instead of UTC. Mornings can have their own dim and temperature, and lux anchors stay intact when you edit the group.
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

### 25 new flow cards

**Triggers**: phase changed, red mode started/ended, paused/resumed, turned on/off, target changed, error, outdoor light requested. Plus an **app-level "Solar event occurred"** card with all 14 events + offset, usable from any flow.

**Conditions**: is in phase, red mode active, is paused, is on.

**Actions**: pause (sec/min/hour), pause until time, pause until solar event, resume, turn on/off/toggle (also as **… and report the result** with *All lights confirmed* and *Status* tags, Advanced Flow), set red threshold, **apply temporary state** (override dim/temp/saturation/red — restored on next tick, perfect for testing or quick "moods"), **force red mode** (with optional duration), apply now, set outdoor lux, **turn on light at current circadian level** (pick any group member from dropdown), **turn on / off all members** (group-level convenience).

<a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">→ Read full Circadian Light Group guide</a>

<a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">→ Install store v1.10.16</a>
<br>
<a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">→ Install test v1.10.32</a>

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

> Homey stops every app Flow card after 60 seconds. The in-card waits (*Conditional Gate: Wait for GO*, *Wait until device capability becomes value*, *Wait*) therefore end after at most 55 seconds; use the **Start waiting…** cards plus their **…wait finished** trigger for anything longer. In an Advanced Flow both parts can live on one canvas. Pending waits are kept in memory and are lost if the app restarts.

---

## Documentation

- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/getting-started.html" target="_blank">**Getting Started Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/devices.html" target="_blank">**Device Types Guide**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/composite-device.html" target="_blank">**Composite Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/circadian-light-group.html" target="_blank">**Circadian Light Group**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-device.html" target="_blank">**State Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/state-capture-device.html" target="_blank">**State Capture Device**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/conditional-gates.html" target="_blank">**Conditional Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/waiter-gates.html" target="_blank">**Waiter Gates**</a>
- <a href="https://tiwas.github.io/SmartComponentsToolkit/docs/flow-cards.html" target="_blank">**Flow Cards Reference**</a>

---

## Installation and Links

* **Homey App Store (v1.10.16):** <a href="https://homey.app/en-no/app/no.tiwas.booleantoolbox/" target="_blank">Install Smart (Components) Toolkit</a>
* **Test channel (v1.10.32):** <a href="https://homey.app/a/no.tiwas.booleantoolbox/test/" target="_blank">Install test version</a>
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
