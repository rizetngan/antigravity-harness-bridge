<div align="center">

<img src="docs/images/antigravity-logo.png" width="92" alt="Antigravity Agent Bridge icon">

# Antigravity Agent Bridge

**Bring your Antigravity models into Cursor's native Agent experience.**

Native model picker · Native thinking depth · Conversation continuity · Instant provider switching

[![Release](https://img.shields.io/github/v/release/rizetngan/antigravity-harness-bridge?label=release)](https://github.com/rizetngan/antigravity-harness-bridge/releases/latest) ![Windows](https://img.shields.io/badge/Windows-x64-0078D4) ![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-555) ![ACP](https://img.shields.io/badge/Agent%20protocol-ACP-4285F4)

English · [简体中文](README.zh-CN.md)

[Download](#download) · [Highlights](#highlights) · [Platforms](#platform-support) · [Installation](#installation) · [Agent-assisted installation](#agent-assisted-installation) · [Development](#development--validation)

</div>

<p align="center">
<img src="docs/images/macos-native-picker.png" width="67%" alt="Antigravity models and Low thinking depth in Cursor's native model picker">
<img src="docs/images/macos-management.png" width="25%" alt="Antigravity management panel with connected account and model catalogue">
<br><sub>V1.2.0 on macOS: actual native picker and management panel.</sub>
</p>

Antigravity Agent Bridge is built around Google's official Antigravity CLI and Agent Client Protocol (ACP). **Keep the Cursor editor, native conversation, and familiar workflow while using the models available to your signed-in Antigravity account.** No separate chat interface or manual copying between IDEs.

The first production adapter is **Antigravity for Cursor**, validated on Windows and macOS. Other agent harnesses can use direct ACP where supported, or dedicated adapters where deeper integration is needed.

> **V1.2.1 validation:** Windows x64 on Cursor 3.28.7 and 3.32.4 passed native model selection, Hydrogen Low chat and provider switching. The official CLI clean-install, 54 automated tests and real-resource patch/restore passed on both platforms. macOS 3.28.7 retains the previously live-tested native adapter; the V1.2.1 gateway passed a real Hydrogen Low request. macOS 3.32.4 also passed native Hydrogen Low chat, service stop/start and same-conversation context continuity using the released VSIX. Antigravity model execution uses the Antigravity account; the adapter preserves the host's native picker policies.

> **V1.2.3:** Reduced unnecessary validation, improved recovery, stale-lock handling, bundled Node reuse and new-install port selection. Windows: 71 automated tests passed, real Cursor 3.32.4 resource install/restore and lifecycle probes passed. macOS retest and full native conversation regression were not performed for this release.

## Download

**V1.2.3 stable** · Windows x64 / macOS Apple Silicon · See verified host versions below · CLI 1.5.18 tested

**[Download VSIX (both platforms)](https://github.com/rizetngan/antigravity-harness-bridge/releases/download/v1.2.3/antigravity-cursor-1.2.3.vsix)** · [Release notes](https://github.com/rizetngan/antigravity-harness-bridge/releases/tag/v1.2.3) · [All releases](https://github.com/rizetngan/antigravity-harness-bridge/releases)

SHA-256: see the release asset digest for optional verification.

**Installing the Antigravity desktop app alone is not sufficient.** The adapter requires Cursor and the separately installed [official Antigravity CLI (`agy`)](https://antigravity.google/docs/getting-started?tab=cli). Keep your desktop app; install the CLI only if missing, and use the official account sign-in flow. Use the dependency-check commands or agent-assisted installation below. Initial integration may require normal OS authorization; daily service switching does not require elevation or restart.

## Highlights

### Native model and reasoning-depth selection

Choose models inside Cursor's own picker. Labels such as `Gemini 4 Hydrogen·Antigravity` make the provider explicit; native thinking-depth controls expose only the options supported by the model.

The catalogue is discovered dynamically through ACP. The test account exposed 11 model families and 27 model/effort variants in V1.2.0; actual availability depends on the account and service.

### One switch, two provider modes

<p align="center">
<img src="docs/images/macos-native-picker.png" width="48%" alt="Antigravity-only models after starting the service">
<img src="docs/images/macos-cursor-picker.png" width="48%" alt="Native Cursor models restored after stopping the service">
<br><sub>Left: service started. Right: service stopped. Actual cropped menus.</sub>
</p>

| Action | Result |
| --- | --- |
| Start Service | Show only Antigravity models |
| Stop Service | Stop ACP and restore Cursor's original model directory |
| Temporary disconnect | Keep Antigravity mode; do not silently fall back to Cursor-billed models |
| Restore Cursor | Restore original Workbench resources and remove the integration |

Daily switching does not restart Cursor or delete existing conversations. If a conversation still points to an unavailable model after a provider change, explicitly select an available model before sending another message.

### Real native Agent conversations

<p align="center"><img src="docs/images/windows-3324-native-continuity.png" width="96%" alt="Windows 3.32.4 native chat continuity after service restart"><br><sub>V1.2.1 / Cursor 3.32.4: actual native conversation, including the follow-up after restarting the service.</sub></p>

<p align="center">
<img src="docs/images/windows-native-chat.png" width="90%" alt="Real Windows Cursor native chat: Gemini 4 Hydrogen Low returned HYDROGEN_LOW_UI_OK">
<br><sub>Windows: actual Gemini 4 Hydrogen Low request and response in Cursor.</sub>
</p>

<p align="center">
<img src="docs/images/macos-native-chat.png" width="36%" alt="Real macOS Cursor native chat: HYDROGEN_LOW_MAC_UI_OK">
<br><sub>macOS: independently verified Hydrogen Low conversation.</sub>
</p>

Cursor owns the visible transcript. The adapter maps ACP sessions, synchronizes visible context, and translates streamed responses, supported tool events and checkpoints into Cursor's native conversation. Tool permissions depend on ACP and the capabilities of the host.

### A native panel with reversible integration

Open Antigravity from Cursor's status bar to start or stop the service, connect the account, refresh the model catalogue, or restore Cursor. Multiple windows share the authenticated loopback gateway. The official `agy acp` process remains responsible for agent execution.

The integration is version-checked, backs up modified Workbench resources and verifies their hashes. It is not a Cursor fork or a generic OpenAI-compatible proxy, and does not extract OAuth credentials.

## Why this approach?

| Approach | Antigravity for Cursor | Separate IDEs | Generic model API | ACP-native host |
| --- | --- | --- | --- | --- |
| UI | Native Cursor Agent | Each IDE separately | Client-dependent | Native host Agent |
| Model/effort picker | Native Cursor controls | Separate controls | Interface-dependent | Host-dependent |
| Execution | Official Antigravity ACP | Separate agents | Usually model requests | Official ACP |
| Continuity | Cursor-to-ACP session mapping | Manual workflow switching | Implementation-dependent | Host-dependent |
| Switching | Start / Stop Service | Change IDE | Change endpoint | Host-dependent |

For a client that already supports ACP, prefer Google's direct `agy acp` connection. The value of the native adapter is integration into the host's workflow, not building another model API.

## Platform support

| Platform / client | Status | Installation |
| --- | --- | --- |
| Windows x64 + Cursor 3.28.7 | Stable, live-tested | Shared VSIX; UAC for protected directories |
| macOS Apple Silicon + Cursor 3.28.7 | V1.2.0 native UI verified; V1.2.1 gateway and resource regression passed | Shared VSIX; App Management authorization as needed |
| Windows x64 + Cursor 3.32.4 | Live native picker, chat, switching and context continuity passed | Shared VSIX |
| macOS Apple Silicon + Cursor 3.32.4 | Live native chat, switching and context continuity passed; resource compatibility and exact restore passed | Shared VSIX |
| Windows ARM64 / Intel Mac / Linux | Not live-tested | Compatibility not established |
| Zed, JetBrains and other ACP clients | Official direct ACP path | Follow client-specific Google documentation |
| Other non-ACP agent harnesses | Future adapters | Host-specific validation required |

Cursor integration depends on version-specific Workbench resources. Recheck compatibility when Cursor updates. [Client compatibility matrix](docs/client-compatibility.md)

## Installation

**Quick setup (V1.2.3):** Install the VSIX → open the Antigravity management panel → choose Install and Connect if the CLI is missing (existing CLI is reused) → complete official sign-in if requested → Enable Native Models → fully quit and reopen Cursor → Start Service. The terminal steps below are an alternative.

### Step 1: Detect and install the official CLI if needed

The desktop app and `agy` are distinct installation components. The bridge calls the official agent via `agy acp`, not the desktop application. Reuse a working CLI installation instead of reinstalling or upgrading it. These commands check PATH and the official default location, invoke Google's installer only when the CLI is missing, and verify the version and ACP command.

**macOS · Terminal**

```bash
set -e
agy_bin="$(command -v agy || true)"
if [ -z "$agy_bin" ] && [ -x "$HOME/.local/bin/agy" ]; then
  agy_bin="$HOME/.local/bin/agy"
fi
if [ -z "$agy_bin" ]; then
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  agy_bin="$HOME/.local/bin/agy"
fi
"$agy_bin" --version
"$agy_bin" acp --help
```

**Windows · PowerShell**

```powershell
$ErrorActionPreference = 'Stop'
$agy = Get-Command agy.exe -ErrorAction SilentlyContinue
$agyPath = if ($agy) { $agy.Source } else { Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe' }
if (-not (Test-Path $agyPath)) {
    & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://antigravity.google/cli/install.ps1'))) --skip-path --skip-aliases
    $agyPath = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
}
& $agyPath --version
if ($LASTEXITCODE -ne 0) { throw 'agy verification failed' }
& $agyPath acp --help
if ($LASTEXITCODE -ne 0) { throw 'ACP unavailable' }
```

Default locations: macOS `~/.local/bin/agy`; Windows `%LOCALAPPDATA%\agy\bin\agy.exe`. The absolute path works even before PATH is refreshed. For a custom installation, use the actual executable or add its directory to PATH. If sign-in is required, launch the detected CLI and complete the official interactive sign-in. Reuse valid authentication when available.

[Google's official CLI installation guide](https://antigravity.google/docs/getting-started?tab=cli)

### Step 2: Enable Cursor integration

1. Download and install the VSIX; for an existing integration, follow the upgrade instructions below first.
2. Open the Antigravity panel; choose Install and Connect if the CLI is missing. Complete official Antigravity sign-in when requested.
3. Open **Antigravity** from the status bar and select **Enable Native Models**.
4. Confirm any required system permission, then fully quit and reopen Cursor.
5. Start Service and select a model and thinking depth in Cursor's native picker. Stop Service to return to native Cursor models.

**Upgrading:** restore the previous Workbench integration first, install the new VSIX, re-enable native models, then fully quit and reopen Cursor. Preserve your existing conversations and settings.

### Terminal installation

The following commands install V1.2.3; optional download digest is on the release page. Complete the CLI detection and installation step above first, including on machines that only have the desktop app. Initial integration is still confirmed from the management panel.

**macOS**

```bash
set -e
file="/tmp/antigravity-cursor-1.2.3.vsix"
curl -fL --connect-timeout 15 \
  https://github.com/rizetngan/antigravity-harness-bridge/releases/download/v1.2.3/antigravity-cursor-1.2.3.vsix \
  -o "$file"
"/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
  --install-extension "$file" --force
```

Adjust the CLI path if Cursor is installed elsewhere. Grant App Management permission through normal macOS settings if prompted.

**Windows PowerShell**

```powershell
$ErrorActionPreference = 'Stop'
$file = Join-Path $env:TEMP 'antigravity-cursor-1.2.3.vsix'
Invoke-WebRequest -UseBasicParsing 'https://github.com/rizetngan/antigravity-harness-bridge/releases/download/v1.2.3/antigravity-cursor-1.2.3.vsix' -OutFile $file
cursor --install-extension $file --force
```

If `cursor` is not on PATH, use Install from VSIX in the editor or run `resources\app\bin\cursor.cmd` from the actual Cursor installation. Custom drives are supported. Cursor does not need to run as administrator permanently.

## Agent-assisted installation

Copy this prompt into an agent with access to the local computer, such as ChatGPT Work, Codex or Claude Code:

```text
Install the latest stable Antigravity Agent Bridge on this computer:
https://github.com/rizetngan/antigravity-harness-bridge

0. Choose a stable release and a verified host version from the compatibility matrix. Reuse a working CLI, and prefer Install and Connect when available. Antigravity execution uses the Antigravity account. Report any host picker restriction separately, without modifying its permission checks.
1. Check OS, architecture, Cursor and CLI. The Antigravity desktop app is not the CLI. Check PATH and the official default locations (macOS ~/.local/bin/agy; Windows %LOCALAPPDATA%\agy\bin\agy.exe). Reuse an existing working CLI. If missing, install it directly using the official Google command for this OS instead of merely reporting a missing dependency:
   macOS: curl -fsSL https://antigravity.google/cli/install.sh | bash
   Windows PowerShell: & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://antigravity.google/cli/install.ps1'))) --skip-path --skip-aliases
   Verify agy --version and agy acp --help using the actual executable path, even if PATH has not refreshed. Report any actual installation or compatibility failure; let me complete official sign-in if required.
2. Download the latest stable VSIX from this repository's GitHub Releases. The published SHA-256 is available for optional verification.
3. Check for an existing Workbench integration. Restore the previous integration before upgrading; preserve conversations and settings. Do not interrupt an active task.
4. Install the VSIX and open the Antigravity panel. Explain the opt-in Workbench patch and backup before enabling it. Let me confirm any OS authorization; do not bypass security.
5. Fully quit and reopen Cursor. Let me complete official Antigravity sign-in if needed.
6. Verify Start Service shows only Antigravity models, Stop Service restores native Cursor models, and a no-tool test message uses an account-available model and effort through ACP.
7. Report the installed version, checksum, real test result and any manual authorization steps.
```

## Recovery & troubleshooting

| Situation | Action |
| --- | --- |
| Desktop app installed but agy is missing | Check the official default binary location; if absent, install the CLI in step 1 and verify `agy acp --help` |
| Models do not appear | Check service/account status, refresh the catalogue, and fully restart Cursor after initial integration |
| Temporarily return to Cursor models | Stop Service |
| Model is present but requests fail | Reconnect and verify that ACP still exposes the selected model |
| Updating Cursor or removing the extension | Restore Cursor first, then fully quit and reopen |
| Cursor cannot launch | Close it and run the standalone recovery launcher; Node.js 22+ must be on PATH |

Recovery launchers:

- Windows: `%LOCALAPPDATA%\Antigravity for Cursor\recovery\<installation-id>\Restore Cursor.cmd`
- macOS: `~/Library/Application Support/Antigravity for Cursor/recovery/<installation-id>/Restore Cursor.command`

Recovery uses the original backed-up resources and recorded hashes. Keep these backups; do not overwrite Workbench with resources from unrelated Cursor versions.

## Architecture & other agent harnesses

<p align="center"><img src="docs/images/current-cursor-flow.jpg" width="96%" alt="Current Cursor adapter and official Antigravity ACP architecture"><br><sub>Current Cursor adapter architecture.</sub></p>

Antigravity owns execution, tools, permissions and account access. Cursor owns the host interaction and visible transcript. The local bridge handles discovery, session mapping, event conversion and service lifecycle.

<p align="center"><img src="docs/images/client-connection-modes.jpg" width="96%" alt="Direct ACP versus dedicated host adapter"></p>

ACP-native clients can connect directly using the [official Google ACP editor guide](https://antigravity.google/docs/ide/extensions/acp). For non-ACP clients and deeper native integration, a tested host adapter is required. Host-neutral Bridge Core and the Adapter SDK remain roadmap goals, not universal V1.2.0 capabilities.

[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Adapter contract](docs/adapter-contract.md) · [Known limitations](docs/known-limitations.md)

## Development & validation

```bash
git clone https://github.com/rizetngan/antigravity-harness-bridge.git
cd antigravity-harness-bridge
npm install
npm run check
npm run package:vsix
```

V1.2.0 passed 45 automated tests per platform, real-resource patch and exact restoration checks, native provider switching, and live Gemini 4 Hydrogen Low conversations on both platforms. Screenshots are genuine application captures or crops, not mockups; see [image provenance](docs/images/README.md).

Independently maintained by [rizetngan](https://github.com/rizetngan). Antigravity and Cursor are their respective products; this project is not an official product of either.

[Issues](https://github.com/rizetngan/antigravity-harness-bridge/issues)
