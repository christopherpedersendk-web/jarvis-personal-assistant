import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf("    if(path==='/api/self-development'"),end=source.indexOf("    if(path==='/api/commerce/read'");
assert.ok(start>0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dispatch=new AsyncFunction('path','req','res','json','bodyJson','selfDevelopment','commerce','STORES',source.slice(start,end));
const id='12345678-1234-1234-1234-123456789012';
const invoke=(path,body,selfDevelopment={},commerce={})=>dispatch(path,{method:'POST'},null,(_res,status,payload)=>({status,payload}),async()=>body,selfDevelopment,commerce,{});
test('actual route block binds commerce revision/cancel bodies and reports conflicts',async()=>{
 const calls=[],commerce={revise:async(...args)=>{calls.push(args);return {revision:2};},cancel:async()=>{throw Error('changed');}};
 const body={expectedRevision:1,order:{items:[]}},result=await invoke('/api/commerce/'+id+'/revise',body,{},commerce);
 assert.equal(result.status,200);assert.deepEqual(calls,[[id,body]]);assert.equal(result.payload.order.revision,2);
 const conflict=await invoke('/api/commerce/'+id+'/cancel',{expectedRevision:1},{},commerce);assert.equal(conflict.status,409);assert.equal(conflict.payload.error,'changed');
});
test('actual route block separates local development drafts from candidate execution',async()=>{
 const calls=[],work={saveDraft:async(...args)=>{calls.push(['draft',...args]);return {id};},prepare:async(...args)=>{calls.push(['start',...args]);return {id};},cancelDraft:async(...args)=>{calls.push(['cancel',...args]);return {id};}};
 const task={file:'allowed',request:'test'},saved=await invoke('/api/self-development/drafts',task,work);assert.equal(saved.status,201);assert.deepEqual(calls.pop(),['draft',task]);
 await invoke('/api/self-development/'+id+'/draft',{task,expectedRevision:2},work);assert.deepEqual(calls.pop(),['draft',task,{id,expectedRevision:2}]);
 await invoke('/api/self-development/'+id+'/cancel',{expectedRevision:3},work);assert.deepEqual(calls.pop(),['cancel',id,{expectedRevision:3}]);
 await invoke('/api/self-development',{draftId:id,expectedRevision:4},work);assert.deepEqual(calls.pop(),['start',{draftId:id,expectedRevision:4}]);
 work.saveDraft=async()=>{throw Error('revision');};assert.equal((await invoke('/api/self-development/'+id+'/draft',{task,expectedRevision:1},work)).status,409);
});

