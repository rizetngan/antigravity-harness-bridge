# V1.2.3 compatibility resilience

## Scope
Preserve the native Cursor model picker, visible transcript, official agy ACP route, account model policies, service stop/start, and deterministic restore. This release changes validation and recovery behavior, not the provider architecture.

## Windows evidence
- 71 automated tests including legacy install lock recovery, metadata failure, unrelated configuration preservation, clean upgrade, real recovery conflict protection, path compatibility, and empty-workspace root policy.
- Real local HTTP listener collision, endpoint reuse across windows, token rotation, other-profile rejection, refusal to move an already-patched endpoint, and service stop/start.
- Real Cursor 3.32.4 resource copies passed native seam discovery, syntax, patch install, checksum and exact restore; original installation unchanged. Cursor bundled Windows Node 24.22.1 was used for the resource probe.
- Full native UI/real-account conversation acceptance is separate from these targeted probes.
- Mac device offline during development; the maintainer explicitly waived macOS retesting for this release.

## Intentional boundaries
- Unknown edits to a still-patched Workbench remain protected; no blind old-file overwrite or blessing unknown host bytes with a new checksum.
- Explicit AGY_PATH is respected instead of silently selecting another executable.
- Incomplete native history is not silently discarded or passed as complete; the missing-history recovery design is deferred pending a reproduced case.
- A working installed endpoint is not silently moved; fresh installations only may select an alternative port.
- No account entitlement check or host native blocked-model policy is removed.

Maintainer approved the release based on the Windows regression evidence. This is not a new macOS or full native conversation acceptance claim.
