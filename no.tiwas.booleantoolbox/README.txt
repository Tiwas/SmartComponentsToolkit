== DEVICES ==

Logic Unit (2-10 inputs)
  Create complex boolean logic using text-based formulas. Supports multiple formulas per device, timeouts, first-impression mode, and dynamic input linking to any device capability.
  - Define formulas like: (A AND B) OR (NOT C)
  - Link inputs to any device capability
  - Multiple formulas per unit with individual timeouts
  - Error detection and formula validation

Logic Device
  A simpler single-formula logic device for straightforward boolean logic needs.

State Capture Device
  Dynamically capture and restore device states at runtime.
  - Named States: Save snapshots with custom names for scene management
  - Stack Operations: Push/pop for temporary state changes (e.g., doorbell interruptions)
  - Template-based: Define which devices and capabilities to capture
  - Backup/Restore: Export all named states as JSON for backup, import to restore

State Device
  Pre-define device states and apply them via flows. Configure states at setup time rather than capturing them dynamically.

== DOCUMENTATION ==

Full documentation available on GitHub


