import test from "node:test";
import assert from "node:assert/strict";
import { allowedAction, actions } from "../src/ui/managementActions.ts";
const base={patch:"disabled",reload:false,version:"1.1.0",running:false,connected:false,connecting:false,models:[],variants:0,active:0,borrowed:false};
test("first enable, reload and restore have separate action states",()=>{
 assert.equal(allowedAction("enable",base),true);
 assert.equal(allowedAction("start",base),false);
 assert.equal(allowedAction("restore",base),false);
 const reload={...base,patch:"enabled",reload:true,running:true};
 assert.equal(allowedAction("reload",reload),true);
 assert.equal(allowedAction("stop",reload),false);
 assert.equal(allowedAction("restore",reload),false);
 assert.equal(allowedAction("restore",{...base,patch:"enabled"}),true);
});
test("service switch, model refresh and login reflect gateway state",()=>{
 const stopped={...base,patch:"enabled"};
 assert.equal(allowedAction("start",stopped),true);
 assert.equal(allowedAction("stop",stopped),false);
 assert.equal(allowedAction("login",stopped),false);
 const running={...stopped,running:true};
 assert.equal(allowedAction("stop",running),true);
 assert.equal(allowedAction("refresh",running),true);
 assert.equal(allowedAction("login",running),true);
 assert.equal(allowedAction("refresh",{...running,connecting:true}),false);
});
test("active tasks are protected while shared gateways remain remotely manageable",()=>{
 const running={...base,patch:"enabled",running:true};
 for(const k of ["stop","restore","login"]){
  assert.equal(allowedAction(k,{...running,active:1}),false);
 }
 const borrowed={...running,borrowed:true};
 assert.equal(allowedAction("stop",borrowed),true);
 assert.equal(allowedAction("login",borrowed),true);
 assert.equal(allowedAction("refresh",borrowed),true);
 assert.equal(allowedAction("restore",borrowed),true);
 assert.equal(allowedAction("stop",{...borrowed,active:1}),false);
 for(const k of ["__proto__","constructor","workbench.action.reloadWindow",null,{}])assert.equal(allowedAction(k,running),false);
 assert.equal(actions.restore,"antigravityCursor.restoreCursor");
});
