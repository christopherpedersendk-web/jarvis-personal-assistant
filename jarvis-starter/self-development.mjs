import {randomUUID,createHash} from 'node:crypto';
import {dockerTest} from './isolated-test.mjs';
import {rejectSecrets} from './privacy.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const SELF_EDITABLE=Object.freeze(['jarvis-starter/meal-variety.mjs','jarvis-starter/shopping-search-list.mjs']);
export const SELF_WORKFLOWS=Object.freeze([408158602,407266480,409821936,409679954,409695161,410086167]);
export const SELF_CHECKS=Object.freeze(['unit-regression','browser-regression','local-semantic-acceptance','candidate-performance','contract','visual-smoke','voice (22)','voice (24)']);
function task(input){
 const {file,request,version,acceptanceCriteria=[]}=input;
 if(!SELF_EDITABLE.includes(file))throw new Error('Filen ligger uden for den tilladte funktionsændring.');
 if(typeof request!=='string'||!request.trim()||request.length>2000)throw new Error('Beskriv en afgrænset rettelse.');rejectSecrets(request);
 if(!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Angiv kandidatversionen.');
 if(!Array.isArray(acceptanceCriteria)||acceptanceCriteria.length>10||acceptanceCriteria.some(x=>typeof x!=='string'||!x.trim()||x.length>500))throw new Error('Angiv højst ti konkrete acceptkriterier.');for(const x of acceptanceCriteria)rejectSecrets(x);
 return {file,request:request.trim(),version,acceptanceCriteria:acceptanceCriteria.map(x=>x.trim())};
}
// No arbitrary commands, dependency installation, CI/workflow edits or deploy.
export class SelfDevelopment{
 constructor({state,save,transact,control,backend,propose,tests,fixture,enabled=false,autoApprove=false,now=()=>Date.now()}){Object.assign(this,{state,save,transact,control,backend,propose,fixture,enabled,autoApprove,now});this.tests=tests||dockerTest;this.busy=false;}
 rows(){return (this.state.selfDevelopmentJobs||[]).filter(r=>r.engine!=='codex-app-server');}
 status(){return {enabled:this.enabled,configured:Boolean(this.backend),autoApprove:this.autoApprove,allowedFiles:SELF_EDITABLE,automaticDeployment:false};}
 async record(id,patch){return this.transact(['selfDevelopmentJobs'],async()=>{const row=this.rows().find(r=>r.id===id);if(!row)throw new Error('Udviklingsopgaven findes ikke.');Object.assign(row,patch);await this.save();return structuredClone(row);});}
 async recover(){await this.transact(['selfDevelopmentJobs'],async()=>{for(const row of this.rows())if(['preparing','testing','publishing'].includes(row.status))row.status=row.status==='publishing'?'unknown':'stopped';await this.save();});}
 async saveDraft(input,{id,expectedRevision}={}){
  const spec=task(input);this.control.assertAllowed();
  return this.transact(['selfDevelopmentJobs'],async()=>{this.control.assertAllowed();const existing=id?this.rows().find(r=>r.id===id):null;
   if(id&&(!existing||existing.status!=='draft'||existing.revision!==expectedRevision))throw new Error('Udviklingskladden er ændret eller allerede startet. Bevar dine rettelser og hent status.');
   if(!id&&(this.state.selfDevelopmentJobs||[]).length>=100)throw new Error('Gennemgå udviklingsarkivet før flere kladder.');
   const row={...existing,...spec,id:id||randomUUID(),revision:(existing?.revision||0)+1,status:'draft',createdAt:existing?.createdAt||new Date(this.now()).toISOString(),updatedAt:new Date(this.now()).toISOString()};
   this.state.selfDevelopmentJobs=existing?(this.state.selfDevelopmentJobs||[]).map(r=>r.id===id?row:r):[...(this.state.selfDevelopmentJobs||[]),row];await this.save();return structuredClone(row);
  });
 }
 async cancelDraft(id,{expectedRevision}){
  return this.transact(['selfDevelopmentJobs'],async()=>{const row=this.rows().find(r=>r.id===id);if(!row||row.status!=='draft'||row.revision!==expectedRevision)throw new Error('Udviklingskladden er ændret eller allerede startet.');row.status='cancelled';row.revision++;await this.save();return structuredClone(row);});
 }
 async prepare(input){
  const draft=input.draftId?this.rows().find(r=>r.id===input.draftId):null;
  if(input.draftId&&(!draft||draft.status!=='draft'||draft.revision!==input.expectedRevision))throw new Error('Udviklingskladden er ændret eller allerede startet.');
  const {file,request,version,acceptanceCriteria}=task(draft||input);
  this.control.assertAllowed();if(!this.enabled||!this.backend)throw new Error('Selvudvikling mangler separat udviklingsadgang og er ikke aktiveret.');
  if(this.busy||(this.state.selfDevelopmentJobs||[]).some(r=>r.status==='unknown'||r.engine==='codex-app-server'&&['queued','starting','running','waiting_approval','stop_requested','publishing'].includes(r.status)))throw new Error('En udviklingsopgave er aktiv eller har ukendt publiceringsudfald.');
  if((this.state.selfDevelopmentJobs||[]).filter(r=>!['draft','cancelled'].includes(r.status)&&(r.startedAt||r.createdAt).slice(0,10)===new Date(this.now()).toISOString().slice(0,10)).length>=3)throw new Error('Dagens grænse på tre udviklingsopgaver er nået.');
  this.busy=true;const id=draft?.id||randomUUID(),scope=this.control.current();let publishing=false,started=false;
  try{
   await this.transact(['selfDevelopmentJobs'],async()=>{this.control.assertAllowed(scope);if(draft){const current=this.rows().find(r=>r.id===id);if(current.status!=='draft'||current.revision!==input.expectedRevision)throw new Error('Kladden er ændret.');Object.assign(current,{status:'preparing',startedAt:new Date(this.now()).toISOString(),revision:current.revision+1});}else{this.state.selfDevelopmentJobs=[...(this.state.selfDevelopmentJobs||[]),{id,file,request,version,acceptanceCriteria,revision:1,status:'preparing',createdAt:new Date(this.now()).toISOString()}];}await this.save();});
   started=true;
   const base=await this.backend.snapshot([...SELF_EDITABLE,'jarvis-starter/food-identity.mjs','jarvis-starter/package.json']);this.control.assertAllowed(scope);
   if(!/^[a-f0-9]{40}$/.test(base.sha))throw new Error('Udviklingsgrundlaget mangler et præcist commit.');
   const pkg=JSON.parse(base.files.find(f=>f.path==='jarvis-starter/package.json').content),parts=pkg.version.split('.').map(Number);if(version!==`${parts[0]}.${parts[1]}.${parts[2]+1}`)throw new Error('Første automatiske kandidat skal være næste patchversion.');
   const original=base.files.find(f=>f.path===file)?.content;if(typeof original!=='string'||Buffer.byteLength(original)>45000)throw new Error('Funktionen findes ikke i det valgte grundlag.');
   rejectSecrets(original);
   const change=await this.propose({file,request:request+(acceptanceCriteria.length?'\n\nAcceptkriterier:\n'+acceptanceCriteria.join('\n'):''),original,includeMemory:false});this.control.assertAllowed(scope);
   if(typeof change.content!=='string'||!change.content.trim()||change.content===original||Buffer.byteLength(change.content)>45000||typeof change.summary!=='string'||change.summary.length>800)throw new Error('Ugyldigt eller tomt kodeforslag.');rejectSecrets(change.content);rejectSecrets(change.summary);
   const sources=base.files.filter(f=>f.path!=='jarvis-starter/package.json').map(f=>({path:f.path.slice('jarvis-starter/'.length),content:f.path===file?change.content:f.content}));
   const testFiles=[...sources,{path:'test/self-development.fixture.test.mjs',content:this.fixture}];const contentHash=hash(testFiles);
   await this.record(id,{status:'testing',baseSha:base.sha,contentHash,summary:change.summary,change:{file,before:original,after:change.content},scope:'Afgrænsede funktionsprøver; fuld kandidat-CI kræves før releasegodkendelse.'});
   const report=await this.tests(testFiles);this.control.assertAllowed(scope);if(report.status!=='passed'){await this.record(id,{status:report.status==='unavailable'?'blocked':'failed',test:{status:report.status,contentHash}});return this.rows().find(r=>r.id===id);}
   pkg.version=version;const files=[{path:file,content:change.content},{path:'jarvis-starter/package.json',content:JSON.stringify(pkg,null,2)+'\n'},{path:'docs/agent-candidates/'+id+'.md',content:`# Kandidat ${version}\n\nGrundlag: ${base.sha}\nTestgrundlag: ${contentHash}\n\n${change.summary}\n\nKun afgrænsede funktionsprøver bestået. Hele PR-kandidatens CI og selvstændige sikkerhedsreview kræves før godkendelse. Ingen deployment.\n`}];
   await this.record(id,{status:'publishing',diffHash:hash(files),test:{status:'passed',contentHash},summary:change.summary});publishing=true;
   const candidate=await this.backend.publish({baseSha:base.sha,branch:'agent/fix-'+id,files,title:'Jarvis '+version+': '+change.summary.slice(0,100)});
   this.control.assertAllowed(scope);if(!/^[a-f0-9]{40}$/.test(candidate.sha)||!/^https:\/\/github\.com\/christopherpedersendk-web\/jarvis-personal-assistant\/pull\/\d+$/.test(candidate.url))throw new Error('Publiceringsudfald kunne ikke bekræftes.');
   return this.record(id,{status:'draft_pr',candidateSha:candidate.sha,prUrl:candidate.url,prNumber:candidate.number});
  }catch(error){if(started)await this.record(id,{status:publishing?'unknown':this.control.snapshot().stopped?'stopped':'failed',reason:publishing?'publication_unconfirmed':'preparation_failed'}).catch(()=>{});throw new Error(publishing?'Publiceringsudfald er ukendt. Kontrollér grenen og PR før en ny opgave.':'Udviklingsopgaven kunne ikke færdiggøres. Hent status; ingen automatisk gentagelse.');}
  finally{this.busy=false;}
 }
 async verifyApproval(id){
  const row=this.rows().find(r=>r.id===id);if(!row?.approval?.scope||row.approval.expires<=this.now())return {valid:false,reason:'missing_or_expired'};try{this.control.assertAllowed(row.approval.scope);const e=await this.backend.evidence(row.prNumber);this.control.assertAllowed(row.approval.scope);return {valid:e.sha===row.approval.sha&&e.version===row.version&&e.securityReviewed&&SELF_WORKFLOWS.every(id=>e.workflowIds?.includes(id))&&SELF_CHECKS.every(name=>e.checks.some(c=>c.name===name&&c.conclusion==='success'))&&e.checks.every(c=>c.conclusion==='success'),sha:row.approval.sha};}catch{return {valid:false,reason:'verification_unavailable'};}
 }
 async approveRelease(id){const scope=this.control.current();this.control.assertAllowed(scope);if(!this.autoApprove)throw new Error('Agentens egen releasegodkendelse er ikke aktiveret.');const row=this.rows().find(r=>r.id===id);if(!row||row.status!=='draft_pr')throw new Error('En verificerbar draft-PR mangler.');const evidence=await this.backend.evidence(row.prNumber);this.control.assertAllowed(scope);
  if(!SELF_WORKFLOWS.every(id=>evidence.workflowIds?.includes(id))||evidence.sha!==row.candidateSha||evidence.version!==row.version||!evidence.securityReviewed||!evidence.paths.every(p=>SELF_EDITABLE.includes(p)||p==='jarvis-starter/package.json'||p==='docs/agent-candidates/'+id+'.md')||!SELF_CHECKS.every(name=>evidence.checks.some(c=>c.name===name&&c.conclusion==='success'))||evidence.checks.some(c=>c.conclusion!=='success'))throw new Error('Kandidat-SHA, filscope, version, CI eller uafhængigt sikkerhedsreview mangler/er ændret.');
  return this.record(id,{status:'approved_candidate',approval:{by:'agent-policy',scope,sha:row.candidateSha,diffHash:row.diffHash,expires:this.now()+3600000,note:'Godkendt kandidat, ingen merge, releasepublicering eller deployment.'}});
 }
}

