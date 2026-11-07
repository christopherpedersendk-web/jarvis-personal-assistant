// Explicit acceptance only, never starts a Discord gateway or reads bot data.
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {DurableState} from '../durable-state.mjs';import {ProviderControl} from '../provider-control.mjs';import {BoundedJobQueue} from '../bounded-queue.mjs';
import {CodexAppServer,prepareCodexHome} from '../codex-app-server.mjs';import {CodexWorktrees} from '../codex-worktree.mjs';import {CodexBridge,discordDevelopmentReply} from '../codex-bridge.mjs';import {developmentGithubCli} from '../self-development-github-cli.mjs';
const args=process.argv.slice(2);if(args[0]!=='--live')throw Error('Explicit --live <repository> <base-ref> <codex-binary> <codex-auth-file> [--publish-root <previous-root>] required.');
const [repository,baseRef,binary,authSource]=args.slice(1,5);if(![repository,baseRef,binary,authSource].every(Boolean))throw Error('Explicit development paths required.');
const publishIndex=args.indexOf('--publish-root'),root=publishIndex>=0?args[publishIndex+1]:await mkdtemp('/tmp/jarvis-codex-live-');
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));const reportPath=join(root,'report.json');let initial={};try{initial=JSON.parse(await readFile(join(root,'jobs.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const report=publishIndex>=0?JSON.parse(await readFile(reportPath,'utf8')):{at:new Date().toISOString(),root,codeHashes:{},cases:[],scope:'real installed Codex and Docker; direct Danish Discord route with synthetic owner metadata, no actual bot connection'};
const manifest=publishIndex>=0?(report.publicationCodeHashes={}):report.codeHashes;
for(const f of ['codex-app-server.mjs','codex-worktree.mjs','codex-bridge.mjs','self-development-github.mjs','self-development-github-cli.mjs'])manifest[f]=createHash('sha256').update(await readFile(join(sourceRoot,'jarvis-starter',f))).digest('hex');
const config={enabled:true,token:'synthetic-no-bot-connection',userId:'11111111111111111',guildId:'22222222222222222'};let counter=(initial.selfDevelopmentJobs||[]).flatMap(r=>(r.commands||[]).map(c=>BigInt(c.id))).reduce((a,b)=>a>b?a:b,44444444444444444n)+100n;
const meta=()=>({ownerId:config.userId,guildId:config.guildId,channelId:'33333333333333333',messageId:String(++counter)});
const home=join(root,'codex-home');await prepareCodexHome({directory:home,authSource:resolve(authSource)});
let bridge,store;const make=async(initial)=>{
 store=new DurableState({initial,write:s=>writeFile(join(root,'jobs.json'),s,{mode:0o600})});await store.initialize();const save=()=>store.save(),transact=(...a)=>store.transact(...a),control=new ProviderControl({state:store.state,save,transact});
 const workspace=new CodexWorktrees({repository:resolve(repository),root:join(root,'worktrees'),baseRef,sourceRoot});const client=new CodexAppServer({binary:resolve(binary),home,requestTimeoutMs:30000});
 // Diagnostic metadata only. Never print model prompts, source, auth or raw logs.
 const original=client.message.bind(client);client.message=message=>{if(message.error)report.lastProtocolError={code:message.error.code,message:client.clean(message.error.message)};original(message);};
 bridge=new CodexBridge({state:store.state,save,transact,control,config:()=>config,workspace,client,queue:new BoundedJobQueue(),github:developmentGithubCli({env:{...process.env,JARVIS_CODEX_GITHUB_CLI:'yes'}}),enabled:true,notify:async()=>{}});await bridge.recover();return bridge;
};
const until=async(predicate,timeout=180000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Acceptance deadline; inspect private job journal, no automatic retry.');};
let id;
try{
 await make(initial);
 if(publishIndex>=0){
  const row=bridge.rows()[0];if(!row||row.status!=='completed')throw Error('Only a completed prior acceptance job may publish.');id=row.id;
  const preview=await bridge.previewPublication(id,meta());const result=await bridge.decision(id,preview.pendingApproval.id,true,meta());report.pr={url:result.prUrl,number:result.prNumber,sha:result.candidateSha};report.cases.push('actual typed M18 GitHub draft publication with durable one-use exact-diff review');
 }else{
  const m=meta();await discordDevelopmentReply(bridge,'Start udviklingsopgave: Ret kun jarvis-starter/test/fixtures/codex-bridge-probe.mjs, så compactLabel samler interne whitespace-tegn til ét mellemrum, trimmer og bevarer danske tegn og priser. Brug jarvis_read_file, jarvis_write_file og de beskyttede Docker-tests. Ingen andre filer og ingen PR.',m);
  id=bridge.rows()[0]?.id;if(!id)throw Error('No durable job created.');const firstThread=()=>bridge.get(id).threadId;
  await until(()=>['completed','failed','unknown'].includes(bridge.get(id).status));let row=bridge.get(id);if(row.status!=='completed'||row.test?.status!=='passed')throw Error('First Codex code/test turn did not pass.');
  report.cases.push('actual initialize + thread/start + model tool calls + code write in isolated Git worktree + protected Docker tests');report.threadId=row.threadId;report.sessionId=row.sessionId;report.baseSha=row.baseSha;
  const before=bridge.rows().length;await bridge.start(row.request,m);if(bridge.rows().length!==before)throw Error('Duplicate start created a job.');report.cases.push('repeated Discord message cannot start a second session');
  await bridge.follow(id,`Udvid compactLabel til at give tom streng ved null og undefined. Tilføj en fokuseret testfil jarvis-starter/test/codex-task-${id}.test.mjs, der kontrollerer begge værdier. Bevar de eksisterende beskyttede tests og kør Docker-testværktøjet.`,meta());
  await until(()=>['completed','failed','unknown'].includes(bridge.get(id).status));row=bridge.get(id);if(row.status!=='completed'||row.test?.status!=='passed'||row.threadId!==report.threadId)throw Error('Same-session follow-up did not pass.');report.cases.push('actual follow-up in same Codex thread modifies behavior and passes protected/generated tests');
  await bridge.follow(id,'Læs kildefilerne for M12 og udarbejd en detaljeret vurdering. Foretag ingen ændringer og genkør ikke uændrede tests.',meta());await until(()=>bridge.get(id).status==='running'&&bridge.get(id).turnId,30000);
  const stopped=await bridge.stop(id,meta());report.stopInitially=stopped.status;await until(()=>['stopped','completed','failed'].includes(bridge.get(id).status),45000);if(bridge.get(id).status!=='stopped')throw Error('Codex interruption was not confirmed.');report.cases.push('actual turn/interrupt acknowledged, then interrupted completion confirms stopped');
  const persisted=JSON.parse(await readFile(join(root,'jobs.json'),'utf8'));await bridge.shutdown();await make(persisted);if(bridge.get(id).status!=='stopped'||bridge.get(id).threadId!==report.threadId)throw Error('Restart lost stop/thread binding.');report.cases.push('new bridge/process lifecycle reloads durable stopped job without replay');
  await bridge.follow(id,'Afslut opgaven med en kort dansk oversigt over de allerede udførte ændringer. Ingen nye ændringer, ingen PR og ingen genkørsel af uændrede tests.',meta());await until(()=>['completed','failed','unknown'].includes(bridge.get(id).status));row=bridge.get(id);if(row.status!=='completed'||row.threadId!==report.threadId)throw Error('Persisted thread resume failed.');report.cases.push('actual thread/resume across App Server restart keeps original session and unchanged test evidence');
  report.final={jobId:id,status:row.status,codeRevision:row.codeRevision,test:row.test,files:(await bridge.workspace.changes(row)).files.map(f=>({path:f.path,sha256:f.sha256}))};
 }
 report.status='passed';
}catch(error){report.status='failed_or_unknown';report.error=bridge?.client.clean(error.message)||error.message;process.exitCode=1;}
finally{if(bridge)await bridge.shutdown().catch(()=>{});await writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));}
