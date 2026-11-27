import path from "node:path";
import { installationKey } from "../platform.ts";

export function gatewayLocation(supportPath: string, appRoot?: string, platform = process.platform) {
  if (!appRoot) return { port: 28743, directory: path.join(supportPath, "probe") };
  const key = installationKey(supportPath, appRoot, platform);
  return { port: 30000 + parseInt(key.slice(0, 4), 16) % 20000, directory: path.join(supportPath, "gateways", key) };
}
