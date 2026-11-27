import type { AntigravityGateway } from "../gateway/AntigravityGateway.js";

export type PatchState = "checking" | "disabled" | "enabled" | "partial" | "unsupported";
export type PanelState = AntigravityGateway["panelStatus"] & { patch: PatchState; reload: boolean; version: string };
export const actions = {
  enable: "antigravityCursor.enableIntegration",
  start: "antigravityCursor.startService",
  stop: "antigravityCursor.stopService",
  refresh: "antigravityCursor.refreshModels",
  login: "antigravityCursor.signIn",
  restore: "antigravityCursor.restoreCursor",
  logs: "antigravityCursor.showStatus",
  reload: "workbench.action.reloadWindow",
} as const;
export type PanelAction = keyof typeof actions;
export function allowedAction(action: unknown, state: PanelState): action is PanelAction {
  if (typeof action !== "string" || !Object.hasOwn(actions, action)) return false;
  if (action === "logs") return true;
  if (action === "reload") return state.reload;
  if (state.reload || state.patch === "checking") return false;
  if (action === "enable") return state.patch === "disabled";
  if (action === "restore") return ["enabled", "partial", "unsupported"].includes(state.patch) && !state.active;
  if (state.patch !== "enabled") return false;
  if (action === "start") return !state.running;
  if (action === "stop") return state.running && !state.active;
  if (action === "login") return state.running && !state.active;
  if (action === "refresh") return state.running && !state.connecting;
  return false;
}
