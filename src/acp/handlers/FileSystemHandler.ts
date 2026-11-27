import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";

export class FileSystemHandler {
  constructor(private readonly getRoots: (sessionId: string) => string[]) {}

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const target = await this.assertAllowed(params.sessionId, params.path, false);
    const uri = vscode.Uri.file(target);
    const openDocument = vscode.workspace.textDocuments.find((document) =>
      path.resolve(document.uri.fsPath) === target,
    );
    let content = openDocument
      ? openDocument.getText()
      : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");

    if (params.line != null || params.limit != null) {
      const lines = content.split("\n");
      const start = Math.max(0, (params.line ?? 1) - 1);
      const end = params.limit != null ? start + params.limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }
    return { content };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const target = await this.assertAllowed(params.sessionId, params.path, true);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.assertAllowed(params.sessionId, target, true);
    const uri = vscode.Uri.file(target);
    const openDocument = vscode.workspace.textDocuments.find((document) =>
      path.resolve(document.uri.fsPath) === target,
    );

    if (openDocument) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(openDocument.positionAt(0), openDocument.positionAt(openDocument.getText().length)),
        params.content,
      );
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error("Cursor could not apply the Antigravity file edit.");
      await openDocument.save();
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(params.content, "utf8"));
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
    }
    return {};
  }

  private async assertAllowed(sessionId: string, requestedPath: string, allowMissing: boolean): Promise<string> {
    const target = path.resolve(requestedPath);
    const roots = this.getRoots(sessionId);
    if (!roots.length) throw new Error("No workspace root is registered for this Antigravity session.");

    const checkedPath = allowMissing
      ? await nearestExistingPath(path.dirname(target))
      : await fs.realpath(target);
    const resolvedRoots = await Promise.all(roots.map((root) =>
      fs.realpath(root).catch(() => path.resolve(root)),
    ));
    if (!resolvedRoots.some((root) => isInside(root, checkedPath))) {
      throw new Error("Antigravity file access is restricted to the current workspace.");
    }

    if (allowMissing) {
      const existingTarget = await fs.realpath(target).catch(() => undefined);
      if (existingTarget && !resolvedRoots.some((root) => isInside(root, existingTarget))) {
        throw new Error("Antigravity file access is restricted to the current workspace.");
      }
    }
    return target;
  }
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
