import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { AntigravityGateway } from "../src/gateway/AntigravityGateway.ts";
import { SessionStore } from "../src/session/SessionStore.ts";

const output = {
  appendLine: (value) => process.stdout.write("[gateway] " + value + "\n"),
  clear: () => undefined,
  show: () => undefined,
};
const support = join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
const gateway = new AntigravityGateway(output);
const conversationId = "gateway-probe-" + Date.now();
const runId = "gateway-probe-run-" + Date.now();

let resultSummary;
try {
  const config = await gateway.start();
  const headers = { Authorization: "Bearer " + config.token };
  const health = await fetch(config.url + "/health", { headers }).then((response) => response.json());
  assert.equal(health.ok, true);

  const catalogueResponse = await fetch(config.url + "/catalog", { headers });
  assert.equal(catalogueResponse.ok, true);
  const catalogue = await catalogueResponse.json();
  assert.ok(catalogue.models.some((model) => model.id === "gemini-3.8-flash"));
  const flash = catalogue.models.find((model) => model.id === "gemini-3.8-flash");
  assert.ok(flash.reasoning.effortValues.includes("low"));

  const body = {
    first: {
      runRequest: {
        conversationId,
        requestedModel: {
          modelId: "antigravity/gemini-3.8-flash",
          parameters: [{ id: "reasoning_effort", value: "low" }],
        },
        action: {
          userMessageAction: {
            userMessage: {
              text: "Reply exactly with ACP_GATEWAY_OK and nothing else.",
              messageId: "gateway-probe-user",
              mode: 1,
            },
          },
        },
        conversationState: { mode: 1, turns: [] },
      },
      modelMetadata: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    },
  };

  const response = await fetch(config.url + "/sessions/" + runId + "/start", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(response.ok, true);
  const raw = await response.text();
  const events = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const messages = events.filter((event) => event.message);
  const checkpoint = events.find((event) => event.checkpoint)?.checkpoint;
  const done = events.some((event) => event.done === true);
  const assistantText = messages
    .map((event) => event.message.interactionUpdate?.textDelta?.text ?? "")
    .join("");

  assert.ok(messages.length > 0, "ACP should stream at least one native Cursor message");
  assert.ok(checkpoint, "ACP should return a native Cursor checkpoint");
  assert.equal(checkpoint.userMessage.text, "Reply exactly with ACP_GATEWAY_OK and nothing else.");
  assert.equal(checkpoint.modelName, "Gemini 3.8 Flash");
  assert.ok(checkpoint.steps.length >= 1);
  assert.equal(done, true, "Gateway should close the stream with done=true");

  const finalHealth = await fetch(config.url + "/health", { headers }).then((value) => value.json());
  assert.equal(finalHealth.runRequests, 1);
  assert.equal(finalHealth.activeRuns, 0);

  const previousAcp = gateway.acp;
  const reconnectedModels = await gateway.reconnect();
  assert.notEqual(gateway.acp, previousAcp, "reconnect should replace the authenticated ACP process");
  assert.equal(reconnectedModels.length, catalogue.models.length, "reconnected ACP should restore the full account catalogue");

  resultSummary = {
    gatewayHealth: "passed",
    catalogueFamilies: catalogue.models.length,
    selectedModel: flash.name,
    selectedThinking: "low",
    streamedCursorMessages: messages.length,
    assistantText,
    checkpoint: "passed",
    runCompleted: done,
    acpReconnect: "passed",
    reconnectedCatalogueFamilies: reconnectedModels.length,
    requestCounters: {
      catalog: finalHealth.catalogRequests,
      runs: finalHealth.runRequests,
    },
  };
} finally {
  gateway.dispose();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const store = new SessionStore(join(support, "probe"));
  await store.delete(conversationId);
  await store.dispose();
}

console.log(JSON.stringify(resultSummary, null, 2));
