import { createHash } from "node:crypto";
import path from "node:path";

export function gatewayLocation(supportPath: string, appRoot?: string) {
  if (!appRoot) return { port: 28743, directory: path.join(supportPath, "probe") };
  const key = createHash("sha256").update(path.resolve(appRoot)).digest("hex").slice(0, 16);
  return { port: 30000 + parseInt(key.slice(0, 4), 16) % 20000, directory: path.join(supportPath, "gateways", key) };
}
