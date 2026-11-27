import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchorCounts, patchSource, CursorCompatibility, START, END, EXTENSION_ID, nativeCompatibility } from "../src/cursor/compat.ts";

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



// Representative shapes from the official 3.28.7 and 3.32.4 bundles,
// with unrelated implementation omitted. Test that identifier renaming is
// irrelevant while the blocked-model callback and native config stay intact.
function availabilityFixture({ stored="u", model="d", list="f", resolved="g", item="_", available="i", field="r", blocked="l", factory="Cdp" } = {}) {
  return 'const{modelConfigService:t,availableModels:'+available+',specificModelField:'+field+',isModelBlocked:'+blocked+'=()=>!1}=e,'+stored+'=t.getStoredModelConfig('+field+');const '+model+'='+stored+'.modelName;if('+model+'==="default")return '+stored+';const '+list+'='+model+'.split(",").map('+item+'=>'+item+'.trim()).filter('+item+'=>'+item+'.length>0),'+resolved+'='+list+'.map('+item+'=>'+factory+'('+item+','+available+',s));if(!('+resolved+'.length>0&&'+resolved+'.every('+item+'=>'+available+'.includes('+item+')))){if('+available+'.length===0||'+field+'==="background-composer")return '+stored+';log({subkey:"fix_unavailable_model_reset"});}';
}
test("recognizes model availability structure across renamed minified identifiers", () => {
  const variants = [
    {},
    { resolved:"p", item:"v", available:"n", factory:"JXm" },
    { stored:"d", model:"u", list:"p", resolved:"m", item:"S", factory:"ysl" },
    { stored:"d", model:"u", list:"p", resolved:"g", item:"f", available:"n", field:"s", factory:"NOd" },
    { stored:"saved", model:"slug", list:"tokens", resolved:"lookup", item:"entry", available:"choices", field:"surface", blocked:"denied", factory:"normalize" },
  ];
  for (const variant of variants) {
    const input = source + availabilityFixture(variant);
    const before = anchorCounts(input).anchors.find(a => a.id === "model_availability");
    assert.equal(before.count, 1, JSON.stringify(variant));
    const patched = patchSource(input, renderer, { url: "http://127.0.0.1:28743", token: "test-token" });
    const after = anchorCounts(patched).anchors.find(a => a.id === "model_availability");
    assert.equal(after.patched, 1, JSON.stringify(variant));
    assert.ok(patched.includes("registeredModel?.(" + (variant.item || "_") + "," + (variant.blocked || "l") + ")"));
  }
});
test("rejects ambiguous or unrelated availability branches and incomplete full native adapters", () => {
  const fixture = availabilityFixture();
  assert.equal(anchorCounts(source + fixture.replace('fix_unavailable_model_reset','unrelated')).anchors.find(a=>a.id==="model_availability").count,0);
  assert.equal(anchorCounts(source + fixture.replace('isModelBlocked:l','unrelated:l')).anchors.find(a=>a.id==="model_availability").count,0);
  assert.throws(()=>patchSource(source+fixture+"\n"+fixture,renderer,{url:"http://127.0.0.1",token:"test"}),/availability guard is ambiguous/);
  assert.equal(nativeCompatibility(source).ok,false);
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

    const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath, { syntheticFixture: true });
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
    const appBundle = join(directory, "Cursor-Antigravity-Test");
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

    const compatibility = new CursorCompatibility(appRoot, storagePath, rendererPath, { syntheticFixture: true });
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
