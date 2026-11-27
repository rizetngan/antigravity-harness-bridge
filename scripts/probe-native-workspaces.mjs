import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { AntigravityGateway } from "../src/gateway/AntigravityGateway.ts";
import { AcpClientHandlers } from "../src/acp/AcpClientHandlers.ts";
import { workspace } from "vscode";
import { randomUUID } from "node:crypto";

const temp=await mkdtemp(path.join(tmpdir(),"agy-native-scope-"));
const previousHome=process.env.HOME, previousLocal=process.env.LOCALAPPDATA;
process.env.HOME=temp;process.env.LOCALAPPDATA=path.join(temp,"local");
const [a,b,worktree,owner,profile]=await Promise.all(["Project A","Project B","Worktree A","Gateway owner","Profile"].map(async n=>{
 const p=path.join(temp,n);await mkdir(p);return realpath(p);
}));
workspace.workspaceFolders=[{uri:{fsPath:owner,scheme:"file"}}];
const appRoot=path.join(temp,"Test","resources","app");
const gateway=new AntigravityGateway({appendLine(){},clear(){},show(){}},profile,appRoot);
const handlers=new AcpClientHandlers();
const requests=new Map();
handlers.register({onRequest(name,fn){requests.set(name,fn);}});
const invoke=(name,params)=>requests.get(name)({params});
const sessions=new Map(),listeners=new Set(),created=[],loaded=[];
const mock={
 async start(){},
 async getCatalogue(){return {availableModels:[],modelFamilies:[{id:"test-model",name:"Test Model",thoughtLevels:[],supportsThinking:false,supportedInputTypes:["text"]}],modeOptions:[]};},
 async createSession(cwd,roots){const id=randomUUID();sessions.set(id,{cwd,roots});handlers.registerSession(id,roots);created.push(id);return {sessionId:id};},
 async loadSession(id,cwd,roots){assert.equal(sessions.get(id).cwd,cwd);handlers.registerSession(id,roots);loaded.push(id);return {};},
 async setConfigOption(){},
 onSessionUpdate(fn){listeners.add(fn);return()=>listeners.delete(fn);},
 async prompt(id){for(const fn of listeners)fn({sessionId:id,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"ok"}}});return {stopReason:"end_turn"};},
 async cancel(){},dispose(){handlers.dispose();}
};
gateway.acp.dispose();gateway.acp=mock;
try{
 const config=await gateway.start();
 await gateway.refreshCatalogue();
 const histories=new Map();
 async function run(conversationId,execution){
  const entries=histories.get(conversationId)??[];
  const history={source:"native-turns",totalTurns:entries.length/2,entries};
  const body={execution,history,first:{runRequest:{conversationId,requestedModel:{modelId:"antigravity/test-model"},action:{userMessageAction:{userMessage:{text:"test",messageId:randomUUID(),mode:1}}},conversationState:{mode:1,turns:[]}}}};
  const response=await fetch(config.url+"/sessions/"+randomUUID()+"/start",{method:"POST",headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const events=(await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(response.status,200,JSON.stringify(events));assert.ok(events.some(x=>x.done),JSON.stringify(events));
  histories.set(conversationId,[...entries,{role:"user",text:"test"},{role:"assistant",text:"ok"}]);
  return gateway.sessions.get(conversationId);
 }
 const scope=p=>({kind:"local",workspacePaths:[p]});
 const [ra,rb,rc]=await Promise.all([run("a",scope(a)),run("b",scope(b)),run("chat",{kind:"none"})]);
 assert.equal(ra.cwd,a);assert.equal(rb.cwd,b);assert.notEqual(ra.sessionId,rb.sessionId);assert.deepEqual(sessions.get(rc.sessionId).roots,[]);
 await writeFile(path.join(a,"input.txt"),"A");await writeFile(path.join(b,"input.txt"),"B");
 assert.equal((await invoke("fs/read_text_file",{sessionId:ra.sessionId,path:"input.txt"})).content,"A");
 assert.equal((await invoke("fs/read_text_file",{sessionId:rb.sessionId,path:"input.txt"})).content,"B");
 await invoke("fs/write_text_file",{sessionId:ra.sessionId,path:"out.txt",content:"A only"});
 await invoke("fs/write_text_file",{sessionId:rb.sessionId,path:"out.txt",content:"B only"});
 assert.equal(await readFile(path.join(a,"out.txt"),"utf8"),"A only");assert.equal(await readFile(path.join(b,"out.txt"),"utf8"),"B only");
 await assert.rejects(invoke("fs/read_text_file",{sessionId:ra.sessionId,path:path.join(b,"input.txt")}),/restricted/);
 await assert.rejects(invoke("fs/write_text_file",{sessionId:rb.sessionId,path:path.join(owner,"bad.txt"),content:"x"}),/restricted/);
 await assert.rejects(invoke("fs/read_text_file",{sessionId:rc.sessionId,path:path.join(a,"input.txt")}),/No workspace/);
 for(const r of [ra,rb]){
  const term=await invoke("terminal/create",{sessionId:r.sessionId,command:process.execPath,args:["-e","process.stdout.write(process.cwd())"],cwd:"."});
  assert.equal((await invoke("terminal/wait_for_exit",{sessionId:r.sessionId,terminalId:term.terminalId})).exitCode,0);
  assert.equal(await realpath((await invoke("terminal/output",{sessionId:r.sessionId,terminalId:term.terminalId})).output),r.cwd);
  await invoke("terminal/release",{sessionId:r.sessionId,terminalId:term.terminalId});
 }
 await assert.rejects(invoke("terminal/create",{sessionId:ra.sessionId,command:process.execPath,cwd:b}),/restricted/);
 const again=await run("a",scope(a));assert.equal(again.sessionId,ra.sessionId);assert.ok(loaded.includes(ra.sessionId));
 const changed=await run("a",scope(worktree));assert.notEqual(changed.sessionId,ra.sessionId);assert.equal(changed.cwd,worktree);
 const multi=await run("multi",{kind:"local",workspacePaths:[b,a],worktreeMainPath:owner});assert.deepEqual(sessions.get(multi.sessionId).roots,[b,a]);
 const narrow=await run("multi",scope(b));assert.notEqual(narrow.sessionId,multi.sessionId);assert.deepEqual(sessions.get(narrow.sessionId).roots,[b]);
 const remote=await run("remote",{kind:"remote",workspacePaths:[owner]});assert.deepEqual(sessions.get(remote.sessionId).roots,[]);
 console.log("PASS: actual HTTP gateway, concurrent project A/B, empty and remote scope, real file I/O and terminal cwd, session reuse, Worktree switch and multi-root narrowing. ACP protocol responses simulated; no live model call.");
}finally{
 gateway.dispose();await gateway.sessions.dispose();
 if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;
 if(previousLocal===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previousLocal;
 await rm(temp,{recursive:true,force:true});
}
