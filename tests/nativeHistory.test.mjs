import test from "node:test";
import assert from "node:assert/strict";
import {parseNativeHistory,nativeSnapshot,nativeHistoryFingerprint} from "../src/context/NativeHistory.ts";
test("validates native history, rejects hidden fields, and fingerprints rolling visible turns",()=>{
 const h=parseNativeHistory({source:"native-turns",totalTurns:1,entries:[
  {role:"user",text:"same",hidden:"secret"},
  {role:"assistant",text:"reply",toolResults:[{name:"readToolCall",summary:"secret"}]}
 ]});
 const s=nativeSnapshot("c",h);
 assert.equal(s.messages.length,2);
 assert.doesNotMatch(JSON.stringify(s),/secret/);
 const a=nativeHistoryFingerprint(s.messages,1);
 assert.equal(a,nativeHistoryFingerprint([{role:"user",text:"same"},{role:"assistant",text:"reply"}],1));
 assert.notEqual(a,nativeHistoryFingerprint(s.messages,2));
 assert.notEqual(a,nativeHistoryFingerprint([{role:"user",text:"changed"},{role:"assistant",text:"reply"}],1));
 assert.throws(()=>parseNativeHistory({source:"native-turns",totalTurns:1,entries:[{role:"assistant",text:"x"}]}));
});
