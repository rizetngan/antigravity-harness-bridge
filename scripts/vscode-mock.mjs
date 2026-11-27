import { promises as fs } from "node:fs";

const root = process.env.ANTIGRAVITY_TEST_WORKSPACE || process.cwd();

export const workspace = {
  workspaceFolders: [{ uri: { fsPath: root } }],
  textDocuments: [],
  fs: {
    readFile: (uri) => fs.readFile(uri.fsPath),
    writeFile: (uri, content) => fs.writeFile(uri.fsPath, content),
  },
  applyEdit: async () => true,
  openTextDocument: async (uri) => ({
    uri,
    getText: () => "",
    save: async () => true,
    positionAt: () => 0,
  }),
};

export const window = {
  showQuickPick: async () => undefined,
  showTextDocument: async (document) => document,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  createOutputChannel: () => ({
    appendLine: (value) => process.stdout.write("[vscode-output] " + value + "\n"),
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
};

export const Uri = {
  file: (fsPath) => ({ fsPath, scheme: "file", path: fsPath, toString: () => "file://" + fsPath }),
};

export class WorkspaceEdit {
  replace() {}
}

export class Range {
  constructor() {}
}

export class Disposable {
  constructor(dispose) { this.dispose = dispose; }
}
