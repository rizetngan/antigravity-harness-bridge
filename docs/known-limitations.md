# Known limitations

1. **Version compatibility** — this release targets the tested Cursor 3.28.7 resources. Workbench updates require revalidation; native live tests were performed in Desktop mode.
2. **Context** — cross-model visible text and restart recovery have been verified. When a new ACP session is required, at most 24 recent turns are read and compacted to a bounded prompt. Tool summaries are not complete tool outputs, and images are not transferred.
3. **Model selection** — RC1 retained model and effort across renderer reload and full app restart. V1.0.0 uses stable model labels with connection status reported separately. Cached model entries do not authorize model invocation; the gateway checks live availability.
4. **Tools** — file read/write and terminal output passed real test-workspace calls, with single-use confirmation for write and terminal. Only local workspace use has been validated; a terminal working-directory check is not an operating-system sandbox.
5. **Application signature** — modifying Workbench resources invalidates the original signature while patched. Exact restoration from the verified originals has been tested by the command-line recovery tool. Native Restore Cursor and re-enable passed on the isolated installation.
6. **Profiles** — one user-data profile per app installation; separate installations have independent loopback addresses and tokens. Service start/stop should occur in the owning window.
7. **Authentication** — official CLI sign-in can expire independently of Cursor. Use Sign In / Reconnect and refresh models.
8. **Scope** — macOS initial target; remote/cloud workspaces, image payloads, full tool transcript migration and Cursor context-window reporting are not fully supported.

9. **Multi-harness scope** — V1.1.2 ships only the Cursor native adapter. ACP-native editors can use Google's documented direct agy acp route, but those clients have not all been tested by this repository. Non-ACP hosts need separate native adapters.
10. **ACP model visibility** — model visibility varies by client. Google documents Gemini availability across ACP clients and third-party model availability only for a subset of supported clients. Do not infer full account catalogue access from ACP support alone.
11. **Bridge Core** — the host-neutral Bridge Core and Adapter SDK are roadmap items, not shipped components in V1.1.2.
