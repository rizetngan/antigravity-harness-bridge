# Changelog


## 1.2.0 — Windows candidate

- Add Windows-native agy.exe discovery and PowerShell login.
- Separate local bridge data from Cursor roaming data, preserving macOS paths.
- Support Windows custom-drive Cursor installs and an independent recovery launcher.
- Add Windows real-resource copy patch/restore probe and cross-platform tests.
- Keep v1.1.2 main/release untouched until Windows end-to-end acceptance.

## 1.1.2 — 2026-11-27

### Added
- Native management panel entry in the Activity Bar and bottom status bar.
- Cross-window service management through one authenticated local gateway.
- Live shared status synchronization across Cursor windows.

### Fixed
- Refreshing the live Antigravity model catalogue from a window borrowing the shared gateway.
- Sign-in and reconnect controls being incorrectly disabled in secondary windows.
- Starting and stopping the shared ACP service from any Cursor window.
- Stale per-window paused state preventing a window from attaching to an already-running service.

### Safety
- Active Agent runs remain protected from destructive service controls.
- The Workbench adapter remains version-checked, backed up, hash-verified, and reversible.
