import {randomUUID,createHash} from 'node:crypto';
import {dockerTest} from './isolated-test.mjs';
import {rejectSecrets} from './privacy.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const SELF_EDITABLE=Object.freeze(['jarvis-starter/meal-variety.mjs','jarvis-starter/shopping-search-list.mjs']);
export const SELF_WORKFLOWS=Object.freeze([408158602,407266480,409821936,409679954,409695161,410086167]);
export const SELF_CHECKS=Object.freeze(['unit-regression','browser-regression','local-semantic-acceptance','candidate-performance','contract','visual-smoke','voice (22)','voice (24)']);
// No arbitrary commands, dependency installation, CI/workflow edits or deploy.
export class SelfDevelopment{
 constructor({state,save,transact,control,backend,propose,tests,fixture,enabled=false,autoApprove=false,now=()=>Date.now()}){Object.assign(this,{state,save,transact,control,backend,propose,fixture,enabled,autoApprove,now});this.tests=tests||dockerTest;this.busy=false;}
 rows(){return this.state.selfDevelopmentJobs||[];}
 status(){return {enabled:this.enabled,configured:Boolean(this.backend),autoApprove:this.autoApprove,allowedFiles:SELF_EDITABLE,automaticDeployment:false};}
 async record(id,patch){return this.transact(['selfDevelopmentJobs'],async()=>{const row=this.rows().find(r=>r.id===id);if(!row)throw new Error('Udviklingsopgaven findes ikke.');Object.assign(row,patch);await this.save();return structuredClone(row);});}
 async recover(){await this.transact(['selfDevelopmentJobs'],async()=>{for(const row of this.rows())if(['preparing','testing','publishing'].includes(row.status))row.status=row.status==='publishing'?'unknown':'stopped';await this.save();});}
 async prepare({file,request,version}){
  this.control.assertAllowed();if(!this.enabled||!this.backend)throw new Error('Selvudvikling mangler separat udviklingsadgang og er ikke aktiveret.');
  if(!SELF_EDITABLE.includes(file))throw new Error('Filen ligger uden for den tilladte funktionsændring. Sikkerhedsregler, workflows og agenten selv er beskyttet.');
  if(typeof request!=='string'||!request.trim()||request.length>2000)throw new Error('Beskriv en afgrænset rettelse.');rejectSecrets(request);
  if(!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Angiv kandidatversionen.');
  if(this.busy||this.rows().some(r=>r.status==='unknown'))throw new Error('En udviklingsopgave er aktiv eller har ukendt publiceringsudfald.');
  if(this.rows().filter(r=>r.createdAt.slice(0,10)===new Date(this.now()).toISOString().slice(0,10)).length>=3)throw new Error('Dagens grænse på tre udviklingsopgaver er nået.');
  this.busy=true;const id=randomUUID(),scope=this.control.current();let publishing=false;
  try{
   await this.transact(['selfDevelopmentJobs'],async()=>{this.state.selfDevelopmentJobs=[...this.rows(),{id,file,version,status:'preparing',createdAt:new Date(this.now()).toISOString()}];await this.save();});
   const base=await this.backend.snapshot([...SELF_EDITABLE,'jarvis-starter/food-identity.mjs','jarvis-starter/package.json']);this.control.assertAllowed(scope);
   if(!/^[a-f0-9]{40}$/.test(base.sha))throw new Error('Udviklingsgrundlaget mangler et præcist commit.');
   const pkg=JSON.parse(base.files.find(f=>f.path==='jarvis-starter/package.json').content),parts=pkg.version.split('.').map(Number);if(version!==`${parts[0]}.${parts[1]}.${parts[2]+1}`)throw new Error('Første automatiske kandidat skal være næste patchversion.');
   const original=base.files.find(f=>f.path===file)?.content;if(typeof original!=='string')throw new Error('Funktionen findes ikke i det valgte grundlag.');
   const change=await this.propose({file,request,original,includeMemory:false});this.control.assertAllowed(scope);
   if(typeof change.content!=='string'||!change.content.trim()||change.content===original||Buffer.byteLength(change.content)>45000||typeof change.summary!=='string'||change.summary.length>800)throw new Error('Ugyldigt eller tomt kodeforslag.');rejectSecrets(change.content);rejectSecrets(change.summary);
   const sources=base.files.filter(f=>f.path!=='jarvis-starter/package.json').map(f=>({path:f.path.slice('jarvis-starter/'.length),content:f.path===file?change.content:f.content}));
   const testFiles=[...sources,{path:'test/self-development.fixture.test.mjs',content:this.fixture}];const contentHash=hash(testFiles);
   await this.record(id,{status:'testing',baseSha:base.sha,contentHash,scope:'Afgrænsede funktionsprøver; fuld kandidat-CI kræves før releasegodkendelse.'});
   const report=await this.tests(testFiles);this.control.assertAllowed(scope);if(report.status!=='passed'){await this.record(id,{status:report.status==='unavailable'?'blocked':'failed',test:{status:report.status,contentHash}});return this.rows().find(r=>r.id===id);}
   pkg.version=version;const files=[{path:file,content:change.content},{path:'jarvis-starter/package.json',content:JSON.stringify(pkg,null,2)+'\n'},{path:'docs/agent-candidates/'+id+'.md',content:`# Kandidat ${version}\n\nGrundlag: ${base.sha}\nTestgrundlag: ${contentHash}\n\n${change.summary}\n\nKun afgrænsede funktionsprøver bestået. Hele PR-kandidatens CI og selvstændige sikkerhedsreview kræves før godkendelse. Ingen deployment.\n`}];
   await this.record(id,{status:'publishing',diffHash:hash(files),test:{status:'passed',contentHash},summary:change.summary});publishing=true;
   const candidate=await this.backend.publish({baseSha:base.sha,branch:'agent/fix-'+id,files,title:'Jarvis '+version+': '+change.summary.slice(0,100)});
   this.control.assertAllowed(scope);if(!/^[a-f0-9]{40}$/.test(candidate.sha)||!/^https:\/\/github\.com\/christopherpedersendk-web\/jarvis-personal-assistant\/pull\/\d+$/.test(candidate.url))throw new Error('Publiceringsudfald kunne ikke bekræftes.');
   return this.record(id,{status:'draft_pr',candidateSha:candidate.sha,prUrl:candidate.url,prNumber:candidate.number});
  }catch(error){await this.record(id,{status:publishing?'unknown':this.control.snapshot().stopped?'stopped':'failed',reason:publishing?'publication_unconfirmed':'preparation_failed'}).catch(()=>{});throw new Error(publishing?'Publiceringsudfald er ukendt. Kontrollér grenen og PR før en ny opgave.':'Udviklingsopgaven kunne ikke færdiggøres. Ingen automatisk gentagelse.');}
  finally{this.busy=false;}
 }
 async verifyApproval(id){
  const row=this.rows().find(r=>r.id===id);if(!row?.approval||row.approval.expires<=this.now())return {valid:false,reason:'missing_or_expired'};try{const e=await this.backend.evidence(row.prNumber);return {valid:e.sha===row.approval.sha&&e.version===row.version&&e.securityReviewed&&SELF_WORKFLOWS.every(id=>e.workflowIds?.includes(id))&&SELF_CHECKS.every(name=>e.checks.some(c=>c.name===name&&c.conclusion==='success'))&&e.checks.every(c=>c.conclusion==='success'),sha:row.approval.sha};}catch{return {valid:false,reason:'verification_unavailable'};}
 }
 async approveRelease(id){this.control.assertAllowed();if(!this.autoApprove)throw new Error('Agentens egen releasegodkendelse er ikke aktiveret.');const row=this.rows().find(r=>r.id===id);if(!row||row.status!=='draft_pr')throw new Error('En verificerbar draft-PR mangler.');const evidence=await this.backend.evidence(row.prNumber);this.control.assertAllowed();
  if(!SELF_WORKFLOWS.every(id=>evidence.workflowIds?.includes(id))||evidence.sha!==row.candidateSha||evidence.version!==row.version||!evidence.securityReviewed||!evidence.paths.every(p=>SELF_EDITABLE.includes(p)||p==='jarvis-starter/package.json'||p==='docs/agent-candidates/'+id+'.md')||!SELF_CHECKS.every(name=>evidence.checks.some(c=>c.name===name&&c.conclusion==='success'))||evidence.checks.some(c=>c.conclusion!=='success'))throw new Error('Kandidat-SHA, filscope, version, CI eller uafhængigt sikkerhedsreview mangler/er ændret.');
  return this.record(id,{status:'approved_candidate',approval:{by:'agent-policy',sha:row.candidateSha,diffHash:row.diffHash,expires:this.now()+3600000,note:'Godkendt kandidat, ingen merge, releasepublicering eller deployment.'}});
 }
}
