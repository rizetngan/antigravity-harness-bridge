import test from "node:test";
import assert from "node:assert/strict";
import { buildContextSnapshot } from "../src/context/ContextSnapshot.ts";

test("builds a compact handoff context with decisions, recent turns, and file references", () => {
  const snapshot = {
    composerId: "composer-1",
    workspaceUris: ["/workspace/project"],
    missingMessages: 0,
    messages: [
      { id: "1", role: "user", text: "We are building a Cursor bridge.", fileRefs: [], toolResults: [], imageCount: 0 },
      { id: "2", role: "assistant", text: "Decision: use ACP as the execution engine.", fileRefs: [], toolResults: [], imageCount: 0 },
      { id: "3", role: "user", text: "Continue with the context reader.", fileRefs: ["/workspace/project/src/context.ts"], toolResults: [], imageCount: 0 },
      { id: "4", role: "assistant", text: "The context reader is ready.", fileRefs: [], toolResults: [{ name: "read_file", status: "completed", summary: "Read context module" }], imageCount: 0 },
    ],
  };
  const context = buildContextSnapshot(snapshot);
  assert.match(context, /Decision: use ACP/);
  assert.match(context, /Continue with the context reader/);
  assert.match(context, /src\/context\.ts/);
  assert.match(context, /read_file/);
});

test("respects the configured context size", () => {
  const snapshot = {
    composerId: "composer-2",
    workspaceUris: [],
    missingMessages: 0,
    messages: Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      role: index % 2 ? "assistant" : "user",
      text: "x".repeat(2000),
      fileRefs: [],
      toolResults: [],
      imageCount: 0,
    })),
  };
  const context = buildContextSnapshot(snapshot, { maxChars: 4000 });
  assert.ok(context.length <= 4000);
});
