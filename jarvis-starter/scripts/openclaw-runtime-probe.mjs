import {startRuntime} from '../openclaw-runtime/run.mjs';
import {createOpenJarvis} from '../openjarvis.mjs';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const args=process.argv.slice(2),live=args.includes('--live');
const at=args.indexOf('--runtime-root'),out=args.indexOf('--output');
const token=randomBytes(32).toString('hex');
const report={at:new Date().toISOString(),runtime:'2026.11.1',policy:'not_run',research:'not_run',live,sourceCount:0};
let runtime;
try {
 runtime=await startRuntime({networkEnv:args.includes('--use-environment-proxy')?{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY}:{},runtimeRoot:at>=0?resolve(args[at+1]):undefined,token,port:0,upstreamPort:Number(process.env.OPENJARVIS_TEST_PORT||18791)});
 report.policyStatuses=await runtime.verifyPolicy();
 report.policy=Object.entries(report.policyStatuses).every(([key,value])=>key==='wrongCredential'?value===401:[403,404].includes(value))?'passed':'failed';
 if(live){
  const bridge=createOpenJarvis({env:{OPENJARVIS_ENABLED:'yes',OPENJARVIS_GATEWAY_MODE:'restricted-v1',OPENJARVIS_GATEWAY_URL:runtime.url,OPENJARVIS_GATEWAY_TOKEN:token},control:{externalSearch:fn=>fn(new AbortController().signal)}});
  try{const result=await bridge.search('OpenClaw official documentation');report.sourceCount=result.sources.length;report.research=result.sources.length?'passed':'incomplete';}
  catch(error){report.research='failed';report.errorCode=error.code||'UNKNOWN';}
 }
}catch(error){report.policy='failed';report.error=error.message;}
finally{await runtime?.stop();}
if(out>=0)await writeFile(resolve(args[out+1]),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report,null,2));
if(report.policy!=='passed'||live&&report.research!=='passed')process.exitCode=1;
