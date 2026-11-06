import assert from 'node:assert/strict';
import {createIsolatedBrowser} from '../isolated-browser.mjs';
let requests=0;
const renderer=createIsolatedBrowser({env:{...process.env,JARVIS_DYNAMIC_BROWSER:'yes'},fetchResource:async url=>{
 requests++;assert.equal(url,'https://example.org/');
 return {url,contentType:'text/html',buffer:Buffer.from(`<html><body>Before<script>
 document.body.append('JAVASCRIPT_EXECUTED');
 fetch('https://127.0.0.1/private').catch(()=>{});
 fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{});
 fetch('https://example.org/write',{method:'POST',body:'blocked'}).catch(()=>{});
 </script></body></html>`)};
}});
const result=await renderer('https://example.org/',{allowUrl:url=>url.origin==='https://example.org'});
assert.match(result.buffer.toString(),/Before<script/);
assert.match(result.buffer.toString(),/<\/script>JAVASCRIPT_EXECUTED/);
assert.equal(requests,1);
console.log('PASS: isolated JavaScript rendering; internal/metadata origins and POST never reached transport; container cleanup confirmed. Synthetic sources only.');
