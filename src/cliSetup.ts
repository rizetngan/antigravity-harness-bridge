import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import { platformPaths, resolveAgyExecutable } from "./platform.ts";

export type CliStatus = "checking" | "missing" | "ready" | "error" | "installing";
export type CliResult = { status: CliStatus; version?: string; detail?: string };
type Run = (file: string, args: string[], timeout: number) => Promise<string>;
const exec = promisify(execFile);
const run: Run = async (file, args, timeout) => {
  const r = await exec(file, args, { cwd: homedir(), encoding: "utf8", windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 });
  return r.stdout.trim();
};
export function officialInstaller(platform: string): { file: string; args: string[] } {
  if (platform === "darwin") return { file: "/bin/bash", args: ["-o", "pipefail", "-c", "/usr/bin/curl -fsSL --connect-timeout 15 https://antigravity.google/cli/install.sh | /bin/bash"] };
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; $installer = [scriptblock]::Create((Invoke-RestMethod -Uri 'https://antigravity.google/cli/install.ps1')); & $installer --skip-path --skip-aliases"] };
  throw new Error("当前平台未验证 CLI 自动安装，请使用 Google 官方安装指南。");
}

export async function inspectCli(resolve = resolveAgyExecutable, execute: Run = run, explicit = Boolean(process.env.AGY_PATH)): Promise<CliResult> {
  const file = resolve();
  let version: string;
  try { version = await execute(file, ["--version"], 15000); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !explicit) return { status: "missing" };
    return { status: "error", detail: "CLI 无法运行，请检查安装路径或 AGY_PATH，然后重新检测。" };
  }
  try { await execute(file, ["acp", "--help"], 15000); }
  catch { return { status: "error", detail: "当前 CLI 不支持或无法启动 ACP，请检查官方 CLI 版本。" }; }
  return { status: "ready", version: version.split(/\r?\n/)[0].slice(0, 100) };
}

// No installer runs unless the user explicitly invokes setup and the CLI is absent.
export async function ensureCli(options: {
  inspect?: () => Promise<CliResult>;
  install?: () => Promise<void>;
} = {}): Promise<CliResult> {
  const inspect = options.inspect ?? inspectCli;
  const before = await inspect();
  if (before.status !== "missing") return before;
  await (options.install ?? installOfficialCli)();
  const after = await inspect();
  if (after.status !== "ready") throw new Error(after.detail || "官方安装器已退出，但仍未找到可用的 CLI。请重新检测。");
  return after;
}

async function installOfficialCli(): Promise<void> {
  const command = officialInstaller(process.platform);
  const root = platformPaths().support;
  await fs.mkdir(root, { recursive: true });
  const lock = path.join(root, "cli-install.lock");
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("另一个窗口正在安装 CLI，或上次安装未完成。请先确认安装进程已结束，再重新检测。");
    throw error;
  }
  try {
    // Recheck after acquiring the cross-window lock, to avoid redundant installs.
    if ((await inspectCli()).status !== "missing") return;
    await run(command.file, command.args, 240000);
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}
