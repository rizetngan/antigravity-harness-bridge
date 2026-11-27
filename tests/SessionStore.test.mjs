import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session/SessionStore.ts";

test("persists and reloads Cursor-to-ACP session mappings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "antigravity-session-store-"));
  try {
    const first = new SessionStore(directory);
    await first.set({
      composerId: "composer-1",
      sessionId: "acp-session-1",
      cwd: "/workspace/project",
      modelId: "claude-opus-5.5",
      lastVisibleMessageCount: 12,
      lastAgentMessageCount: 34,
      updatedAt: Date.now(),
    });
    const second = new SessionStore(directory);
    assert.deepEqual(await second.get("composer-1"), await first.get("composer-1"));
    await second.delete("composer-1");
    assert.equal(await second.get("composer-1"), undefined);
    await first.dispose();
    await second.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
