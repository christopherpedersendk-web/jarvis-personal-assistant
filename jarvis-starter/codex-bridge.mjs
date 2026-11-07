import {createHash,randomUUID} from 'node:crypto';
import {redactSecrets,rejectSecrets} from './privacy.mjs';
import {CODEX_EDITABLE,codexWritable} from './codex-worktree.mjs';
const engine='codex-app-server',hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snow=x=>typeof x==='string'&&/^\d{15,22}$/.test(x);
const active=new Set(['queued','starting','running','waiting_approval','stop_requested','publishing']);
const basis=c=>hash([c.enabled,c.token,c.userId,c.guildId,c.configurationRevision||0]);
const clean=x=>redactSecrets(String(x||'')).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,1800);
export const DEVELOPMENT_LABELS={queued:'venter i kø',starting:'starter',running:'arbejder',waiting_approval:'venter på din beslutning',completed:'afsluttet',stopped:'stoppet — afbrydelse bekræftet',stop_requested:'stop anmodet — afventer bekræftelse',failed:'fejlet',unknown:'ukendt udfald — inspicér før fortsættelse',publishing:'opretter draft-PR',draft_pr:'draft-PR klar'};
export class CodexBridge{
 constructor({state,save,transact,control,config,workspace,client,queue,github,enabled=false,notify=async()=>{},now=()=>Date.now(),model}){
  Object.assign(this,{state,save,transact,control,config,workspace,client,queue,github,enabled,notify,now,model});this.boot=randomUUID();this.runtime=new Map();this.approvals=new Map();this.operations=new Set();
  client.onEvent=(...a)=>this.event(...a);client.onRequest=(...a)=>this.serverRequest(...a);client.onDisconnect=()=>this.disconnected();
 }
 rows(){return (this.state.selfDevelopmentJobs||[]).filter(r=>r.engine===engine);}
 list(){return structuredClone(this.rows());}
 get(id){const matches=this.rows().filter(r=>r.id===id||r.id.slice(0,8)===String(id).toLowerCase());if(matches.length!==1)throw Error('Angiv ét entydigt opgave-ID fra statuslisten.');return matches[0];}
 auth(meta,row,{effect=false}={}){
  const c=this.config();if(!this.enabled)throw Error('Codex-broen er ikke aktiveret. Operatøren skal klargøre den separate udviklingsprofil.');
  if(!c.enabled||!c.token||meta.ownerId!==c.userId||!snow(meta.ownerId)||!snow(meta.channelId)||(meta.guildId&&meta.guildId!==c.guildId))throw Error('Kun den konfigurerede ejer i godkendt Discord-kontekst kan styre udviklingen.');
  if(row&&(row.ownerId!==meta.ownerId||row.channelId!==meta.channelId||row.guildId!==(meta.guildId||'')||row.configurationBasis!==basis(c)))throw Error('Brug opgavens oprindelige ejer/kanal; konfigurationen må ikke være ændret.');
  if(effect)this.control.assertAllowed();return c;
 }
 async record(id,patch){return this.transact(['selfDevelopmentJobs'],async()=>{const row=this.rows().find(x=>x.id===id);if(!row)throw Error('Udviklingsopgaven mangler.');if(row.status==='stop_requested'&&patch.status){if(['queued','starting','running','waiting_approval'].includes(patch.status))return structuredClone(row);if(patch.status==='unknown')patch={...patch,status:'stop_requested'};}Object.assign(row,patch,{updatedAt:new Date(this.now()).toISOString(),revision:row.revision+1});await this.save();return structuredClone(row);});}
 async recover(){
  await this.transact(['selfDevelopmentJobs'],async()=>{for(const row of this.rows()){
   if(active.has(row.status)&&row.status!=='stop_requested')row.status='unknown';
   if(row.publicationOutcome==='sending')row.publicationOutcome='unknown';
   if(row.pendingApproval){row.pendingApproval.status='expired';row.pendingApproval=null;}
   row.recoveryNote='Genstart gentager ikke kodeændringer, tests eller publicering. Status kan genfindes eksplicit.';
  }await this.save();});
 }
 async initialize(){if(!this.ready)this.ready=(async()=>{await this.workspace.initialize();await this.client.connect();})();return this.ready;}
 commandId(meta){if(!snow(meta.messageId))throw Error('Et verificeret Discord-besked-ID kræves for ændringer.');return meta.messageId;}
 async claimCommand(row,meta,kind){
  const messageId=this.commandId(meta);return this.transact(['selfDevelopmentJobs'],async()=>{const current=this.get(row.id);if((current.commands||[]).some(c=>c.id===messageId))return false;
   current.commands=[...(current.commands||[]),{id:messageId,kind}].slice(-100);await this.save();return true;});
 }
 text(value){if(typeof value!=='string'||!value.trim()||value.length>2000)throw Error('Beskriv udviklingsønsket på højst 2.000 tegn.');rejectSecrets(value);return value.trim();}
 async start(request,meta){
  this.auth(meta,null,{effect:true});request=this.text(request);const sourceMessageId=this.commandId(meta);
  const row=await this.transact(['selfDevelopmentJobs'],async()=>{
   const previous=this.rows().find(r=>r.sourceMessageId===sourceMessageId&&r.ownerId===meta.ownerId&&r.channelId===meta.channelId);if(previous)return {...structuredClone(previous),duplicate:true};
   if((this.state.selfDevelopmentJobs||[]).some(r=>r.status==='unknown'||r.engine===engine&&active.has(r.status)||r.engine!==engine&&['preparing','testing','publishing'].includes(r.status)))throw Error('En udviklingsopgave arbejder eller har ukendt udfald. Hent status før en ny start.');
   if((this.state.selfDevelopmentJobs||[]).length>=100)throw Error('Gennemgå udviklingsarkivet før nye opgaver.');
   if((this.state.selfDevelopmentJobs||[]).filter(r=>(r.startedAt||r.createdAt||'').slice(0,10)===new Date(this.now()).toISOString().slice(0,10)&&!['draft','cancelled'].includes(r.status)).length>=3)throw Error('M18-grænsen på tre udviklingsopgaver pr. UTC-døgn er nået.');
   const row={id:randomUUID(),engine,request,summary:clean(request).slice(0,160),revision:1,codeRevision:1,status:'queued',sourceMessageId,commands:[{id:sourceMessageId,kind:'start'}],ownerId:meta.ownerId,guildId:meta.guildId||'',channelId:meta.channelId,configurationBasis:basis(this.config()),scope:this.control.current(),createdAt:new Date(this.now()).toISOString(),startedAt:new Date(this.now()).toISOString(),checks:[],receipts:[],pendingApproval:null};
   this.state.selfDevelopmentJobs=[...(this.state.selfDevelopmentJobs||[]),row];await this.save();return structuredClone(row);
  });
  if(!row.duplicate)this.schedule(row.id,()=>this.launch(row.id,request));return this.get(row.id);
 }
 schedule(id,run){
  try{const job=this.queue.enqueue('Codex udvikling · '+id.slice(0,8),run);this.runtime.set(id,{...(this.runtime.get(id)||{}),queueId:job.id,tools:0});job.promise.catch(()=>this.failJob(id));}
  catch(error){this.record(id,{status:'failed',latestProgress:'Den eksisterende JARVIS-kø kunne ikke modtage opgaven.'}).catch(()=>{});throw error;}
 }
 check(id,{allowStop=false}={}){const row=this.get(id);if(!allowStop&&(row.status==='stop_requested'||['stopped','unknown','failed','publishing','draft_pr'].includes(row.status)))throw Error('Opgaven kan ikke udføre flere handlinger.');if(row.configurationBasis!==basis(this.config()))throw Error('Udviklingskonfigurationen er ændret.');this.control.assertAllowed(row.scope);return row;}
 tools(id){const writable=[...CODEX_EDITABLE,`jarvis-starter/test/codex-task-${id}.test.mjs`];const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});return [
  {type:'function',name:'jarvis_project_files',description:'List the approved files and task context. No shell or production access.',inputSchema:schema({})},
  {type:'function',name:'jarvis_read_file',description:'Read a bounded public project file; returns its SHA256 for editing.',inputSchema:schema({path:{type:'string'}})},
  {type:'function',name:'jarvis_write_file',description:'Replace one approved source file using expectedHash from read. Null hash only for a new file. Never runs code.',inputSchema:schema({path:{type:'string',enum:writable},content:{type:'string'},expectedHash:{type:['string','null']}})},
  {type:'function',name:'jarvis_run_tests',description:'Run protected focused tests in existing JARVIS networkless Docker isolation. No arbitrary commands. Wait for result.',inputSchema:schema({})},
 ];}
 async launch(id,prompt){
  try{
   let row=this.check(id);if(row.status!=='queued')return;
   await this.record(id,{status:'starting',latestProgress:'Klargør isoleret Git-worktree.'});await this.initialize();this.check(id);
   const location=await this.workspace.create(id);row=await this.record(id,{...location,latestProgress:'Forbinder en ny Codex-session.'});
   this.check(id);const runtime=this.runtime.get(id)||{};runtime.threadCreationStarted=true;this.runtime.set(id,runtime);
   const result=await this.client.start(row.worktree,this.tools(id),'Du arbejder kun på denne JARVIS-udviklingsopgave. Brug udelukkende jarvis_project_files, jarvis_read_file, jarvis_write_file og jarvis_run_tests. Native shell og filskrivning er bevidst utilgængelige. Kør aldrig kode uden Docker-testværktøjet. Ingen produktionsdata, credentials, netværkshandlinger, køb, betaling, sikkerhedssvækkelser, merge, release eller deployment. Bevar M12/M16-acceptkrav og beskriv ukendt som ukendt. Afslut med en kort dansk ændringsoversigt og faktisk teststatus. Opret ikke selv PR. Spørg via samtalen, hvis scope ikke er tilstrækkeligt.',this.model);
   this.check(id);if(typeof result.thread?.id!=='string')throw Error('Codex-sessionen mangler.');
   await this.record(id,{threadId:result.thread.id,sessionId:result.thread.sessionId||result.thread.id});await this.beginTurn(id,prompt);
  }catch{if(this.get(id).status==='stop_requested'&&!this.get(id).threadId&&!this.runtime.get(id)?.threadCreationStarted)await this.record(id,{status:'stopped',latestProgress:'Stop før Codex-start er bekræftet.'});else await this.failJob(id);}
 }
 async beginTurn(id,prompt,{resume=false}={}){
  let row=this.check(id);if(resume)await this.client.resume(row.threadId,row.worktree);this.check(id);
  const runtime=this.runtime.get(id)||{tools:0};runtime.interrupted=false;this.runtime.set(id,runtime);
  await this.record(id,{status:'running',previousTurnId:row.turnId||null,turnId:null,pendingApproval:null,latestProgress:'Codex arbejder i den isolerede udviklingsmappe.'});
  this.check(id);const result=await this.client.turn(row.threadId,prompt);const current=this.get(id);if(!result.turn?.id)throw Error('Codex-turnens udfald er ukendt.');
  if(!current.turnId)await this.record(id,{turnId:result.turn.id});
 }
 async follow(id,prompt,meta){
  let row=this.get(id);this.auth(meta,row,{effect:true});prompt=this.text(prompt);
  if(!await this.claimCommand(row,meta,'follow'))return this.get(row.id);
  if(!['completed','stopped','running'].includes(row.status)||!row.threadId)throw Error('Opgaven afventer afklaring eller arbejder med en anden handling. Hent status.');
  if(row.status!=='running'&&(this.state.selfDevelopmentJobs||[]).some(r=>r.id!==row.id&&(r.status==='unknown'||r.engine===engine&&active.has(r.status)||r.engine!==engine&&['preparing','testing','publishing'].includes(r.status))))throw Error('En anden udviklingsopgave arbejder eller har ukendt udfald. Hent status før fortsættelse.');
  if(this.operations.has(row.id)||(this.runtime.get(row.id)?.queuedTools||0))throw Error('Et værktøj eller en instruktion behandles allerede. Vent på det aktuelle kontrolpunkt.');this.operations.add(row.id);
  try{
   await this.initialize();row=await this.record(row.id,{codeRevision:row.codeRevision+1,pendingApproval:null,scope:this.control.current()});
   if(row.status==='running'){
    if(!row.turnId)throw Error('Startudfaldet afventer et turn-ID.');
    await this.client.steer(row.threadId,row.turnId,prompt);await this.record(row.id,{latestProgress:'Opfølgning sendt til samme aktive Codex-turn.'});
   }else{await this.record(row.id,{status:'queued'});this.schedule(row.id,()=>this.beginTurn(row.id,prompt,{resume:true}));}
   return this.get(row.id);
  }finally{this.operations.delete(row.id);}
 }
 async stop(id,meta){let row=this.get(id);if(meta)this.auth(meta,row);if(meta&&!await this.claimCommand(row,meta,'stop'))return this.get(row.id);
  row=this.get(row.id);if(['completed','failed','draft_pr','stopped'].includes(row.status))return row;
  await this.record(row.id,{status:'stop_requested',stopRequestedAt:new Date(this.now()).toISOString(),pendingApproval:null,latestProgress:'Stop er anmodet. Afventer Codex og eventuel Docker-testoprydning.'});
  for(const [key,p]of this.approvals)if(p.jobId===row.id){p.resolve(this.denial(p.method));this.approvals.delete(key);}
  const runtime=this.runtime.get(row.id);
  if(!row.threadId&&row.status==='queued'&&runtime?.queueId){try{this.queue.cancel(runtime.queueId);return this.record(row.id,{status:'stopped',latestProgress:'Ventende opgave er annulleret før Codex-start.'});}catch{}}
  if(row.threadId&&row.turnId&&!this.client.dead){try{await this.client.interrupt(row.threadId,row.turnId);}catch{/* Request success alone is never stop confirmation. */}}
  return this.get(row.id);
 }
 async settleStop(id){const rt=this.runtime.get(id)||{};if(rt.interrupted&&!rt.tools&&!rt.queuedTools&&this.get(id).status==='stop_requested'){await this.record(id,{status:'stopped',latestProgress:'Codex har bekræftet afbrydelsen; alle lokale værktøjer er afsluttet.'});await this.announce(id);}}
 async stopAll(){for(const row of this.rows().filter(r=>active.has(r.status)))await this.stop(row.id);}
 async shutdown(){await this.stopAll();await this.client.close();await this.workspace.close?.();}
 async failJob(id){const row=this.get(id);if(['stopped','stop_requested','completed','draft_pr'].includes(row.status))return;await this.record(id,{status:row.threadId||['starting','publishing'].includes(row.status)?'unknown':'failed',pendingApproval:null,latestProgress:'Forløbet kunne ikke bekræftes. Ingen automatisk gentagelse.'});await this.announce(id);}
 async disconnected(){for(const row of this.rows().filter(r=>active.has(r.status)&&r.threadId)){
  await this.record(row.id,{status:row.status==='stop_requested'?'stop_requested':'unknown',pendingApproval:null,latestProgress:'Codex-forbindelsen blev afbrudt. Status skal genfindes; intet genstartes automatisk.'});
 }}
 async event(method,p){
  const row=this.rows().find(r=>r.threadId===p.threadId);if(!row)return;
  if(p.turnId&&((row.turnId&&p.turnId!==row.turnId)||(!row.turnId&&p.turnId===row.previousTurnId)))return;
  if(method==='turn/started'&&p.turn?.id!==row.previousTurnId&&!row.turnId&&['running','stop_requested'].includes(row.status))await this.record(row.id,{turnId:p.turn.id});
  if(method==='item/completed'&&p.item?.type==='agentMessage')await this.record(row.id,{codexSummary:clean(this.client.clean(p.item.text))});
  if(method==='turn/completed'){
   if(!['running','waiting_approval','stop_requested'].includes(row.status)||!row.turnId&&p.turn?.id===row.previousTurnId)return;
   const status=p.turn?.status;if(!['completed','interrupted','failed'].includes(status))return;
   if(row.turnId&&p.turn.id!==row.turnId)return;
   if(status==='interrupted'){const rt=this.runtime.get(row.id)||{};rt.interrupted=true;this.runtime.set(row.id,rt);if(row.status!=='stop_requested')await this.record(row.id,{status:'stop_requested'});await this.settleStop(row.id);return;}
   if(row.status==='stop_requested'){await this.record(row.id,{status:status==='completed'?'completed':'failed',latestProgress:'Codex-turnen sluttede '+(status==='completed'?'før afbrydelsen':'med fejl')+'. Den rapporteres ikke som stoppet.',terminalTurnStatus:status,stopOutcome:'finished_before_interrupt'});await this.announce(row.id);return;}
   await this.record(row.id,{status:status==='completed'?'completed':'failed',turnId:p.turn.id,pendingApproval:null,latestProgress:status==='completed'?'Codex er afsluttet. Se ændringer og faktisk Docker-teststatus.':'Codex meldte fejl. Ingen automatisk genstart.'});await this.announce(row.id);
  }
 }
 denial(method){return method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:method==='item/tool/requestUserInput'?{answers:{}}:{decision:'decline'};}
 async serverRequest(method,p,rpcId){
  const row=this.rows().find(r=>r.threadId===p.threadId);if(!row||row.turnId&&p.turnId!==row.turnId)return this.denial(method);
  if(method==='item/tool/call'){if(row.status!=='running'||(!row.turnId&&p.turnId===row.previousTurnId))throw Error('Forældet eller stoppet værktøjskald.');return this.tool(row.id,p);}
  if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput'].includes(method))throw Error('Protokolhandlingen er ikke tilladt.');
  if(row.status==='stop_requested')return this.denial(method);
  const id=randomUUID(),pending={id,kind:method==='item/tool/requestUserInput'?'input':'codex_scope',method,boot:this.boot,codeRevision:row.codeRevision,expires:this.now()+300000,questions:(p.questions||[]).slice(0,3).map(q=>({id:q.id,text:clean(this.client.clean(q.question||q.header))}))};
  const waiting=await this.record(row.id,{status:'waiting_approval',pendingApproval:pending,latestProgress:pending.kind==='input'?'Codex afventer dit svar.':'Codex har bedt om rettigheder uden for den afgrænsede udviklingsprofil. Adgang udvides ikke automatisk.'});if(waiting.status!=='waiting_approval')return this.denial(method);await this.announce(row.id);
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.approvals.delete(id);if(this.get(row.id).pendingApproval?.id===id)this.record(row.id,{status:'running',pendingApproval:null,latestProgress:'Forespørgslen udløb og blev afvist.'}).catch(()=>{});resolve(this.denial(method));},300000);timer.unref?.();this.approvals.set(id,{jobId:row.id,method,rpcId,p,resolve:value=>{clearTimeout(timer);resolve(value);}});});
 }
 async decision(id,reviewId,accept,meta,text){const row=this.get(id);this.auth(meta,row,{effect:accept});const review=row.pendingApproval;
  if(!review||review.id!==reviewId||review.boot!==this.boot||review.expires<=this.now()||review.codeRevision!==row.codeRevision)throw Error('Godkendelsen er udløbet, ændret eller stammer fra en tidligere proces.');
  if(review.kind==='publish')return accept?this.publish(row.id,reviewId,meta):this.record(row.id,{pendingApproval:null,latestProgress:'Draft-PR-publicering er annulleret.'});
  const pending=this.approvals.get(reviewId);if(!pending)throw Error('Forespørgslen er ikke længere aktiv.');
  if(accept&&review.kind!=='input')throw Error('Shell-/secret-/rettighedsudvidelse kan ikke godkendes gennem denne bro. Afvis forespørgslen og tilpas opgaven.');
  if(accept){text=this.text(text);pending.resolve({answers:Object.fromEntries(review.questions.map(q=>[q.id,{answers:[text]}]))});}else pending.resolve(this.denial(pending.method));
  this.approvals.delete(reviewId);return this.record(row.id,{status:'running',pendingApproval:null,latestProgress:accept?'Dit svar er sendt til samme session.':'Rettighedsforespørgslen er afvist.'});
 }
 tool(id,p){const rt=this.runtime.get(id)||{tools:0};rt.queuedTools=(rt.queuedTools||0)+1;this.runtime.set(id,rt);const operation=(rt.toolTail||Promise.resolve()).then(()=>this.executeTool(id,p));rt.toolTail=operation.catch(()=>{});return operation.finally(async()=>{rt.queuedTools--;await this.settleStop(id);});}
 async executeTool(id,p){
  const row=this.check(id);if(row.status!=='running')throw Error('Værktøjet kræver en aktiv turn.');if(typeof p.callId!=='string'||p.callId.length>160||!p.arguments||typeof p.arguments!=='object'||Array.isArray(p.arguments))throw Error('Ugyldigt værktøjskald.');
  const args=p.arguments,requestHash=hash([p.tool,args]);const prior=(row.receipts||[]).find(r=>r.id===p.callId);
  if(prior){if(prior.hash!==requestHash||prior.status!=='completed')throw Error('Gentaget værktøj har ændret eller ukendt udfald.');return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(prior.result)}]};}
  if(row.receipts.length>=200||row.receipts.some(r=>r.status==='unknown'))throw Error('Værktøjsjournalen kræver gennemgang.');
  const rt=this.runtime.get(id)||{tools:0};rt.tools++;this.runtime.set(id,rt);
  await this.record(id,{receipts:[...row.receipts,{id:p.callId,hash:requestHash,status:'processing'}]});let result;
  try{
   const check=()=>{const current=this.check(id);if(current.status!=='running')throw Error('Turnen er ikke længere aktiv.');return current;};
   if(p.tool==='jarvis_project_files'){if(Object.keys(args).length)throw Error('Uventede parametre.');result={writable:[...CODEX_EDITABLE,`jarvis-starter/test/codex-task-${id}.test.mjs`],context:'Læs docs/next/acceptance-register.md gennem opgavens instruktioner; M12/M16 er åbne. Ingen shell, credentials eller produktion.'};}
   else if(p.tool==='jarvis_read_file'){if(Object.keys(args).some(k=>k!=='path'))throw Error('Uventede parametre.');result=await this.workspace.read(this.get(id),args.path);}
   else if(p.tool==='jarvis_write_file'){
    if(Object.keys(args).some(k=>!['path','content','expectedHash'].includes(k)))throw Error('Uventede parametre.');
    result=await this.workspace.write(this.get(id),args,check);check();const current=this.get(id);await this.record(id,{codeRevision:current.codeRevision+1,pendingApproval:null,test:null,latestProgress:'Kodeændring gemt i opgavens isolerede worktree.'});
   }else if(p.tool==='jarvis_run_tests'){
    if(Object.keys(args).length)throw Error('Vilkårlige testkommandoer er ikke tilladt.');await this.record(id,{latestProgress:'Kører beskyttede tests i netværksløs Docker.'});
    const before=this.get(id),snapshot=await this.workspace.changes(before);
    result=before.test?.status==='passed'&&before.test.contentHash===snapshot.hash?{...before.test,reused:true}:await this.workspace.test(before);check();result={...result,summary:clean(this.client.clean(result.summary))};const current=this.get(id);await this.record(id,{test:result,checks:[...current.checks,result].slice(-20),latestProgress:result.status==='passed'?'De beskyttede Docker-tests bestod.':'Docker-tests er fejlet eller isolation er utilgængelig.'});
   }else throw Error('Ukendt værktøj.');
   check();const current=this.get(id);await this.record(id,{receipts:current.receipts.map(r=>r.id===p.callId?{...r,status:'completed',result:p.tool==='jarvis_read_file'?{path:result.path,sha256:result.sha256,note:'Læs filen på ny med et nyt call-ID; rå kilde gemmes ikke i journalen.'}:result}:r)});
   return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(result)}]};
  }catch(error){const current=this.get(id),notStarted=p.tool==='jarvis_run_tests'&&error.code==='DEVELOPMENT_TEST_CONTRACT'&&error.noActionTaken===true;
   await this.record(id,{receipts:current.receipts.map(r=>r.id===p.callId?{...r,status:notStarted?'failed':['jarvis_write_file','jarvis_run_tests'].includes(p.tool)?'unknown':'failed',...(notStarted?{noActionTaken:true,reason:'missing_protected_contract'}:{})}:r),...(notStarted?{test:{status:'not_run',reason:'missing_protected_contract'},latestProgress:'Docker-testen blev afvist før start: ændringen mangler en beskyttet testkontrakt. Intet er kørt.'}:{})}).catch(()=>{});
   return {success:false,contentItems:[{type:'inputText',text:notStarted?'Docker-testen er ikke startet, fordi ændringen mangler en beskyttet testkontrakt. Intet er kørt. Ret opgaven eller bed om konkret scope-review.':'JARVIS afviste værktøjet eller kunne ikke bekræfte udfaldet. Ingen automatisk gentagelse. Se opgavens scope/status.'}]};}
  finally{rt.tools--;await this.settleStop(id);}
 }
 async changes(id,meta){const row=this.get(id);this.auth(meta,row);if(!row.worktree)return 'Arbejdsmappe er endnu ikke oprettet.';const change=await this.workspace.changes(row);return `Opgave ${row.id.slice(0,8)} · ændringer\n${change.summary}\nDiffhash: ${change.hash.slice(0,16)}\nTests: ${row.test?.status||'ikke kørt'}${row.test?.contentHash===change.hash?' på dette diff':' — intet aktuelt bestået testbevis'}.`;}
 async previewPublication(id,meta){const row=this.get(id);this.auth(meta,row,{effect:true});if(!await this.claimCommand(row,meta,'publication-preview'))return this.get(row.id);
  if(row.status!=='completed'||!this.github)throw Error('En afsluttet opgave og separat GitHub-transport kræves.');await this.workspace.initialize();const change=await this.workspace.changes(row);
  if(!change.files.length||row.test?.status!=='passed'||row.test.contentHash!==change.hash)throw Error('Det præcise aktuelle diff mangler beståede beskyttede Docker-tests.');
  const review={id:randomUUID(),kind:'publish',codeRevision:row.codeRevision,diffHash:change.hash,baseSha:row.baseSha,boot:this.boot,expires:this.now()+120000};return this.record(row.id,{pendingApproval:review,latestProgress:'Gennemgå ændringerne. Godkend kun en draft-PR på dette præcise diff; ingen merge/release/deployment.'});
 }
 async publish(id,reviewId,meta){let row=this.get(id);this.auth(meta,row,{effect:true});
  if(this.operations.has(row.id)||this.rows().some(r=>r.status==='publishing'||r.publicationOutcome==='unknown'))throw Error('En publicering er aktiv eller uafklaret.');this.operations.add(row.id);let sending=false;
  try{
   const review=row.pendingApproval;if(!review||review.kind!=='publish'||review.id!==reviewId||review.boot!==this.boot||review.codeRevision!==row.codeRevision||review.baseSha!==row.baseSha||review.expires<=this.now()||row.status!=='completed')throw Error('Draft-PR-review er ændret eller udløbet.');
   this.control.assertAllowed(row.scope);const change=await this.workspace.changes(row);if(change.hash!==review.diffHash||row.test?.contentHash!==change.hash||row.test.status!=='passed')throw Error('Kode eller testgrundlag er ændret.');
   const files=[...change.files.map(({path,content})=>({path,content})),{path:'jarvis-starter/package.json',content:JSON.stringify(change.packageJson,null,2)+'\n'},{path:'docs/agent-candidates/'+row.id+'.md',content:`# JARVIS Codex-kandidat\n\nOpgave: ${row.id}\nGrundlag: ${row.baseSha}\nDiffhash: ${change.hash}\nBeskyttede isolerede tests: passed\n\n${row.summary}\n\nIngen merge, release, deployment eller milestone-lukning. Fuld kandidat-CI og review kræves.\n`}];
   row=await this.record(row.id,{status:'publishing',pendingApproval:null,publicationOutcome:'sending',publicationHash:hash(files)});sending=true;
   this.control.assertAllowed(row.scope);const result=await this.github.publishCodex({id:row.id,baseSha:row.baseSha,files,title:'JARVIS Codex: '+row.summary.slice(0,130)});
   if(!/^[a-f0-9]{40}$/.test(result.sha)||!/^https:\/\/github\.com\/christopherpedersendk-web\/jarvis-personal-assistant\/pull\/\d+$/.test(result.url))throw Error('Ubekræftet GitHub-resultat.');
   await this.record(row.id,{status:'draft_pr',publicationOutcome:'confirmed',candidateSha:result.sha,prUrl:result.url,prNumber:result.number,latestProgress:'Draft-PR er oprettet. Ingen automatisk merge, release eller deployment.'});await this.announce(row.id);return this.get(row.id);
  }catch(e){if(sending)await this.record(row.id,{status:'unknown',publicationOutcome:'unknown',latestProgress:'Publiceringsudfaldet er ukendt. Inspicér branch/PR; der genforsøges ikke.'});throw e;}
  finally{this.operations.delete(row.id);}
 }
 async refresh(id,meta){let row=this.get(id);this.auth(meta,row);if(!row.threadId||!['unknown','stop_requested'].includes(row.status)||row.publicationOutcome==='unknown')return row;
  await this.initialize();const result=await this.client.read(row.threadId);const turn=result.thread?.turns?.find(t=>t.id===row.turnId);
  if(turn&&['completed','failed','interrupted'].includes(turn.status)){
   if(row.status==='stop_requested'&&turn.status!=='interrupted')return this.record(row.id,{status:turn.status,terminalTurnStatus:turn.status,stopOutcome:'finished_before_interrupt',latestProgress:'Turnens slutstatus er '+turn.status+'; den rapporteres ikke som stoppet.'});
   if(turn.status==='interrupted'&&(this.runtime.get(row.id)?.tools||0)>0)return row;
   return this.record(row.id,{status:turn.status==='interrupted'?'stopped':turn.status,pendingApproval:null,latestProgress:'Slutstatus er genfundet fra den gemte Codex-session. Ingen kodehandling er genstartet.'});
  }return row;
 }
 format(row){const review=row.pendingApproval;return `Opgave ${row.id.slice(0,8)} · ${clean(row.summary)}\nStatus: ${DEVELOPMENT_LABELS[row.status]||'ukendt'}.\n${clean(row.latestProgress||'Afventer første hændelse.')}${row.codexSummary?'\nCodex: '+clean(row.codexSummary):''}${row.test?'\nBeskyttede Docker-tests: '+({passed:'bestået',failed:'fejlet',unavailable:'isolation utilgængelig',not_run:'ikke startet',unknown:'ukendt udfald',skipped:'ikke kørt'}[row.test.status]||'ikke verificeret')+'.':''}${review?review.kind==='publish'?`\nBase: ${review.baseSha} · koderevision ${review.codeRevision} · diff ${review.diffHash.slice(0,16)}.\nGennemgå med “Vis ændringer for opgave ${row.id.slice(0,8)}”. Godkend inden 2 minutter: Godkend udvikling ${row.id.slice(0,8)} ${review.id}`:review.kind==='input'?`\n${review.questions.map(q=>q.text).join('\n')}\nSvar opgave ${row.id.slice(0,8)}: dit svar`:`\nKræver operatørreview uden for broen. Afvis udvikling ${row.id.slice(0,8)} ${review.id}`:''}${row.prUrl?'\n'+row.prUrl:''}`;}
 async status(id,meta){this.auth(meta);if(id)return this.format(await this.refresh(id,meta));const rows=this.rows().filter(r=>r.ownerId===meta.ownerId&&r.channelId===meta.channelId&&r.guildId===(meta.guildId||''));if(!rows.length)return 'Ingen Codex-udviklingsopgaver i denne kanal.';if(rows.length===1)return this.format(await this.refresh(rows[0].id,meta));return rows.slice(-10).map(r=>`${r.id.slice(0,8)} · ${clean(r.summary).slice(0,90)} · ${DEVELOPMENT_LABELS[r.status]||'ukendt'}`).join('\n')+'\nAngiv opgave-ID ved ændringer.';}
 async announce(id){let row=this.get(id);if(row.configurationBasis!==basis(this.config()))return;const text=this.format(row),fingerprint=hash(text);if(row.lastNotificationHash===fingerprint)return;
  await this.record(id,{lastNotificationHash:fingerprint});try{await this.notify(row,text);}catch{await this.record(id,{notificationOutcome:'unknown'}).catch(()=>{});}
 }
}

export function developmentCommand(message){
 const text=String(message||'').trim();let m;
 if(m=/^Start udviklingsopgave:\s*([\s\S]+)$/iu.exec(text))return {action:'start',text:m[1]};
 if(/^Status på udviklingsopgaven[.!]?$/iu.test(text))return {action:'status'};
 if(m=/^(?:Status (?:på )?(?:udviklings)?opgave|Stop opgave|Vis ændringer for opgave|Opret draft-PR for opgave) ([a-f0-9-]{8,36})[.!]?$/iu.exec(text))return {action:/^Stop/i.test(text)?'stop':/^Vis/i.test(text)?'changes':/^Opret/i.test(text)?'preview':'status',id:m[1]};
 if(m=/^(Fortsæt|Svar) opgave ([a-f0-9-]{8,36}):\s*([\s\S]+)$/iu.exec(text))return {action:m[1].toLowerCase()==='svar'?'answer':'follow',id:m[2],text:m[3]};
 if(m=/^(Godkend|Afvis) udvikling ([a-f0-9-]{8,36}) ([a-f0-9-]{36})[.!]?$/iu.exec(text))return {action:'decision',id:m[2],review:m[3],accept:m[1].toLowerCase()==='godkend'};
 return null;
}
export async function discordDevelopmentReply(bridge,message,meta){const cmd=developmentCommand(message);if(!cmd)return null;
 try{
  if(!bridge)return 'Codex-broen er ikke aktiveret. Koden skal installeres og den separate udviklingsprofil klargøres; produktionsbotten er ikke ændret.';
  if(cmd.action==='status')return await bridge.status(cmd.id,meta);
  if(cmd.action==='changes')return await bridge.changes(cmd.id,meta);
  let row;if(cmd.action==='start')row=await bridge.start(cmd.text,meta);else if(cmd.action==='follow')row=await bridge.follow(cmd.id,cmd.text,meta);else if(cmd.action==='stop')row=await bridge.stop(cmd.id,meta);else if(cmd.action==='preview')row=await bridge.previewPublication(cmd.id,meta);else if(cmd.action==='decision')row=await bridge.decision(cmd.id,cmd.review,cmd.accept,meta);else if(cmd.action==='answer'){const r=bridge.get(cmd.id);row=await bridge.decision(cmd.id,r.pendingApproval?.id,true,meta,cmd.text);}return bridge.format(row);
 }catch(error){return clean(bridge?.client.clean(error.message)||error.message);}
}
