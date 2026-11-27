import { createHash } from "node:crypto";
import type { CursorConversationMessage, CursorConversationSnapshot } from "./CursorConversationReader.js";

export interface NativeHistory {
  source: "native-turns";
  totalTurns: number;
  entries: CursorConversationMessage[];
}

export function parseNativeHistory(input: unknown): NativeHistory | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object") throw new Error("Invalid native history.");
  const value = input as Record<string, unknown>;
  if (value.source !== "native-turns" || !Number.isSafeInteger(value.totalTurns) ||
      Number(value.totalTurns) < 0 || !Array.isArray(value.entries) || value.entries.length > 48 ||
      value.entries.length % 2 !== 0 || value.entries.length > Number(value.totalTurns) * 2) {
    throw new Error("Invalid native history envelope.");
  }
  const entries = value.entries.map((entry: any, index: number): CursorConversationMessage => {
    const role = index % 2 ? "assistant" : "user";
    if (!entry || entry.role !== role || typeof entry.text !== "string" || entry.text.length > 6000) {
      throw new Error("Invalid native history message.");
    }
    const toolResults = Array.isArray(entry.toolResults) ? entry.toolResults.slice(0,30)
      .filter((tool: any) => tool && typeof tool.name === "string")
      .map((tool: any) => ({ name: tool.name.slice(0,100), status: "recorded" })) : [];
    return {
      id: "native-" + index, role, text: entry.text, fileRefs: [], toolResults,
      imageCount: Number.isSafeInteger(entry.imageCount) ? Math.max(0, Math.min(100, entry.imageCount)) : 0,
    };
  });
  return { source: "native-turns", totalTurns: Number(value.totalTurns), entries };
}

export function nativeSnapshot(composerId: string, history: NativeHistory): CursorConversationSnapshot {
  return { composerId, messages: history.entries, agentMessages: [], workspaceUris: [],
    missingMessages: 0, missingAgentBlobs: 0, agentBlobCount: history.totalTurns };
}

// Only a digest and count are stored; the conversation text is not duplicated on disk.
export function nativeHistoryFingerprint(messages: Pick<CursorConversationMessage,"role"|"text">[], turnCount: number): string {
  return createHash("sha256").update(JSON.stringify({
    turnCount, entries: messages.slice(-48).map(({role,text}) => [role, text.slice(0,6000)]),
  })).digest("hex");
}
