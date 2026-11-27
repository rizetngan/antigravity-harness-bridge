import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const VIEW_ID = "antigravityCursor.management";
export type { PatchState, PanelState } from "./managementActions.js";
import { actions, allowedAction, type PanelAction, type PanelState } from "./managementActions.js";

export class ManagementView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: PanelAction;
  private last = "";
  private listeners: vscode.Disposable[] = [];
  constructor(private readonly state: () => PanelState, private readonly htmlPath: string) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    this.disconnect();
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = readFileSync(this.htmlPath, "utf8").replaceAll("__NONCE__", randomBytes(18).toString("base64"));
    this.listeners.push(view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "ready") { this.last = ""; this.publish(); return; }
      if (message?.type !== "action" || this.pending || !allowedAction(message.action, this.state())) return;
      const action = message.action as PanelAction;
      this.pending = action;
      this.publish();
      try {
        await vscode.commands.executeCommand(actions[action], { fromPanel: true });
      } catch {
        void vscode.window.showErrorMessage("Antigravity：操作失败，请查看连接状态。");
      } finally {
        this.pending = undefined;
        this.publish();
      }
    }));
    this.listeners.push(view.onDidChangeVisibility(() => { this.last = ""; this.publish(); }));
    this.listeners.push(view.onDidDispose(() => this.disconnect()));
    this.timer = setInterval(() => this.publish(), 750);
    this.publish();
  }
  publish(): void {
    if (!this.view?.visible) return;
    const state = { ...this.state(), pending: this.pending ?? null };
    const serialized = JSON.stringify(state);
    if (serialized === this.last) return;
    this.last = serialized;
    void this.view.webview.postMessage({ type: "state", state });
  }
  private disconnect(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.view = undefined;
    for (const listener of this.listeners.splice(0)) listener.dispose();
    this.last = "";
  }
  dispose(): void { this.disconnect(); }
}
