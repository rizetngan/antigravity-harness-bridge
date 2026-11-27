import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCli, ensureCli, officialInstaller, buildLoginCommand, acquireCliInstallLock } from "../src/cliSetup.ts";
test("working CLI verifies version and ACP without installation",async()=>{
 const calls=[];const r=await inspectCli(()=>"/test/agy",async(file,args)=>{calls.push([file,args]);return "1.5.18"},false);
 assert.equal(r.status,"ready");assert.deepEqual(calls,[["/test/agy",["--version"]],["/test/agy",["acp","--help"]]]);
 let installs=0;assert.equal((await ensureCli({inspect:async()=>r,install:async()=>{installs++}})).status,"ready");assert.equal(installs,0);
});
test("missing CLI installs exactly once and verifies after",async()=>{
 let installed=false,checks=0;
 const r=await ensureCli({inspect:async()=>{checks++;return {status:installed?"ready":"missing"}},install:async()=>{installed=true}});
 assert.equal(r.status,"ready");assert.equal(checks,2);
});
test("broken existing CLI or custom path never triggers install",async()=>{
 const absent=Object.assign(new Error("missing"),{code:"ENOENT"});
 assert.equal((await inspectCli(()=>"/test/agy",async()=>{throw absent},false)).status,"missing");
 assert.equal((await inspectCli(()=>"/custom/agy",async()=>{throw absent},true)).status,"error");
 assert.equal((await inspectCli(()=>"/test/agy",async(_f,a)=>{if(a[0]==="acp")throw Error("bad");return "1.0"},false)).status,"error");
 let n=0;assert.equal((await ensureCli({inspect:async()=>({status:"error"}),install:async()=>{n++}})).status,"error");assert.equal(n,0);
});
test("failed installer or missing post-install CLI fails closed",async()=>{
 await assert.rejects(ensureCli({inspect:async()=>({status:"missing"}),install:async()=>{throw Error("download failed")}}),/download failed/);
 await assert.rejects(ensureCli({inspect:async()=>({status:"missing"}),install:async()=>{}}),/仍未找到/);
});
test("installer uses only fixed official Google commands for supported systems",()=>{
 assert.match(officialInstaller("darwin").args.join(" "),/https:\/\/antigravity\.google\/cli\/install\.sh/);
 const win=officialInstaller("win32").args.join(" ");
 assert.match(win,/https:\/\/antigravity\.google\/cli\/install\.ps1/);
 assert.match(win,/--skip-path/);assert.match(win,/--skip-aliases/);assert.doesNotMatch(win,/Invoke-Expression/);
 assert.throws(()=>officialInstaller("linux"),/未验证/);
});

test("official login command is correctly quoted and closes only on success",()=>{
 const win=buildLoginCommand("C:\\Program Files\\Antigravity\\agy.exe","win32");
 assert.equal(win,"& 'C:\\Program Files\\Antigravity\\agy.exe' acp --login; if ($LASTEXITCODE -eq 0) { exit }");
 assert.match(win,/acp --login/);assert.match(win,/LASTEXITCODE -eq 0/);
 const mac=buildLoginCommand("/Users/O'Brien/.local/bin/agy","darwin");
 assert.equal(mac,"'/Users/O'\\''Brien/.local/bin/agy' acp --login && exit");
});

test("CLI version metadata failure does not block a working ACP command",async()=>{
 const status=await inspectCli(()=>"/test/agy",async(_f,args)=>{if(args[0]==="--version")throw Error("Version output unavailable");return "ACP help"},false);
 assert.equal(status.status,"ready");assert.equal(status.version,undefined);
});
test("installer rejects a live lock but recovers stale directories and legacy files",async()=>{
 const root=mkdtempSync(join(tmpdir(),"agy-install-lock-"));const marker=join(root,"cli-install.lock");
 try {
  const release=await acquireCliInstallLock(root);
  await assert.rejects(acquireCliInstallLock(root),/already being held/);
  await release();assert.equal(existsSync(marker),false);
  const old=new Date(Date.now()-20*60_000);
  mkdirSync(marker);utimesSync(marker,old,old);
  const recovered=await acquireCliInstallLock(root);await recovered();
  writeFileSync(marker,"");await assert.rejects(acquireCliInstallLock(root));
  utimesSync(marker,old,old);const legacy=await acquireCliInstallLock(root);await legacy();
  assert.equal(existsSync(marker),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
