import { promises as fs } from "node:fs";
import { pathIdentity, samePath } from "../platform.ts";

export type ExecutionKind = "local" | "none" | "remote" | "unknown";
export interface SessionWorkspace { cwd: string; roots: string[]; toolsEnabled: boolean; kind: ExecutionKind; }
export function fullyQualifiedLocalPath(value: string, platform = process.platform): boolean {
  if (platform === "win32") return /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
  return value.startsWith("/") && !value.startsWith("//");
}

export async function sessionWorkspace(execution: unknown, chatDirectory: string): Promise<SessionWorkspace> {
  const fallback = (kind: ExecutionKind): SessionWorkspace => ({ cwd: chatDirectory, roots: [], toolsEnabled: false, kind });
  const input = execution as { kind?: unknown; workspacePaths?: unknown } | undefined;
  if (input?.kind === "none" || input?.kind === "remote") return fallback(input.kind);
  if (input?.kind !== "local" || !Array.isArray(input.workspacePaths)) return fallback("unknown");
  if (!input.workspacePaths.length) return fallback("none");
  const roots: string[] = [];
  for (const item of input.workspacePaths) {
    if (typeof item !== "string" || !fullyQualifiedLocalPath(item)) return fallback("unknown");
    try {
      const actual = await fs.realpath(item);
      if (!(await fs.stat(actual)).isDirectory()) return fallback("unknown");
      if (!roots.some(root => samePath(root, actual))) roots.push(actual);
    } catch { return fallback("unknown"); }
  }
  // ACP v1 accepts one cwd; native root ordering is preserved and other roots
  // remain available to the existing ACP client tool callbacks.
  return { cwd: roots[0], roots, toolsEnabled: true, kind: "local" };
}

export function workspaceIdentity(workspace: SessionWorkspace): string {
  return JSON.stringify([workspace.kind, pathIdentity(workspace.cwd), workspace.roots.map(root => pathIdentity(root)).sort()]);
}
