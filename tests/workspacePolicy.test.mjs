import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { sessionWorkspace, workspaceIdentity, fullyQualifiedLocalPath } from "../src/gateway/workspacePolicy.ts";
async function fixture(run) {
 const root=await mkdtemp(path.join(tmpdir(),"native-workspaces-"));
 try {
  const [a,b,worktree,scratch]=await Promise.all(["Project A","Project B","Worktree","chat-only"].map(async name=>{
   const p=path.join(root,name);await mkdir(p);return realpath(p);
  }));
  await run({a,b,worktree,scratch});
 }finally{await rm(root,{recursive:true,force:true});}
}
test("native no-project, remote and missing environments never inherit another window",async()=>{
 await fixture(async({a,scratch})=>{
  for(const [input,kind] of [[{kind:"none",workspacePaths:[a]},"none"],[{kind:"remote",workspacePaths:[a]},"remote"],[undefined,"unknown"]]){
   assert.deepEqual(await sessionWorkspace(input,scratch),{cwd:scratch,roots:[],toolsEnabled:false,kind});
  }
 });
});
test("native project A, B and Worktree keep distinct cwd and root scope regardless of window",async()=>{
 await fixture(async({a,b,worktree,scratch})=>{
  const results=await Promise.all([a,b,worktree].map(p=>sessionWorkspace({kind:"local",workspacePaths:[p],worktreeMainPath:a},scratch)));
  assert.deepEqual(results.map(x=>x.cwd),[a,b,worktree]);
  assert.deepEqual(results.map(x=>x.roots),[[a],[b],[worktree]]);
  assert.equal(new Set(results.map(workspaceIdentity)).size,3);
 });
});
test("preserve native ordered roots and deduplicate without granting main repository or unrelated folders",async()=>{
 await fixture(async({a,b,worktree,scratch})=>{
  const multi=await sessionWorkspace({kind:"local",workspacePaths:[b,a,b],worktreeMainPath:worktree},scratch);
  assert.deepEqual(multi,{kind:"local",cwd:b,roots:[b,a],toolsEnabled:true});
  const one=await sessionWorkspace({kind:"local",workspacePaths:[b]},scratch);
  assert.notEqual(workspaceIdentity(multi),workspaceIdentity(one));
 });
});
test("invalid and remote path spellings cannot silently select a different project",async()=>{
 await fixture(async({a,scratch})=>{
  for(const p of ["relative", "vscode-remote://ssh-remote+host/project", path.join(a,"missing")]){
   assert.deepEqual(await sessionWorkspace({kind:"local",workspacePaths:[p,a]},scratch),{kind:"unknown",cwd:scratch,roots:[],toolsEnabled:false});
  }
 });
 assert.equal(fullyQualifiedLocalPath("D:/Cursor Space/project","win32"),true);
 assert.equal(fullyQualifiedLocalPath("d:\\project","win32"),true);
 assert.equal(fullyQualifiedLocalPath("/home/remote","win32"),false);
 assert.equal(fullyQualifiedLocalPath("D:relative","win32"),false);
 assert.equal(fullyQualifiedLocalPath("/Users/local/project","darwin"),true);
});
