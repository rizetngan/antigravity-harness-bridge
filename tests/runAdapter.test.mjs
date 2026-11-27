import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptSessionUpdate,
  buildCheckpointData,
  buildPromptText,
  getConversationId,
  getRequestedMode,
  getSelectedModelId,
  getThinkingEffort,
  getUserText,
  getUserMessage,
  withoutCurrentUserMessage,
} from "../src/gateway/runAdapter.ts";

const runRequest = {
  conversationId: "composer-123",
  requestedModel: {
    modelId: "antigravity/claude-opus-5.5",
    parameters: [{ id: "reasoning_effort", value: "high" }],
  },
  action: {
    userMessageAction: {
      userMessage: { text: "Inspect the project", messageId: "message-1", mode: 3 },
    },
  },
  conversationState: { turns: ["previous-turn"], mode: 3 },
};

test("extracts Cursor conversation, user message, model, and Thinking selection", () => {
  assert.equal(getConversationId(runRequest), "composer-123");
  assert.equal(getUserText(runRequest), "Inspect the project");
  assert.equal(getSelectedModelId(runRequest), "claude-opus-5.5");
  assert.equal(getThinkingEffort(runRequest), "high");
  assert.equal(getRequestedMode(runRequest), 3);
});

test("supports Cursor oneof case/value action encoding", () => {
  const encoded = {
    action: {
      case: "userMessageAction",
      value: { userMessage: { text: "Oneof encoded request", messageId: "oneof-1", mode: 2 } },
    },
  };
  assert.equal(getUserMessage(encoded).messageId, "oneof-1");
  assert.equal(getUserText(encoded), "Oneof encoded request");
});

test("removes the current user request from imported history without changing order", () => {
  const messages = [
    { role: "user", text: "Earlier request" },
    { role: "assistant", text: "Earlier answer" },
    { role: "user", text: "Inspect the project" },
  ];
  assert.deepEqual(
    withoutCurrentUserMessage(messages, "Inspect the project"),
    messages.slice(0, 2),
  );
});

test("builds a single prompt with instructions, prior context, and current request", () => {
  const prompt = buildPromptText("Earlier decision: use ACP.", "Inspect the project", "Use TypeScript.");
  assert.match(prompt, /Project instructions supplied by Cursor/);
  assert.match(prompt, /Earlier decision: use ACP/);
  assert.match(prompt, /Current user request/);
  assert.match(prompt, /Inspect the project/);
});

test("converts ACP text chunks into Cursor native interaction updates", () => {
  const updates = adaptSessionUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "The implementation is ready." },
    messageId: "message-2",
  });
  assert.deepEqual(updates, [{
    message: {
      interactionUpdate: {
        textDelta: { text: "The implementation is ready." },
      },
    },
  }]);
});

test("maps ACP tool calls into Cursor native MCP tool-call structures", () => {
  const updates = adaptSessionUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "tool-1",
    title: "Read project configuration",
    name: "read_file",
    kind: "read",
    status: "in_progress",
    rawInput: { path: "package.json" },
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].toolCallId, "tool-1");
  assert.equal(updates[0].message.interactionUpdate.toolCallStarted.callId, "tool-1");
  assert.equal(updates[0].toolStep.toolCall.mcpToolCall.description, "Read project configuration");
});

test("creates a Cursor checkpoint with user message, tool steps, and assistant text", () => {
  const checkpoint = buildCheckpointData({
    runRequest,
    modelMetadata: { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    assistantText: "I inspected the project.",
    toolSteps: [{ toolCall: { mcpToolCall: { args: { name: "Antigravity" } } } }],
    startedAt: 1000,
    stopReason: "end_turn",
  });
  assert.equal(checkpoint.userMessage.messageId, "message-1");
  assert.equal(checkpoint.userMessage.mode, 3);
  assert.equal(checkpoint.steps.length, 2);
  assert.equal(checkpoint.steps[1].assistantMessage.text, "I inspected the project.");
  assert.equal(checkpoint.state.turns[0], "previous-turn");
  assert.equal(checkpoint.modelName, "Claude Opus 5.5");
});
