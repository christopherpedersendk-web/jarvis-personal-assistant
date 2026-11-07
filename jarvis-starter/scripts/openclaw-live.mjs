// Explicit public research only: no bot, operator credential or production writes.
import assert from 'node:assert/strict';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOpenJarvis,openJarvisSources} from '../openjarvis.mjs';
import {DurableState} from '../durable-state.mjs';
import {ProviderControl} from '../provider-control.mjs';
const args=process.argv.slice(2),argument=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
try{
 if(!args.includes('--live')||!argument('--output'))throw Error('Explicit live/output required');
 let config=process.env;
 if(argument('--config-file')){const file=argument('--config-file'),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private regular configuration required');config=parseEnv(await readFile(file,'utf8'));}
 const env=Object.fromEntries(['OPENJARVIS_ENABLED','OPENJARVIS_GATEWAY_MODE','OPENJARVIS_GATEWAY_URL','OPENJARVIS_GATEWAY_TOKEN'].map(k=>[k,config[k]]));
 assert.equal(env.OPENJARVIS_ENABLED,'yes');assert.equal(env.OPENJARVIS_GATEWAY_MODE,'restricted-v1');
 const base=new URL(env.OPENJARVIS_GATEWAY_URL);assert.equal(base.protocol,'http:');assert.equal(base.hostname,'127.0.0.1');assert.equal(base.pathname,'/');assert(!base.username&&!base.password&&!base.search&&!base.hash);
 const token=env.OPENJARVIS_GATEWAY_TOKEN;assert(token?.length>=32);
 // Reserve evidence output before any external work; never overwrite an old run.
 const output=argument('--output');await writeFile(output,JSON.stringify({status:'started',at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 const request=async(path,{body,auth=token}={})=>{const r=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});const text=await r.text();assert(Buffer.byteLength(text)<=100000);return {status:r.status,data:JSON.parse(text)};};
 const health=await request('/health');assert.equal(health.status,200);assert.equal(health.data.contractVersion,1);assert.equal(health.data.runtimeVersion,'2026.11.1');assert.deepEqual(health.data.tools,['web_search']);assert.equal(health.data.status,'ready');
 const direct=await request('/tools/invoke',{body:{tool:'web_search',args:{query:'OpenClaw browser SSRF isolation official documentation',count:5}}});assert.equal(direct.status,200);assert.equal(direct.data.ok,true);const sources=openJarvisSources(direct.data,[token]);assert(sources.length);
 const rejected=[];for(const tool of ['exec','browser','web_fetch','cron','sessions_spawn']){const r=await request('/tools/invoke',{body:{tool,args:{query:'public probe',count:5}}});assert.equal(r.status,403);rejected.push({tool,status:r.status});}
 assert.equal((await request('/health',{auth:'synthetic-invalid-credential'})).status,401);
 const store=new DurableState({initial:{},write:async()=>{}});await store.initialize();const control=new ProviderControl({state:store.state,save:()=>store.save(),transact:(...a)=>store.transact(...a)});
 const adapter=createOpenJarvis({env,control});const result=await adapter.search('OpenClaw web search tool documentation');assert.equal(result.provider,'openclaw');assert.equal(result.status,'completed');assert(result.sources.length);
 const sourceHashes={};for(const path of ['openjarvis.mjs','openjarvis-transport.mjs','openclaw-runtime/gateway.mjs','scripts/openclaw-live.mjs'])sourceHashes[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{PATH:process.env.PATH},encoding:'utf8'}).trim();
 const report={at:new Date().toISOString(),status:'passed',sourceCommit,sourceHashes,runtime:health.data.runtimeVersion,contractVersion:1,direct:{status:direct.status,sources},adapter:{status:result.status,sources:result.sources,usage:result.usage},rejected,invalidCredentialStatus:401,scope:'Actual existing restricted gateway and public searches, empty isolated adapter state; no new bot, operator credential or production write. Remote provider closure not measured.'};
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:report.status,sourceCommit,runtime:report.runtime,directSources:sources.length,adapterSources:result.sources.length,forbiddenToolsRejected:rejected.length,output}));
}catch{console.error('OpenClaw-liveprøven kunne ikke bekræftes. Ingen automatisk gentagelse. Kontrollér privat konfiguration og eventuel startet evidensfil.');process.exitCode=1;}
