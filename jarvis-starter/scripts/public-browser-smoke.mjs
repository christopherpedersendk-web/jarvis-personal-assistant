// Explicit opt-in integration probe: public, credential-free sources only.
// Synthetic containment tests remain separate and must pass independently.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createIsolatedBrowser} from '../isolated-browser.mjs';
import {extractWebPage} from '../browser-workspace.mjs';
const report={at:new Date().toISOString(),candidateCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 status:'not_run',scope:'Public HTTPS through real isolated Chromium and DNS-pinned host transport; no login, model or owner data. JS execution is separately proven by the synthetic containment test.',pages:[]};
if(process.argv.includes('--live')){
 try{
  const render=createIsolatedBrowser({env:{...process.env,JARVIS_DYNAMIC_BROWSER:'yes'}});
  for(const [url,expected] of [['https://example.com/','Example Domain'],['https://playwright.dev/','Playwright']]){
   const started=Date.now(),origin=new URL(url).origin;
   const resource=await render(url,{allowUrl:target=>target.origin===origin});
   const page=extractWebPage(resource.buffer,resource.url);
   assert.ok(page.text.includes(expected),'Expected public source text is missing');
   assert.ok(page.text.length>=50,'Public excerpt is incomplete');
   report.pages.push({url:page.url,title:page.title,contentHash:page.contentHash,characters:page.text.length,elapsedMs:Date.now()-started,status:'passed'});
  }
  report.status='passed';
 }catch{report.status='failed';report.error='Public source could not be verified within the unchanged isolation and resource limits.';process.exitCode=1;}
}
await mkdir('artifacts/browser',{recursive:true});
await writeFile('artifacts/browser/public-read.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
