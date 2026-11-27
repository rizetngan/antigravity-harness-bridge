import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { samePath } from "../src/platform.ts";
import { gatewayLocation } from "../src/gateway/location.ts";
test("keeps isolated and daily installations on separate authenticated endpoints", () => {
  const support = "/Users/test/Library/Application Support/Antigravity for Cursor";
  const daily = gatewayLocation(support, "/Applications/Cursor.app/Contents/Resources/app");
  const isolated = gatewayLocation(support, "/Users/test/Applications/Cursor-Antigravity-Test.app/Contents/Resources/app");
  assert.notEqual(daily.directory, isolated.directory);
  assert.notEqual(daily.port, isolated.port);
  assert.deepEqual(daily, gatewayLocation(support, "/Applications/Cursor.app/Contents/Resources/app/"));
  assert.notEqual(gatewayLocation(support).directory, daily.directory);
});

test("Windows drive, case, slash and trailing separator variations share an endpoint", () => {
  const support = path.join(tmpdir(), "no-existing-bridge-journal");
  const root = "D:/Cursor Space/cursor/resources/app";
  const equivalent = "d:/cursor space/CURSOR/resources/app/";
  assert.equal(samePath(root, equivalent, "win32"), true);
  assert.deepEqual(gatewayLocation(support, root, "win32"), gatewayLocation(support, equivalent, "win32"));
  assert.notDeepEqual(gatewayLocation(support, root, "win32"), gatewayLocation(support, "E:/Cursor Space/cursor/resources/app", "win32"));
  assert.equal(samePath("/tmp/Cursor", "/tmp/cursor", "darwin"), false);
});

test("adopts an existing mixed-case Windows journal and its original gateway", () => {
  const support = mkdtempSync(path.join(tmpdir(), "bridge-path-identity-"));
  try {
    const root = path.win32.resolve("D:/Cursor Space/cursor/resources/app");
    const oldKey = createHash("sha256").update(root).digest("hex").slice(0, 16);
    const folder = path.join(support, "compatibility", oldKey);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "compatibility.json"), JSON.stringify({ appRoot: root, state: "installed" }));
    const a = gatewayLocation(support, "d:/cursor space/CURSOR/resources/app/", "win32");
    assert.equal(a.directory, path.join(support, "gateways", oldKey));
    assert.equal(a.port, 30000 + parseInt(oldKey.slice(0, 4), 16) % 20000);
    assert.deepEqual(a, gatewayLocation(support, root, "win32"));
  } finally { rmSync(support, { recursive: true, force: true }); }
});
