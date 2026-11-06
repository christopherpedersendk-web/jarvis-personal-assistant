import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {researchGateway} from './gateway.mjs';
import {gatewayConfig} from './config.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export async function startRuntime({runtimeRoot=root,port=18790,upstreamPort=18791,token,networkEnv={}}) {
  const pin=JSON.parse(await readFile(join(root,'pin.json'),'utf8'));
  const packageRoot=resolve(runtimeRoot,'node_modules/openclaw');
  const pkg=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
  const pluginPath=resolve(runtimeRoot,'node_modules/@openclaw/parallel-plugin');
  const plugin=JSON.parse(await readFile(join(pluginPath,'package.json'),'utf8'));
  if(pkg.version!==pin.version||plugin.version!==pin.version)throw new Error('Pinned runtime/plugin version mismatch.');
  if(!Number.isInteger(port)||!Number.isInteger(upstreamPort)||port<0||upstreamPort<1||port>65535||upstreamPort>65535||port===upstreamPort)throw new Error('Invalid ports');
  if(typeof token!=='string'||token.length<32)throw new Error('Configure a separate research token of at least 32 characters.');
  const dir=await mkdtemp(join(tmpdir(),'openjarvis-research-'));
  await mkdir(join(dir,'workspace'),{mode:0o700});
  const operatorToken=randomBytes(32).toString('hex');
  await writeFile(join(dir,'openclaw.json'),JSON.stringify(gatewayConfig({port:upstreamPort,token:operatorToken,workspace:join(dir,'workspace'),pluginPath})),{mode:0o600});
  // Explicit environment: never inherit owner credentials, preload hooks or config.
  const env={PATH:process.env.PATH,HOME:dir,TMPDIR:dir,OPENCLAW_STATE_DIR:dir,OPENCLAW_CONFIG_PATH:join(dir,'openclaw.json'),
    OPENCLAW_NO_AUTO_UPDATE:'1',OPENCLAW_DISABLE_BONJOUR:'1'};
  // Explicit test network plumbing only; no arbitrary environment inheritance.
  for(const key of ['HTTP_PROXY','HTTPS_PROXY'])if(networkEnv[key])env[key]=networkEnv[key];
  env.NO_PROXY='127.0.0.1,localhost,::1';
  let gateway,child,closed;
  const stop=async()=>{
    gateway?.stop();
    if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([closed,delay(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await closed;}}
    await rm(dir,{recursive:true,force:true});
  };
  try {
    const cli=join(packageRoot,'openclaw.mjs');
    const validate=spawn(process.execPath,[cli,'config','validate','--json'],{cwd:dir,env,stdio:'ignore',timeout:60000});
    const code=await new Promise((res,rej)=>{validate.once('error',rej);validate.once('close',res);});
    if(code!==0)throw new Error('Pinned OpenClaw rejected the isolated configuration.');
    child=spawn(process.execPath,[cli,'gateway','run'],{cwd:dir,env,stdio:'ignore'});
    closed=new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);});
    const upstreamUrl=`http://127.0.0.1:${upstreamPort}`;
    let ready=false;
    for(let i=0;i<120;i++){
      if(child.exitCode!==null)break;
      try {if((await fetch(upstreamUrl+'/readyz',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
      await delay(250);
    }
    if(!ready)throw new Error('Isolated OpenClaw did not become ready.');
    const verifyPolicy=async()=>{
      const statuses={};
      for(const tool of ['exec','browser','web_fetch','cron','sessions_spawn']) {
        const response=await fetch(upstreamUrl+'/tools/invoke',{method:'POST',headers:{Authorization:`Bearer ${operatorToken}`,'Content-Type':'application/json'},body:JSON.stringify({tool,args:{}}),signal:AbortSignal.timeout(30000)});
        statuses[tool]=response.status;await response.body?.cancel();
      }
      const bad=await fetch(upstreamUrl+'/tools/invoke',{method:'POST',headers:{Authorization:'Bearer invalid-credential','Content-Type':'application/json'},body:JSON.stringify({tool:'web_search',args:{query:'test'}}),signal:AbortSignal.timeout(30000)});
      statuses.wrongCredential=bad.status;await bad.body?.cancel();return statuses;
    };
    const policy=await verifyPolicy();
    if(!Object.entries(policy).every(([key,value])=>key==='wrongCredential'?value===401:[403,404].includes(value)))
      throw new Error('OpenClaw tool policy rejected before exposure.');
    gateway=researchGateway({token,upstreamToken:operatorToken,upstreamUrl,runtimeVersion:pkg.version});
    await new Promise((res,rej)=>{gateway.server.once('error',rej);gateway.server.listen(port,'127.0.0.1',res);});
    child.once('exit',()=>gateway.stop());
    return {stop, verifyPolicy,url:`http://127.0.0.1:${gateway.server.address().port}`,version:pkg.version};
  }catch(error){await stop();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const runtime=await startRuntime({token:process.env.OPENJARVIS_GATEWAY_TOKEN,port:Number(process.env.OPENJARVIS_RESEARCH_PORT||18790),upstreamPort:Number(process.env.OPENJARVIS_UPSTREAM_PORT||18791)});
    console.log(`Restricted OpenClaw ${runtime.version} ready on ${runtime.url}. No bot or scheduler.`);
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await runtime.stop();process.exit(0);};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }catch{console.error('Isolated OpenClaw startup failed. Verify pinned install, ports and separate credential locally.');process.exitCode=1;}
}
