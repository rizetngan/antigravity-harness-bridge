import test from "node:test";
import assert from "node:assert/strict";
import { buildCursorModelDefinitions, resolveAcpModelSelection, thinkingEffortFromCursorParameters } from "../src/catalog/modelCatalog.ts";

const catalogue = {
  availableModels: [],
  modeOptions: ["default", "accept-edits", "auto", "plan"],
  modelFamilies: [
    {
      id: "gemini-4-hydrogen",
      name: "Gemini 4 Hydrogen",
      thoughtLevels: ["low", "medium", "high", "xhigh"],
      defaultThoughtLevel: "high",
      supportsThinking: true,
      supportedInputTypes: [],
    },
    {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      thoughtLevels: ["low", "medium", "high"],
      defaultThoughtLevel: "high",
      supportsThinking: true,
      supportedInputTypes: [],
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Thinking)",
      thoughtLevels: [],
      supportsThinking: true,
      supportedInputTypes: [],
    },
    {
      id: "claude-opus-4-6-thinking",
      name: "Claude Opus 4.6 (Thinking)",
      thoughtLevels: [],
      supportsThinking: true,
      supportedInputTypes: [],
    },
    {
      id: "gpt-oss-120b-medium",
      name: "GPT-OSS 120B (Medium)",
      thoughtLevels: [],
      supportsThinking: false,
      supportedInputTypes: [],
    },
  ],
};

test("builds model families from the live ACP configuration", () => {
  const models = buildCursorModelDefinitions(catalogue);
  assert.equal(models.length, 5);
  assert.deepEqual(models[0].reasoning.effortValues, ["low", "medium", "high", "xhigh"]);
  assert.equal(models[0].reasoning.defaultEffort, "high");
  assert.equal(models[2].variants[0].thinking, true);
  assert.equal(models[2].reasoning, undefined);
  assert.equal(models[4].variants[0].thinking, false);
});

test("maps Cursor Thinking parameters to the ACP thought level", () => {
  const model = buildCursorModelDefinitions(catalogue)[0];
  assert.deepEqual(resolveAcpModelSelection(model, "xhigh"), {
    model: "gemini-4-hydrogen",
    thoughtLevel: "xhigh",
  });
  assert.deepEqual(resolveAcpModelSelection(model), {
    model: "gemini-4-hydrogen",
    thoughtLevel: "high",
  });
});

test("rejects a Thinking level not offered by the selected model", () => {
  const model = buildCursorModelDefinitions(catalogue)[1];
  assert.throws(() => resolveAcpModelSelection(model, "xhigh"), /not supported/);
});

test("does not invent a Thinking selector for Claude", () => {
  const model = buildCursorModelDefinitions(catalogue)[2];
  assert.deepEqual(resolveAcpModelSelection(model, "high"), {
    model: "claude-sonnet-4-6",
  });
});

test("reads Cursor's native reasoning parameter name", () => {
  assert.equal(thinkingEffortFromCursorParameters([{ id: "reasoning_effort", value: "xhigh" }]), "xhigh");
});
