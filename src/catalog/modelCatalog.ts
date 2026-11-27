import type { AntigravityCatalogue, AntigravityModelFamily } from "../acp/AntigravityAcpProcess.js";

export interface CursorModelVariant {
  id: string;
  label: string;
  thinking: boolean;
  agentic: boolean;
}

export interface CursorModelDefinition {
  id: string;
  name: string;
  variants: CursorModelVariant[];
  reasoning?: {
    effortValues: string[];
    defaultEffort?: string;
  };
  supportedInputTypes: string[];
  supportsPlanMode: boolean;
  contextWindow?: number;
}

export function buildCursorModelDefinitions(
  catalogue: AntigravityCatalogue,
): CursorModelDefinition[] {
  const supportsPlanMode = catalogue.modeOptions.includes("plan");
  return catalogue.modelFamilies.map((family) =>
    toCursorModelDefinition(family, supportsPlanMode),
  );
}

function toCursorModelDefinition(
  family: AntigravityModelFamily,
  supportsPlanMode: boolean,
): CursorModelDefinition {
  return {
    id: family.id,
    name: family.name,
    variants: [{
      id: family.id,
      label: "",
      thinking: family.supportsThinking,
      agentic: false,
    }],
    ...(family.thoughtLevels.length
      ? {
          reasoning: {
            effortValues: family.thoughtLevels,
            defaultEffort: family.defaultThoughtLevel,
          },
        }
      : {}),
    supportedInputTypes: family.supportedInputTypes,
    supportsPlanMode,
  };
}

export function resolveAcpModelSelection(
  model: CursorModelDefinition,
  effort?: string,
): { model: string; thoughtLevel?: string } {
  const allowed = model.reasoning?.effortValues ?? [];
  if (allowed.length === 0) return { model: model.id };
  if (effort && !allowed.includes(effort)) {
    throw new Error(`Thinking level "${effort}" is not supported by ${model.name}.`);
  }
  const selected = effort || model.reasoning?.defaultEffort || allowed[0];
  return { model: model.id, thoughtLevel: selected };
}

export function thinkingEffortFromCursorParameters(
  parameters: Array<{ id: string; value: unknown }> = [],
): string | undefined {
  const item = parameters.find((parameter) =>
    parameter.id === "reasoning_effort" || parameter.id === "thinking_effort",
  );
  return typeof item?.value === "string" ? item.value : undefined;
}
