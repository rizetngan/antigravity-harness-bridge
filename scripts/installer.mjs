import { promises as fs } from "node:fs";
import path from "node:path";
import { CursorCompatibility } from "../src/cursor/compat.ts";
import { gatewayLocation } from "../src/gateway/location.ts";

async function main() {
  const [action, appRootArg, storagePathArg, rendererPathArg, supportPathArg, uidArg, gidArg] =
    process.argv.slice(2);

  if (!["install", "restore"].includes(action)) {
    throw new Error("Usage: installer install|restore <appRoot> <storagePath> <rendererPath> <supportPath> <uid> <gid>");
  }

  const appRoot = path.resolve(appRootArg || "");
  const storagePath = path.resolve(storagePathArg || "");
  const rendererPath = path.resolve(rendererPathArg || "");
  const supportPath = path.resolve(supportPathArg || "");
  const uid = Number(uidArg);
  const gid = Number(gidArg);

  if (!appRootArg || !storagePathArg || !rendererPathArg || !supportPathArg ||
      !Number.isInteger(uid) || !Number.isInteger(gid)) {
    throw new Error("Installer arguments are incomplete.");
  }

  const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath, {
    allowOriginalApp: true,
  });

  if (action === "install") {
    const gateway = gatewayLocation(supportPath, appRoot);
    const token = (await fs.readFile(path.join(gateway.directory, "bridge-token"), "utf8")).trim();
    if (token.length < 40) throw new Error("The local bridge token is invalid.");
    const anchors = await compatibility.anchors();
    if (!anchors.length || anchors.some((item) => !item.ok || item.adapter)) {
      throw new Error("Cursor Workbench anchors are missing, ambiguous, or already patched.");
    }
    const plan = await compatibility.plan({
      url: "http://127.0.0.1:" + gateway.port,
      token,
    });
    await compatibility.install(plan);
  } else {
    await compatibility.restore();
  }

  async function restoreOwner(current) {
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of await fs.readdir(current)) {
        await restoreOwner(path.join(current, name));
      }
    }
    await fs.chown(current, uid, gid);
  }

  if (typeof process.getuid === "function" && process.getuid() !== uid) {
    await restoreOwner(storagePath);
  }
  console.log(JSON.stringify({
    action,
    appRoot,
    result: action === "install" ? "Workbench integration installed" : "Cursor Workbench restored",
    backupDirectory: storagePath,
    ownerRestored: uid + ":" + gid,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
