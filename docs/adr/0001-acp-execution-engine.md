# ADR 0001 — Antigravity ACP as the execution engine

- Status: Accepted
- Date: 2026-11-26

## Context

The target is to expose every model available to the user's Antigravity account in Cursor's native model picker. Google provides an official ACP server through `agy acp`. ACP is an agent protocol, not a pure model inference API.

## Decision

When an Antigravity model is selected:
- Cursor remains the visible conversation and transcript owner.
- Antigravity ACP owns the model call, tool orchestration, permissions, and execution.
- The extension imports Cursor context and maps ACP events back into Cursor's native transcript.
- A separate ACP session is mapped to each Cursor composer ID.

## Consequences

Positive:
- Uses official account authentication and the account's dynamic model catalogue.
- Avoids OAuth extraction and unofficial subscription proxying.
- Reuses Antigravity's own agent tools and permissions.
- Preserves Cursor as the user's primary conversation surface.

Trade-offs:
- Cursor and ACP do not share one underlying session object.
- Context continuity must be maintained by explicit snapshot/delta synchronization.
- Cursor Workbench integration uses private, version-specific compatibility hooks.
- Tool events must be translated into Cursor-native conversation structures.

## Rejected alternatives

### Pure Gemini API BYOK
Rejected as the primary path because it uses API credentials and billing rather than the user's Antigravity account catalogue.

### OAuth token extraction and OpenAI-compatible proxy
Rejected because it bypasses the official ACP interface and creates account-policy and maintenance risks.

### Standalone ACP chat panel
Rejected because the requested experience is Cursor's native model picker and existing conversation.
