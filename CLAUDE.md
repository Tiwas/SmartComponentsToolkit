# HomeyBooleanToolbox — repo conventions

## HTML tools must stay in sync with device code

The repo ships browser-based companion tools under `docs/tools/*.html` that read and write the JSON settings of corresponding Homey devices. Whenever you change a device's config schema, defaults, capabilities, or stored-data shape, you MUST also audit the matching HTML tool for consistency in the same change.

Device → tool mapping (extend as new tools land):

| Device driver | Companion tool |
|---|---|
| `drivers/circadian-light-group` | `docs/tools/clg-editor.html` |
| `drivers/state-capture-device`, `drivers/state-device` | `docs/tools/state-editor.html`, `docs/tools/state-editor-api.html` |
| `drivers/logic-device`, `drivers/logic-unit*` | `docs/tools/boolean-editor.html`, `docs/tools/formula-builder.html`, `docs/tools/emulator.html` |
| (floorplan settings) | `docs/tools/floorplan-editor.html` |
| (diagnostic; reads app state) | `docs/tools/flow-doctor.html` |

What "audit for consistency" means at minimum:
- Round-trip: paste a real current config_json into the tool, export, and verify no fields are dropped or reshaped (preserve unknown keys like `_meta`, `version`, capability arrays, prewarm state, etc.).
- DEFAULT_CONFIG / template values in the tool match the driver's `createDefaultConfig` (or equivalent).
- New anchor modes, provider options, capability flags, or enum values added to the device are surfaced — or at least preserved unchanged — by the tool.
- If a field can't be edited in the UI yet, the tool must still pass it through untouched, and the change description should call out the gap.

If the schema change is large enough that the tool needs a real UI update, do not silently ship a device change that breaks round-tripping — either land the tool update in the same PR or open a follow-up issue and note it in the PR description.
