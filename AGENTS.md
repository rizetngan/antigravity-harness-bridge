# Antigravity Cursor — Project Rules

## Goal
Expose the models available to the signed-in Antigravity CLI account in Cursor's native model picker, while preserving the Cursor conversation as the visible conversation.

## Platform
- Primary target: macOS Apple Silicon.
- Initial compatibility target: Cursor 3.28.7, Antigravity IDE 2.35.2, Antigravity CLI 1.5.17.
- Keep Kiro Bridge as a separate product and repository.

## Architecture boundaries
- Use Google's official `agy acp` process as the upstream.
- Use the stable ACP v1 TypeScript SDK unless a tested capability requires otherwise.
- Discover models and session options dynamically from ACP. Never hardcode a model catalogue.
- Cursor remains the conversation shell and transcript owner.
- Antigravity ACP owns execution, tool orchestration, permissions, and its own session.
- Map ACP updates into Cursor's native conversation events where the private API permits.

## Context and privacy
- Read Cursor history in read-only mode.
- Do not log message bodies, source code, tokens, OAuth credentials, or file contents.
- Store only the Cursor conversation ID, ACP session ID, model selection, and sync cursor in extension storage.
- Exclude hidden reasoning/thinking blocks from imported history. Include user-visible answers and concise tool-result summaries.
- Never extract OAuth tokens or implement a third-party subscription proxy.

## Cursor compatibility
- Treat Workbench internals as version-specific.
- Require unique structural anchors before generating a patch.
- Back up every changed file and verify SHA-256 before and after writes.
- Test against a copied Cursor.app before touching the daily installation.
- Always provide a deterministic restore path.

## Engineering
- Prefer small modules and existing mature libraries.
- Keep ACP protocol handling separate from Cursor compatibility code.
- Every model, session, context, and patch path needs automated tests.
- No silent fallback to a Cursor-billed model.
- No model fallback when an Antigravity model is unavailable; show a visible error.
- Keep the UI minimal and native-looking.
