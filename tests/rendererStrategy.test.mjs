import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const source = readFileSync(new URL("../src/renderer/renderer.js", import.meta.url), "utf8");
const model = { id: "gemini-test", name: "Gemini Test", variants: [{ id: "gemini-test", thinking: true }], reasoning: { effortValues: ["low","high"] } };
const userMessage = { text: "test", messageId: "user", mode: 1 };
function setup(events = [{ message: { interactionUpdate: { textDelta: { text: "ok" } } } }, { checkpoint: { userMessage, steps: [{ assistantMessage: { text: "ok" } }], state: { turns: [] }, mode: 1, modelName: "Gemini Test" } }, { done: true }]) {
  const requests = [], updates = [], blobs = [], checkpoints = [];
  let enabled = true, online = true, timer;
  const storage = new Map();
  const context = vm.createContext({
    console: { info(){}, warn(){} }, localStorage: { getItem: key => storage.get(key) ?? (key.endsWith(".provider") ? null : key.endsWith(".preferences") ? null : JSON.stringify({models:[model]})), setItem(key,value){storage.set(key,value);} }, crypto: webcrypto, AbortController, AbortSignal, Headers, TextDecoder, btoa, atob, Uint8Array,
    setTimeout: fn => { timer=fn; return 1; }, clearTimeout(){},
    fetch: async (url, init) => {
      requests.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
      if (!online) throw new Error("offline");
      if (url.endsWith("/mode")) return Response.json({ enabled });
      if (url.endsWith("/catalog")) return Response.json({ enabled, models: enabled ? [model] : [] });
      return new Response(url.endsWith("/start") ? events.map(v=>JSON.stringify(v)).join("\n")+"\n" : "");
    },
  });
  vm.runInContext(source.replace("__ANTIGRAVITY_BRIDGE_CONFIG__", JSON.stringify({url:"http://127.0.0.1:28743",token:"test"})), context);
  const bridge = context.__antigravityBridge;
  bridge.nativeType = type => ({ fromBinary: bytes => JSON.parse(new TextDecoder().decode(bytes)), fromJson: value => type === "AgentServerMessage" ?
    { message: value.interactionUpdate ? {case:"interactionUpdate",value:value.interactionUpdate} : {case:"conversationCheckpointUpdate",value:value.conversationCheckpointUpdate} } :
    { toBinary: () => new TextEncoder().encode(JSON.stringify(value)) } });
  const turn = {
    conversationId: "test", action: { userMessageAction: { userMessage } }, conversationState: { turns: [] },
    runOptions: { requestedModel: { modelId: "antigravity/gemini-test", parameters: [{id:"reasoning_effort",value:"high"}] } },
    ctx: {}, abortController: new AbortController(),
    blobStore: { setBlob: async (_, hash, bytes) => blobs.push({hash,bytes}), flush: async()=>{} },
    interactionListener: { sendUpdate: async (_, value) => updates.push(value) },
    checkpointHandler: { handleCheckpoint: async (_, value) => checkpoints.push(value) },
  };
  let nativeCalls=0;
  const strategy=bridge.wrapExecutionStrategy({executeTurn: async()=>{nativeCalls++}});
  return {strategy, turn, requests, updates, blobs, checkpoints, bridge, nativeCalls:()=>nativeCalls, async switchMode(value){await new Promise(r=>setImmediate(r)); enabled=value; await timer();}, async disconnect(){online=false; await timer();}, storage};
}
test("routes selected Antigravity turns directly to ACP and writes native checkpoint", async()=>{
  const t=setup();
  await t.strategy.executeTurn(t.turn);
  assert.equal(t.nativeCalls(),0);
  const start=t.requests.find(r=>r.url.endsWith("/start"));
  assert.equal(start.body.first.runRequest.requestedModel.modelId,"antigravity/gemini-test");
  assert.equal(start.body.first.runRequest.requestedModel.parameters[0].value,"high");
  assert.equal(t.updates[0].textDelta.text,"ok");
  assert.equal(t.blobs.length,3);
  assert.equal(t.checkpoints[0].turns.length,1);
});
test("leaves ordinary Cursor models on the original strategy", async()=>{
  const t=setup();
  t.turn.runOptions.requestedModel.modelId="cursor-model";
  await t.switchMode(false);
  await t.strategy.executeTurn(t.turn);
  assert.equal(t.nativeCalls(),1);
  assert.equal(t.requests.filter(r=>r.url.endsWith("/start")).length,0);
});
test("ACP failure is surfaced without falling back", async()=>{
  const t=setup([{error:"provider unavailable"}]);
  await assert.rejects(t.strategy.executeTurn(t.turn), /provider unavailable/);
  assert.equal(t.nativeCalls(),0);
  assert.equal(t.checkpoints.length,0);
});
test("incomplete stream cannot be reported as success", async()=>{
  const t=setup([{done:true}]);
  await assert.rejects(t.strategy.executeTurn(t.turn), /complete checkpoint/);
  assert.equal(t.nativeCalls(),0);
});


test("imports current native turn's visible history without transferring reasoning or root blobs", async()=>{
  const t=setup();
  const data = new Map([
    [1, {agentConversationTurn:{userMessage:"Ag==",steps:["Aw==","BA==","BQ=="]}}],
    [2, {text:"Remember the blue kite",images:[]}],
    [3, {assistantMessage:{text:"I remember."}}],
    [4, {thinkingMessage:{text:"PRIVATE_THOUGHT_MUST_NOT_LEAVE"}}],
    [5, {toolCall:{mcpToolCall:{args:{name:"sensitive details"}}}}],
  ]);
  t.turn.conversationState={turns:["AQ=="],rootPromptMessagesJson:["PRIVATE_ROOT"]};
  t.turn.blobStore.getBlob=async (_,ref)=>new TextEncoder().encode(JSON.stringify(data.get(ref[0])));
  await t.strategy.executeTurn(t.turn);
  const body=t.requests.find(r=>r.url.endsWith("/start")).body;
  assert.equal(body.history.entries.length,2);
  assert.equal(body.history.entries[0].text,"Remember the blue kite");
  assert.equal(body.history.entries[1].text,"I remember.");
  assert.equal(body.history.entries[1].toolResults[0].name,"mcpToolCall");
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_THOUGHT|PRIVATE_ROOT|sensitive details/);
  assert.equal(t.checkpoints[0].turns.length,2);
});

test("fails closed when a native history blob cannot be loaded",async()=>{
  const t=setup();
  t.turn.conversationState={turns:["AQ=="]};
  t.turn.blobStore.getBlob=async()=>undefined;
  await assert.rejects(t.strategy.executeTurn(t.turn),/history blob is unavailable/);
  assert.equal(t.requests.filter(r=>r.url.endsWith("/start")).length,0);
});

test("restores model metadata before network catalogue loads, never accepts unknown or blocked models",()=>{
  const {bridge}=setup();
  assert.equal(bridge.registeredModel("antigravity/gemini-test[reasoning_effort=high]",()=>false),true);
  assert.equal(bridge.registeredModel("antigravity/gemini-test[reasoning_effort=not-offered]",()=>false),false);
  assert.equal(bridge.registeredModel("antigravity/unknown",()=>false),false);
  assert.equal(bridge.registeredModel("antigravity/gemini-test",()=>true),false);
  assert.equal(bridge.registeredModel("cursor-native",()=>false),false);
});

test("keeps model labels stable when the service goes offline and refreshes reactive catalogue on reconnection", async()=>{
  let online=false, now=10000, revision=0, reads=0, bumps=0;
  let timer;
  const context=vm.createContext({
    console:{info(){},warn(){}}, AbortSignal, Headers,
    Date:class extends Date {static now(){return now;}},
    localStorage:{getItem:()=>JSON.stringify({models:[model]}),setItem(){}},
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
    fetch:async()=>{if(!online)throw new Error("stopped");return Response.json({enabled:true,models:[model],revision});},
  });
  vm.runInContext(source.replace("__ANTIGRAVITY_BRIDGE_CONFIG__",JSON.stringify({url:"http://127.0.0.1:28743",token:"test"})),context);
  const bridge=context.__antigravityBridge;
  const service={reactiveStorageService:{availableModelsCatalogRevision(){reads++;},bumpAvailableModelsCatalogRevision(){bumps++;}}};
  const names=()=>Array.from(bridge.mergeModels(service,[]),m=>m.variants[0].displayName);
  const cached=names();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(bridge.catalogueStatus(),"unavailable");
  assert.deepEqual(names(),cached);
  online=true;revision=1;now+=3000;
  await timer();
  assert.equal(bridge.catalogueStatus(),"connected");
  assert.deepEqual(names(),cached);
  assert.ok(bumps>=1);
  online=false;now+=3000;
  await timer();
  assert.equal(bridge.catalogueStatus(),"unavailable");
  assert.deepEqual(names(),cached);
  assert.ok(reads>=3);
});

test("adds Antigravity suffix only to bridge labels while preserving route identity and effort", async()=>{
  const t=setup();
  const native={name:"gemini-test",clientDisplayName:"Gemini Test",defaultOn:true};
  const entries=t.bridge.mergeModels({},[native]);
  assert.equal(entries[0],native);
  const entry=entries[1];
  assert.equal(entry.name,"antigravity/gemini-test");
  assert.equal(entry.vendorName,"Antigravity");
  assert.equal(entry.clientDisplayName,"Gemini Test\u00b7Antigravity");
  assert.equal(entry.inputboxShortModelName,"Gemini Test\u00b7Antigravity");
  assert.equal(entry.variants[1].displayName,"Gemini Test\u00b7Antigravity \u00b7 High");
  assert.equal(entry.variants[1].displayNameOutsidePicker,"Gemini Test\u00b7Antigravity \u00b7 High");
  assert.equal(entry.variants[1].variantStringRepresentation,"antigravity/gemini-test[reasoning_effort=high]");
  await t.strategy.executeTurn(t.turn);
  const req=t.requests.find(r=>r.url.endsWith("/start")).body.first.runRequest;
  assert.equal(req.modelDetails.displayName,"Gemini Test\u00b7Antigravity");
  assert.equal(req.requestedModel.modelId,"antigravity/gemini-test");
});

test("explicit stop restores native models, restart shows only bridge models, offline never falls back",async()=>{
  const t=setup();
  const native={name:"gemini-test",clientDisplayName:"Gemini Test",defaultOn:true};
  const service={reactiveStorageService:{availableModelsCatalogRevision(){},bumpAvailableModelsCatalogRevision(){}}};
  const visible=()=>Array.from(t.bridge.filterVisibleModels(t.bridge.mergeModels(service,[native])),m=>m.name);
  assert.deepEqual(visible(),["antigravity/gemini-test"]);
  assert.deepEqual(Array.from(t.bridge.preferredVisibleIds([],t.bridge.mergeModels(service,[native]))),["antigravity/gemini-test"]);
  t.turn.runOptions.requestedModel.modelId="gemini-test";
  await assert.rejects(t.strategy.executeTurn(t.turn),/mode is active/);
  await t.switchMode(false);
  assert.equal(t.bridge.catalogueStatus(),"paused");
  assert.deepEqual(visible(),["gemini-test"]);
  t.turn.runOptions.requestedModel.modelId="antigravity/gemini-test";
  await assert.rejects(t.strategy.executeTurn(t.turn),/service is stopped/);
  await t.switchMode(true);
  assert.deepEqual(visible(),["antigravity/gemini-test"]);
  await t.disconnect();
  assert.equal(t.bridge.catalogueStatus(),"unavailable");
  assert.deepEqual(visible(),["antigravity/gemini-test"]);
  assert.equal(t.nativeCalls(),0);
});
