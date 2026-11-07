import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {researchGateway} from '../openclaw-runtime/gateway.mjs';import {boundedJson} from '../openjarvis-transport.mjs';import {openJarvisSources} from '../openjarvis.mjs';
const token='synthetic-research-'.repeat(3),upstreamToken='synthetic-operator-'.repeat(3),body={tool:'web_search',args:{query:'public synthetic query',count:5}};
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
async function fixture(t,extra={}){const g=researchGateway({token,upstreamToken,upstreamUrl:'http://127.0.0.1:18791',runtimeVersion:'2026.11.1',fetcher:async()=>Response.json({ok:true,result:{}}),...extra});const url=await listen(g.server);t.after(()=>g.stop());return {g,url,request:()=>fetch(url+'/tools/invoke',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)})};}
test('gateway request window recovers without a service restart and counts concurrent admission',async t=>{
 let clock=0,forwarded=0;const f=await fixture(t,{maxCalls:1,windowMs:1000,now:()=>clock,fetcher:async()=>{forwarded++;return Response.json({ok:true,result:{}});}});
 const first=await Promise.all([f.request(),f.request()]);assert.deepEqual(first.map(r=>r.status).sort(),[200,429]);for(const r of first)await r.body.cancel();assert.equal(forwarded,1);
 const limited=await f.request();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'1');assert.equal((await limited.json()).retryable,false);
 clock=1000;const next=await f.request();assert.equal(next.status,200);await next.body.cancel();assert.equal(forwarded,2);assert.equal(f.g.snapshot().calls,2);
});
test('gateway rejects invalid quota configuration before opening a service',()=>{
 for(const extra of [{maxCalls:0},{maxCalls:Infinity},{windowMs:0},{windowMs:86400001}])assert.throws(()=>researchGateway({token,upstreamToken,upstreamUrl:'http://127.0.0.1:18791',...extra}),/window/);
});
test('actual loopback HTTP disconnect aborts the forwarded HTTP connection and releases admission',async t=>{
 let began,ended;const started=new Promise(r=>began=r),closed=new Promise(r=>ended=r);
 const upstream=createServer((req,res)=>{req.resume();res.once('close',ended);began();});const upstreamUrl=await listen(upstream);t.after(()=>{upstream.closeAllConnections();upstream.close();});
 const {g,url}=await fixture(t,{upstreamUrl,fetcher:fetch});const c=new AbortController();const pending=fetch(url+'/tools/invoke',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body),signal:c.signal}).catch(()=>{});
 await started;c.abort();await pending;await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('HTTP connection did not close')),1500).unref())]);
 for(let i=0;i<30&&g.snapshot().active;i++)await new Promise(r=>setTimeout(r,10));assert.equal(g.snapshot().active,0);
});
test('rate-limit errors are concrete, rejected and never retried or echoed',async()=>{
 let calls=0;await assert.rejects(boundedJson(async()=>{calls++;return new Response('PRIVATE_UPSTREAM_BODY',{status:429});},new URL('http://127.0.0.1:18790'),{}),e=>{assert.equal(e.code,'GATEWAY_RATE_LIMIT');assert.equal(e.outcome,'rejected');assert.equal(e.retryable,false);assert.match(e.message,/forespørgselsgrænse/);assert.doesNotMatch(e.message,/PRIVATE_UPSTREAM_BODY/);return true;});assert.equal(calls,1);
});
test('observed OpenClaw title envelope is removed only for display while source and secrecy remain intact',()=>{
 const title='\n<<<EXTERNAL_UNTRUSTED_CONTENT id="abc123">>>\nSource: Web Search\n---\nBrowser\nconfiguration SECRET\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="abc123">>>';
 const original={results:[{url:'https://docs.openclaw.ai/tools/browser/configuration',title}]};const sources=openJarvisSources(original,['SECRET']);assert.deepEqual(sources,[{url:original.results[0].url,title:'Browser configuration [hemmelighed skjult]'}]);assert.equal(original.results[0].title,title);
});
