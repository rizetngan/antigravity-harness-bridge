import * as vscode from "vscode";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";

export class PermissionHandler {
  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const title = params.toolCall.title || params.toolCall.name || "Antigravity tool permission";
    const detail = describeToolCall(params.toolCall);
    const items = params.options.map((option) => ({
      label: `${option.kind.startsWith("allow") ? "$(check)" : "$(x)"} ${option.name}`,
      description: option.kind,
      optionId: option.optionId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: "Antigravity permission",
      placeHolder: detail ? `${title} · ${detail}` : title,
      ignoreFocusOut: true,
    });

    if (!selected) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: selected.optionId } };
  }
}

function describeToolCall(tool: RequestPermissionRequest["toolCall"]): string {
  const raw = tool.rawInput;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" ? value.path : "";
  const command = typeof value.command === "string" ? value.command : "";
  const url = typeof value.url === "string" ? value.url : "";
  return [path, command, url].filter(Boolean).join(" · ").slice(0, 220);
}
