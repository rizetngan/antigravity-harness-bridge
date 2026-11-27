import path from "node:path";
import { readFileSync, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { installationKey } from "../platform.ts";

export function readGatewayPort(directory: string, fallback: number): number {
  try {
    const port = Number(readFileSync(path.join(directory, "gateway-port"), "utf8").trim());
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
  } catch { /* existing releases did not persist a port */ }
  return fallback;
}

export async function persistGatewayPort(directory: string, port: number): Promise<void> {
  const file = path.join(directory, "gateway-port");
  const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    await fs.writeFile(temporary, String(port), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
}

export function gatewayLocation(supportPath: string, appRoot?: string, platform = process.platform) {
  if (!appRoot) return { port: 28743, directory: path.join(supportPath, "probe") };
  const key = installationKey(supportPath, appRoot, platform);
  const directory = path.join(supportPath, "gateways", key);
  return { port: readGatewayPort(directory, 30000 + parseInt(key.slice(0, 4), 16) % 20000), directory };
}
