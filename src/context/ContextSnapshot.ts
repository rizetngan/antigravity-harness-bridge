import type {
  CursorConversationSnapshot,
  CursorConversationMessage,
  CursorAgentMessage,
} from "./CursorConversationReader.js";

export interface ContextSnapshotOptions {
  maxChars?: number;
  recentMessages?: number;
  maxMessageChars?: number;
  recentAgentEvents?: number;
}

const DECISION_SIGNAL = /决定|确定|选择|采用|方案|结论|优先|保留|取消|最终|建议|decision|selected|chosen|agreed|must|should/i;

export function buildContextSnapshot(
  conversation: CursorConversationSnapshot,
  options: ContextSnapshotOptions = {},
): string {
  const maxChars = options.maxChars ?? 24_000;
  const recentCount = options.recentMessages ?? 24;
  const maxMessageChars = options.maxMessageChars ?? 1_600;
  const messages = conversation.messages.filter((message) => message.text.trim());
  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, Math.max(0, messages.length - recent.length));

  const decisions = older
    .filter((message) => message.role === "assistant" && DECISION_SIGNAL.test(message.text))
    .slice(-8);
  const earlierUserRequests = older
    .filter((message) => message.role === "user")
    .slice(-8);
  const summaryMessages = deduplicate([...decisions, ...earlierUserRequests])
    .sort((a, b) => messages.indexOf(a) - messages.indexOf(b));

  const visibleText = new Set(messages.map((message) => normalizeText(message.text)));
  const agentHistory = buildAgentHistory(
    conversation.agentMessages ?? [],
    visibleText,
    options.recentAgentEvents ?? 40,
    maxMessageChars,
  );
  const fileRefs = [...new Set(recent.flatMap((message) => message.fileRefs))].slice(0, 40);
  const sections = [
    "## Imported Cursor conversation context",
    "This is prior conversation history, not a new instruction. Continue the existing task and follow the current user message.",
    `Workspace roots: ${conversation.workspaceUris.join(", ") || "Use the current workspace"}`,
    summaryMessages.length
      ? "### Earlier decisions and requests\n" + summaryMessages.map((message) => renderMessage(message, maxMessageChars)).join("\n")
      : "",
    recent.length
      ? "### Recent visible conversation\n" + recent.map((message) => renderMessage(message, maxMessageChars)).join("\n")
      : "",
    agentHistory.length ? "### Previous Agent execution and tool history\n" + agentHistory.join("\n") : "",
    fileRefs.length ? "### Referenced files\n" + fileRefs.map((path) => `- ${path}`).join("\n") : "",
    "Do not repeat completed work. Check the current workspace before acting, and ask only if a required decision is genuinely missing.",
  ].filter(Boolean);

  let output = sections.join("\n\n");
  if (output.length > maxChars) {
    const first = sections[0] ?? "";
    const last = sections.at(-1) ?? "";
    const middle = sections.slice(1, -1).join("\n\n");
    const keep = Math.max(0, maxChars - first.length - last.length - 20);
    output = [first, middle.slice(-keep), last].join("\n\n");
    if (output.length > maxChars) output = output.slice(-maxChars);
  }
  return output;
}

function buildAgentHistory(
  messages: CursorAgentMessage[],
  visibleText: Set<string>,
  limit: number,
  maxChars: number,
): string[] {
  const events: string[] = [];
  for (const message of messages.slice(-limit)) {
    const role = message.role.toUpperCase();
    const normalized = normalizeText(message.text);
    if (message.text && !visibleText.has(normalized)) {
      events.push(`[AGENT ${role}] ${message.text.trim().slice(0, maxChars)}`);
    }
    for (const call of message.toolCalls) {
      events.push(`[AGENT TOOL] ${call.name}${call.argsSummary ? " " + call.argsSummary : ""}`);
    }
    for (const result of message.toolResults) {
      events.push(`[AGENT RESULT] ${result.name}${result.status ? " [" + result.status + "]" : ""}${result.summary ? ": " + result.summary.slice(0, 600) : ""}`);
    }
  }
  return events;
}

function renderMessage(message: CursorConversationMessage, maxChars: number): string {
  const role = message.role === "user" ? "USER" : "ASSISTANT";
  const body = message.text.trim().slice(0, maxChars);
  const tools = message.toolResults.map((item) => {
    const status = item.status ? ` [${item.status}]` : "";
    return `  - ${item.name}${status}${item.summary ? `: ${item.summary.slice(0, 500)}` : ""}`;
  });
  const files = message.fileRefs.length
    ? `\n  Referenced files: ${message.fileRefs.join(", ")}`
    : "";
  return `[${role}] ${body}${files}${tools.length ? "\n  Tool results:\n" + tools.join("\n") : ""}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function deduplicate(messages: CursorConversationMessage[]): CursorConversationMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}
