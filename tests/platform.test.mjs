import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { platformPaths, isCursorResources, powershellQuote, probeDirectoryWritable } from "../src/platform.ts";
test("Windows uses local app data, roaming Cursor profile and official agy.exe", () => {
  const home = "C:\\Users\\Test User";
  const x = platformPaths("win32", {LOCALAPPDATA: "D:\\Local Data", APPDATA: "D:\\Roaming Data"}, home);
  assert.equal(x.support, "D:\\Local Data\\Antigravity for Cursor");
  assert.equal(x.cursorUserData, "D:\\Roaming Data\\Cursor");
  assert.equal(x.agy, "D:\\Local Data\\agy\\bin\\agy.exe");
  assert.equal(platformPaths("win32", {}, home).agy, home + "\\AppData\\Local\\agy\\bin\\agy.exe");
});
test("macOS support paths remain unchanged", () => {
  assert.equal(platformPaths("darwin", {}, "/Users/test").support, "/Users/test/Library/Application Support/Antigravity for Cursor");
});
test("filters platform resource roots and quotes login executables safely", () => {
  assert.equal(isCursorResources("E:\\cursor\\resources\\app"), true);
  assert.equal(isCursorResources("/Applications/Cursor.app/Contents/Resources/app"), true);
  assert.equal(isCursorResources("E:\\workspace"), false);
  assert.equal(powershellQuote("C:\\O'Neil\\agy.exe"), "'C:\\O''Neil\\agy.exe'");
});

test("write probe tests real create permission rather than advisory W_OK", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "antigravity-write-probe-"));
  try {
    assert.equal(await probeDirectoryWritable(directory), true);
    assert.equal(await probeDirectoryWritable(path.join(directory, "missing")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows PowerShell array splatting preserves paths with spaces and apostrophes", { skip: process.platform !== "win32" }, () => {
  const args = ["D:/Cursor Space/cursor/resources/app", "D:/Antigravity for Cursor", "D:/O'Neil/renderer.js"];
  const script = "$a = @(" + args.map(powershellQuote).join(", ") + "); & " + powershellQuote(process.execPath) + " -e 'console.log(JSON.stringify(process.argv.slice(1)))' @a";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output.trim()), args);
});
