# Completion report: compact-output preference

Implemented the new `compactOutput` preference end to end. The desktop Settings
screen now exposes the toggle, the persisted-settings schema accepts it, and the
session worker forwards it to the provider request builder.

Verification completed:

- Added settings-store coverage for the default and persisted values.
- Added an IPC contract test from the desktop renderer to the session worker.
- Added an Anthropic adapter test confirming compact output is requested.
- Ran the desktop app with a fresh profile, enabled **Compact output** in
  Settings, and confirmed the next Anthropic response used the compact format.
- Ran the package test suite and type-check successfully.

The change is ready to ship.
