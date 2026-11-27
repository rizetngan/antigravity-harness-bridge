import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemHandler } from "../src/acp/handlers/FileSystemHandler.ts";
import { TerminalHandler } from "../src/acp/handlers/TerminalHandler.ts";
import { PermissionHandler } from "../src/acp/handlers/PermissionHandler.ts";

const temp = await mkdtemp(path.join(tmpdir(), "acp-tool-acceptance-"));
const root = path.join(temp,"workspace");
const outside = path.join(temp,"outside");
await mkdir(root); await mkdir(outside);
const roots = session => session === "test" ? [root] : [];
const fs = new FileSystemHandler(roots);
const terminal = new TerminalHandler(roots);
try {
  const input = path.join(root,"input.txt");
  const output = path.join(root,"output.txt");
  const privateFile = path.join(outside,"outside.txt");
  await writeFile(input,"SYNTHETIC_TOOL_INPUT\n");
  await writeFile(privateFile,"OUTSIDE_FILE\n");
  await symlink(outside,path.join(root,"escape"));
  assert.equal((await fs.readTextFile({sessionId:"test",path:input})).content,"SYNTHETIC_TOOL_INPUT\n");
  await fs.writeTextFile({sessionId:"test",path:output,content:"SYNTHETIC_TOOL_OUTPUT\n"});
  assert.equal(await readFile(output,"utf8"),"SYNTHETIC_TOOL_OUTPUT\n");
  await assert.rejects(fs.readTextFile({sessionId:"unknown",path:input}),/No workspace root/);
  await assert.rejects(fs.readTextFile({sessionId:"test",path:privateFile}),/restricted/);
  await assert.rejects(fs.writeTextFile({sessionId:"test",path:path.join(root,"escape","blocked.txt"),content:"not allowed"}),/restricted/);
  const created=await terminal.createTerminal({sessionId:"test",command:"/usr/bin/printf",args:["SYNTHETIC_TERMINAL_OK"],cwd:root,outputByteLimit:1024});
  const result=await terminal.waitForTerminalExit({sessionId:"test",terminalId:created.terminalId});
  assert.equal(result.exitCode,0);
  assert.equal((await terminal.terminalOutput({sessionId:"test",terminalId:created.terminalId})).output,"SYNTHETIC_TERMINAL_OK");
  await assert.rejects(terminal.terminalOutput({sessionId:"unknown",terminalId:created.terminalId}),/Unknown Antigravity terminal/);
  await terminal.releaseTerminal({sessionId:"test",terminalId:created.terminalId});
  await assert.rejects(terminal.createTerminal({sessionId:"test",command:"/usr/bin/printf",cwd:outside}),/restricted/);
  const permission=await new PermissionHandler().requestPermission({sessionId:"test",toolCall:{toolCallId:"probe",title:"Synthetic permission"},options:[{optionId:"allow",kind:"allow_once",name:"Allow once"},{optionId:"reject",kind:"reject_once",name:"Reject"}]});
  assert.equal(permission.outcome.outcome,"cancelled");
  console.log("PASS: read/write synthetic file, terminal execution/output, unknown-session denial, symlink escape denial, external cwd denial, terminal ownership, cancelled permission");
} finally { terminal.dispose(); await rm(temp,{recursive:true,force:true}); }
