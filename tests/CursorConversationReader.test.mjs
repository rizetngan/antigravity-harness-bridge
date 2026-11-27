import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CursorConversationReader } from "../src/context/CursorConversationReader.ts";
import { buildContextSnapshot } from "../src/context/ContextSnapshot.ts";

function makeDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "cursor-context-test-"));
  const path = join(dir, "state.vscdb");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
  return { dir, path, db };
}

function encodeVarint(value) {
  const bytes = [];
  while (value > 127) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function encodeAgentState(blobIds) {
  const fields = blobIds.map((id) =>
    Buffer.concat([Buffer.from([0x0a, 0x20]), Buffer.from(id, "hex")]),
  );
  return "~" + Buffer.concat(fields).toString("base64");
}

test("reads ordered Cursor messages in read-only mode and excludes hidden reasoning", () => {
  const { dir, path, db } = makeDatabase();
  try {
    const composerId = "composer-test";
    const headers = [
      { bubbleId: "bubble-user", type: 1, createdAt: "2026-11-26T10:00:00Z" },
      { bubbleId: "bubble-assistant", type: 2, createdAt: "2026-11-26T10:01:00Z" },
    ];
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${composerId}`,
      JSON.stringify({ fullConversationHeadersOnly: headers, workspaceUris: ["/workspace/demo"] }),
    );
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${composerId}:bubble-user`,
      JSON.stringify({ type: 1, text: "Please inspect the project.", context: { fileSelections: [{ path: "/workspace/demo/src/app.ts" }] } }),
    );
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${composerId}:bubble-assistant`,
      JSON.stringify({ type: 2, text: "I will inspect the project.", thinking: "private reasoning must not be imported" }),
    );
    db.close();

    const snapshot = new CursorConversationReader(path).readConversation(composerId);
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.messages[0].role, "user");
    assert.equal(snapshot.messages[1].role, "assistant");
    assert.deepEqual(snapshot.messages[0].fileRefs, ["/workspace/demo/src/app.ts"]);
    assert.equal(snapshot.missingMessages, 0);
    assert.equal(JSON.stringify(snapshot).includes("private reasoning"), false);
  } finally {
    try { db.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconstructs Cursor agent tool history from conversation-state blob references", () => {
  const { dir, path, db } = makeDatabase();
  try {
    const composerId = "composer-agent-test";
    const messages = [
      { role: "user", content: "Continue the existing task." },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the code." },
          { type: "reasoning", text: "hidden chain of thought" },
          { type: "tool-call", toolCallId: "call-1", toolName: "read_file", args: { path: "src/app.ts", content: "sensitive source body" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-1", toolName: "read_file", result: "sensitive file body should not be imported" },
        ],
      },
    ];
    const blobIds = messages.map((message) =>
      createHash("sha256").update(JSON.stringify(message)).digest("hex"),
    );
    const state = encodeAgentState(blobIds);

    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${composerId}`,
      JSON.stringify({ fullConversationHeadersOnly: [], conversationState: state }),
    );
    messages.forEach((message, index) => {
      db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
        `agentKv:blob:${blobIds[index]}`,
        JSON.stringify(message),
      );
    });
    db.close();

    const snapshot = new CursorConversationReader(path).readConversation(composerId);
    assert.equal(snapshot.agentBlobCount, 3);
    assert.equal(snapshot.agentMessages.length, 3);
    assert.equal(snapshot.missingAgentBlobs, 0);
    assert.equal(snapshot.agentMessages[1].toolCalls.length, 1);
    assert.match(snapshot.agentMessages[1].toolCalls[0].argsSummary, /src\/app\.ts/);
    assert.equal(snapshot.agentMessages[2].toolResults.length, 1);

    const context = buildContextSnapshot(snapshot);
    assert.match(context, /AGENT TOOL.*read_file/);
    assert.match(context, /src\/app\.ts/);
    assert.doesNotMatch(context, /hidden chain of thought/);
    assert.doesNotMatch(context, /sensitive source body/);
    assert.doesNotMatch(context, /sensitive file body/);
  } finally {
    try { db.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports missing persisted message bodies without corrupting order", () => {
  const { dir, path, db } = makeDatabase();
  try {
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      "composerData:composer-missing",
      JSON.stringify({
        fullConversationHeadersOnly: [
          { bubbleId: "bubble-present", type: 1 },
          { bubbleId: "bubble-missing", type: 2 },
        ],
      }),
    );
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      "bubbleId:composer-missing:bubble-present",
      JSON.stringify({ type: 1, text: "Hello" }),
    );
    db.close();

    const snapshot = new CursorConversationReader(path).readConversation("composer-missing");
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.missingMessages, 1);
  } finally {
    try { db.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
