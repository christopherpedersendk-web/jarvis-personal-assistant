import test from 'node:test';
import assert from 'node:assert/strict';
import {researchGateway} from '../openclaw-runtime/gateway.mjs';
import {createOpenJarvis} from '../openjarvis.mjs';
const token='research-test-'.repeat(4),operator='operator-test-'.repeat(4);
async function fixture(t,fetcher){
 const gateway=researchGateway({token,upstreamToken:operator,upstreamUrl:'http://127.0.0.1:18791',runtimeVersion:'2026.11.1',fetcher});
 await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));t.after(()=>gateway.stop());
 return {gateway,url:`http://127.0.0.1:${gateway.server.address().port}`};
}
const control={externalSearch:fn=>fn(new AbortController().signal)};
test('restricted gateway rejects credentials, tools, extra authority and routes before upstream',async t=>{
 let calls=0;const {url}=await fixture(t,async()=>{calls++;return Response.json({});});
 const request=(body,auth=token,path='/tools/invoke')=>fetch(url+path,{method:'POST',headers:{Authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
 assert.equal((await request({},'wrong')).status,401);
 for(const input of [{tool:'exec',args:{}},{tool:'web_search',args:{query:'news',count:5},sessionKey:'admin'},
  {tool:'web_search',args:{query:'news',count:5,url:'file:///etc/passwd'}},{tool:'web_search',args:{query:'',count:5}}])
  assert.equal((await request(input)).status,403);
 assert.equal((await request({},token,'/v1/responses')).status,404);assert.equal(calls,0);
});
test('restricted adapter verifies health and sends only a public query',async t=>{
 const seen=[];const {url}=await fixture(t,async(url,options)=>{
  seen.push({path:url.pathname,...options});
  return Response.json(url.pathname==='/readyz'?{status:'ready'}:{ok:true,result:{content:[{type:'text',text:JSON.stringify({results:[{title:'Menu',url:'https://example.org/menu'}]})}]}});
 });
 const bridge=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_TOKEN:token,OPENJARVIS_GATEWAY_URL:url,OPENJARVIS_GATEWAY_MODE:'restricted-v1'},control});
 const result=await bridge.search('restaurant');assert.equal(result.status,'completed');assert.equal(result.sources.length,1);
 assert.equal(seen.length,2);assert.equal(seen[1].headers.Authorization,`Bearer ${operator}`);
 assert.deepEqual(JSON.parse(seen[1].body),{tool:'web_search',args:{query:'restaurant',count:5}});
 assert.equal(result.usage.inputTokens,null);
});
test('version mismatch prevents search, with no fallback',async()=>{
 let calls=0;const bridge=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_TOKEN:token,OPENJARVIS_GATEWAY_MODE:'restricted-v1'},control,
 fetcher:async()=>{calls++;return Response.json({contractVersion:1,runtimeVersion:'wrong',tools:['web_search'],status:'ready'});}});
 await assert.rejects(bridge.search('news'),{code:'VERSION_MISMATCH'});assert.equal(calls,1);
});
test('invalid and tool-error envelopes never count as research',async()=>{
 for(const result of [null,{}, {ok:true},{ok:true,result:[]},{ok:true,result:{isError:true}}, {ok:true,result:{error:'secret'}},{ok:true,result:{details:{kind:'error',error:'provider_error'},content:[{type:'text',text:'failure'}]}}]){
  const bridge=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_TOKEN:token},control,fetcher:async()=>Response.json(result)});
  await assert.rejects(bridge.search('news'));
 }
});
test('stop between health and search prevents the tool call',async()=>{
 const c=new AbortController();let calls=0;
 const bridge=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_TOKEN:token,OPENJARVIS_GATEWAY_MODE:'restricted-v1'},
  control:{externalSearch:fn=>fn(c.signal)},fetcher:async()=>{calls++;c.abort();return Response.json({contractVersion:1,runtimeVersion:'2026.11.1',tools:['web_search'],status:'ready'});}});
 await assert.rejects(bridge.search('news'));assert.equal(calls,1);
});
test('disconnect cancels the active upstream request',async t=>{
 let started,aborted;const began=new Promise(r=>started=r),ended=new Promise(r=>aborted=r);
 const {url}=await fixture(t,async(_url,{signal})=>{started();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true}));});
 const c=new AbortController();const response=fetch(url+'/tools/invoke',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({tool:'web_search',args:{query:'news',count:5}}),signal:c.signal}).catch(()=>{});
 await began;c.abort();await response;await Promise.race([ended,new Promise((_r,j)=>setTimeout(()=>j(new Error('Abort not propagated')),1000).unref())]);
});
