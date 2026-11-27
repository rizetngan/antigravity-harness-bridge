import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { sessionWorkspace, sessionToolRoots } from "../src/gateway/workspacePolicy.ts";
const scratch = path.join(tmpdir(),"chat-only");
const project = path.join(tmpdir(),"project");
test("empty Cursor window can use a chat-only cwd without granting filesystem or terminal roots",()=>{
  assert.deepEqual(sessionWorkspace(undefined,scratch),{cwd:scratch,toolsEnabled:false});
  assert.deepEqual(sessionToolRoots(scratch,undefined,false),[]);
  assert.deepEqual(sessionToolRoots(scratch,[{uri:{fsPath:project,scheme:"file"}}],false),[]);
});
test("local workspace preserves existing tool roots and a remote folder does not become local",()=>{
  const local={uri:{fsPath:project,scheme:"file"}};
  const remote={uri:{fsPath:path.join(tmpdir(),"remote"),scheme:"vscode-remote"}};
  assert.deepEqual(sessionWorkspace([remote,local],scratch),{cwd:project,toolsEnabled:true});
  assert.deepEqual(sessionToolRoots(project,[remote,local],true),[project]);
  assert.deepEqual(sessionWorkspace([remote],scratch),{cwd:scratch,toolsEnabled:false});
});
