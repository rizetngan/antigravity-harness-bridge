import * as vscode from "vscode";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { platformPaths, resolveAgyExecutable, resolveNodeExecutable, bundledNodePath, probeDirectoryWritable, powershellQuote, installationKey, samePath } from "./platform.ts";
import path from "node:path";
import { buildLoginCommand, ensureCli, inspectCli, type CliResult } from "./cliSetup.js";
import { AntigravityGateway } from "./gateway/AntigravityGateway.js";
import { CursorCompatibility } from "./cursor/compat.js";
import { ManagementView, VIEW_ID, type PatchState } from "./ui/ManagementView.js";

let activeGateway: AntigravityGateway | undefined;
let loginTerminal: vscode.Terminal | undefined;

function createCompatibility(context: vscode.ExtensionContext, allowOriginalApp = false) {
  const appRoot = path.resolve(vscode.env.appRoot);
  const supportPath = platformPaths().support;
  const appKey = installationKey(supportPath, appRoot);
  const testRoot = path.join(homedir(), "Applications", "Cursor-Antigravity-Test.app", "Contents", "Resources", "app");
  const storagePath = samePath(appRoot, testRoot)
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
      invalid.map((target) => target.file + " [" + target.anchors.filter(a => !a.ok).map(a => a.id + "=" + (a.count + a.patched)).join(", ") + "]").join("; "),
    );
  }
  const patched = targets.filter((target) => target.adapter).length;
  if (patched === targets.length) return "enabled";
  if (patched === 0) return "disabled";
  return "partial";
}

async function offerReload(message: string): Promise<void> {
  void vscode.window.showInformationMessage(message, "退出 Cursor").then(choice => {
    if (choice === "退出 Cursor") void vscode.commands.executeCommand("workbench.action.quit");
  });
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

  const executable = resolveAgyExecutable();
  const windows = process.platform === "win32";
  const terminal = vscode.window.createTerminal({
    name: "Antigravity Sign In",
    cwd: homedir(),
    shellPath: windows ? "powershell.exe" : "/bin/zsh",
    shellArgs: windows ? ["-NoLogo", "-NoProfile"] : ["-l"],
  });
  loginTerminal = terminal;

  const closeListener = vscode.window.onDidCloseTerminal(async (closed) => {
    if (closed !== terminal) return;
    closeListener.dispose();
    if (loginTerminal === terminal) loginTerminal = undefined;
    try {
      if (!gateway.running) {
        output.appendLine("Antigravity sign-in terminal closed; start the service to verify the account.");
        return;
      }
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
  terminal.sendText(buildLoginCommand(executable, process.platform));
  void vscode.window.showInformationMessage(
    "请按终端提示完成 Google 账号登录。成功后终端自动关闭，插件会刷新模型目录。",
  );
}

function appleScriptQuote(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function canWriteDirectory(filePath: string): Promise<boolean> {
  // fs.access(W_OK) can report success on Windows even when the directory's
  // DACL only grants read access. Probe the operation we actually need instead.
  return probeDirectoryWritable(path.dirname(filePath));
}

async function runWindowsElevatedCompatibility(
  context: vscode.ExtensionContext,
  action: "install" | "restore",
  paths: ReturnType<typeof createCompatibility>,
): Promise<void> {
  const nodePath = resolveNodeExecutable(paths.appRoot);
  const helperPath = context.asAbsolutePath(path.join("dist", "installer.cjs"));
  const rendererPath = context.asAbsolutePath(path.join("dist", "renderer.js"));
  const supportPath = platformPaths().support;
  await fs.mkdir(paths.recoveryPath, { recursive: true });

  const logPath = path.join(paths.recoveryPath, "elevated-" + action + "-" + Date.now() + ".log");
  const installerArgs = [
    helperPath,
    action,
    paths.appRoot,
    paths.storagePath,
    rendererPath,
    supportPath,
    "-1",
    "-1",
  ];
  const elevatedScript = [
    "$ErrorActionPreference = 'Stop'",
    "$nodePath = " + powershellQuote(nodePath),
    "$installerArgs = @(" + installerArgs.map(powershellQuote).join(", ") + ")",
    "& $nodePath @installerArgs *> " + powershellQuote(logPath),
    "exit $LASTEXITCODE",
  ].join("\r\n");
  const encoded = Buffer.from(elevatedScript, "utf16le").toString("base64");
  const powershellPath = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const parentScript = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $process = Start-Process -FilePath " + powershellQuote(powershellPath) +
      " -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand'," +
      powershellQuote(encoded) + ")",
    "  if (Test-Path " + powershellQuote(logPath) + ") { Get-Content -Raw " + powershellQuote(logPath) + " }",
    "  exit $process.ExitCode",
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  if ($_.Exception.Message -match 'cancel|cancelled|1223') { exit 1223 }",
    "  exit 1",
    "}",
  ].join("\r\n");

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", parentScript], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });

  if (result.code === 0) return;
  if (result.code === 1223 || /user canceled|operation was canceled|cancelled by the user/i.test(result.stderr)) {
    throw new Error("已取消 Windows 管理员授权，Cursor 原文件未修改。");
  }
  throw new Error(
    "Windows 管理员安装助手执行失败（退出码 " + String(result.code) + "）。" +
    (result.stderr || result.stdout ? "\n" + (result.stderr + "\n" + result.stdout).trim() : ""),
  );
}

async function runPrivilegedCompatibility(
  context: vscode.ExtensionContext,
  action: "install" | "restore",
  paths: ReturnType<typeof createCompatibility>,
): Promise<void> {
  if (process.platform === "win32") {
    await runWindowsElevatedCompatibility(context, action, paths);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("当前系统不支持对 Cursor 安装目录进行管理员授权修改。");
  }
  const nodePath = resolveNodeExecutable(paths.appRoot);
  if (!nodePath) throw new Error("没有找到 Node.js，无法启动安全安装助手。");

  const helperPath = context.asAbsolutePath(path.join("dist", "installer.cjs"));
  const rendererPath = context.asAbsolutePath(path.join("dist", "renderer.js"));
  const supportPath = platformPaths().support;
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
  const supportPath = platformPaths().support;
  await fs.mkdir(paths.recoveryPath, { recursive: true });
  const helperPath = path.join(paths.recoveryPath, "installer.cjs");
  const rendererPath = path.join(paths.recoveryPath, "renderer.js");
  const commandPath = path.join(paths.recoveryPath, "Restore Cursor.command");
  await fs.copyFile(context.asAbsolutePath(path.join("dist", "installer.cjs")), helperPath);
  await fs.copyFile(context.asAbsolutePath(path.join("dist", "renderer.js")), rendererPath);

  if (process.platform === "win32") {
    const args = ["restore", paths.appRoot, paths.storagePath, rendererPath, supportPath, "-1", "-1"];
    const wrapper = path.join(paths.recoveryPath, "restore.cjs");
    await fs.writeFile(
      wrapper,
      'process.argv = [process.execPath, require("node:path").join(__dirname, "installer.cjs"), ...' +
        JSON.stringify(args) + ']; require("./installer.cjs");\r\n',
    );
    const elevatedScript = path.join(paths.recoveryPath, "restore-elevated.ps1");
    await fs.writeFile(elevatedScript, [
      "$ErrorActionPreference = 'Stop'",
      "$nodePath = " + powershellQuote(bundledNodePath(paths.appRoot)),
      "if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { $nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }",
      "$restorePath = Join-Path $PSScriptRoot 'restore.cjs'",
      "$argumentLine = '\"' + $restorePath + '\"'",
      "$process = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru",
      "if ($process.ExitCode -ne 0) { throw \"Restore failed with exit code $($process.ExitCode).\" }",
      "Write-Host 'Cursor Workbench restored. Restart Cursor.'",
      "",
    ].join("\r\n"));
    const launcher = path.join(paths.recoveryPath, "Restore Cursor.cmd");
    await fs.writeFile(launcher, [
      "@echo off",
      "setlocal DisableDelayedExpansion",
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-elevated.ps1"',
      "if errorlevel 1 (echo Restore failed. Close Cursor and check permissions. & pause & exit /b 1)",
      "echo Cursor restored. Restart Cursor.",
      "pause",
      "",
    ].join("\r\n"));
    return launcher;
  }

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
  const bundled = bundledNodePath(paths.appRoot);
  const findNode = "if test -x " + shellQuote(bundled) + "; then printf '%s' " + shellQuote(bundled) + "; else /bin/zsh -lc 'command -v node'; fi";
  const script = [
    "#!/bin/zsh",
    "/usr/bin/osascript <<'APPLESCRIPT'",
    "set nodePath to do shell script " + appleScriptQuote(findNode),
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
  let cli: CliResult = { status: "checking" };
  const panel = new ManagementView(() => ({ ...gateway.panelStatus, patch, reload, cli, version: "1.2.4" }), context.asAbsolutePath("media/management.html"));
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
    const sync = patch === "enabled" && !reload ? gateway.maintainSharedGateway() : gateway.syncRemoteStatus();
    void sync.finally(() => panel.publish());
  }, 1200);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(remoteStatusSync)));
  context.subscriptions.push(new vscode.Disposable(() => {
    gateway.dispose();
    if (activeGateway === gateway) activeGateway = undefined;
  }));

  let setupPending = false;
  let checking: Promise<CliResult> | undefined;
  const checkCli = async (): Promise<CliResult> => {
    if (checking) return checking;
    if (setupPending) return cli;
    cli = { status: "checking" }; panel.publish();
    checking = inspectCli().catch(() => ({ status: "error" as const, detail: "CLI 检测失败，请检查安装环境。" }));
    try { cli = await checking; return cli; }
    finally { checking = undefined; panel.publish(); }
  };
  const requireCli = async (): Promise<boolean> => {
    if (setupPending) return false;
    if (cli.status === "ready" || gateway.panelStatus.connected) return true;
    const state = await checkCli();
    if (state.status === "ready") return true;
    void vscode.window.showWarningMessage(state.status === "missing" ? "缺少 Antigravity CLI，请在管理面板点击「安装并连接」。" : state.detail || "CLI 不可用，请重新检测。");
    return false;
  };
  const setupCommand = vscode.commands.registerCommand("antigravityCursor.setupCli", async () => {
    if (setupPending || checking || reload || gateway.panelStatus.active || !["disabled", "enabled"].includes(patch)) return;
    setupPending = true;
    try {
      cli = { status: "installing" }; panel.publish();
      cli = await ensureCli();
      panel.publish();
      if (cli.status !== "ready") throw new Error(cli.detail || "CLI 未就绪");
      output.appendLine("Antigravity CLI verified: " + (cli.version || "ready"));
      await gateway.start(false, patch === "disabled");
      await context.globalState.update("servicePaused", false);
      try {
        const models = await gateway.refreshCatalogue(true);
        if (!models.length) throw new Error("Antigravity 账号未返回可用模型。");
        void vscode.window.showInformationMessage("Antigravity 已连接 · " + models.length + " 个模型系列" + (patch === "disabled" ? "，现在可以启用原生模型。" : ""));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isAuthenticationRequired(message)) await openAgyLoginTerminal(context, gateway, output);
        else throw error;
      }
    } catch (error) {
      if (cli.status === "installing") {
        cli = await inspectCli().catch(() => ({ status: "error" as const }));
        if (cli.status !== "ready") cli = { status: "error", detail: "安装未完成，请重新检测 CLI；如仍缺少，可重试官方安装。" };
      }
      output.appendLine("Antigravity setup failed: " + (error instanceof Error ? error.message : String(error)));
      void vscode.window.showErrorMessage("Antigravity 安装或连接未完成，请查看连接状态后重试。");
    } finally { setupPending = false; panel.publish(); }
  });
  context.subscriptions.push(setupCommand, vscode.commands.registerCommand("antigravityCursor.checkCli", async () => { if (!setupPending) await checkCli(); }));

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
      if (!(await requireCli())) return;
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
      const revisions = await paths.service.runtimeRevisions();
      output.appendLine("Embedded renderer revisions: " + revisions.installed.map(t => t.kind + "=" + (t.revision ?? "unknown")).join(", ") + "; expected=" + revisions.expected);
      output.appendLine("Native picker: controlled by Cursor. ACP connection and patch presence do not establish native model selection or a completed native turn.");
      output.appendLine("App root: " + paths.appRoot);
      output.appendLine("Official CLI: " + cli.status + (cli.version ? " · " + cli.version : "") + (cli.detail ? " · " + cli.detail : ""));
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
    if (setupPending || !(await requireCli())) return;
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

      const config = await gateway.start(false, true);
      let accountReady = false;
      try {
        const models = await gateway.refreshCatalogue(true);
        accountReady = models.length > 0;
      } catch (error) {
        output.appendLine("Antigravity account not yet ready: " + (error instanceof Error ? error.message : String(error)));
      }
      // Local installation is independent of network/login, but a provider
      // that has never connected must not be activated or invent model access.
      if (!accountReady) await gateway.stop();
      const plan = await paths.service.plan(config);
      if (!plan.targets.length) throw new Error("没有可安装的 Workbench 目标文件。");
      const writable = await canWriteDirectory(plan.targets[0].path);
      if (writable) {
        await paths.service.install(plan);
        output.appendLine("Workbench compatibility installed with the current user account.");
      } else {
        await runPrivilegedCompatibility(context, "install", paths);
        output.appendLine("Workbench compatibility installed with administrator authorization.");
      }
      if (await readPatchState(paths.service) !== "enabled") {
        throw new Error("补丁写入后未通过完整性复验。");
      }
      await context.globalState.update("servicePaused", !accountReady);
      output.appendLine("Backups: " + paths.storagePath);
      patch = "enabled"; reload = true; panel.publish();
      await offerReload(accountReady ? "原生模型接入已启用，请完全退出并重新打开 Cursor。" : "原生接入已安装，服务暂停。重开 Cursor 后可登录 Antigravity 并启动服务。");
    } catch (error) {
      try {
        const currentState = await readPatchState(createCompatibility(context, true).service);
        if (currentState !== "enabled") await gateway.stop();
      } catch {
        await gateway.stop().catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Enabling Antigravity integration failed: " + message);
      output.show(true);
      void vscode.window.showErrorMessage("启用失败：" + message);
    }
  });
  context.subscriptions.push(enableCommand);

  const startService = vscode.commands.registerCommand("antigravityCursor.startService", async () => {
    if (setupPending || !(await requireCli())) return;
    try {
      const state = patch === "enabled" ? patch : await readPatchState(createCompatibility(context, true).service);
      if (state !== "enabled") throw new Error("请先启用原生模型接入。");
      await gateway.start();
      await context.globalState.update("servicePaused", false);
      await gateway.refreshCatalogue(true);
      void vscode.window.showInformationMessage("Antigravity 服务已启动。");
    } catch (error) { void vscode.window.showErrorMessage("启动失败：" + (error instanceof Error ? error.message : String(error))); }
  });
  const stopService = vscode.commands.registerCommand("antigravityCursor.stopService", async () => {
    if (setupPending) return;
    try {
      await gateway.stop();
      await context.globalState.update("servicePaused", true);
      void vscode.window.showInformationMessage("Antigravity 服务已停止，已恢复 Cursor 原生模型。对话历史保留。");
    } catch (error) { void vscode.window.showErrorMessage("停止失败：" + (error instanceof Error ? error.message : String(error))); }
  });
  context.subscriptions.push(startService, stopService);

  const restoreCommand = vscode.commands.registerCommand("antigravityCursor.restoreCursor", async () => {
    if (setupPending) return;
    const confirmation = await vscode.window.showWarningMessage(
      "将使用本扩展保存的备份恢复当前 Cursor 的 Workbench 资源和 product.json，移除 Antigravity 原生模型接入。不会删除 Cursor 设置、项目文件或对话记录。",
      { modal: true },
      "恢复 Cursor",
    );
    if (confirmation !== "恢复 Cursor") return;

    try {
      const paths = createCompatibility(context, true);
      const journalPath = path.join(paths.storagePath, "compatibility.json");
      let journal: { targets?: Array<{ file?: string }> } | undefined;
      try { journal = JSON.parse(await fs.readFile(journalPath, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || await paths.service.hasInstalledMarkers()) throw error;
      }
      const targetFile = journal?.targets?.[0]?.file;
      if (!targetFile && await paths.service.hasInstalledMarkers()) throw new Error("Bridge recovery record is missing.");
      await gateway.stop();
      await context.globalState.update("servicePaused", true);
      const writable = !targetFile || await canWriteDirectory(targetFile);
      if (writable) {
        const restored = await paths.service.restore();
        if (!restored) {
          patch = await readPatchState(paths.service).catch(() => "unsupported" as const);
          panel.publish();
          void vscode.window.showInformationMessage("No Antigravity modifications need to be restored.");
          return;
        }
      } else {
        await runPrivilegedCompatibility(context, "restore", paths);
      }
      if (await paths.service.hasInstalledMarkers()) throw new Error("Bridge modifications remain after recovery.");
      output.appendLine("Cursor Workbench restored from the verified original backup.");
      patch = await readPatchState(paths.service).catch(() => "unsupported" as const); reload = true; panel.publish();
      await offerReload("Cursor 已恢复原始 Workbench。请完全退出并重新打开 Cursor。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine("Cursor restore failed: " + message);
      output.show(true);
      void vscode.window.showErrorMessage("恢复失败：" + message);
    }
  });
  context.subscriptions.push(restoreCommand);

  try {
    const paths = createCompatibility(context, true);
    try {
      const recoveryTool = await installRecoveryTool(context, paths);
      output.appendLine("Standalone recovery tool: " + recoveryTool);
    } catch (error) {
      output.appendLine("Standalone recovery tool unavailable: " + (error instanceof Error ? error.message : String(error)));
    }
    const patchState = await readPatchState(paths.service);
    patch = patchState; panel.publish();
    await checkCli();
    if (patchState === "enabled") {
      // An extension update does not replace already embedded Workbench JS.
      // Keep existing service usable and surface a precise recovery path.
      void paths.service.runtimeRevisions().then(revisions => {
        if (!revisions.outdated) return;
        output.appendLine("Installed Workbench renderer is older/different: " + revisions.installed.map(t => t.kind + "=" + (t.revision ?? "unknown")).join(", ") + "; expected=" + revisions.expected);
        void vscode.window.showWarningMessage("当前 Workbench 接入代码与插件版本不一致。请先恢复 Cursor，重启后重新启用接入。", "恢复 Cursor").then(choice => {
          if (choice === "恢复 Cursor") void vscode.commands.executeCommand("antigravityCursor.restoreCursor");
        });
      }).catch(() => undefined);
      const paused = await gateway.isPaused();
      const config = await gateway.start(paused, false, true);
      if (!gateway.running) {
        output.appendLine("Antigravity service is paused; Cursor native models are active.");
        return;
      }
      await context.globalState.update("servicePaused", false);
      output.appendLine("Antigravity integration enabled.");
      output.appendLine("Local gateway ready: " + config.url);
      output.appendLine("Waiting for Cursor to request the Antigravity model catalogue.");
      if (cli.status !== "ready") return;
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
