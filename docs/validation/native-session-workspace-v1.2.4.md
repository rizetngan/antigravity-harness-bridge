# V1.2.4 candidate validation

Base: V1.2.3, commit 207bb94. Native workspace routing candidate; not a stable release.

## Implementation
- Inherit the current native Agent Host workspace paths and explicit local execution authority. Do not infer a directory from the gateway window or historical workspace metadata.
- Map the ordered native roots to the single ACP cwd and session-specific tool roots. Recreate ACP session with visible history when scope changes.
- Missing, ambiguous or remote execution context does not acquire unrelated local tool roots. Existing ACP permission handling remains unchanged.

## Windows evidence
- Cursor 3.32.4 Desktop and Glass original Workbench copies: native seam found, patch syntax, installation and exact restoration passed; daily installation unchanged.
- Typecheck, build and all 77 automated tests passed.
- Actual HTTP gateway with simulated upstream: concurrent A/B scopes, temporary file operations, terminal cwd, scope changes, multi-root narrowing, and session reuse passed.
- Official ACP agy 1.5.18: 11 model families, 27 variants. Two initialized Git projects concurrently returned their own unique sentinel; ordinary non-Git folder and no-project chat passed. Initial upstream session creation returned HTTP 500; subsequent runs passed. No Git requirement added.
- Additional official ACP probe passed: resumed the same conversation in its original directory; created a real Git worktree with different sentinel contents, changed the execution scope of that conversation and verified a different ACP session and the worktree contents. Two native roots were readable in the same turn (second root explicitly addressed). This does not demonstrate native UI multi-root selection or OS sandboxing.
- Isolated Cursor copy with the candidate VSIX: extension activation, gateway connection and model catalogue verified. The test profile is now logged in, but the native model picker displays "Upgrade to unlock more models" and does not allow selecting the bridge model. Native IDE/Glass turns remain pending. The daily installation displays Pro; it was inspected read-only and not modified.

## Controlled native picker baseline (2026-11-27)
- With V1.2.4 installed, the isolated test profile was signed in and the official ACP catalogue returned 11 families / 27 variants. Clicking the native picker displayed "Upgrade to unlock more models".
- Quit only the isolated Cursor copy, restore its exact original Workbench files, confirm bridge markers are absent, and restart with extensions disabled and the same profile/project. Clicking the stock picker returned the identical upgrade prompt. The daily installation was untouched.
- Cursor public pricing and model docs restrict third-party models on Free/Plus; its support forum also describes custom/local model selection being locked on Free. See https://cursor.com/pricing and https://forum.cursor.com/t/cant-switch-model/169806/12 .
- These observations establish a host picker restriction independent of the workspace patch. They do not establish that the bridge's native model selection works on Free. No subscription or model-access policy was changed. Panel status now explicitly describes ACP connectivity rather than implying native selection is proven.

## Remaining acceptance
Native IDE/Glass conversations, project switch, worktree and multi-root behavior in the actual UI; macOS regression not performed. Native tool permissions, cross-window unsaved buffers, diff/undo and remote/cloud execution are not claimed as fully inherited. No stable publication until acceptance or explicit waiver.
