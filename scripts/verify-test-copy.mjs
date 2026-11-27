import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { CursorCompatibility } from "../src/cursor/compat.ts";

const appPath = process.env.CURSOR_TEST_APP_PATH ||
  join(homedir(), "Applications", "Cursor-Antigravity-Test.app");
const appRoot = join(appPath, "Contents", "Resources", "app");
const support = join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
const storagePath = join(support, "compatibility-test");
const rendererPath = new URL("../src/renderer/renderer.js", import.meta.url).pathname;
const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath);
const journal = JSON.parse(readFileSync(join(storagePath, "compatibility.json"), "utf8"));
const product = JSON.parse(readFileSync(join(appRoot, "product.json"), "utf8"));
const anchors = await compatibility.anchors();

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function checksum(value) {
  return createHash("sha256").update(value).digest("base64").replace(/=+$/, "");
}

if (journal.state !== "installed") throw new Error("Test Cursor patch journal is not in installed state.");
if (!anchors.length || anchors.some((item) => !item.adapter || !item.ok)) {
  throw new Error("One or more patched Cursor Workbench anchors failed verification.");
}

const checksumResults = [];
const dailyResults = [];
for (const target of journal.targets) {
  const bytes = readFileSync(target.file);
  const productKey = "vs/workbench/" + basename(target.file);
  const expectedChecksum = product.checksums?.[productKey];
  if (expectedChecksum && checksum(bytes) !== expectedChecksum) {
    throw new Error("product.json checksum mismatch for " + productKey);
  }
  checksumResults.push({ file: basename(target.file), checksumVerified: expectedChecksum ? true : "not declared" });

  const dailyFile = join("/Applications/Cursor.app/Contents/Resources/app", "out", "vs", "workbench", basename(target.file));
  const dailyHash = hash(readFileSync(dailyFile));
  dailyResults.push({
    file: basename(target.file),
    dailyCursorMatchesOriginal: dailyHash === target.originalHash,
  });
}
const dailyProductHash = hash(readFileSync("/Applications/Cursor.app/Contents/Resources/app/product.json"));
const dailyProductUnchanged = dailyProductHash === journal.productHash;


console.log(JSON.stringify({
  testApp: appPath,
  workbench: anchors.map((item) => ({
    file: item.file,
    adapterInstalled: item.adapter,
    anchorsValid: item.ok,
  })),
  productChecksums: checksumResults,
  dailyCursor: {
    workbenchMatchesOriginal: dailyResults.every((item) => item.dailyCursorMatchesOriginal),
    files: dailyResults,
    productJsonUnchanged: dailyProductUnchanged,
  },
  codeSignatureMetadata: "not modified by the compatibility installer",
}, null, 2));
