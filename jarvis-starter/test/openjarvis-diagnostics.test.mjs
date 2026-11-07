import test from 'node:test';
import assert from 'node:assert/strict';
import {openJarvisDiagnostics} from '../openjarvis-diagnostics.mjs';
import {createOpenJarvis} from '../openjarvis.mjs';
import {compareEvaluations} from '../scripts/compare-assistant-evaluations.mjs';
const env={OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_MODE:'restricted-v1',OPENJARVIS_GATEWAY_TOKEN:'synthetic-private-credential-123456789',OPENJARVIS_GATEWAY_URL:'http://127.0.0.1:18790'};
test('configuration never becomes runtime or host evidence and never echoes secrets',()=>{
 for(const url of [env.OPENJARVIS_GATEWAY_URL,'http://user:password@127.0.0.1','http://10.0.0.1']){
 const d=openJarvisDiagnostics({...env,OPENJARVIS_GATEWAY_URL:url});assert.equal(d.readyForResearch,false);assert.equal(d.hostAccepted,false);assert.doesNotMatch(JSON.stringify(d),/synthetic-private|password|10\.0\.0\.1/);
 }
 assert.equal(openJarvisDiagnostics(env,{connectionStatus:'ready',lastCheckedAt:new Date().toISOString()}).readyForResearch,true);
 assert.equal(openJarvisDiagnostics(env,{connectionStatus:'ready',lastCheckedAt:'2000-01-01'}).readyForResearch,false);
});
test('actual local HTTP gateway check reports auth rejection without raw provider errors',async()=>{
 const {createServer}=await import('node:http');const s=createServer((req,res)=>{res.writeHead(401);res.end('private-provider-error');});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));
 try{const b=createOpenJarvis({env:{...env,OPENJARVIS_GATEWAY_URL:`http://127.0.0.1:${s.address().port}`},control:{controlled:f=>f(new AbortController().signal)}});await b.inspect();assert.match(b.status().connectionError,/credential/);assert.doesNotMatch(JSON.stringify(b.status()),/private-provider-error|synthetic-private/);assert.equal(b.status().diagnostics.readyForResearch,false);}finally{await new Promise(r=>s.close(r));}
});
test('version mismatch is distinguished and a valid contract preserves sources',async()=>{
 const control={controlled:f=>f(new AbortController().signal),externalSearch:f=>f(new AbortController().signal)};
 const bad=createOpenJarvis({env,control,fetcher:async()=>new Response(JSON.stringify({runtimeVersion:'wrong'}))});await bad.inspect();assert.match(bad.status().connectionError,/Runtimeversion/);
 const good=createOpenJarvis({env,control,fetcher:async url=>new Response(JSON.stringify(url.pathname==='/health'?{contractVersion:1,runtimeVersion:'2026.11.1',tools:['web_search'],status:'ready'}:{ok:true,result:{results:[{url:'https://example.org/',title:'Source'}]}}))});
 const result=await good.search('public example');assert.equal(result.sources[0].url,'https://example.org/');assert.equal(good.status().diagnostics.readyForResearch,true);assert.equal(result.usage.cost,null);
});
test('comparison preserves unknown usage and separates setup from HTTP duration',()=>{
 const a={backend:'baseline',model:'same',datasetSha256:'x',coreSourceSha256:'x',results:[{id:'DA01',durationMs:20,setupDurationMs:5,conversationDurationMs:12}]};
 const b={...a,backend:'hybrid',results:[{id:'DA01',durationMs:10,setupDurationMs:3,conversationDurationMs:6,usage:{requests:1,cost:null}}]};
 const r=compareEvaluations(a,b);assert.equal(r.tasks[0].baselineUsage,null);assert.equal(r.tasks[0].hybridUsage.cost,null);assert.equal(r.tasks[0].baselineConversationMs,12);assert.equal(r.accepted,false);assert.equal(r.costSavings,null);
 assert.equal(compareEvaluations(a,{...b,model:'different'}).matching,false);
});
