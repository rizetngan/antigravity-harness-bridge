import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { AntigravityGateway } from "./gateway/AntigravityGateway.js";
import { CursorCompatibility } from "./cursor/compat.js";
import { ManagementView, VIEW_ID, type PatchState } from "./ui/ManagementView.js";

let activeGateway: AntigravityGateway | undefined;
let loginTerminal: vscode.Terminal | undefined;

function createCompatibility(context: vscode.ExtensionContext, allowOriginalApp = false) {
  const appRoot = path.resolve(vscode.env.appRoot);
  const appKey = createHash("sha256").update(appRoot).digest("hex").slice(0, 16);
  const supportPath = path.join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
  const testRoot = path.join(homedir(), "Applications", "Cursor-Antigravity-Test.app", "Contents", "Resources", "app");
  const storagePath = appRoot === testRoot
    ? path.join(supportPath, "compatibility-test")
    : path.join(supportPath, "compatibility", appKey);
  const recoveryPath = path.join(supportPath, "recovery", appKey);
  const rendererPath = context.asAbsolutePath(path.join("dist", "renderer.js"));
  return {
    appRoot,
    appKey,
    storagePath,
    recoveryPath,
    service: new CursorCompatibility(appRoot, storagePath, rendererPath, { allowOriginalApp }),
  };
}

async function readPatchState(service: CursorCompatibility): Promise<"enabled" | "disabled" | "partial"> {
  const targets = await service.anchors();
  if (!targets.length) throw new Error("当前 Cursor 安装中没有找到可兼容的 Workbench 文件。");
  const invalid = targets.filter((target) => !target.ok);
  if (invalid.length) {
    throw new Error(
      "当前 Cursor Workbench 与已验证版本不兼容：" +
      invalid.map((target) => target.file).join(", "),
    );
  }
  const patched = targets.filter((target) => target.adapter).length;
  if (patched === targets.length) return "enabled";
  if (patched === 0) return "disabled";
  return "partial";
}

async function offerReload(message: string): Promise<void> {
  void vscode.window.showInformationMessage(message, "立即重载窗口").then(choice => {
    if (choice === "立即重载窗口") void vscode.commands.executeCommand("workbench.action.reloadWindow");
  });
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function isAuthenticationRequired(message: string): boolean {
  return /authentication required|please sign in|not signed in/i.test(message);
}

async function openAgyLoginTerminal(
  context: vscode.ExtensionContext,
  gateway: AntigravityGateway,
  output: vscode.OutputChannel,
): Promise<void> {
  if (loginTerminal) {
    loginTerminal.show(true);
    return;
  }

  let executable = path.join(homedir(), ".local", "bin", "agy");
  try {
    await fs.access(executable, constants.X_OK);
  } catch {
    try {
      executable = execFileSync("/bin/zsh", ["-lc", "command -v agy"], { encoding: "utf8" }).trim();
    } catch {
      executable = "";
    }
  }
  if (!executable) throw new Error("未找到 Antigravity CLI（agy），请先安装 Antigravity CLI。");

  const terminal = vscode.window.createTerminal({
    name: "Antigravity Sign In",
    cwd: homedir(),
    shellPath: "/bin/zsh",
    shellArgs: ["-l"],
  });
  loginTerminal = terminal;

  const closeListener = vscode.window.onDidCloseTerminal(async (closed) => {
    if (closed !== terminal) return;
    closeListener.dispose();
    if (loginTerminal === terminal) loginTerminal = undefined;
    try {
      const models = await gateway.reconnect();
      output.appendLine("Antigravity sign-in verified · ACP restarted · " + models.length + " model families");
      void vscode.window.showInformationMessage("Antigravity 已连接 · " + models.length + " 个模型系列");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Antigravity sign-in verification failed: " + message);
      void vscode.window.showErrorMessage("Antigravity 登录尚未完成：" + message);
    }
  });
  context.subscriptions.push(closeListener);

  terminal.show(true);
  terminal.sendText(shellQuote(executable) + " acp --login");
  void vscode.window.showInformationMessage(
    "请按终端提示完成 Google 账号登录。登录命令退出后关闭终端标签，插件会自动刷新模型目录。",
  );
}

function appleScriptQuote(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

async function canWriteDirectory(filePath: string): Promise<boolean> {
  try {
    await fs.access(path.dirname(filePath), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function runPrivilegedCompatibility(
  context: vscode.ExtensionContext,
  action: "install" | "restore",
  paths: ReturnType<typeof createCompatibility>,
): void {
  if (process.platform !== "darwin") {
    throw new Error("管理员授权安装目前只支持 macOS。");
  }
  const nodePath = execFileSync("/bin/zsh", ["-lc", "command -v node"], { encoding: "utf8" }).trim();
  if (!nodePath) throw new Error("没有找到 Node.js，无法启动安全安装助手。");

  const helperPath = context.asAbsolutePath(path.join("dist", "installer.cjs"));
  const rendererPath = context.asAbsolutePath(path.join("dist", "renderer.js"));
  const supportPath = path.join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const gid = typeof process.getgid === "function" ? process.getgid() : -1;
  const args = [
    nodePath,
    helperPath,
    action,
    paths.appRoot,
    paths.storagePath,
    rendererPath,
    supportPath,
    String(uid),
    String(gid),
  ];
  const command = args.map(shellQuote).join(" ");
  const script = "do shell script " + appleScriptQuote(command) + " with administrator privileges";
  const result = spawnSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "未完成管理员授权，Cursor 未更改。").trim());
  }
}

async function installRecoveryTool(
  context: vscode.ExtensionContext,
  paths: ReturnType<typeof createCompatibility>,
): Promise<string> {
  const supportPath = path.join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
  await fs.mkdir(paths.recoveryPath, { recursive: true });
  const helperPath = path.join(paths.recoveryPath, "installer.cjs");
  const rendererPath = path.join(paths.recoveryPath, "renderer.js");
  const commandPath = path.join(paths.recoveryPath, "Restore Cursor.command");
  await fs.copyFile(context.asAbsolutePath(path.join("dist", "installer.cjs")), helperPath);
  await fs.copyFile(context.asAbsolutePath(path.join("dist", "renderer.js")), rendererPath);

  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const gid = typeof process.getgid === "function" ? process.getgid() : -1;
  const commandLine =
    "set cmd to quoted form of nodePath & \" \" & quoted form of " + appleScriptQuote(helperPath) +
    " & \" restore \" & quoted form of " + appleScriptQuote(paths.appRoot) +
    " & \" \" & quoted form of " + appleScriptQuote(paths.storagePath) +
    " & \" \" & quoted form of " + appleScriptQuote(rendererPath) +
    " & \" \" & quoted form of " + appleScriptQuote(supportPath) +
    " & \" \" & quoted form of " + appleScriptQuote(String(uid)) +
    " & \" \" & quoted form of " + appleScriptQuote(String(gid));
  const script = [
    "#!/bin/zsh",
    "/usr/bin/osascript <<'APPLESCRIPT'",
    'set nodePath to do shell script "/bin/zsh -lc \'command -v node\'"',
    commandLine,
    "do shell script cmd with administrator privileges",
    'display dialog "Cursor 已恢复。" buttons {"好"} default button "好"',
    "APPLESCRIPT",
    "",
  ].join("\n");
  await fs.writeFile(commandPath, script, { mode: 0o700 });
  await fs.chmod(commandPath, 0o700);
  return commandPath;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Antigravity for Cursor");
  context.subscriptions.push(output);

  const gateway = new AntigravityGateway(
    output,
    context.globalStorageUri.fsPath,
    vscode.env.appRoot,
    async () => { await context.globalState.update("servicePaused", true); },
  );
  activeGateway = gateway;
  let patch: PatchState = "checking";
  let reload = false;
  const panel = new ManagementView(() => ({ ...gateway.panelStatus, patch, reload, version: "1.1.2" }), context.asAbsolutePath("media/management.html"));
  context.subscriptions.push(panel, vscode.window.registerWebviewViewProvider(VIEW_ID, panel, { webviewOptions: { retainContextWhenHidden: false } }));
  // Cursor can hide the Activity Bar in its Agent-oriented layout. The native
  // status item provides the same one-click entry without changing that layout.
  const panelEntry = vscode.window.createStatusBarItem("antigravityCursor.panel", vscode.StatusBarAlignment.Left, 40);
  panelEntry.name = "Antigravity";
  panelEntry.text = "$(rocket) Antigravity";
  panelEntry.tooltip = "打开 Antigravity 管理面板";
  panelEntry.command = VIEW_ID + ".focus";
  panelEntry.show();
  context.subscriptions.push(panelEntry);
  const remoteStatusSync = setInterval(() => {
    void gateway.syncRemoteStatus().finally(() => panel.publish());
  }, 1200);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(remoteStatusSync)));
  context.subscriptions.push(new vscode.Disposable(() => {
    gateway.dispose();
    if (activeGateway === gateway) activeGateway = undefined;
  }));

  const refreshCommand = vscode.commands.registerCommand("antigravityCursor.refreshModels", async (options?: { fromPanel?: boolean }) => {
    try {
      if (!gateway.running) throw new Error("请先启动 Antigravity 服务。");
      const models = await gateway.refreshCatalogue(true);
      output.clear();
      output.appendLine("Antigravity ACP connected.");
      output.appendLine("Model families: " + models.length);
      for (const model of models) {
        const efforts = model.reasoning?.effortValues.join(", ") ?? "";
        output.appendLine("- " + model.name + (efforts ? " · Thinking: " + efforts : ""));
      }
      if (!options?.fromPanel) output.show(true);
      void vscode.window.showInformationMessage("Antigravity connected · " + models.length + " model families");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Antigravity catalogue refresh failed: " + message);
      output.show(true);
      if (isAuthenticationRequired(message)) {
        const choice = await vscode.window.showWarningMessage(
          "Antigravity CLI 尚未登录，请先完成账号登录。",
          "打开登录终端",
        );
        if (choice === "打开登录终端") {
          try {
            await openAgyLoginTerminal(context, gateway, output);
          } catch (loginError) {
            const detail = loginError instanceof Error ? loginError.message : String(loginError);
            void vscode.window.showErrorMessage("无法打开登录终端：" + detail);
          }
        }
        return;
      }
      void vscode.window.showErrorMessage("Antigravity connection failed: " + message);
    }
  });
  context.subscriptions.push(refreshCommand);

  const signInCommand = vscode.commands.registerCommand("antigravityCursor.signIn", async () => {
    try {
      if (!gateway.running) throw new Error("请先启动 Antigravity 服务。");
      await openAgyLoginTerminal(context, gateway, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Could not open Antigravity sign-in terminal: " + message);
      output.show(true);
      void vscode.window.showErrorMessage("无法启动 Antigravity 登录：" + message);
    }
  });
  context.subscriptions.push(signInCommand);

  const statusCommand = vscode.commands.registerCommand("antigravityCursor.showStatus", async () => {
    try {
      const paths = createCompatibility(context, true);
      const patchState = await readPatchState(paths.service);
      patch = patchState;
      output.appendLine("Workbench integration: " + patchState);
      output.appendLine("App root: " + paths.appRoot);
      try {
        output.appendLine("Gateway: " + gateway.getConfig().url);
        output.appendLine(gateway.panelStatus.borrowed
          ? "ACP process: managed by another Cursor window (remote control enabled)"
          : "ACP process: managed by this extension host");
        try {
          const models = await gateway.refreshCatalogue();
          output.appendLine("Model catalogue: connected · " + models.length + " model families");
        } catch (error) {
          output.appendLine("Model catalogue: unavailable · " + (error instanceof Error ? error.message : String(error)));
        }
      } catch {
        output.appendLine("Gateway: stopped");
        output.appendLine("Model catalogue: offline (cached model names may remain visible)");
      }
      output.show(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Status check failed: " + message);
      output.show(true);
    }
  });
  context.subscriptions.push(statusCommand);

  const enableCommand = vscode.commands.registerCommand("antigravityCursor.enableIntegration", async () => {
    const confirmation = await vscode.window.showWarningMessage(
      "启用后会在当前 Cursor 安装目录内修改 Desktop / Glass Workbench 资源和 product.json，让 Antigravity 模型进入原生模型选择器。原文件会先备份，可随时使用“恢复 Cursor”撤销；不会替换 Cursor 程序或修改其源码。",
      { modal: true },
      "启用原生模型",
    );
    if (confirmation !== "启用原生模型") return;

    try {
      const paths = createCompatibility(context, true);
      const state = await readPatchState(paths.service);
      patch = state;
      if (state === "enabled") {
        await gateway.start();
        await context.globalState.update("servicePaused", false);
        void vscode.window.showInformationMessage("Antigravity 原生模型接入已启用，服务已启动。");
        return;
      }
      if (state === "partial") {
        throw new Error("检测到不完整的 Workbench 补丁。请先执行“恢复 Cursor”，再重新启用。");
      }

      const config = await gateway.start();
      const plan = await paths.service.plan(config);
      if (!plan.targets.length) throw new Error("没有可安装的 Workbench 目标文件。");
      const writable = await canWriteDirectory(plan.targets[0].path);
      if (writable) {
        await paths.service.install(plan);
        output.appendLine("Workbench compatibility installed with the current user account.");
      } else {
        runPrivilegedCompatibility(context, "install", paths);
        output.appendLine("Workbench compatibility installed with macOS administrator authorization.");
      }
      if (await readPatchState(paths.service) !== "enabled") {
        throw new Error("补丁写入后未通过完整性复验。");
      }
      await context.globalState.update("servicePaused", false);
      output.appendLine("Backups: " + paths.storagePath);
      patch = "enabled"; reload = true; panel.publish();
      await offerReload("Antigravity 原生模型接入已启用。重载窗口后即可加载模型目录。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Enabling Antigravity integration failed: " + message);
      output.show(true);
      void vscode.window.showErrorMessage("启用失败：" + message);
    }
  });
  context.subscriptions.push(enableCommand);

  const startService = vscode.commands.registerCommand("antigravityCursor.startService", async () => {
    try {
      const state = await readPatchState(createCompatibility(context, true).service);
      if (state !== "enabled") throw new Error("请先启用原生模型接入。");
      await gateway.start();
      await context.globalState.update("servicePaused", false);
      await gateway.refreshCatalogue(true);
      void vscode.window.showInformationMessage("Antigravity 服务已启动。");
    } catch (error) { void vscode.window.showErrorMessage("启动失败：" + (error instanceof Error ? error.message : String(error))); }
  });
  const stopService = vscode.commands.registerCommand("antigravityCursor.stopService", async () => {
    try {
      await gateway.stop();
      await context.globalState.update("servicePaused", true);
      void vscode.window.showInformationMessage("Antigravity 服务已停止，模型选择和对话历史仍保留。重新使用前请执行 Start Service。");
    } catch (error) { void vscode.window.showErrorMessage("停止失败：" + (error instanceof Error ? error.message : String(error))); }
  });
  context.subscriptions.push(startService, stopService);

  const restoreCommand = vscode.commands.registerCommand("antigravityCursor.restoreCursor", async () => {
    const confirmation = await vscode.window.showWarningMessage(
      "将使用本扩展保存的备份恢复当前 Cursor 的 Workbench 资源和 product.json，移除 Antigravity 原生模型接入。不会删除 Cursor 设置、项目文件或对话记录。",
      { modal: true },
      "恢复 Cursor",
    );
    if (confirmation !== "恢复 Cursor") return;

    try {
      const paths = createCompatibility(context, true);
      const journalPath = path.join(paths.storagePath, "compatibility.json");
      await fs.access(journalPath);
      const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
        targets?: Array<{ file?: string }>;
      };
      const targetFile = journal.targets?.[0]?.file;
      if (!targetFile) throw new Error("备份记录缺少目标文件，无法安全恢复。");
      await gateway.stop();
      await context.globalState.update("servicePaused", true);
      const writable = await canWriteDirectory(targetFile);
      if (writable) {
        await paths.service.restore();
      } else {
        runPrivilegedCompatibility(context, "restore", paths);
      }
      if (await readPatchState(paths.service) !== "disabled") {
        throw new Error("恢复后 Workbench 仍检测到 Antigravity 补丁。");
      }
      output.appendLine("Cursor Workbench restored from the verified original backup.");
      patch = "disabled"; reload = true; panel.publish();
      await offerReload("Cursor 已恢复到启用 Antigravity 之前的 Workbench 状态。");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "ENOENT") {
        void vscode.window.showInformationMessage("没有找到本扩展安装的兼容补丁，Cursor 无需恢复。");
        return;
      }
      output.appendLine("Cursor restore failed: " + message);
      output.show(true);
      void vscode.window.showErrorMessage("恢复失败：" + message);
    }
  });
  context.subscriptions.push(restoreCommand);

  try {
    const paths = createCompatibility(context, true);
    const recoveryTool = await installRecoveryTool(context, paths);
    output.appendLine("Standalone recovery tool: " + recoveryTool);
    const patchState = await readPatchState(paths.service);
    patch = patchState; panel.publish();
    if (patchState === "enabled") {
      const paused = await gateway.isPaused();
      if (paused) {
        output.appendLine("Antigravity service is paused. Run Antigravity: Start Service to resume.");
        return;
      }
      if (context.globalState.get<boolean>("servicePaused", false)) {
        if (!(await gateway.attachExisting())) {
          output.appendLine("Antigravity service is stopped. Run Antigravity: Start Service to resume.");
          return;
        }
        await context.globalState.update("servicePaused", false);
        output.appendLine("Attached to the Antigravity service already running in another Cursor window.");
      } else {
        const config = await gateway.start();
        output.appendLine("Antigravity integration enabled.");
        output.appendLine("Local gateway ready: " + config.url);
      }
      output.appendLine("Waiting for Cursor to request the Antigravity model catalogue.");
      void gateway.refreshCatalogue().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine("Initial Antigravity catalogue refresh failed: " + message);
        if (!isAuthenticationRequired(message)) return;
        void vscode.window.showWarningMessage(
          "Antigravity CLI 尚未登录，原生模型目录暂不可用。",
          "打开登录终端",
        ).then((choice) => {
          if (choice !== "打开登录终端") return;
          void openAgyLoginTerminal(context, gateway, output).catch((loginError) => {
            const detail = loginError instanceof Error ? loginError.message : String(loginError);
            void vscode.window.showErrorMessage("无法打开登录终端：" + detail);
          });
        });
      });
    } else if (patchState === "disabled") {
      output.appendLine("Antigravity integration is not enabled.");
      output.appendLine("Run “Antigravity: Enable Native Models” to add it to Cursor's native model picker.");
    } else {
      output.appendLine("A partial compatibility patch was detected. Restore Cursor before enabling again.");
      output.show(true);
      void vscode.window.showWarningMessage("检测到不完整的 Antigravity 补丁，请先执行“恢复 Cursor”。");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patch = "unsupported"; panel.publish();
    output.appendLine("Antigravity startup check failed: " + message);
    output.show(true);
  }
}

export function deactivate(): void {
  activeGateway?.dispose();
  activeGateway = undefined;
}
