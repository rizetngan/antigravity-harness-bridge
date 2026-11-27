# Antigravity Agent Bridge

**Connect Google Antigravity to Cursor and other Agent Harness clients.**

A multi-harness integration project built around Google's official Antigravity CLI and Agent Client Protocol (ACP). Cursor is the first native host adapter; ACP-compatible editors can already connect directly to agy acp.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Client compatibility](docs/client-compatibility.md)

![Target architecture](docs/images/target-harness-architecture.png)

## What this project is

Antigravity Agent Bridge separates the upstream agent runtime from the client-specific integration:

- **Upstream:** the signed-in Antigravity CLI account, launched through the official agy acp interface.
- **Bridge core (target):** a host-neutral runtime contract for model discovery, sessions, event streaming, context, permissions, and lifecycle.
- **Client adapters:** native integrations for clients that need more than a direct ACP connection.

The goal is not to build a replacement agent or a third-party model proxy. Antigravity remains responsible for its agent execution, tools, authentication, and account model access.

## Current release

![Current Cursor adapter architecture](docs/images/current-cursor-flow.png)

**V1.1.2 · macOS Apple Silicon · tested compatibility baseline: Cursor 3.28.7**

- Official Antigravity CLI / ACP integration with live account model discovery.
- Antigravity models appear in Cursor's native model picker, with model and supported reasoning-depth selection.
- Native Cursor conversation continuity, ACP session mapping, and native transcript updates.
- Native management panel, service lifecycle controls, model refresh, and reconnect.
- Multiple Cursor windows share one authenticated local gateway.
- 39 automated tests passed; lifecycle and tool-handler probes passed.
- Workbench changes are opt-in, version-checked, backed up, hash-verified, and reversible.

Cursor does not expose a public API for registering arbitrary third-party providers in its native model picker. The current adapter therefore uses a narrow, version-specific Workbench compatibility layer. It does not replace the Cursor executable or create a Cursor fork.

## Two connection paths

![ACP direct connection and host adapter paths](docs/images/client-connection-modes.png)

### 1. ACP-native clients — connect directly

When a client supports ACP, the shortest path is to register agy acp as its external agent. Google documents this route for Zed, JetBrains IDEs, Android Studio, Xcode, and VS Code through the community ACP Client extension.

~~~sh
agy --version
agy acp --help
~~~

Example Zed configuration:

~~~json
{
  "agent_servers": {
    "Antigravity": {
      "type": "custom",
      "command": "agy",
      "args": ["acp"]
    }
  }
}
~~~

No custom Bridge adapter is needed for this direct route. The client launches the official ACP server and renders its native agent experience.

**Model availability is client-dependent.** Google's current ACP documentation says Gemini models are available in every ACP client, while third-party models are exposed only in a defined set of clients, including JetBrains, Android Studio, Zed, and Xcode. See [Google's ACP editor guide](https://antigravity.google/docs/ide/extensions/acp).

### 2. Non-ACP or deeper native integrations — use an adapter

Some hosts need a native model picker, host-owned conversation, special event mapping, or a connection mechanism that is not ACP. These require a host-specific adapter built on the shared Bridge core.

Cursor is the first example. Future adapters will be selected only after validating the host's documented extension or agent API. A generic OpenAI-compatible endpoint is not treated as equivalent to a full Agent Harness integration.

## Current Cursor installation

1. Install the VSIX from the [Releases](https://github.com/rizetngan/antigravity-harness-bridge/releases) page.
2. Open the Antigravity panel in Cursor.
3. Choose **Enable Native Models** and confirm the Workbench compatibility patch.
4. Reload Cursor and sign in through the official Antigravity CLI flow if prompted.
5. Select an Antigravity model in Cursor's native model picker.

For upgrades from an earlier release, restore the previous Workbench patch before installing the new VSIX. See the [architecture and recovery guide](docs/architecture.md).

## Product roadmap

![Project roadmap](docs/images/roadmap.png)

1. **Keep Cursor stable** — preserve the working V1.1.2 adapter and its deterministic recovery.
2. **Extract the shared core** — separate Antigravity runtime, model catalogue, sessions, normalized events, permissions, and context contracts from Cursor-specific code.
3. **Reuse ACP wherever possible** — document and optionally automate direct ACP setup instead of rebuilding integrations that already work.
4. **Add native adapters selectively** — implement only where a host's public API provides a meaningful capability advantage.
5. **Publish an adapter contract** — allow new clients to integrate without duplicating upstream process, session, and permission logic.

See [Roadmap](docs/roadmap.md) for milestones and acceptance criteria.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/architecture.md) | Current implementation and target multi-harness design |
| [Roadmap](docs/roadmap.md) | Upgrade phases and completion criteria |
| [Client compatibility](docs/client-compatibility.md) | Direct ACP clients vs native adapter candidates |
| [Adapter contract](docs/adapter-contract.md) | The future host-adapter interface |
| [Known limitations](docs/known-limitations.md) | Verified limitations of the current release |

## Development

~~~sh
npm install
npm run check
npm run probe:acp
npm run probe:cursor-context
npm run probe:gateway
npm run probe:extension-activation
npm run install:test-copy
npm run verify:test-copy
npm run restore:test-copy
npm run package:vsix
~~~

## Security and design boundaries

- Use the official agy acp interface and Antigravity-managed sign-in.
- Never extract OAuth credentials or build a third-party subscription proxy.
- Do not silently fall back to a Cursor-billed or unrelated model.
- Keep host-specific compatibility code isolated from the shared runtime.
- Read host conversation history only through supported or explicitly validated interfaces; exclude hidden reasoning and system prompts.
- Map permissions explicitly. If a host cannot express a required permission decision, fail closed rather than auto-approve.
- Do not claim universal compatibility: each non-ACP host needs a tested adapter and a documented capability matrix.

## Naming

The GitHub repository is antigravity-harness-bridge. The product is **Antigravity Agent Bridge**. The existing VSIX remains the **Antigravity for Cursor** adapter so its installed extension identity stays compatible.

[executed on device: appledeMacBook-Pro.local (3931b947-2b37-4ca8-b3e8-9d8d44e81839)]