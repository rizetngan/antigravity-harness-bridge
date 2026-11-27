# Architecture diagrams

These diagrams are hand-authored SVG source files and compressed JPEG previews so labels, layout, and connectors remain crisp and maintainable.

- current-cursor-flow.svg — implementation that exists in V1.1.2.
- target-harness-architecture.svg — intended multi-harness architecture.
- client-connection-modes.svg — when to connect directly through ACP vs use a host adapter.
- roadmap.svg — staged evolution plan.

The target diagrams describe planned architecture, not shipped functionality.


## V1.2.0 实机截图 / Live screenshots

The following screenshots were captured from the actual Cursor 3.28.7 UI running the released V1.2.0 adapter, with Antigravity CLI 1.5.18. They are unmodified window captures or viewport crops of the test workspace. No simulated responses, account identifiers, tokens or personal conversations are included.

| File | Source / content |
| --- | --- |
| `macos-native-picker.png` | macOS Apple Silicon, service running; native picker and Low thinking-depth menu. Visible portion of the scrollable model list. |
| `macos-cursor-picker.png` | Same macOS window after explicit Stop Service; native Cursor catalogue restored. Existing conversation may still display its unavailable previous model until reselected. |
| `macos-management.png` | Actual management panel showing connected service, 11 families and 27 variants at capture time. |
| `macos-native-chat.png` | Original macOS live test conversation; assistant returned `HYDROGEN_LOW_MAC_UI_OK`. |
| `windows-native-chat.png` | Original Windows x64 Cursor window; assistant returned `HYDROGEN_LOW_UI_OK`. |

Actual model availability and appearance may change with the account, Cursor version and theme. The management panel uses its current Chinese UI labels.

- `windows-3324-native-continuity.png`: V1.2.1 candidate, Cursor 3.32.4 on Windows x64. Actual native conversation after stopping and restarting the service, with Hydrogen Low selected and an exact-token context follow-up. No mockup.
