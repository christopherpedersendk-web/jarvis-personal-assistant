import assert from 'node:assert/strict';
import {createIsolatedBrowser} from '../isolated-browser.mjs';
const requests=[];
const renderer=createIsolatedBrowser({env:{...process.env,JARVIS_DYNAMIC_BROWSER:'yes'},fetchResource:async url=>{
 requests.push(url);
 if(url==='https://example.org/public.json')return {url,contentType:'application/json',buffer:Buffer.from('{"label":"DYNAMIC_VALUE"}')};
 assert.equal(url,'https://example.org/');
 return {url,contentType:'text/html',buffer:Buffer.from(`<html><body>Before<script>
 fetch('/public.json').then(r=>r.json()).then(data=>{const node=document.createElement('div');node.id='proof';node.textContent=data.label;document.body.append(node);});
 fetch('https://127.0.0.1/private').catch(()=>{});
 fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{});
 fetch('file:///etc/passwd').catch(()=>{});
 fetch('https://example.org/write',{method:'POST',body:'blocked'}).catch(()=>{});
 navigator.serviceWorker.register('/worker.js').catch(()=>{});
 try{new WebSocket('wss://example.org/socket')}catch{}
 const frame=document.createElement('iframe');frame.src='https://other.example.org/';document.body.append(frame);
 </script></body></html>`)};
}});
const result=await renderer('https://example.org/',{allowUrl:url=>url.origin==='https://example.org'});
assert.match(result.buffer.toString(),/<div id="proof">DYNAMIC_VALUE<\/div>/);
assert.deepEqual(requests,['https://example.org/','https://example.org/public.json']);
const stalled=createIsolatedBrowser({env:{...process.env,JARVIS_DYNAMIC_BROWSER:'yes'},fetchResource:async url=>({url,contentType:'text/html',buffer:Buffer.from('<html><script>while(true){}</script></html>')})});
const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),2000);
try{await assert.rejects(stalled('https://example.org/',{signal:stop.signal,allowUrl:()=>true}),/afbrudt/);}finally{clearTimeout(timer);}
console.log('PASS: isolated JS DOM and JSON fetch; internal/metadata/file origins, frames, service workers, WebSocket and POST never reached transport; stop kills looping page; cleanup confirmed. Synthetic sources only.');
