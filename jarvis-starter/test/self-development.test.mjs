import test from 'node:test';import assert from 'node:assert/strict';import {SelfDevelopment,SELF_EDITABLE,SELF_CHECKS,SELF_WORKFLOWS} from '../self-development.mjs';import {DurableState} from '../durable-state.mjs';import {ProviderControl} from '../provider-control.mjs';
async function fixture(){const store=new DurableState({initial:{},write:async()=>{}});await store.initialize();const state=store.state,save=()=>store.save(),transact=(...a)=>store.transact(...a),control=new ProviderControl({state,save,transact});let publications=0,model=0,evidence={sha:'b'.repeat(40),version:'5.4.1',securityReviewed:true,workflowIds:[...SELF_WORKFLOWS],paths:[SELF_EDITABLE[0]],checks:SELF_CHECKS.map(name=>({name,conclusion:'success'}))};const files=[...SELF_EDITABLE.map(path=>({path,content:'export const fixture=1;'})),{path:'jarvis-starter/food-identity.mjs',content:'export const identity=1;'}, {path:'jarvis-starter/package.json',content:JSON.stringify({name:'synthetic',version:'5.4.0',jarvisSchemaVersion:1})}];const backend={snapshot:async()=>({sha:'a'.repeat(40),files}),publish:async()=>{publications++;return {sha:'b'.repeat(40),url:'https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/123',number:123};},evidence:async()=>evidence};const work=new SelfDevelopment({state,save,transact,control,backend,propose:async input=>{model++;assert.equal(input.includeMemory,false);return {content:'export const fixture=2;',summary:'Ret syntetisk fejl'};},fixture:'trusted test',tests:async files=>{assert.equal(files.at(-1).content,'trusted test');return {status:'passed'};},enabled:true,autoApprove:true});return {work,control,backend,evidence,files,counts:()=>({publications,model})};}
const input={file:SELF_EDITABLE[0],request:'Ret en syntetisk funktion',version:'5.4.1'};
test('self-development prepares one draft PR from public source, fixes exact version and preserves schema',async()=>{const f=await fixture();let published;f.backend.publish=async p=>{published=p;return {sha:'b'.repeat(40),url:'https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/123',number:123};};const r=await f.work.prepare(input);assert.equal(r.status,'draft_pr');assert.match(published.branch,/^agent\/fix-/);assert.notEqual(published.branch,'main');const pkg=JSON.parse(published.files.find(f=>f.path==='jarvis-starter/package.json').content);assert.equal(pkg.version,'5.4.1');assert.equal(pkg.jarvisSchemaVersion,1);assert.ok(published.files.every(f=>!f.path.startsWith('.github/')));});
test('protected agent, approval, workflow and dependency files are rejected before model/test/publish',async()=>{const f=await fixture();for(const file of ['jarvis-starter/self-development.mjs','.github/workflows/test.yml','jarvis-starter/package.json','../secret','jarvis-starter/server.mjs'])await assert.rejects(f.work.prepare({...input,file}));assert.deepEqual(f.counts(),{publications:0,model:0});});
test('failed/unavailable isolated test cannot publish or turn into a successful candidate',async()=>{for(const status of ['failed','unavailable']){const f=await fixture();f.work.tests=async()=>({status});const r=await f.work.prepare(input);assert.equal(r.status,status==='unavailable'?'blocked':'failed');assert.equal(f.counts().publications,0);}});
test('stop after test prevents publication; unknown publication cannot retry',async()=>{const f=await fixture();f.work.tests=async()=>{await f.control.stop(true);return {status:'passed'};};await assert.rejects(f.work.prepare(input));assert.equal(f.counts().publications,0);const g=await fixture();g.backend.publish=async()=>{throw new Error('lost acknowledgement');};await assert.rejects(g.work.prepare(input));assert.equal(g.work.rows()[0].status,'unknown');await assert.rejects(g.work.prepare(input),/ukendt/);});
test('agent approval requires unchanged SHA, exact version, all CI and independent security evidence',async()=>{for(const patch of [{workflowIds:[]},{sha:'c'.repeat(40)},{version:'5.4.2'},{securityReviewed:false},{paths:['.github/workflows/security.yml']},{checks:[{name:'unit-regression',conclusion:'success'}]}]){const f=await fixture(),r=await f.work.prepare(input);Object.assign(f.evidence,patch);await assert.rejects(f.work.approveRelease(r.id));}const f=await fixture(),r=await f.work.prepare(input);const accepted=await f.work.approveRelease(r.id);assert.equal(accepted.approval.by,'agent-policy');assert.equal(accepted.approval.sha,r.candidateSha);assert.equal(f.work.status().automaticDeployment,false);});


test('queued draft edit wins over stale start without being marked failed',async()=>{
 const f=await fixture(),r=await f.work.saveDraft(input);
 const results=await Promise.allSettled([f.work.saveDraft({...input,request:'Ny ejerrettelse'},{id:r.id,expectedRevision:1}),f.work.prepare({draftId:r.id,expectedRevision:1})]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(f.work.rows()[0].status,'draft');assert.equal(f.work.rows()[0].request,'Ny ejerrettelse');assert.deepEqual(f.counts(),{publications:0,model:0});
});
test('daily execution limit counts start date rather than draft creation date',async()=>{
 const f=await fixture();let now=Date.parse('2026-11-06T12:00:00Z');f.work.now=()=>now;
 const drafts=[];for(let i=0;i<4;i++)drafts.push(await f.work.saveDraft(input));
 now=Date.parse('2026-11-07T12:00:00Z');for(const draft of drafts.slice(0,3))await f.work.prepare({draftId:draft.id,expectedRevision:1});
 await assert.rejects(f.work.prepare({draftId:drafts[3].id,expectedRevision:1}),/tre/);assert.equal(f.counts().publications,3);assert.equal(f.work.rows()[3].status,'draft');
});

test('stored approval loses authority when PR advances or evidence cannot be checked',async()=>{const f=await fixture(),r=await f.work.prepare(input);await f.work.approveRelease(r.id);assert.equal((await f.work.verifyApproval(r.id)).valid,true);f.evidence.sha='c'.repeat(40);assert.equal((await f.work.verifyApproval(r.id)).valid,false);f.backend.evidence=async()=>{throw new Error('offline');};assert.equal((await f.work.verifyApproval(r.id)).valid,false);});

test('global stop permanently invalidates old candidate approval even after resume',async()=>{const f=await fixture(),r=await f.work.prepare(input);await f.work.approveRelease(r.id);await f.control.stop(true);assert.equal((await f.work.verifyApproval(r.id)).valid,false);await f.control.stop(false);assert.equal((await f.work.verifyApproval(r.id)).valid,false);});

test('local development drafts work without backend, model or isolated execution',async()=>{
 const f=await fixture();f.work.enabled=false;f.work.backend=null;f.work.tests=()=>{throw Error('must not execute');};
 const r=await f.work.saveDraft({...input,acceptanceCriteria:['Bevar låste måltider']});
 assert.equal(r.status,'draft');assert.equal(r.request,input.request);assert.deepEqual(f.counts(),{publications:0,model:0});
 await f.work.recover();assert.equal(f.work.rows()[0].status,'draft');
 await assert.rejects(f.work.prepare({draftId:r.id,expectedRevision:r.revision}));
 assert.equal(f.work.rows()[0].status,'draft');
});
test('draft revisions preserve winning edit and cancellation cannot be replayed',async()=>{
 const f=await fixture(),r=await f.work.saveDraft(input),next=await f.work.saveDraft({...input,request:'Bevar ejerens rettelse'},{id:r.id,expectedRevision:1});
 await assert.rejects(f.work.saveDraft(input,{id:r.id,expectedRevision:1}));await assert.rejects(f.work.prepare({draftId:r.id,expectedRevision:1}));
 assert.equal(f.work.rows()[0].request,next.request);
 await f.work.cancelDraft(r.id,{expectedRevision:2});await assert.rejects(f.work.prepare({draftId:r.id,expectedRevision:3}));await assert.rejects(f.work.saveDraft(input,{id:r.id,expectedRevision:3}));
 assert.deepEqual(f.counts(),{publications:0,model:0});
});
test('starting a reviewed draft consumes it once and retains request, criteria, base and change',async()=>{
 const f=await fixture();let prompt;f.work.propose=async x=>{prompt=x;return {content:'export const fixture=2;',summary:'Afgrænset ændring'};};
 const r=await f.work.saveDraft({...input,acceptanceCriteria:['Ingen gentagne måltider']});
 const results=await Promise.allSettled([f.work.prepare({draftId:r.id,expectedRevision:1}),f.work.prepare({draftId:r.id,expectedRevision:1})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.counts().publications,1);assert.equal(f.work.rows().length,1);
 const job=f.work.rows()[0];assert.equal(job.id,r.id);assert.equal(job.status,'draft_pr');assert.equal(job.request,input.request);assert.deepEqual(job.acceptanceCriteria,['Ingen gentagne måltider']);assert.equal(job.baseSha,'a'.repeat(40));assert.equal(job.change.before,'export const fixture=1;');assert.equal(job.change.after,'export const fixture=2;');assert.equal(prompt.includeMemory,false);assert.match(prompt.request,/Acceptkriterier/);
 await assert.rejects(f.work.prepare({draftId:r.id,expectedRevision:2}));
});
test('blocked isolated test retains reviewable change and never publishes',async()=>{
 const f=await fixture();f.work.tests=async()=>({status:'unavailable'});
 const r=await f.work.saveDraft(input),job=await f.work.prepare({draftId:r.id,expectedRevision:1});
 assert.equal(job.status,'blocked');assert.ok(job.change.before);assert.ok(job.change.after);assert.equal(job.test.status,'unavailable');assert.equal(f.counts().publications,0);
});
test('draft criteria reject secrets, excessive size and protected files without execution',async()=>{
 const f=await fixture();
 for(const patch of [{file:'.github/workflows/test.yml'},{acceptanceCriteria:['x'.repeat(501)]},{acceptanceCriteria:Array(11).fill('check')},{acceptanceCriteria:['OPENAI_API_KEY=sk-'+ 'a'.repeat(40)]}])await assert.rejects(f.work.saveDraft({...input,...patch}));
 assert.equal(f.work.rows().length,0);assert.deepEqual(f.counts(),{publications:0,model:0});
});


