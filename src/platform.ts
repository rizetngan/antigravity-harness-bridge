import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function platformPaths(platform = process.platform, env = process.env, home = homedir()) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const local = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
  const roaming = env.APPDATA || p.join(home, "AppData", "Roaming");
  return {
    support: platform === "win32" ? p.join(local, "Antigravity for Cursor") : p.join(home, "Library", "Application Support", "Antigravity for Cursor"),
    cursorUserData: platform === "win32" ? p.join(roaming, "Cursor") : p.join(home, "Library", "Application Support", "Cursor"),
    agy: platform === "win32" ? p.join(local, "agy", "bin", "agy.exe") : p.join(home, ".local", "bin", "agy"),
  };
}

export function resolveAgyExecutable(): string {
  if (process.env.AGY_PATH) return process.env.AGY_PATH;
  const candidate = platformPaths().agy;
  if (existsSync(candidate)) return candidate;
  if (process.platform === "win32") {
    try {
      const found = execFileSync("where.exe", ["agy.exe"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).find((line) => line.trim());
      if (found) return found.trim();
    } catch { /* fallback to a normal executable lookup */ }
    return "agy.exe";
  }
  try {
    const found = execFileSync("/bin/zsh", ["-lc", "command -v agy"], { encoding: "utf8" }).trim();
    if (found) return found;
  } catch { /* fallback to PATH */ }
  return "agy";
}

export function isCursorResources(candidate: string): boolean {
  return /(?:^|[\\/])(?:contents[\\/])?resources[\\/]app(?:[\\/]|$)/i.test(candidate);
}

export async function probeDirectoryWritable(directory: string): Promise<boolean> {
  const probe = path.join(directory, ".antigravity-write-probe-" + randomBytes(8).toString("hex") + ".tmp");
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(probe, "wx", 0o600);
    await handle.close();
    handle = undefined;
    await fs.unlink(probe);
    return true;
  } catch {
    await handle?.close().catch(() => undefined);
    await fs.unlink(probe).catch(() => undefined);
    return false;
  }
}

export function resolveNodeExecutable(): string {
  if (process.platform !== "win32") return "node";
  try {
    const candidates = execFileSync("where.exe", ["node.exe"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;
  } catch { /* fall through to the standard system installation */ }
  const fallback = path.win32.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe");
  return existsSync(fallback) ? fallback : "node.exe";
}

export function powershellQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
