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

    const restoreRoot = process.platform === "win32" ? appRoot.replace(/^[A-Za-z]/, (drive) => drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()) : appRoot;
    const restoreCompatibility = new CursorCompatibility(restoreRoot, storagePath, rendererPath, { syntheticFixture: true });
    await restoreCompatibility.restore();
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

async function recoveryFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "antigravity-resilience-"));
  try {
    const appRoot = join(root, "Cursor-Antigravity-Test", "resources", "app");
    const dir = join(appRoot, "out", "vs", "workbench");
    const desktop = join(dir, "workbench.desktop.main.js"), glass = join(dir, "workbench.glass.main.js");
    const product = join(appRoot, "product.json"), storage = join(root, "storage"), rendererPath = join(root, "renderer.js");
    const originalProduct = {version:"1",checksums:{"vs/workbench/workbench.desktop.main.js":"desktop-original","vs/workbench/workbench.glass.main.js":"glass-original","other":"other-original"}};
    mkdirSync(dir,{recursive:true});
    writeFileSync(desktop,source);writeFileSync(glass,source);writeFileSync(rendererPath,renderer);writeFileSync(product,JSON.stringify(originalProduct));
    const compat = new CursorCompatibility(appRoot,storage,rendererPath,{syntheticFixture:true});
    const plan = await compat.plan({url:"http://127.0.0.1:28743",token:"test-token"});
    await compat.install(plan);
    await run({compat,plan,desktop,glass,product,storage,originalProduct});
  } finally {rmSync(root,{recursive:true,force:true});}
}

test("restore preserves unrelated product.json changes and only reverts bridge checksums",async()=>{
 await recoveryFixture(async({compat,desktop,glass,product,originalProduct})=>{
   const current=JSON.parse(readFileSync(product,"utf8"));current.unrelated={new:true};current.checksums.other="other-new";writeFileSync(product,JSON.stringify(current,null,2));
   await compat.restore();
   assert.equal(readFileSync(desktop,"utf8"),source);assert.equal(readFileSync(glass,"utf8"),source);
   const result=JSON.parse(readFileSync(product,"utf8"));
   assert.deepEqual(result.unrelated,{new:true});assert.equal(result.checksums.other,"other-new");
   assert.equal(result.checksums["vs/workbench/workbench.desktop.main.js"],originalProduct.checksums["vs/workbench/workbench.desktop.main.js"]);
 });
});

test("a clean Cursor upgrade never gets replaced by older backup files",async()=>{
 await recoveryFixture(async({compat,desktop,glass,product})=>{
   const updated="new Cursor build with different native structures";
   const metadata=JSON.stringify({version:"2",checksums:{other:"new"}},null,2);
   writeFileSync(desktop,updated);writeFileSync(glass,updated);writeFileSync(product,metadata);
   await compat.restore();
   assert.equal(readFileSync(desktop,"utf8"),updated);assert.equal(readFileSync(glass,"utf8"),updated);assert.equal(readFileSync(product,"utf8"),metadata);
   assert.equal(await compat.hasInstalledMarkers(),false);
 });
});

test("unknown edits to a still-patched file are detected before any other file is restored",async()=>{
 await recoveryFixture(async({compat,desktop,glass,product})=>{
   const desktopBefore=readFileSync(desktop,"utf8"), productBefore=readFileSync(product,"utf8");
   const conflict=readFileSync(glass,"utf8")+"\n// unknown change";
   writeFileSync(glass,conflict);
   await assert.rejects(compat.restore(),/bridge still present/);
   assert.equal(readFileSync(desktop,"utf8"),desktopBefore);assert.equal(readFileSync(glass,"utf8"),conflict);assert.equal(readFileSync(product,"utf8"),productBefore);
 });
});

test("a missing recovery record is only a no-op if the bridge is absent",async()=>{
 await recoveryFixture(async({compat,desktop,glass,storage})=>{
   rmSync(join(storage,"compatibility.json"));
   await assert.rejects(compat.restore(),/ENOENT/);
   writeFileSync(desktop,source);writeFileSync(glass,source);
   assert.equal(await compat.restore(),false);
 });
});

test("a different product configuration does not collide with an existing verified backup",async()=>{
 await recoveryFixture(async({compat,plan,product})=>{
   await compat.restore();
   const data=JSON.parse(readFileSync(product,"utf8"));data.newFlag=true;writeFileSync(product,JSON.stringify(data));
   const next=await compat.plan({url:"http://127.0.0.1:28743",token:"test-token"});
   assert.equal(next.targets[0].originalHash,plan.targets[0].originalHash);
   await compat.install(next);await compat.restore();
   assert.equal(JSON.parse(readFileSync(product,"utf8")).newFlag,true);
 });
});

test("retired legacy UI does not block compatibility but an unrecognized existing surface does",()=>{
 const absent=nativeCompatibility(source);
 assert.equal(absent.anchors.find(a=>a.id==="provider_legacy").required,false);
 assert.equal(absent.anchors.find(a=>a.id==="provider_settings").required,false);
 assert.equal(absent.ok,false); // missing native turn / active picker is still incompatible
 const present=nativeCompatibility(source+"\ngetAvailableModelsReactiveWithStatus(renamed){}\ngetHardcodedLongContextOnlyModelNames(){}");
 assert.equal(present.anchors.find(a=>a.id==="provider_legacy").ok,false);
 assert.equal(present.anchors.find(a=>a.id==="provider_settings").ok,false);
});

test("a changed unpatched Workbench is not blessed with a new checksum when metadata is still stale",async()=>{
 await recoveryFixture(async({compat,desktop,glass,product})=>{
   const updated="unverified updated Workbench";
   writeFileSync(desktop,updated);
   const before=readFileSync(product,"utf8"),glassBefore=readFileSync(glass,"utf8");
   await assert.rejects(compat.restore(),/old bridge checksum/);
   assert.equal(readFileSync(desktop,"utf8"),updated);assert.equal(readFileSync(glass,"utf8"),glassBefore);assert.equal(readFileSync(product,"utf8"),before);
 });
});
