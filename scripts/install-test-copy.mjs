import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { CursorCompatibility } from "../src/cursor/compat.ts";
import { gatewayLocation } from "../src/gateway/location.ts";

const appRoot = process.env.CURSOR_TEST_APP_ROOT ||
  join(homedir(), "Applications", "Cursor-Antigravity-Test.app", "Contents", "Resources", "app");
const appPath = join(appRoot, "..", "..", "..");
const storageDirectory = join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
const storagePath = join(storageDirectory, "compatibility-test");
const gateway = gatewayLocation(storageDirectory, appRoot);
const tokenFile = join(gateway.directory, "bridge-token");
const rendererPath = new URL("../src/renderer/renderer.js", import.meta.url).pathname;
const temporary = mkdtempSync(join(tmpdir(), "antigravity-cursor-install-check-"));

function signatureTreeHash(root) {
  const hash = createHash("sha256");
  const signatureDirs = [];
  function find(current) {
    if (!existsSync(current)) return;
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (name === "_CodeSignature" && statSync(full).isDirectory()) {
        signatureDirs.push(full);
        continue;
      }
      if (statSync(full).isDirectory()) find(full);
    }
  }
  find(root);
  for (const directory of signatureDirs.sort()) {
    hash.update(relative(root, directory));
    function files(current) {
      for (const name of readdirSync(current).sort()) {
        const full = join(current, name);
        if (statSync(full).isDirectory()) files(full);
        else {
          hash.update(relative(root, full));
          hash.update(readFileSync(full));
        }
      }
    }
    files(directory);
  }
  return hash.digest("hex");
}

mkdirSync(gateway.directory, { recursive: true });
let token;
try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch {
  token = randomBytes(32).toString("base64url");
  writeFileSync(tokenFile, token, { mode: 0o600 });
}
if (token.length < 40) throw new Error("The local bridge token is invalid.");

const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath);
try {
  const anchors = await compatibility.anchors();
  if (!anchors.length || anchors.some((item) => !item.ok || item.adapter)) {
    throw new Error("Cursor Workbench compatibility anchors are missing, ambiguous, or already patched.");
  }

  const plan = await compatibility.plan({
    url: "http://127.0.0.1:" + gateway.port,
    token,
  });

  for (const target of plan.targets) {
    const file = join(temporary, target.file + ".mjs");
    writeFileSync(file, target.patched);
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) {
      throw new Error(target.file + ": " + (checked.stderr || checked.stdout).split("\n").slice(0, 5).join("\n"));
    }
  }

  const signatureBefore = signatureTreeHash(appPath);
  await compatibility.install(plan);
  const signatureAfter = signatureTreeHash(appPath);
  if (signatureAfter !== signatureBefore) {
    await compatibility.restore();
    throw new Error("The compatibility installer unexpectedly changed the app's code-signature metadata.");
  }

  console.log(JSON.stringify({
    target: appRoot,
    patchedFiles: plan.targets.map((item) => item.file),
    patchSyntax: "passed",
    productChecksumUpdated: plan.productHash !== plan.patchedProductHash,
    backups: storagePath,
    codeSignatureMetadata: "untouched",
    dailyCursorModified: false,
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
