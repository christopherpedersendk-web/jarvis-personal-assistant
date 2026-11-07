import {StringDecoder} from 'node:string_decoder';
import {spawn} from 'node:child_process';
import {mkdir,open,readFile,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {redactSecrets} from './privacy.mjs';

export const CODEX_VERSION='0.167.0';
// The harness has NO native execution tools. All generated-code execution goes
// through JARVIS' existing networkless Docker test runner via dynamic tools.
export const CODEX_CONFIG=`approval_policy = "on-request"
default_permissions = "jarvis_bridge"
web_search = "disabled"
[features]
shell_tool = false
unified_exec = false
code_mode = false
code_mode_host = true
apps = false
plugins = false
browser_use = false
computer_use = false
skill_search = false
skill_mcp_dependency_install = false
shell_snapshot = false
[permissions.jarvis_bridge.filesystem]
":minimal" = "read"
":workspace_roots" = "read"
[permissions.jarvis_bridge.network]
enabled = false
[shell_environment_policy]
inherit = "none"
[analytics]
enabled = false
`;

export async function prepareCodexHome({directory,authSource}){
 if(!isAbsolute(directory)||!isAbsolute(authSource))throw Error('Codex kræver eksplicitte private stier.');
 await mkdir(directory,{recursive:true,mode:0o700});
 const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Codex HOME skal være en privat 0700-mappe.');
 // Only the existing Codex login is provisioned, never the owner's config,
 // plugins, shell environment, GitHub login or JARVIS private settings.
 const source=await open(authSource,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await source.stat();if(!stat.isFile()||(stat.mode&0o077)||stat.size>64000)throw Error('Codex-loginfilen er ikke privat.');
  const auth=await source.readFile();JSON.parse(auth.toString());
  try{const dest=await open(join(directory,'auth.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await dest.writeFile(auth);await dest.sync();}finally{await dest.close();}}catch(e){if(e.code!=='EEXIST')throw e;const existing=await lstat(join(directory,'auth.json'));if(!existing.isFile()||existing.isSymbolicLink()||(existing.mode&0o077))throw Error('Den eksisterende Codex-loginfil er usikker.');}
 }finally{await source.close();}
 const config=await open(join(directory,'config.toml'),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await config.writeFile(CODEX_CONFIG);await config.sync();}finally{await config.close();}
 return directory;
}

export class CodexAppServer{
 constructor({binary,home,spawnProcess=spawn,onEvent=async()=>{},onRequest=async()=>{throw Error('Afvist værktøj.');},onDisconnect=async()=>{},requestTimeoutMs=20000}){
  if(!isAbsolute(binary||'')||!isAbsolute(home||''))throw Error('Codex binær og privat HOME mangler.');
  Object.assign(this,{binary,home,spawnProcess,onEvent,onRequest,onDisconnect,requestTimeoutMs});this.pending=new Map();this.sequence=0;this.secrets=[];this.eventTail=Promise.resolve();
 }
 clean(value){return redactSecrets(String(value||''),this.secrets).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,2400);}
 async connect(){
  if(this.child)return;
  // Retain token values only in memory for defensive redaction, never logs.
  const auth=JSON.parse(await readFile(join(this.home,'auth.json'),'utf8'));
  const collect=x=>{if(typeof x==='string'&&x.length>16)this.secrets.push(x);else if(x&&typeof x==='object')Object.values(x).forEach(collect);};collect(auth);
  const binary=await realpath(this.binary);const stat=await lstat(binary);if(!stat.isFile())throw Error('Codex-binæren er ikke en fil.');
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:this.home,CODEX_HOME:this.home,LANG:'C.UTF-8',RUST_LOG:'error'};
  const child=this.spawnProcess(binary,['app-server','--stdio','--strict-config'],{env,cwd:this.home,stdio:['pipe','pipe','pipe'],shell:false});this.child=child;
  this.closed=new Promise(resolve=>child.once('close',()=>resolve()));
  let buffer='';const decoder=new StringDecoder('utf8');
  child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>1000000)return this.fail();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;try{this.message(JSON.parse(line));}catch{this.fail();}}});
  // Raw stderr can contain private paths/provider diagnostics. Never forward it.
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>this.fail());child.on('error',()=>this.fail());
  child.once('close',()=>{this.dead=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex-forbindelsen er lukket; udfald kan være ukendt.'));}this.pending.clear();Promise.resolve(this.onDisconnect()).catch(()=>{});});
  this.info=await this.request('initialize',{clientInfo:{name:'jarvis_development_bridge',title:'JARVIS udvikling',version:'1.0.0'},capabilities:{experimentalApi:true}});
  this.send({method:'initialized',params:{}});
  const effective=await this.request('config/read',{includeLayers:false});
  if(effective.config?.features?.shell_tool!==false||effective.config?.features?.unified_exec!==false||effective.config?.features?.apps!==false||effective.config?.features?.plugins!==false)throw Error('Codex-udførelsesprofilen kunne ikke attesteres.');
  // Fail closed if the running binary differs from the reviewed protocol.
  const identity=String(this.info.userAgent||'');if(!identity.includes('/'+CODEX_VERSION+' ' )&&!identity.includes('/'+CODEX_VERSION+')')&&!identity.includes('/'+CODEX_VERSION+' (')){await this.close();throw Error('Codex-versionen matcher ikke den gennemgåede 0.167.0-kontrakt.');}
 }
 send(message){if(!this.child||this.dead||this.child.stdin.destroyed)throw Error('Codex er ikke tilsluttet.');this.child.stdin.write(JSON.stringify(message)+'\n');}
 request(method,params={}){
  const id=++this.sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(Error('Codex-kaldets udfald er ukendt. Ingen automatisk gentagelse.'),{unknownOutcome:true}));},this.requestTimeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
 }
 message(message){
  if(message.method&&message.id!==undefined){
   Promise.resolve().then(()=>this.onRequest(message.method,message.params||{},message.id)).then(result=>this.send({id:message.id,result}),()=>this.send({id:message.id,error:{code:-32000,message:'JARVIS afviste kaldet; ingen automatisk gentagelse.'}})).catch(()=>{});return;
  }
  if(message.method){this.eventTail=this.eventTail.then(()=>this.onEvent(message.method,message.params||{})).catch(()=>this.fail());return;}
  const p=this.pending.get(message.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(message.id);
  message.error?p.reject(Error('Codex afviste protokolkaldet ('+Number(message.error.code)+').')):p.resolve(message.result);
 }
 fail(){if(this.child&&!this.dead)this.child.kill('SIGTERM');}
 async close(){if(!this.child)return;this.child.stdin.end();const timer=setTimeout(()=>this.child?.kill('SIGTERM'),2000);await this.closed;clearTimeout(timer);await this.eventTail;}
 async start(worktree,tools,instructions,model){return this.request('thread/start',{cwd:worktree,permissions:'jarvis_bridge',approvalPolicy:'on-request',approvalsReviewer:'user',dynamicTools:tools,developerInstructions:instructions,historyMode:'legacy',...(model?{model}:{})});}
 resume(threadId,worktree){return this.request('thread/resume',{threadId,cwd:worktree,permissions:'jarvis_bridge',approvalPolicy:'on-request',excludeTurns:true});}
 turn(threadId,text){return this.request('turn/start',{threadId,input:[{type:'text',text,text_elements:[]}]});}
 steer(threadId,turnId,text){return this.request('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text,text_elements:[]}]});}
 interrupt(threadId,turnId){return this.request('turn/interrupt',{threadId,turnId});}
 read(threadId){return this.request('thread/read',{threadId,includeTurns:true});}
}
