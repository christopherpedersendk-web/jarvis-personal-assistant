import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {boundedJson, localEndpoint} from '../openjarvis-transport.mjs';
import {rejectSecrets} from '../privacy.mjs';

// Jarvis gets only this credential, never the upstream operator credential.
// No WebSocket upgrades, generic proxying, sessions, paths, headers or tool names.
export function researchGateway({token, upstreamToken, upstreamUrl, runtimeVersion, fetcher=fetch, maxCalls=60}) {
  if (typeof token !== 'string' || token.length < 32 || typeof upstreamToken !== 'string' || upstreamToken.length < 32 || token === upstreamToken)
    throw new Error('Separate credentials of at least 32 characters are required.');
  const endpoint=localEndpoint(upstreamUrl), active=new Set();
  let calls=0, stopped=false;
  const authorized=value=>{
    const expected=Buffer.from(`Bearer ${token}`), actual=Buffer.from(typeof value==='string'?value:'');
    return expected.length===actual.length && timingSafeEqual(expected,actual);
  };
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
    if (!authorized(req.headers.authorization)) {send(401,{ok:false,error:'AUTH_REJECTED'});req.resume();return;}
    if (stopped) {send(503,{ok:false,error:'STOPPED'});req.resume();return;}
    if (req.method==='GET' && req.url==='/health') {
      try {
        await boundedJson(fetcher,new URL('/readyz',endpoint),{}, {timeoutMs:3000,maxBytes:16000});
        send(200,{contractVersion:1,runtimeVersion,tools:['web_search'],status:'ready'});
      } catch {send(503,{ok:false,error:'NOT_READY'});} return;
    }
    if(req.method!=='POST'||req.url!=='/tools/invoke'){send(404,{ok:false,error:'ROUTE_FORBIDDEN'});req.resume();return;}
    if(active.size>=2||calls>=maxCalls){send(429,{ok:false,error:'REQUEST_LIMIT'});req.resume();return;}
    const controller=new AbortController();active.add(controller);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);
    try {
      let size=0,body='';
      for await(const chunk of req){size+=chunk.length;if(size>2048)throw new Error('Invalid request');body+=chunk;}
      const input=JSON.parse(body),args=input?.args;
      if(!input || Object.keys(input).sort().join()!=='args,tool' || input.tool!=='web_search' ||
        !args || Object.keys(args).sort().join()!=='count,query' || args.count!==5 ||
        typeof args.query!=='string'||!args.query.trim()||args.query.length>240) {
        send(403,{ok:false,error:'TOOL_OR_ARGUMENTS_FORBIDDEN'});return;
      }
      rejectSecrets(args.query);
      if(args.query.includes(token)||args.query.includes(upstreamToken))throw new Error('Secret in query');
      controller.signal.throwIfAborted();if(stopped)throw new Error('Stopped');
      calls++;
      const result=await boundedJson(fetcher,new URL('/tools/invoke',endpoint),{method:'POST',
        headers:{Authorization:`Bearer ${upstreamToken}`,'Content-Type':'application/json'},
        body:JSON.stringify({tool:'web_search',args:{query:args.query.trim(),count:5}})}, {signal:controller.signal,timeoutMs:18000});
      controller.signal.throwIfAborted();
      send(200,result);
    } catch(error) {send(error.code==='AUTH_REJECTED'?401:error.code==='TOOL_FORBIDDEN'?403:502,{ok:false,error:error.code||'INVALID_REQUEST',retryable:false});}
    finally{active.delete(controller);res.off('close',disconnect);}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=16;
  server.on('upgrade',(_req,socket)=>socket.destroy());
  return {server,stop(){stopped=true;for(const c of active)c.abort();server.close();server.closeAllConnections();},
    snapshot:()=>({calls,active:active.size,stopped})};
}
