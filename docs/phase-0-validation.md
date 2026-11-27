# Phase 0 — macOS Validation

Date: 2026-11-26

## Environment

| Component | Result |
|---|---|
| Host | Apple Silicon Mac |
| macOS | 27.0 |
| Cursor | 3.28.7 |
| Antigravity IDE | 2.35.2 |
| Node.js | 22.23.3 |
| Antigravity CLI | 1.5.17 |
| CLI path | `~/.local/bin/agy` |

CLI installed using Google's official macOS installer. Existing Antigravity app data was present; `agy models` successfully returned the account's model catalogue.

## ACP validation

- ACP initialize: passed; protocol version 1.
- session/new: passed.
- Dynamic model catalogue: 10 available model variants.
- Dynamic session model options: 5 model families.
- Thinking options: Low / Medium / High / Extra for Gemini 4 Hydrogen.
- Gemini 4 Hydrogen model selection: passed.
- Gemini XHigh/Extra selection: passed.
- Claude Sonnet 4.6 selection: passed.
- Claude Sonnet 4.6 real prompt: passed; streamed response and end_turn received.
- Applying a Gemini Thinking Level to Claude: rejected by ACP because Claude does not expose that option. This is expected and confirms model-specific options must be dynamic.
- session/close and session/load: passed.

## Account catalogue observed

- Gemini 4 Hydrogen: Low, Medium, High, XHigh.
- Gemini 3.8 Flash: Low, Medium, High.
- Claude Sonnet 4.6 (Thinking).
- Claude Opus 4.6 (Thinking).
- GPT-OSS 120B (Medium).

These are the models exposed to this signed-in account by the CLI/ACP at validation time. The extension must always query ACP instead of using this list as a hardcoded catalogue.

## Cursor history validation

Read-only inspection of Cursor's local `state.vscdb` identified:

- `composerData:<composerId>`: conversation metadata and ordered message headers.
- `bubbleId:<composerId>:<bubbleId>`: serialized message records.
- `agentKv:blob:<hash>`: message/agent payload blobs.
- `checkpointId` and conversation checkpoint pointers.

One persisted conversation with 1,144 headers was checked: all 1,144 corresponding message records were present (65 user messages, 1,079 assistant messages). Message records contain user-visible text, rich text, tool results, context references, and checkpoint metadata.

Only storage structure and record counts were inspected. No conversation body was sent to Antigravity.

## Cursor compatibility validation

Cursor 3.28.7 has both:
- `workbench.desktop.main.js`
- `workbench.glass.main.js`

Both bundles contain unique instances of the model catalogue getter, gRPC client factory, `promise-client.js` marker, and the three native conversation message types used by the existing Kiro Bridge adapter. Agent Host and Glass extension-list anchors are also present.

This confirms a viable private-API compatibility route, not yet a completed Antigravity patch. Full patch generation and runtime verification remain Phase 1 work.

## Files changed

- Installed official Antigravity CLI.
- Created this new project scaffold.
- No Cursor Workbench files or existing Kiro Bridge files were changed.
