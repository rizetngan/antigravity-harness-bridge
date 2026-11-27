import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorCompatibility } from "../src/cursor/compat.ts";

const appRoot = process.env.CURSOR_APP_ROOT ||
  "/Applications/Cursor.app/Contents/Resources/app";
const storagePath = "/tmp/antigravity-cursor-readonly-check";
const rendererPath = new URL("../src/renderer/renderer.js", import.meta.url).pathname;
const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath);
const temporary = mkdtempSync(join(tmpdir(), "antigravity-cursor-patch-check-"));

try {
  const anchors = await compatibility.anchors();
  const plan = await compatibility.plan({
    url: "http://127.0.0.1:28743",
    token: "static-read-only-check",
  });

  for (const target of plan.targets) {
    const file = join(temporary, target.file + ".mjs");
    writeFileSync(file, target.patched);
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) {
      throw new Error(`${target.file}: ${(checked.stderr || checked.stdout).split("\n").slice(0, 5).join("\n")}`);
    }
  }

  console.log(JSON.stringify({
    appRoot,
    files: anchors.map((item) => ({
      file: item.file,
      kind: item.kind,
      adapterAlreadyInstalled: item.adapter,
      anchors: item.anchors.map((anchor) => ({
        id: anchor.id,
        count: anchor.count,
        patched: anchor.patched,
        ok: anchor.ok,
      })),
      allAnchorsValid: item.ok,
    })),
    patchedFiles: plan.targets.length,
    patchSyntax: "passed",
    productChecksumUpdated: plan.productHash !== plan.patchedProductHash,
    liveInstallationModified: false,
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
