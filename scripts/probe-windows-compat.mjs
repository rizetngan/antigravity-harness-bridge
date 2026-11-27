import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CursorCompatibility } from "../src/cursor/compat.ts";

if (process.platform !== "win32") throw new Error("Run this probe on Windows.");
const realRoot = process.env.CURSOR_WINDOWS_APP_ROOT;
if (!realRoot) throw new Error("Set CURSOR_WINDOWS_APP_ROOT to the original Cursor resources/app directory.");
const root = mkdtempSync(path.join(tmpdir(), "antigravity-windows-probe-"));
const testRoot = path.join(root, "Cursor-Antigravity-Test", "resources", "app");
const relativePaths = ["product.json", "out/vs/workbench/workbench.desktop.main.js", "out/vs/workbench/workbench.glass.main.js"];
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
try {
  const originalHashes = relativePaths.map((file) => hash(path.join(realRoot, file)));
  for (const file of relativePaths) {
    const destination = path.join(testRoot, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(realRoot, file), destination);
  }
  const storage = path.join(root, "backups");
  const renderer = fileURLToPath(new URL("../src/renderer/renderer.js", import.meta.url));
  const compat = new CursorCompatibility(testRoot, storage, renderer);
  const anchors = await compat.anchors();
  assert.equal(anchors.length, 2);
  assert.ok(anchors.every((item) => item.ok && !item.adapter), "Unsupported or already-patched Windows Workbench");
  const plan = await compat.plan({ url: "http://127.0.0.1:28743", token: "windows-copy-test-only" });
  for (const target of plan.targets) {
    const syntaxFile = path.join(root, target.file + ".mjs");
    writeFileSync(syntaxFile, target.patched);
    const result = spawnSync(process.execPath, ["--check", syntaxFile], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  await compat.install(plan);
  assert.ok((await compat.anchors()).every((item) => item.ok && item.adapter));
  const product = JSON.parse(readFileSync(path.join(testRoot, "product.json"), "utf8"));
  for (const target of plan.targets) {
    const checksum = product.checksums?.[target.key];
    if (checksum) assert.equal(checksum, createHash("sha256").update(readFileSync(target.path)).digest("base64").replace(/=+$/, ""));
  }
  await compat.restore();
  assert.deepEqual(relativePaths.map((file) => hash(path.join(testRoot, file))), originalHashes);
  assert.deepEqual(relativePaths.map((file) => hash(path.join(realRoot, file))), originalHashes);
  console.log(JSON.stringify({ windows: process.arch, originalCursorUntouched: true, workbenchAnchors: anchors.map(x => x.file), syntax: "passed", install: "passed", checksum: "passed", restore: "passed" }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
