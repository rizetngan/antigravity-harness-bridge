import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AntigravityGateway } from "../src/gateway/AntigravityGateway.ts";
import { gatewayLocation } from "../src/gateway/location.ts";
import { platformPaths } from "../src/platform.ts";

// Explicitly invoked live probe: uses the signed-in official ACP account and
// only synthetic project files. No existing Cursor profile is opened or copied.
const temp=await mkdtemp(path.join(tmpdir(),"agy-native-live-"));
const appRoot=path.join(temp,"Test","resources","app");
const support=platformPaths().support;
const location=gatewayLocation(support,appRoot);
const profile=path.join(temp,"profile");
await mkdir(profile);
const gateway=new AntigravityGateway({appendLine(value){console.log("[gateway]",value)},clear(){},show(){}},profile,appRoot);
try{
 const [a,b]=await Promise.all(["Project A","Project B"].map(async n=>{const p=path.join(temp,n);await mkdir(p);return realpath(p);}));
 for(const p of [a,b])execFileSync("git",["init","-q",p],{windowsHide:true});
 const expected=["NATIVE_SCOPE_A_"+randomUUID().slice(0,8),"NATIVE_SCOPE_B_"+randomUUID().slice(0,8)];
 await Promise.all([writeFile(path.join(a,"sentinel.txt"),expected[0]),writeFile(path.join(b,"sentinel.txt"),expected[1])]);
 const config=await gateway.start();
 const models=await gateway.refreshCatalogue();
 const model=models.find(m=>/flash/i.test(m.id))??models[0];
 assert.ok(model,"No model offered by the current account");
 console.log("Official ACP catalogue available:",models.length,"families; selected:",model.id);
 async function run(conversationId,execution,text){
  const body={execution,history:{source:"native-turns",totalTurns:0,entries:[]},first:{runRequest:{conversationId,requestedModel:{modelId:"antigravity/"+model.id},action:{userMessageAction:{userMessage:{text,messageId:randomUUID(),mode:1}}},conversationState:{mode:1,turns:[]}}}};
  const response=await fetch(config.url+"/sessions/"+randomUUID()+"/start",{method:"POST",headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000)});
  const events=(await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(response.status,200,events.find(e=>e.error)?.error);
  assert.ok(events.some(e=>e.done),events.find(e=>e.error)?.error||"No completion");
  const reply=events.filter(e=>e.checkpoint).flatMap(e=>e.checkpoint.steps).map(s=>s.assistantMessage?.text||"").join("");
  const record=await gateway.sessions.get(conversationId);
  return {reply,record};
 }
 const text="Read the file sentinel.txt in your current working directory. Reply with its exact contents only. Do not modify any files.";
 const results=await Promise.all([run("a",{kind:"local",workspacePaths:[a]},text),run("b",{kind:"local",workspacePaths:[b]},text)]);
 for(let i=0;i<2;i++){assert.equal(results[i].reply.trim(),expected[i]);assert.equal(results[i].record.cwd,[a,b][i]);}
 assert.notEqual(results[0].record.sessionId,results[1].record.sessionId);
 console.log("PASS: real official ACP, two concurrent local projects read their own unique sentinel.");
 const ordinary=path.join(temp,"Ordinary Folder");await mkdir(ordinary);await writeFile(path.join(ordinary,"sentinel.txt"),"ORDINARY_FOLDER_OK");
 const plain=await run("ordinary",{kind:"local",workspacePaths:[ordinary]},text);
 assert.equal(plain.reply.trim(),"ORDINARY_FOLDER_OK");
 console.log("PASS: ordinary non-Git folder.");
 const noProject=await run("empty",{kind:"none"},"Reply exactly EMPTY_CHAT_OK. Do not use tools.");
 assert.equal(noProject.reply.trim(),"EMPTY_CHAT_OK");
 console.log("PASS: real official ACP, no-project chat.");
}finally{
 gateway.dispose();await gateway.sessions.dispose();
 await new Promise(r=>setTimeout(r,300));
 await rm(temp,{recursive:true,force:true});
 await rm(location.directory,{recursive:true,force:true});
}
