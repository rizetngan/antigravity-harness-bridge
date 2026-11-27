import type { AntigravityGateway } from "../gateway/AntigravityGateway.js";

export type PatchState = "checking" | "disabled" | "enabled" | "partial" | "unsupported";
import type { CliResult } from "../cliSetup.js";
export type PanelState = AntigravityGateway["panelStatus"] & { patch: PatchState; reload: boolean; version: string; cli: CliResult };
export const actions = {
  setup: "antigravityCursor.setupCli",
  checkCli: "antigravityCursor.checkCli",
  enable: "antigravityCursor.enableIntegration",
  start: "antigravityCursor.startService",
  stop: "antigravityCursor.stopService",
  refresh: "antigravityCursor.refreshModels",
  login: "antigravityCursor.signIn",
  restore: "antigravityCursor.restoreCursor",
  logs: "antigravityCursor.showStatus",
  reload: "workbench.action.quit",
} as const;
export type PanelAction = keyof typeof actions;
export function allowedAction(action: unknown, state: PanelState): action is PanelAction {
  if (typeof action !== "string" || !Object.hasOwn(actions, action)) return false;
  if (action === "logs") return true;
  if (action === "reload") return state.reload;
  if (state.reload || state.patch === "checking") return false;
  if (action === "setup") return state.cli.status === "missing" && !state.active && ["disabled", "enabled"].includes(state.patch);
  if (action === "checkCli") return state.cli.status === "error" || state.cli.status === "missing";
  if (action === "enable") return state.patch === "disabled" && state.cli.status === "ready";
  if (action === "restore") return ["enabled", "partial", "unsupported"].includes(state.patch) && !state.active;
  if (action === "login" && state.patch === "disabled") return state.cli.status === "ready" && !state.active;
  if (state.patch !== "enabled") return false;
  if (action === "start") return !state.running && state.cli.status === "ready";
  if (action === "stop") return state.running && !state.active;
  if (action === "login") return state.running && !state.active && state.cli.status === "ready";
  if (action === "refresh") return state.running && !state.connecting && state.cli.status === "ready";
  return false;
}
