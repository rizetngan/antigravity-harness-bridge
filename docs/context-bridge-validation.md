# Cursor Context Bridge — macOS Validation

Date: 2026-11-26

## Read-only storage model

Cursor 3.28.7 stores visible composer messages in `state.vscdb`:

- `composerData:<composerId>`
- `bubbleId:<composerId>:<bubbleId>`

The same composer metadata includes a `~`-prefixed base64 protobuf conversation state. Its field 1 contains ordered 32-byte SHA-256 message blob references. These resolve to:

- `agentKv:blob:<sha256>`

The referenced blobs contain the Agent model context: user/assistant messages, tool calls, and tool results. Reasoning blocks and system prompt blobs are excluded.

## Real local conversation probe

The probe selected one persisted conversation with the largest visible message history. Only counts and structural metadata were printed; message bodies were not logged or sent to Antigravity.

| Measurement | Result |
|---|---:|
| Visible message headers | 1,144 |
| Visible message bodies found | 1,144 |
| Missing visible message bodies | 0 |
| Visible user messages | 65 |
| Visible assistant messages | 1,079 |
| Agent blob references | 255 |
| Agent message blobs parsed | 254 |
| Missing Agent blobs | 0 |
| Tool calls reconstructed | 139 |
| Tool results reconstructed | 139 |
| Image attachments detected | 9 |
| Context snapshot size | 19,277 characters |

One system blob was intentionally excluded. Hidden reasoning blocks were also excluded. Tool arguments are reduced to safe metadata such as file paths and command names; file contents are not copied into the snapshot. Tool output is redacted and truncated.

## Synthetic tests

- Protobuf field-1 blob reference decoding.
- Blob lookup and chronological reconstruction.
- Tool-call and tool-result extraction.
- Hidden reasoning exclusion.
- Sensitive argument/content omission.
- Missing message/blob handling.

## Remaining work

- Transfer image payloads through ACP when the target model supports them.
- Maintain an incremental sync cursor across Cursor-native and ACP turns.
- Verify that ACP-generated native checkpoints are readable by the next Cursor-native turn.
- Revalidate the storage format after Cursor upgrades.
