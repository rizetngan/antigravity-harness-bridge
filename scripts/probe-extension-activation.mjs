import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const appRoot = process.env.CURSOR_TEST_APP_ROOT ||
  path.join(homedir(), "Applications", "Cursor-Antigravity-Test.app", "Contents", "Resources", "app");
const temporaryHome = mkdtempSync(path.join(tmpdir(), "antigravity-extension-activation-"));
const previousHome = process.env.HOME;
process.env.HOME = temporaryHome;

const commands = new Map();
const outputLines = [];
const output = {
  appendLine: (value) => outputLines.push(String(value)),
  clear: () => outputLines.splice(0),
  show: () => undefined,
  dispose: () => undefined,
};
const fakeVscode = {
  env: { appRoot },
  window: {
    createOutputChannel: () => output,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
  },
  commands: {
    registerCommand: (id, callback) => {
      commands.set(id, callback);
      return { dispose: () => commands.delete(id) };
    },
    executeCommand: async () => undefined,
  },
  Disposable: class {
    constructor(dispose) { this.dispose = dispose; }
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const require = createRequire(import.meta.url);
  const extension = require("../dist/extension.cjs");
  const context = {
    subscriptions: [],
    extensionPath: projectRoot,
    asAbsolutePath: (relativePath) => path.join(projectRoot, relativePath),
  };

  await extension.activate(context);

  for (const id of [
    "antigravityCursor.enableIntegration",
    "antigravityCursor.refreshModels",
    "antigravityCursor.signIn",
    "antigravityCursor.showStatus",
    "antigravityCursor.restoreCursor",
  ]) {
    assert.equal(commands.has(id), true, "Missing command: " + id);
  }

  const supportRoot = path.join(
    temporaryHome,
    "Library",
    "Application Support",
    "Antigravity for Cursor",
  );
  const recoveryRoot = path.join(supportRoot, "recovery");
  const appKey = readdirSync(recoveryRoot)[0];
  assert.ok(appKey, "Recovery directory was not created.");
  const recoveryDirectory = path.join(recoveryRoot, appKey);
  const commandPath = path.join(recoveryDirectory, "Restore Cursor.command");
  const commandSource = readFileSync(commandPath, "utf8");
  const mode = statSync(commandPath).mode & 0o777;

  assert.equal(mode, 0o700);
  assert.ok(commandSource.includes("do shell script cmd with administrator privileges"));
  assert.ok(commandSource.includes(" restore "));
  assert.ok(readFileSync(path.join(recoveryDirectory, "installer.cjs")).length > 1000);
  assert.ok(readFileSync(path.join(recoveryDirectory, "renderer.js")).length > 1000);
  assert.ok(outputLines.some((line) => line.includes("not enabled")));

  const appleScript = commandSource.split("<<'APPLESCRIPT'\n")[1]?.split("\nAPPLESCRIPT")[0];
  assert.ok(appleScript, "Recovery AppleScript block is missing.");
  const appleScriptPath = path.join(temporaryHome, "restore-check.applescript");
  const compiledScriptPath = path.join(temporaryHome, "restore-check.scpt");
  writeFileSync(appleScriptPath, appleScript);
  const compiled = spawnSync("osacompile", ["-o", compiledScriptPath, appleScriptPath], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

  const registeredCommands = [...commands.keys()];
  extension.deactivate();
  for (const subscription of context.subscriptions) subscription.dispose?.();
  console.log(JSON.stringify({
    commandsRegistered: registeredCommands,
    recoveryTool: commandPath,
    recoveryToolMode: "0700",
    appleScriptSyntax: "passed",
    gatewayStarted: false,
  }, null, 2));
} finally {
  Module._load = originalLoad;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(temporaryHome, { recursive: true, force: true });
}
