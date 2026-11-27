import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CursorConversationReader } from "../src/context/CursorConversationReader.ts";
import { buildContextSnapshot } from "../src/context/ContextSnapshot.ts";

const dbPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb",
);
const db = new DatabaseSync(dbPath, { readOnly: true });
let selectedId = "";
let maxMessages = 0;

try {
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
  const rows = db.prepare(
    "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
  ).all();

  for (const row of rows) {
    try {
      const value = typeof row.value === "string"
        ? JSON.parse(row.value)
        : JSON.parse(Buffer.from(row.value).toString("utf8"));
      const count = Array.isArray(value.fullConversationHeadersOnly)
        ? value.fullConversationHeadersOnly.length
        : 0;
      if (count > maxMessages) {
        maxMessages = count;
        selectedId = String(row.key).slice("composerData:".length);
      }
    } catch {
      // Ignore unrelated or malformed cache entries.
    }
  }
} finally {
  db.close();
}

if (!selectedId) throw new Error("No persisted Cursor conversation was found.");

const snapshot = new CursorConversationReader(dbPath).readConversation(selectedId);
const context = buildContextSnapshot(snapshot);
const userCount = snapshot.messages.filter((item) => item.role === "user").length;
const assistantCount = snapshot.messages.filter((item) => item.role === "assistant").length;
const agentToolCalls = snapshot.agentMessages.reduce((n, item) => n + item.toolCalls.length, 0);
const agentToolResults = snapshot.agentMessages.reduce((n, item) => n + item.toolResults.length, 0);

console.log(JSON.stringify({
  conversationFound: true,
  headerCount: maxMessages,
  visibleMessageCount: snapshot.messages.length,
  missingVisibleMessages: snapshot.missingMessages,
  visibleUserMessages: userCount,
  visibleAssistantMessages: assistantCount,
  agentBlobCount: snapshot.agentBlobCount,
  agentMessageCount: snapshot.agentMessages.length,
  missingAgentBlobs: snapshot.missingAgentBlobs,
  agentToolCalls,
  agentToolResults,
  referencedFiles: new Set(snapshot.messages.flatMap((item) => item.fileRefs)).size,
  imageAttachments: snapshot.messages.reduce((n, item) => n + item.imageCount, 0),
  contextSnapshotChars: context.length,
  contextSnapshotBuilt: context.length > 0,
}, null, 2));
