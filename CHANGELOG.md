# Changelog


## 1.2.1 — CLI onboarding candidate

- Detect the official Antigravity CLI and ACP support before enabling native models.
- Install the official CLI only when missing, from Google's installer; reuse an existing working executable. Windows setup keeps the CLI in its official per-user directory without rewriting PATH or shell aliases.
- Guide official sign-in, refresh models automatically when the login terminal exits, and check account model access before patching Workbench.
- Show distinct missing, installing, login-required and error states; allow recheck after manual installation. Verify the official sign-in command and only close its terminal after a successful login.
- Request full Cursor quit/reopen after initial integration or recovery, rather than just reloading the window.
- Preserve the V1.2.0 renderer, provider switching and model routing.
- Multi-version compatibility: discover the model availability guard through stable native properties and local bindings rather than minified identifiers. Require every native picker/Agent seam before modifying resources and report missing or ambiguous seams.
- Add a read-only-source compatibility matrix probe for syntax, patch installation and byte-exact restore on isolated resource copies.
- Candidate checks: 54 automated tests on the candidate; official CLI clean-install verified on Windows and macOS. Multi-version UI acceptance pending.

## 1.2.0 — Windows + macOS

### Added
- Windows x64 support, official agy.exe discovery and PowerShell login, including custom-drive Cursor installs.
- Windows UAC-protected compatibility installer and standalone Restore Cursor.cmd; existing macOS recovery remains available.
- Exclusive provider switching: Start Service shows Antigravity models only; Stop Service restores Cursor's native picker without restarting Cursor.
- Clear model labels: Gemini 4 Hydrogen·Antigravity, with native reasoning-depth selection.

### Fixed
- Windows application-directory write detection and stale Workbench loading after a compatibility update.
- Explicit stop versus transient disconnect: the ACP process stops, while a lightweight authenticated local control endpoint communicates the paused state. Disconnects do not silently route to Cursor models.
- Preserve the original native catalogue and existing conversation history; use Cursor's native parameter validation and preferences.

### Verified
- Cursor 3.28.7 on Windows x64 and macOS Apple Silicon; official Antigravity CLI 1.5.18.
- 45 automated tests per platform, real-resource patch/restore and lifecycle probes passed.
- Both native model pickers switched between the two providers, listed all 11 available model families (27 variants at test time), and returned successful real Gemini 4 Hydrogen Low chat responses.
- A full Cursor quit/relaunch may be needed after initial installation or compatibility updates. Routine Start/Stop needs neither restart nor elevation.

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
