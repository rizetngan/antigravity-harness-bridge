import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchorCounts, patchSource, CursorCompatibility, START, END, EXTENSION_ID } from "../src/cursor/compat.ts";

const source = `
function makeClient(service,transport){return createClient(service,transport)}
"promise-client.js";
getAvailableDefaultModels(){return[...this._availableDefaultModels()]}
U=service.makeMessageType("agent.v1.UserMessage")
S=service.makeMessageType("agent.v1.ConversationStep")
T=service.makeMessageType("agent.v1.ConversationTurnStructure")
this._agentHostEnabled=!0,
a=["anysphere.cursor-resolver","anysphere.cursor-always-local","other.extension"],
`;

const renderer = `
/* Antigravity renderer */
const config=__ANTIGRAVITY_BRIDGE_CONFIG__;
globalThis.__antigravityBridge={config,mergeModels(){return[]},wrapClient(client){return client}};
`;

test("validates unique Cursor anchors before patching", () => {
  const result = anchorCounts(source);
  assert.equal(result.ok, true);
  assert.equal(result.anchors.find((item) => item.id === "client_factory").count, 1);
  assert.equal(result.anchors.find((item) => item.id === "model_getter").count, 1);
});

test("patches the model picker, client factory, native types, and Glass allowlist", () => {
  const patched = patchSource(source, renderer, {
    url: "http://127.0.0.1:28743",
    token: "test-token",
  });
  assert.ok(patched.startsWith(START));
  assert.ok(patched.includes(END));
  assert.ok(patched.includes("__antigravityBridge"));
  assert.ok(patched.includes(EXTENSION_ID));
  assert.ok(patched.includes("this._agentHostEnabled=!0,"));
  assert.ok(!patched.includes("ANTIGRAVITY_AGENT_HOST_OFF"));
  assert.ok(patched.includes("ANTIGRAVITY_MODEL_GETTER"));
  assert.equal(anchorCounts(patched).ok, true);
});



test("keeps Antigravity parameterized Composer models out of Cursor fixUnavailable fallback", () => {
  const guard = 'const f=d.split(",").map(v=>v.trim()).filter(v=>v.length>0),p=f.map(v=>JXm(v,n,s));if(!(p.length>0&&p.every(v=>n.includes(v)))';
  const glassSource = source + guard;
  const patched = patchSource(glassSource, renderer, { url: "http://127.0.0.1:28743", token: "test-token" });
  assert.ok(patched.includes('if(f.length>0&&f.every(v=>globalThis.__antigravityBridge?.registeredModel?.(v,l)))return u;'));
  const anchor = anchorCounts(patched).anchors.find((item) => item.id === "model_availability");
  assert.equal(anchor?.count, 0);
  assert.equal(anchor?.patched, 1);
  assert.equal(anchor?.ok, true);
});


test("patches the distinct desktop model-availability guard", () => {
  const guard = 'const f=d.split(",").map(_=>_.trim()).filter(_=>_.length>0),g=f.map(_=>Cdp(_,i,s));if(!(g.length>0&&g.every(_=>i.includes(_)))';
  const patched = patchSource(source + guard, renderer, { url: "http://127.0.0.1:28743", token: "test-token" });
  assert.ok(patched.includes('if(f.length>0&&f.every(_=>globalThis.__antigravityBridge?.registeredModel?.(_,l)))return u;'));
  const anchor = anchorCounts(patched).anchors.find((item) => item.id === "model_availability_desktop");
  assert.equal(anchor?.count, 0);
  assert.equal(anchor?.patched, 1);
  assert.equal(anchor?.ok, true);
});

test("refuses ambiguous or already-patched Workbench sources", () => {
  assert.throws(() => patchSource(source + source, renderer, { url: "http://127.0.0.1", token: "x" }));
  const patched = patchSource(source, renderer, { url: "http://127.0.0.1", token: "x" });
  assert.throws(() => patchSource(patched, renderer, { url: "http://127.0.0.1", token: "x" }), /already installed/);
});

test("updates every declared Workbench checksum without touching source files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "antigravity-compat-plan-"));
  try {
    const appRoot = join(directory, "Cursor.app", "Contents", "Resources", "app");
    const workbench = join(appRoot, "out", "vs", "workbench");
    mkdirSync(workbench, { recursive: true });
    const desktopPath = join(workbench, "workbench.desktop.main.js");
    const glassPath = join(workbench, "workbench.glass.main.js");
    const productPath = join(appRoot, "product.json");
    const rendererPath = join(directory, "renderer.js");
    const storagePath = join(directory, "storage");
    writeFileSync(desktopPath, source);
    writeFileSync(glassPath, source);
    writeFileSync(rendererPath, renderer);
    const originalProduct = {
      checksums: {
        "vs/workbench/workbench.desktop.main.js": "old-desktop",
        "vs/workbench/workbench.glass.main.js": "old-glass",
      },
    };
    writeFileSync(productPath, JSON.stringify(originalProduct));

    const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath);
    const plan = await compatibility.plan({
      url: "http://127.0.0.1:28743",
      token: "test-token",
    });
    const patchedProduct = JSON.parse(plan.patchedProduct.toString("utf8"));
    const expected = (value) => createHash("sha256")
      .update(value)
      .digest("base64")
      .replace(/=+$/, "");

    assert.equal(plan.targets.length, 2);
    assert.equal(
      patchedProduct.checksums["vs/workbench/workbench.desktop.main.js"],
      expected(plan.targets[0].patched),
    );
    assert.equal(
      patchedProduct.checksums["vs/workbench/workbench.glass.main.js"],
      expected(plan.targets[1].patched),
    );
    assert.equal(readFileSync(desktopPath, "utf8"), source);
    assert.equal(readFileSync(glassPath, "utf8"), source);
    assert.deepEqual(JSON.parse(readFileSync(productPath, "utf8")), originalProduct);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("installs and restores the Workbench patch from a hash-verified backup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "antigravity-compat-restore-"));
  try {
    const appBundle = join(directory, "Cursor.app");
    const appRoot = join(appBundle, "Contents", "Resources", "app");
    const workbench = join(appRoot, "out", "vs", "workbench");
    const desktopPath = join(workbench, "workbench.desktop.main.js");
    const glassPath = join(workbench, "workbench.glass.main.js");
    const productPath = join(appRoot, "product.json");
    const rendererPath = join(directory, "renderer.js");
    const storagePath = join(directory, "storage");
    const signaturePath = join(appBundle, "Contents", "_CodeSignature", "CodeResources");
    const originalProduct = {
      checksums: {
        "vs/workbench/workbench.desktop.main.js": "desktop-before",
        "vs/workbench/workbench.glass.main.js": "glass-before",
      },
    };

    mkdirSync(workbench, { recursive: true });
    mkdirSync(join(appBundle, "Contents", "_CodeSignature"), { recursive: true });
    writeFileSync(desktopPath, source);
    writeFileSync(glassPath, source);
    writeFileSync(rendererPath, renderer);
    writeFileSync(productPath, JSON.stringify(originalProduct));
    writeFileSync(signaturePath, "signature-before");

    const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath);
    const plan = await compatibility.plan({
      url: "http://127.0.0.1:28743",
      token: "test-token",
    });

    await compatibility.install(plan);
    assert.equal(anchorCounts(readFileSync(desktopPath, "utf8")).adapter, true);
    assert.equal(anchorCounts(readFileSync(glassPath, "utf8")).adapter, true);
    assert.equal(readFileSync(signaturePath, "utf8"), "signature-before");

    const installedProduct = JSON.parse(readFileSync(productPath, "utf8"));
    assert.notDeepEqual(installedProduct, originalProduct);
    assert.equal(JSON.parse(readFileSync(join(storagePath, "compatibility.json"), "utf8")).state, "installed");

    await compatibility.restore();
    assert.equal(readFileSync(desktopPath, "utf8"), source);
    assert.equal(readFileSync(glassPath, "utf8"), source);
    assert.deepEqual(JSON.parse(readFileSync(productPath, "utf8")), originalProduct);
    assert.equal(readFileSync(signaturePath, "utf8"), "signature-before");
    assert.equal(anchorCounts(readFileSync(desktopPath, "utf8")).adapter, false);
    assert.equal(JSON.parse(readFileSync(join(storagePath, "compatibility.json"), "utf8")).state, "restored");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("wraps the managed Agent Host per-turn execution strategy on both Workbenches", () => {
  const nativeType = '\nM=service.makeMessageType("agent.v1.AgentServerMessage")\n';
  for (const config of ["e", "t"]) {
    const strategy = 'this._executionStrategy=' + config + '?.executionStrategy??new Legacy(this.agentClientService),';
    const input = source + nativeType + strategy;
    const patched = patchSource(input, renderer, { url: "http://127.0.0.1:28743", token: "test-token" });
    assert.ok(patched.includes("ANTIGRAVITY_TURN_STRATEGY"));
    assert.ok(patched.includes('case "AgentServerMessage":return M;'));
    assert.equal(anchorCounts(patched).anchors.find(a => a.id === "turn_strategy").patched, 1);
    assert.equal(anchorCounts(patched).ok, true);
    assert.throws(() => patchSource(input + strategy, renderer, { url: "http://127.0.0.1", token: "test-token" }), /strategy is ambiguous/);
  }
});
