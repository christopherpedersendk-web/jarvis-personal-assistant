// Run with JARVIS_TEST_JSDOM pointing to an externally installed jsdom module.
// Real local backend, disposable data, no model or external integrations.
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const {JSDOM,VirtualConsole} = require(process.env.JARVIS_TEST_JSDOM || 'jsdom');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('real backend: new destinations, draft identity, command examples, controls and error retention',async()=>{
 const data=await mkdtemp(join(tmpdir(),'jarvis-workspace-'));
 const secret='synthetic-ui-test-credential-000000000000000';
 const root=resolve(__dirname,'..');
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,JARVIS_PORT:'18896',JARVIS_HOST:'127.0.0.1',JARVIS_DATA_DIR:data,JARVIS_ACCESS_TOKEN:secret},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 let dom;
 try{
  const base='http://127.0.0.1:18896';let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await delay(100)}
  assert.ok(ready,log);
  for(const asset of ['/workspace.js','/workspace.css']){const r=await fetch(base+asset);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),asset.endsWith('.css')?/text\/css/:/javascript/);}
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.type!=='css-parsing'&&!String(e.message).includes('Could not parse CSS'))errors.push(e.message)});
  dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.fetch=(url,options)=>fetch(new URL(url,base),options);w.CSS={escape:x=>String(x).replace(/[^a-z0-9_-]/gi,'')};w.HTMLElement.prototype.scrollIntoView=function(){};w.localStorage.setItem('jarvisAccessToken',secret);}});
  const w=dom.window,d=w.document;await new Promise(r=>w.addEventListener('load',r));await delay(300);
  assert.equal(d.getElementById('workspace').classList.contains('hidden'),false,log+' '+errors.join(','));
  assert.equal(d.getElementById('commerce-panel').parentElement.id,'tab-shopping');
  assert.equal(d.getElementById('self-development-panel').parentElement.id,'tab-development');
  const message=d.getElementById('message');
  d.querySelector('.workspace-prompts button').click();assert.match(message.value,/madplan/);
  message.value='Min bevarede kladde';message.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelectorAll('.workspace-prompts button')[1].click();assert.equal(message.value,'Min bevarede kladde');
  d.querySelector('.tab-nav [data-tab="shopping"]').click();assert.equal(d.getElementById('tab-shopping').classList.contains('hidden'),false);
  const field=d.querySelector('#commerce-panel input[name="shipping"]');field.value='2995';
  d.querySelector('.tab-nav [data-tab="development"]').click();
  d.querySelector('.tab-nav [data-tab="shopping"]').click();assert.equal(d.querySelector('#commerce-panel input[name="shipping"]'),field);assert.equal(field.value,'2995');
  d.querySelector('.tab-nav [data-tab="home"]').click();assert.equal(message.value,'Min bevarede kladde');
  assert.ok(d.querySelector('.workspace-stop #assistant-control-stop'));
  d.getElementById('assistant-control-refresh').click();await delay(100);assert.equal(d.getElementById('assistant-control-stop').disabled,false);
  d.getElementById('assistant-control-stop').click();await delay(100);assert.match(d.getElementById('assistant-control-status').textContent,/Stoppet/);
  // Missing model credentials are an actual backend failure, not a fake success.
  d.getElementById('message-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await delay(150);
  assert.equal(message.value,'Min bevarede kladde');
  for(const [view,section,id] of [['plan','meals','tab-meals'],['plan','notes','plan-notes'],['settings','profile','settings-profile']]){w.selectTab(view,{section});await delay(100);assert.equal(d.getElementById(id).classList.contains('hidden'),false);}
  assert.deepEqual(errors,[]);
  console.log('Verified: real bootstrap, two destination mounts, preserved node identity, safe examples, actual provider stop and failed-message draft.');
 }finally{dom?.window.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(data,{recursive:true,force:true});}
});
