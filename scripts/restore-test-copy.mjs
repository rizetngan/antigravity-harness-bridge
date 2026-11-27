import { homedir } from "node:os";
import { join } from "node:path";
import { CursorCompatibility } from "../src/cursor/compat.ts";

const appRoot = process.env.CURSOR_TEST_APP_ROOT ||
  join(homedir(), "Applications", "Cursor-Antigravity-Test.app", "Contents", "Resources", "app");
const storageDirectory = join(homedir(), "Library", "Application Support", "Antigravity for Cursor");
const compatibility = new CursorCompatibility(
  appRoot,
  join(storageDirectory, "compatibility-test"),
  new URL("../src/renderer/renderer.js", import.meta.url).pathname,
);

await compatibility.restore();
const anchors = await compatibility.anchors();
if (anchors.some((item) => item.adapter || !item.ok)) {
  throw new Error("Cursor Workbench restore verification failed.");
}
console.log("Test Cursor copy restored. Workbench files and product.json match the saved pre-install state.");
console.log("Code-signature metadata was not modified by the compatibility installer.");
