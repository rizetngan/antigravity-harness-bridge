import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session/SessionStore.ts";

test("persists and reloads Cursor-to-ACP session mappings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "antigravity-session-store-"));
  try {
    const first = new SessionStore(directory);
    await first.set({
      composerId: "composer-1",
      sessionId: "acp-session-1",
      cwd: "/workspace/project",
      workspaceIdentity: "[native session scope]",
      modelId: "claude-opus-5.5",
      lastVisibleMessageCount: 12,
      lastAgentMessageCount: 34,
      updatedAt: Date.now(),
    });
    const second = new SessionStore(directory);
    assert.deepEqual(await second.get("composer-1"), await first.get("composer-1"));
    await second.delete("composer-1");
    assert.equal(await second.get("composer-1"), undefined);
    await first.dispose();
    await second.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent first reads wait for the same existing mappings",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"antigravity-concurrent-store-"));
 try{
  const first=new SessionStore(directory);
  const entry=id=>({composerId:id,sessionId:"acp-"+id,cwd:"/project/"+id,modelId:"model",lastVisibleMessageCount:0,lastAgentMessageCount:0,updatedAt:0});
  await Promise.all([first.set(entry("a")),first.set(entry("b"))]);
  await first.dispose();
  const second=new SessionStore(directory);
  const [a,b]=await Promise.all([second.get("a"),second.get("b")]);
  assert.equal(a.sessionId,"acp-a");assert.equal(b.sessionId,"acp-b");
 }finally{rmSync(directory,{recursive:true,force:true});}
});
