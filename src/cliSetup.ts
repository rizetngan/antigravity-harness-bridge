import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import { lock } from "proper-lockfile";
import { platformPaths, resolveAgyExecutable, powershellQuote } from "./platform.ts";

export type CliStatus = "checking" | "missing" | "ready" | "error" | "installing";
export type CliResult = { status: CliStatus; version?: string; detail?: string };
type Run = (file: string, args: string[], timeout: number) => Promise<string>;
const exec = promisify(execFile);
const run: Run = async (file, args, timeout) => {
  const r = await exec(file, args, { cwd: homedir(), encoding: "utf8", windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 });
  return r.stdout.trim();
};
export function buildLoginCommand(executable: string, platform: string): string {
  if (platform === "win32") return "& " + powershellQuote(executable) + " acp --login; if ($LASTEXITCODE -eq 0) { exit }";
  return "'" + executable.replace(/'/g, "'\\''") + "' acp --login && exit";
}

export function officialInstaller(platform: string): { file: string; args: string[] } {
  if (platform === "darwin") return { file: "/bin/bash", args: ["-o", "pipefail", "-c", "/usr/bin/curl -fsSL --connect-timeout 15 https://antigravity.google/cli/install.sh | /bin/bash"] };
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; $installer = [scriptblock]::Create((Invoke-RestMethod -Uri 'https://antigravity.google/cli/install.ps1')); & $installer --skip-path --skip-aliases"] };
  throw new Error("当前平台未验证 CLI 自动安装，请使用 Google 官方安装指南。");
}

export async function inspectCli(resolve = resolveAgyExecutable, execute: Run = run, explicit = Boolean(process.env.AGY_PATH)): Promise<CliResult> {
  const file = resolve();
  let version: string | undefined;
  try { version = await execute(file, ["--version"], 15000); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !explicit) return { status: "missing" };
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "error", detail: "Configured AGY_PATH is unavailable. Check the path, then retry." };
    // Version text is metadata, not an ACP capability requirement. Try ACP itself.
  }
  try { await execute(file, ["acp", "--help"], 15000); }
  catch { return { status: "error", detail: "当前 CLI 不支持或无法启动 ACP，请检查官方 CLI 版本。" }; }
  return { status: "ready", version: version?.split(/\r?\n/)[0].slice(0, 100) };
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

// The previous release used an empty exclusive file. Respect fresh legacy
// locks; an old file outliving the four-minute installer deadline can be retired.
// The replacement uses a mature cross-process lock with a heartbeat.
export async function acquireCliInstallLock(root: string): Promise<() => Promise<void>> {
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, "cli-install.lock");
  const stale = 10 * 60_000;
  try {
    const legacy = await fs.lstat(lockPath);
    if (legacy.isFile() && legacy.size === 0 && Date.now() - legacy.mtimeMs > stale) {
      const current = await fs.lstat(lockPath);
      if (current.isFile() && current.size === 0 && current.mtimeMs === legacy.mtimeMs) {
        await fs.unlink(lockPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let compromised: Error | undefined;
  const release = await lock(root, { lockfilePath: lockPath, stale, update: 30_000, retries: 0, onCompromised: error => { compromised = error; } });
  return async () => {
    if (compromised) throw compromised;
    await release();
  };
}

async function installOfficialCli(): Promise<void> {
  const command = officialInstaller(process.platform);
  const root = platformPaths().support;
  const release = await acquireCliInstallLock(root);
  try {
    // Recheck after acquiring the cross-window lock, to avoid redundant installs.
    if ((await inspectCli()).status !== "missing") return;
    await run(command.file, command.args, 240000);
  } finally {
    await release();
  }
}
