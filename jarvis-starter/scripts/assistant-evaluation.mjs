// Real-language evaluation against the real HTTP conversation and local domain
// handlers. Each scenario gets an empty disposable installation, no owner data.
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {syntheticServerEnv} from '../test/helpers/synthetic-env.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dataset=await readFile(new URL('./fixtures/danish-assistant-tasks.json',import.meta.url));
const tasks=JSON.parse(dataset),datasetSha256=createHash('sha256').update(dataset).digest('hex');
async function coreSourceFingerprint() {
 const hash=createHash('sha256');
 const files=(await readdir(root)).filter(name=>name.endsWith('.mjs')).sort();
 files.push('package.json','scripts/assistant-evaluation.mjs','scripts/fixtures/danish-assistant-tasks.json');
 for(const name of files)hash.update(name+'\0').update(await readFile(join(root,name)));
 return hash.digest('hex');
}
export function gradeEvaluation(report) {
 const results=report.results||[],reviewed=results.filter(x=>typeof x.passed==='boolean'&&x.reviewedBy&&x.reviewNote);
 const executionComplete=result=>{
  const task=tasks.find(t=>t.id===result.id);
  return task&&JSON.stringify(task.turns)===JSON.stringify(result.turns)&&result.status==='awaiting_human_review'&&
   Array.isArray(result.answers)&&result.answers.length===task.turns.length&&result.answers.every(a=>a.status===200&&typeof a.body?.answer==='string'&&a.body.answer.trim());
 };
 const passed=reviewed.filter(x=>x.passed&&executionComplete(x)).length;
 const criticalPassed=tasks.filter(x=>x.critical).every(task=>reviewed.some(x=>x.id===task.id&&x.passed&&executionComplete(x)));
 const provenance=report.datasetSha256===datasetSha256&&typeof report.model==='string'&&Boolean(report.model.trim())&&/^[a-f0-9]{64}$/.test(report.coreSourceSha256||'');
 return {reviewed:reviewed.length,passed,total:results.length,criticalPassed,
  accepted:report.live===true&&provenance&&results.length===30&&new Set(results.map(x=>x.id)).size===30&&results.every(x=>tasks.some(t=>t.id===x.id))&&reviewed.length===30&&passed>=27&&criticalPassed};
}
export async function evaluate({live=false,model=process.env.OPENAI_TEXT_MODEL,apiKey=process.env.OPENAI_API_KEY,output,backend='baseline',gatewayEnv=process.env}={}) {
 if(!['baseline','hybrid'].includes(backend))throw new Error('Unknown evaluation backend');
 const report={backend,at:new Date().toISOString(),live,model:model||null,datasetSha256,coreSourceSha256:await coreSourceFingerprint(),nodeVersion:process.version,status:'not_run',
  scope:'Real model + isolated front-page HTTP conversation. Not microphone/Discord gateway acceptance. Human grading of final text and actual state required.',results:[]};
 if(!live){report.plannedTasks=tasks.length;return report;}
 if(!output||typeof model!=='string'||!model||!apiKey?.startsWith('sk-')||apiKey.includes('synthetic'))throw new Error('Angiv output, model og API-adgang via lokalt miljø.');
 // Exclusive output creation protects earlier evidence; no API keys are saved.
 await writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 if(backend==='hybrid' && (gatewayEnv.OPENJARVIS_GATEWAY_MODE!=='restricted-v1'||!gatewayEnv.OPENJARVIS_GATEWAY_TOKEN||!gatewayEnv.OPENJARVIS_GATEWAY_URL))throw new Error('Hybrid evaluation requires the restricted test gateway.');
 const checkpoint=()=>writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
 for(const task of tasks){
  const dir=await mkdtemp(join(tmpdir(),'jarvis-language-eval-')),token=randomBytes(32).toString('hex');let child,exit;
  const started=Date.now();
  const result={...task,answers:[],passed:null,reviewedBy:null,reviewNote:null};report.results.push(result);
  try{
   const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
   const env={...syntheticServerEnv({dataDir:dir,accessToken:token,port}),OPENAI_API_KEY:apiKey,OPENAI_TEXT_MODEL:model,
    JARVIS_API_CALLS_PER_DAY:'16',JARVIS_API_OUTPUT_TOKENS_PER_DAY:'40000',JARVIS_HOSTED_TOOL_CALLS_PER_DAY:'6'};
   if(backend==='hybrid')Object.assign(env,{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_MODE:'restricted-v1',OPENJARVIS_GATEWAY_URL:gatewayEnv.OPENJARVIS_GATEWAY_URL,OPENJARVIS_GATEWAY_TOKEN:gatewayEnv.OPENJARVIS_GATEWAY_TOKEN});
   child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'});exit=new Promise(r=>child.once('close',r));
   const base=`http://127.0.0.1:${port}`;
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/ready',{signal:AbortSignal.timeout(250)})).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(50);}
   if(!ready)throw new Error('Fixture startup failed');
   const api=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});return {status:response.status,body:await response.json()};};
   for(const message of task.turns)result.answers.push(await api('/api/message',{message}));
   result.actions=(await api('/api/actions')).body;result.finalState=(await api('/api/state')).body;result.usage=(await api('/api/assistant/control')).body;
   result.status='awaiting_human_review';
  }catch{result.status='execution_failed';result.error='Scenarioet kunne ikke gennemføres. Ingen automatisk gentagelse.';}
  finally{result.durationMs=Date.now()-started;if(child&&child.exitCode===null){child.kill();await Promise.race([exit,delay(15000)]);if(child.exitCode===null){child.kill('SIGKILL');await exit;}}await rm(dir,{recursive:true,force:true});await checkpoint();}
 }
 report.status='awaiting_human_review';report.grade=gradeEvaluation(report);await checkpoint();return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2),grade=args.indexOf('--grade');
  if(grade>=0){const report=JSON.parse(await readFile(resolve(args[grade+1]))),result=gradeEvaluation(report);console.log(JSON.stringify(result,null,2));if(!result.accepted)process.exitCode=2;}
  else{const i=args.indexOf('--output'),report=await evaluate({live:args.includes('--live'),backend:args.includes('--hybrid')?'hybrid':'baseline',output:i>=0?resolve(args[i+1]):undefined});console.log(JSON.stringify({status:report.status,live:report.live,tasks:report.plannedTasks||report.results.length,grade:report.grade},null,2));}
 }catch{console.error('Evalueringen kunne ikke gennemføres. Kontrollér lokalt modelvalg, API-adgang og en ny outputsti.');process.exitCode=1;}
}
