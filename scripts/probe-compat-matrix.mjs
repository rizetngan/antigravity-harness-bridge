import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CursorCompatibility, digest, nativeCompatibility } from "../src/cursor/compat.ts";

const roots = process.argv.slice(2);
if (!roots.length) throw Error("Usage: node --experimental-strip-types scripts/probe-compat-matrix.mjs <unmodified resources/app> [...]");
const renderer = new URL("../src/renderer/renderer.js", import.meta.url);
for (const input of roots) {
  const source = resolve(input);
  const version = JSON.parse(readFileSync(join(source,"package.json"),"utf8")).version;
  const tmp = mkdtempSync(join(tmpdir(),"ag-compat-matrix-"));
  try {
    const app = join(tmp,"resources","app");
    const wb = join(app,"out","vs","workbench");
    mkdirSync(wb,{recursive:true});
    const rels = ["product.json", "out/vs/workbench/workbench.desktop.main.js", "out/vs/workbench/workbench.glass.main.js"].filter(r => existsSync(join(source,r)));
    assert.ok(rels.includes("out/vs/workbench/workbench.desktop.main.js"),"desktop resource missing");
    const hashes = new Map(rels.map(r => {
      const b=readFileSync(join(source,r));writeFileSync(join(app,r),b);return [r,digest(b)];
    }));
    const service = new CursorCompatibility(app,join(tmp,"backup"),fileURLToPath(renderer),{allowOriginalApp:true});
    const pre = await service.anchors();
    assert.ok(pre.length && pre.every(a=>a.ok&&!a.adapter),JSON.stringify(pre));
    const plan=await service.plan({url:"http://127.0.0.1:28743",token:"isolated-compatibility-test"});
    for (const t of plan.targets) {
      const f=join(tmp,t.file+".mjs");
      writeFileSync(f,t.patched);
      const check=spawnSync(process.execPath,["--check",f],{encoding:"utf8",maxBuffer:4*1024*1024});
      assert.equal(check.status,0,(check.stderr||check.stdout||"").slice(0,1200));
      assert.ok(nativeCompatibility(t.patched).ok);
      console.log(version,t.kind,"native seams and JavaScript syntax PASS");
    }
    await service.install(plan);
    await service.restore();
    for(const [r,h] of hashes) {
      assert.equal(digest(readFileSync(join(app,r))),h,"restore mismatch: "+r);
      assert.equal(digest(readFileSync(join(source,r))),h,"source changed: "+r);
    }
    console.log(version,"patch/install/byte-exact restore PASS");
  } finally { rmSync(tmp,{recursive:true,force:true}); }
}
