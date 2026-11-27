import { randomUUID } from "node:crypto";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

type JsonRecord = Record<string, any>;

export interface CursorCheckpointData {
  userMessage: JsonRecord;
  steps: JsonRecord[];
  state: JsonRecord;
  mode: number;
  modelName: string;
}

export interface AdaptedUpdate {
  message?: JsonRecord;
  toolStep?: JsonRecord;
  toolCallId?: string;
}

export function getRunRequest(first: unknown): JsonRecord {
  if (!isRecord(first) || !isRecord(first.runRequest)) {
    throw new Error("Cursor did not provide a valid Agent run request.");
  }
  return first.runRequest;
}

export function getConversationId(runRequest: JsonRecord): string {
  const value = runRequest.conversationId ?? runRequest.conversation_id;
  return typeof value === "string" ? value : "";
}

export function getUserMessage(runRequest: JsonRecord): JsonRecord {
  const action = runRequest.action ?? {};
  const userAction = isRecord(action) && action.case === "userMessageAction" && isRecord(action.value)
    ? action.value
    : action.userMessageAction ?? action.user_message_action ?? {};
  const message = userAction.userMessage ?? userAction.user_message;
  return isRecord(message) ? message : {};
}

export function getUserText(runRequest: JsonRecord): string {
  const message = getUserMessage(runRequest);
  return typeof message.text === "string" ? message.text.trim() : "";
}

export function getSelectedModelId(runRequest: JsonRecord): string {
  const requested = runRequest.requestedModel ?? runRequest.requested_model ?? {};
  const raw = typeof requested.modelId === "string"
    ? requested.modelId
    : typeof requested.model_id === "string" ? requested.model_id : "";
  return raw.replace(/^antigravity\//, "").replace(/\[[^\]]*\]$/, "");
}

export function getThinkingEffort(runRequest: JsonRecord): string | undefined {
  const requested = runRequest.requestedModel ?? runRequest.requested_model ?? {};
  const parameters = Array.isArray(requested.parameters) ? requested.parameters : [];
  const selected = parameters.find((item: unknown) =>
    isRecord(item) && (item.id === "reasoning_effort" || item.id === "thinking_effort"),
  );
  return typeof selected?.value === "string" ? selected.value : undefined;
}

export function getRequestedMode(runRequest: JsonRecord): number {
  const value = getUserMessage(runRequest).mode;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function getCustomSystemPrompt(runRequest: JsonRecord): string {
  const value = runRequest.customSystemPrompt ?? runRequest.custom_system_prompt;
  return typeof value === "string" ? value.trim() : "";
}

export function withoutCurrentUserMessage<T extends { role: string; text: string }>(
  messages: T[],
  currentText: string,
): T[] {
  if (!currentText) return messages;
  const copy = [...messages];
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    const item = copy[index];
    if (item.role === "user" && normalize(item.text) === normalize(currentText)) {
      copy.splice(index, 1);
      break;
    }
  }
  return copy;
}

export function buildPromptText(context: string, currentText: string, customSystemPrompt = ""): string {
  const sections = [
    customSystemPrompt ? "Project instructions supplied by Cursor:\n" + customSystemPrompt : "",
    context ? "Prior Cursor conversation context:\n" + context : "",
    currentText ? "Current user request:\n" + currentText : "",
  ].filter(Boolean);
  if (!sections.length) throw new Error("The Cursor turn contains no text prompt or importable context.");
  return sections.join("\n\n");
}

export function adaptSessionUpdate(update: SessionUpdate): AdaptedUpdate[] {
  const value = update as unknown as JsonRecord;
  switch (value.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(value.content);
      return text ? [{ message: { interactionUpdate: { textDelta: { text } } } }] : [];
    }
    case "tool_call": {
      const call = nativeToolCall(value);
      return [{
        message: { interactionUpdate: { toolCallStarted: {
          callId: value.toolCallId, toolCall: call, modelCallId: "antigravity",
        } } },
        toolStep: { toolCall: call },
        toolCallId: value.toolCallId,
      }];
    }
    case "tool_call_update": {
      if (value.status !== "completed" && value.status !== "failed") return [];
      const call = nativeToolCall(value, value.status === "completed");
      return [{
        message: { interactionUpdate: { toolCallCompleted: {
          callId: value.toolCallId, toolCall: call, modelCallId: "antigravity",
        } } },
        toolStep: { toolCall: call },
        toolCallId: value.toolCallId,
      }];
    }
    case "notice": {
      const text = typeof value.message === "string" ? value.message : "";
      return text ? [{ message: { interactionUpdate: { textDelta: { text: "\n\n" + text + "\n\n" } } } }] : [];
    }
    case "plan": {
      const entries = Array.isArray(value.entries) ? value.entries : [];
      const text = entries.map((entry: JsonRecord) => {
        const status = entry.status === "completed" ? "✓" : "•";
        return status + " " + String(entry.content ?? entry.title ?? "");
      }).filter(Boolean).join("\n");
      return text
        ? [{ message: { interactionUpdate: { textDelta: { text: "\n\n" + text + "\n" } } } }]
        : [];
    }
    // ACP thought chunks are intentionally not forwarded as private model reasoning.
    default:
      return [];
  }
}

export function buildCheckpointData(input: {
  runRequest: JsonRecord;
  modelMetadata?: JsonRecord;
  assistantText: string;
  toolSteps: JsonRecord[];
  startedAt: number;
  stopReason: string;
}): CursorCheckpointData {
  const sourceMessage = getUserMessage(input.runRequest);
  const userText = typeof sourceMessage.text === "string" ? sourceMessage.text : "";
  const userMessage = {
    ...sourceMessage,
    text: userText,
    messageId: typeof sourceMessage.messageId === "string" && sourceMessage.messageId
      ? sourceMessage.messageId
      : randomUUID(),
    mode: getRequestedMode(input.runRequest),
  };
  const finalText = input.assistantText.trim() ||
    (input.stopReason === "cancelled" ? "已取消。" :
      input.stopReason === "refusal" ? "Antigravity 拒绝了本次请求。" : "已完成。");
  const assistantStep = {
    assistantMessage: {
      text: finalText,
      startedAtMs: input.startedAt,
      completedAtMs: Date.now(),
    },
  };
  const state = isRecord(input.runRequest.conversationState)
    ? input.runRequest.conversationState
    : isRecord(input.runRequest.conversation_state) ? input.runRequest.conversation_state : {};
  const modelName = typeof input.modelMetadata?.name === "string"
    ? input.modelMetadata.name
    : typeof input.modelMetadata?.id === "string" ? input.modelMetadata.id : "Antigravity";

  return {
    userMessage,
    steps: [...input.toolSteps, assistantStep],
    state,
    mode: userMessage.mode,
    modelName,
  };
}

function nativeToolCall(value: JsonRecord, completed = false): JsonRecord {
  const name = typeof value.name === "string" && value.name ? value.name : "antigravity_tool";
  const title = typeof value.title === "string" && value.title ? value.title : name;
  const args: JsonRecord = {
    name: "Antigravity",
    toolCallId: String(value.toolCallId ?? ""),
    providerIdentifier: "antigravity",
    toolName: name,
  };
  return {
    mcpToolCall: {
      args,
      ...(completed ? { result: { success: {} } } : {}),
      description: title,
    },
  };
}

function contentText(content: unknown): string {
  if (!isRecord(content)) return "";
  return content.type === "text" && typeof content.text === "string" ? content.text : "";
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
