import path from "node:path";

type Folder = { uri: { fsPath: string; scheme?: string } };

export function localWorkspaceRoots(folders: readonly Folder[] | undefined): string[] {
  return (folders ?? []).filter(f => !f.uri.scheme || f.uri.scheme === "file")
    .map(f => f.uri.fsPath).filter(p => path.isAbsolute(p));
}

export function sessionWorkspace(folders: readonly Folder[] | undefined, chatDirectory: string) {
  const roots = localWorkspaceRoots(folders);
  return { cwd: roots[0] ?? chatDirectory, toolsEnabled: roots.length > 0 };
}

export function sessionToolRoots(cwd: string, folders: readonly Folder[] | undefined, toolsEnabled: boolean): string[] {
  return toolsEnabled ? [...new Set([cwd, ...localWorkspaceRoots(folders)])] : [];
}
