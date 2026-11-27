import test from "node:test";
import assert from "node:assert/strict";
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
