import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const html=readFileSync(new URL("../media/management.html",import.meta.url),"utf8");
const script=html.match(/<script nonce="__NONCE__">([\s\S]+)<\/script>/)[1];
function fixture(){
 const elements=new Map(), messages=[];
 class Element{
  constructor(){this.hidden=false;this.disabled=false;this.textContent="";this.dataset={};this.listeners={};this.attrs={}}
  addEventListener(n,f){this.listeners[n]=f}
  setAttribute(n,v){this.attrs[n]=v}
  append(){}
  replaceChildren(){}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 let receive;
 vm.runInNewContext(script,{acquireVsCodeApi:()=>({postMessage:m=>messages.push(m)}),document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element(),createDocumentFragment:()=>new Element()},window:{addEventListener:(_n,f)=>receive=f}});
 const base={patch:"disabled",reload:false,running:false,connected:false,connecting:false,active:0,models:[],variants:0,version:"1.2.1",cli:{status:"missing"}};
 return {get,messages,render:(patch={})=>receive({data:{type:"state",state:{...base,...patch}}})};
}
test("first install offers one primary action instead of enabling Workbench",()=>{
 const t=fixture();t.render();
 assert.equal(t.get("mainAction").textContent,"安装并连接");assert.equal(t.get("mainAction").hidden,false);
 assert.equal(t.get("login").disabled,true);t.get("mainAction").listeners.click();
 assert.equal(t.messages.at(-1).action,"setup");
 t.render({cli:{status:"installing"},pending:"setup"});assert.equal(t.get("mainAction").hidden,true);
 t.render({cli:{status:"ready"},connected:true});assert.equal(t.get("mainAction").textContent,"启用原生模型");assert.equal(t.get("detail").textContent,"账号已连接");
});
test("broken CLI and required login have distinct recovery actions",()=>{
 const t=fixture();t.render({cli:{status:"error",detail:"检测失败"}});
 assert.equal(t.get("mainAction").textContent,"重新检测 CLI");assert.equal(t.get("notice").textContent,"检测失败");
 t.render({cli:{status:"ready"},running:true,error:"login"});assert.equal(t.get("mainAction").textContent,"登录 Antigravity");
 t.render({cli:{status:"ready"},patch:"enabled",reload:true});assert.equal(t.get("mainAction").textContent,"退出 Cursor");
 t.render({cli:{status:"ready"},patch:"enabled",running:true,connected:true});assert.equal(t.get("mainAction").hidden,true);assert.equal(t.get("switch").attrs["aria-checked"],"true");
});
