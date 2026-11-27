import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type JsonRecord = Record<string, unknown>;
type SqlValue = string | Uint8Array | null;

export interface CursorToolResultSummary {
  name: string;
  status?: string;
  summary?: string;
}

export interface CursorAgentToolCall {
  name: string;
  argsSummary: string;
}

export interface CursorAgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls: CursorAgentToolCall[];
  toolResults: CursorToolResultSummary[];
  imageCount: number;
}

export interface CursorConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  fileRefs: string[];
  toolResults: CursorToolResultSummary[];
  imageCount: number;
}

export interface CursorConversationSnapshot {
  composerId: string;
  messages: CursorConversationMessage[];
  agentMessages: CursorAgentMessage[];
  workspaceUris: string[];
  missingMessages: number;
  missingAgentBlobs: number;
  agentBlobCount: number;
}

export class CursorConversationReader {
  private readonly databasePath: string;

  constructor(databasePath?: string) {
    const userDataDirectory = process.env.ANTIGRAVITY_CURSOR_USER_DATA_DIR ??
      join(homedir(), "Library", "Application Support", "Cursor");
    this.databasePath = databasePath ?? join(
      userDataDirectory,
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  readConversation(composerId: string): CursorConversationSnapshot {
    const db = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
      const read = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
      const composerRow = read.get(`composerData:${composerId}`) as
        | { value: SqlValue }
        | undefined;

      if (!composerRow?.value) {
        throw new Error("Cursor conversation metadata was not found.");
      }

      const composer = parseJson(composerRow.value);
      const headers = Array.isArray(composer.fullConversationHeadersOnly)
        ? composer.fullConversationHeadersOnly
        : [];
      const messages: CursorConversationMessage[] = [];
      let missingMessages = 0;

      for (const rawHeader of headers) {
        if (!isRecord(rawHeader)) continue;
        const bubbleId = stringValue(rawHeader.bubbleId);
        if (!bubbleId) continue;

        const row = read.get(`bubbleId:${composerId}:${bubbleId}`) as
          | { value: SqlValue }
          | undefined;
        if (!row?.value) {
          missingMessages += 1;
          continue;
        }

        const message = parseJson(row.value);
        const type = numberValue(rawHeader.type ?? message.type);
        if (type !== 1 && type !== 2) continue;

        messages.push({
          id: bubbleId,
          role: type === 1 ? "user" : "assistant",
          text: stringValue(message.text) || stringValue(message.richText),
          createdAt: stringValue(message.createdAt) || stringValue(rawHeader.createdAt),
          fileRefs: collectFileRefs(message),
          toolResults: summarizeBubbleToolResults(message.toolResults),
          imageCount: Array.isArray(message.images) ? message.images.length : 0,
        });
      }

      const agentBlobIds = extractAgentBlobIds(stringValue(composer.conversationState));
      const agentHistory = readAgentMessages(read, agentBlobIds);

      return {
        composerId,
        messages,
        agentMessages: agentHistory.messages,
        workspaceUris: stringArray(composer.workspaceUris),
        missingMessages,
        missingAgentBlobs: agentHistory.missing,
        agentBlobCount: agentBlobIds.length,
      };
    } finally {
      db.close();
    }
  }
}

function parseJson(value: SqlValue): JsonRecord {
  if (value === null) throw new Error("Cursor storage record is empty.");
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("Cursor storage record has an unexpected shape.");
  return parsed;
}

function tryParseJson(value: SqlValue): JsonRecord | undefined {
  try {
    return parseJson(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function collectFileRefs(message: JsonRecord): string[] {
  const paths = new Set<string>();
  const context = isRecord(message.context) ? message.context : {};

  for (const key of ["fileSelections", "mentions", "terminalSelections"]) {
    collectPaths(context[key], paths);
  }
  for (const key of ["attachedCodeChunks", "attachedFileCodeChunksMetadataOnly", "relevantFiles"]) {
    collectPaths(message[key], paths);
  }

  return [...paths];
}

function collectPaths(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      target.add(item);
      continue;
    }
    if (!isRecord(item)) continue;
    for (const key of ["filePath", "relativePath", "path", "uri"]) {
      const candidate = item[key];
      if (typeof candidate === "string" && candidate.trim()) target.add(candidate);
      else if (isRecord(candidate)) {
        const nested = stringValue(candidate.fsPath) || stringValue(candidate.path);
        if (nested) target.add(nested);
      }
    }
  }
}

function summarizeBubbleToolResults(value: unknown): CursorToolResultSummary[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).filter(isRecord).map((item) => ({
    name: firstString(item, ["toolName", "name", "title", "tool"]) || "Tool",
    status: firstString(item, ["status", "state"]),
    summary: firstString(item, ["summary", "result", "output", "text", "error"]).slice(0, 1200),
  }));
}

function extractAgentBlobIds(encodedState: string): string[] {
  if (!encodedState.startsWith("~")) return [];
  const base64 = encodedState.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(base64, "base64");
  const ids: string[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    if (!tag) break;
    offset = tag.next;
    const field = tag.value >>> 3;
    const wire = tag.value & 7;

    if (wire === 2) {
      const length = readVarint(bytes, offset);
      if (!length) break;
      offset = length.next;
      const end = offset + length.value;
      if (end > bytes.length) break;
      const value = bytes.subarray(offset, end);
      offset = end;
      // Field 1 is Cursor's ordered list of model-context message blob hashes.
      if (field === 1 && value.length === 32) ids.push(value.toString("hex"));
    } else if (wire === 0) {
      const value = readVarint(bytes, offset);
      if (!value) break;
      offset = value.next;
    } else if (wire === 1) {
      offset += 8;
      if (offset > bytes.length) break;
    } else if (wire === 5) {
      offset += 4;
      if (offset > bytes.length) break;
    } else {
      break;
    }
  }
  return ids;
}

function readVarint(bytes: Buffer, start: number): { value: number; next: number } | undefined {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length && shift < 35) {
    const byte = bytes[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7;
  }
  return undefined;
}

function readAgentMessages(
  read: ReturnType<DatabaseSync["prepare"]>,
  blobIds: string[],
): { messages: CursorAgentMessage[]; missing: number } {
  const messages: CursorAgentMessage[] = [];
  let missing = 0;

  for (const blobId of blobIds) {
    const row = read.get(`agentKv:blob:${blobId}`) as { value: SqlValue } | undefined;
    if (!row?.value) {
      missing += 1;
      continue;
    }
    const message = tryParseJson(row.value);
    if (!message) {
      missing += 1;
      continue;
    }

    const role = stringValue(message.role);
    if (role !== "user" && role !== "assistant" && role !== "tool") continue;
    const content = message.content;
    const textParts: string[] = [];
    const toolCalls: CursorAgentToolCall[] = [];
    const toolResults: CursorToolResultSummary[] = [];
    let imageCount = 0;

    if (typeof content === "string") textParts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        const type = stringValue(block.type);
        if (type === "text") {
          const text = stringValue(block.text);
          if (text) textParts.push(text);
        } else if (type === "tool-call") {
          toolCalls.push({
            name: stringValue(block.toolName) || "Tool",
            argsSummary: summarizeToolArgs(block.args),
          });
        } else if (type === "tool-result") {
          const name = stringValue(block.toolName) || "Tool";
          toolResults.push({
            name,
            status: "completed",
            summary: summarizeToolOutput(name, stringValue(block.result)),
          });
        } else if (type === "image") {
          imageCount += 1;
        }
        // Reasoning blocks are intentionally excluded from imported context.
      }
    }

    messages.push({
      id: blobId,
      role,
      text: textParts.join("\n").trim(),
      toolCalls,
      toolResults,
      imageCount,
    });
  }

  return { messages, missing };
}

function summarizeToolArgs(value: unknown): string {
  if (!isRecord(value)) return "";
  const allowed = new Set([
    "path", "filePath", "file_path", "command", "query", "pattern",
    "url", "uri", "limit", "offset", "line", "startLine", "endLine",
    "operation", "action", "title",
  ]);
  const summary: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (typeof item === "string" || typeof item === "number") {
      summary[key] = redact(item.toString()).slice(0, 300);
    }
  }
  return JSON.stringify(summary);
}

function summarizeToolOutput(toolName: string, output: string): string {
  if (!output) return "";
  if (/read_file|read_multiple_files|readfile|file_read/i.test(toolName)) {
    return "File contents were read; inspect the current workspace for the latest state.";
  }
  if (/write_file|edit_file|apply_patch|file_write/i.test(toolName)) {
    return "File operation completed; inspect the current workspace for the resulting changes.";
  }
  if (/terminal|run_command|execute|shell/i.test(toolName)) {
    return redact(output).slice(-600);
  }
  return redact(output).slice(0, 500);
}

function redact(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
