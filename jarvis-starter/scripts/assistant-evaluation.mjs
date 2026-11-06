// Real-language evaluation against the real HTTP conversation and local domain
// handlers. Each scenario gets an empty disposable installation, no owner data.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {syntheticServerEnv} from '../test/helpers/synthetic-env.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
export function gradeEvaluation(report) {
 const results=report.results||[],reviewed=results.filter(x=>typeof x.passed==='boolean'&&x.reviewedBy&&x.reviewNote);
 const passed=reviewed.filter(x=>x.passed).length,critical=results.filter(x=>x.critical);
 const criticalPassed=critical.length>0&&critical.every(x=>reviewed.includes(x)&&x.passed);
 return {reviewed:reviewed.length,passed,total:results.length,criticalPassed,
  accepted:report.live===true&&results.length===30&&new Set(results.map(x=>x.id)).size===30&&reviewed.length===30&&passed>=27&&criticalPassed};
}
export async function evaluate({live=false,model=process.env.OPENAI_TEXT_MODEL,apiKey=process.env.OPENAI_API_KEY,output}={}) {
 const dataset=await readFile(new URL('./fixtures/danish-assistant-tasks.json',import.meta.url)),tasks=JSON.parse(dataset);
 const report={at:new Date().toISOString(),live,model:model||null,datasetSha256:createHash('sha256').update(dataset).digest('hex'),status:'not_run',
  scope:'Real model + isolated front-page HTTP conversation. Not microphone/Discord gateway acceptance. Human grading of final text and actual state required.',results:[]};
 if(!live){report.plannedTasks=tasks.length;return report;}
 if(!output||typeof model!=='string'||!model||!apiKey?.startsWith('sk-')||apiKey.includes('synthetic'))throw new Error('Angiv output, model og API-adgang via lokalt miljø.');
 // Exclusive output creation protects earlier evidence; no API keys are saved.
 await writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 const checkpoint=()=>writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
 for(const task of tasks){
  const dir=await mkdtemp(join(tmpdir(),'jarvis-language-eval-')),token=randomBytes(32).toString('hex');let child,exit;
  const result={...task,answers:[],passed:null,reviewedBy:null,reviewNote:null};report.results.push(result);
  try{
   const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
   const env={...syntheticServerEnv({dataDir:dir,accessToken:token,port}),OPENAI_API_KEY:apiKey,OPENAI_TEXT_MODEL:model,
    JARVIS_API_CALLS_PER_DAY:'16',JARVIS_API_OUTPUT_TOKENS_PER_DAY:'40000',JARVIS_HOSTED_TOOL_CALLS_PER_DAY:'6'};
   child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'});exit=new Promise(r=>child.once('close',r));
   const base=`http://127.0.0.1:${port}`;
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/ready',{signal:AbortSignal.timeout(250)})).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(50);}
   if(!ready)throw new Error('Fixture startup failed');
   const api=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});return {status:response.status,body:await response.json()};};
   for(const message of task.turns)result.answers.push(await api('/api/message',{message}));
   result.actions=(await api('/api/actions')).body;result.finalState=(await api('/api/state')).body;result.usage=(await api('/api/assistant/control')).body;
   result.status='awaiting_human_review';
  }catch{result.status='execution_failed';result.error='Scenarioet kunne ikke gennemføres. Ingen automatisk gentagelse.';}
  finally{if(child&&child.exitCode===null){child.kill();await Promise.race([exit,delay(15000)]);if(child.exitCode===null){child.kill('SIGKILL');await exit;}}await rm(dir,{recursive:true,force:true});await checkpoint();}
 }
 report.status='awaiting_human_review';report.grade=gradeEvaluation(report);await checkpoint();return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2),grade=args.indexOf('--grade');
  if(grade>=0){const report=JSON.parse(await readFile(resolve(args[grade+1]))),result=gradeEvaluation(report);console.log(JSON.stringify(result,null,2));if(!result.accepted)process.exitCode=2;}
  else{const i=args.indexOf('--output'),report=await evaluate({live:args.includes('--live'),output:i>=0?resolve(args[i+1]):undefined});console.log(JSON.stringify({status:report.status,live:report.live,tasks:report.plannedTasks||report.results.length,grade:report.grade},null,2));}
 }catch{console.error('Evalueringen kunne ikke gennemføres. Kontrollér lokalt modelvalg, API-adgang og en ny outputsti.');process.exitCode=1;}
}
