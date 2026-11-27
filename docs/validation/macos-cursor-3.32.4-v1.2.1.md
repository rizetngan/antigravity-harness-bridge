# V1.2.1 — macOS Cursor 3.32.4 live acceptance

- Platform: Apple Silicon, Cursor 3.32.4, official released `antigravity-cursor-1.2.1.vsix`.
- SHA-256: `f7954b3af7282b3194f105017d16eaf8610e28d9d47a4a35550081a011e65768`.
- Native integration enabled via the extension; desktop and glass resource hashes verified. Full quit/reopen completed.
- Native UI exposed `Gemini 4 Hydrogen·Antigravity · Low` and `Thinking depth Low`.
- First native prompt: `Reply only MAC3324_V121_NATIVE_OK. Do not use tools or edit files.` Actual reply: `MAC3324_V121_NATIVE_OK`.
- Stop Service: native UI confirmed `Antigravity 服务已停止，已恢复 Cursor 原生模型。对话历史保留。`; gateway logged `Antigravity ACP stopped; Cursor model mode restored.`
- Start Service: native UI restored `Gemini 4 Hydrogen·Antigravity · Low`; management panel reported 11 model families / 27 variants.
- Same-conversation follow-up: `Repeat only the exact token from your previous reply. Do not use tools.` Actual reply: `MAC3324_V121_NATIVE_OK`. Both gateway requests used the same conversation ID.

Evidence is from the actual native application's accessibility tree and extension logs. No screenshot is claimed because macOS screenshot capture was unavailable in the remote session. Existing chat selection initially displayed `default`; a new native chat recovered the provider model and effort. The host's own subscription/UI policies remain unchanged. No executable changes or new package were required.
