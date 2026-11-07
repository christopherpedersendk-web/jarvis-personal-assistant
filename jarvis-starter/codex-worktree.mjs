import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {constants} from 'node:fs';import {lstat,mkdir,realpath,open,readFile,rename,unlink} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute,resolve} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {rejectSecrets} from './privacy.mjs';import {dockerTest} from './isolated-test.mjs';
const exec=promisify(execFile),repoUrl='https://github.com/christopherpedersendk-web/jarvis-personal-assistant.git';
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const CODEX_EDITABLE=Object.freeze([
 'jarvis-starter/meal-variety.mjs','jarvis-starter/shopping-search-list.mjs',
 'jarvis-starter/discord-channels.mjs','jarvis-starter/discord-format.mjs','jarvis-starter/discord-media.mjs',
 'jarvis-starter/recipe-extractor.mjs','jarvis-starter/recipe-memory.mjs',
 'jarvis-starter/commerce.mjs','jarvis-starter/proshop.mjs','jarvis-starter/proshop-session.mjs','jarvis-starter/public/commerce.js',
 'jarvis-starter/test/fixtures/codex-bridge-probe.mjs',
]);
export const codexWritable=(id,path)=>CODEX_EDITABLE.includes(path)||path===`jarvis-starter/test/codex-task-${id}.test.mjs`;
const testMap={
 'meal-variety.mjs':['self-development.fixture.test.mjs'],'shopping-search-list.mjs':['self-development.fixture.test.mjs'],
 'discord-channels.mjs':['discord-channels.test.mjs'],'discord-format.mjs':['discord-format.test.mjs'],
 'discord-media.mjs':['discord-media-guidance.test.mjs','discord-media.test.mjs'],
 'recipe-extractor.mjs':['recipe-image-containment.test.mjs','v49-extractor.test.mjs'],
 'recipe-memory.mjs':['v49-recipes.test.mjs'],
 'commerce.mjs':['commerce.test.mjs','proshop.test.mjs'],'proshop.mjs':['proshop.test.mjs'],
 'proshop-session.mjs':['proshop-session.test.mjs'],'codex-bridge-probe.mjs':['codex-bridge.fixture.test.mjs'],
};
export class CodexWorktrees{
 constructor({repository,root,baseRef='refs/remotes/origin/main',sourceRoot,run,tests=dockerTest,fetchMain=false}){
  if(![repository,root,sourceRoot].every(x=>isAbsolute(x||''))||root===repository||!/^refs\/(?:remotes\/origin\/main|heads\/[a-zA-Z0-9/_-]+)$/.test(baseRef))throw Error('Udviklingsstier eller base-ref er ugyldige.');
  if([repository,root].some(x=>/\/(?:jarvis\/(?:current|shared|releases|update-staging))(?:\/|$)/.test(x)))throw Error('Produktionsstier må ikke bruges til Codex-udvikling.');
  Object.assign(this,{repository,root,baseRef,sourceRoot,tests,fetchMain});
  this.run=run||((args,cwd=repository)=>exec('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false','--no-pager',...args],{cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_PAGER:'cat'},timeout:20000,maxBuffer:1500000}));
 }
 async initialize(){
  await mkdir(this.root,{recursive:true,mode:0o700});const root=await lstat(this.root);
  if(root.isSymbolicLink()||!root.isDirectory()||(root.mode&0o077)||await realpath(this.repository)!==resolve(this.repository)||await realpath(this.root)!==resolve(this.root))throw Error('Udviklingsroden skal være privat og uden symbolske links.');
  await this.lease();
  const remote=(await this.run(['remote','get-url','origin'])).stdout.trim();if(remote!==repoUrl&&remote!=='git@github.com:christopherpedersendk-web/jarvis-personal-assistant.git')throw Error('Forkert udviklingsrepository.');
  try{const filters=await this.run(['config','--name-only','--get-regexp','^filter\\.']);if(filters.stdout.trim())throw Error('Git-filtre må ikke køre på agentens host.');}catch(e){if(e.code!==1)throw e;}
 }
 async lease(){
  if(this.leaseHeld)return;const file=join(this.root,'.bridge.lock');
  const startKey=async pid=>{try{return (await readFile('/proc/'+pid+'/stat','utf8')).split(') ')[1].split(' ')[19];}catch{return null;}};
  const key=await startKey(process.pid);
  for(let attempt=0;attempt<2;attempt++){
   try{const f=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify({pid:process.pid,key}));await f.sync();}finally{await f.close();}this.leaseHeld=true;return;}
   catch(e){if(e.code!=='EEXIST')throw e;const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let old;try{old=JSON.parse(await f.readFile('utf8'));}finally{await f.close();}if(!Number.isSafeInteger(old.pid)||!old.key)throw Error('Arbejdsmappelease kræver manuel inspektion.');if(await startKey(old.pid)===old.key)throw Error('En anden udviklingsproces ejer arbejdsmapperne.');await unlink(file);}
  }throw Error('Arbejdsmappelease kunne ikke tages.');
 }
 async close(){if(this.leaseHeld){const file=join(this.root,'.bridge.lock');const old=JSON.parse(await readFile(file,'utf8'));if(old.pid===process.pid)await unlink(file);this.leaseHeld=false;}}
 async create(id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Ugyldigt opgave-ID.');
  if(this.fetchMain&&this.baseRef==='refs/remotes/origin/main')await this.run(['fetch','origin','main']);
  const base=(await this.run(['rev-parse',this.baseRef])).stdout.trim();if(!/^[a-f0-9]{40}$/.test(base))throw Error('Udviklingsgrundlaget mangler.');
  await this.run(['merge-base','--is-ancestor','refs/remotes/origin/main',base]);
  const worktree=join(this.root,id),branch='agent/codex-'+id;
  await this.run(['worktree','add','-b',branch,worktree,base]);
  return {repository:this.repository,baseSha:base,branch,worktree};
 }
 async checked(row,path,{write=false}={}){
  if(typeof path!=='string'||path.length>180||!(/^(?:jarvis-starter\/[a-zA-Z0-9_./-]+|docs\/next\/(?:acceptance-register\.md|operations\.md|next-package\.md|evidence\.json))$/.test(path))||path.split('/').some(p=>!p||p.startsWith('.'))||/node_modules|private-settings|credentials|sessions/i.test(path))throw Error('Filen ligger uden for projektets læseadgang.');
  if(write&&!codexWritable(row.id,path))throw Error('Filen kræver særskilt scope-/sikkerhedsreview. Ingen ændring er udført.');
  const expected=join(this.root,row.id);if(row.worktree!==expected||await realpath(expected)!==expected)throw Error('Arbejdsmappebindingen er ændret.');
  let cursor=expected;for(const part of path.split('/').slice(0,-1)){cursor=join(cursor,part);const s=await lstat(cursor);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Usikker projektsti.');}
  const target=join(expected,path);try{const s=await lstat(target);if(!s.isFile()||s.isSymbolicLink()||s.size>200000)throw Error('Filen er ikke en begrænset almindelig tekstfil.');}catch(e){if(e.code!=='ENOENT'||!write)throw e;}
  return target;
 }
 async read(row,path){const target=await this.checked(row,path);const f=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const content=await f.readFile('utf8');if(Buffer.byteLength(content)>200000)throw Error('Projektfilen er for stor.');rejectSecrets(content);return {path,content,sha256:digest(content)};}finally{await f.close();}}
 async write(row,{path,content,expectedHash},check=()=>{}){
  if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>80000)throw Error('Kodeændringen er tom eller for stor.');rejectSecrets(content);
  const target=await this.checked(row,path,{write:true});let old=null;try{old=(await this.read(row,path)).sha256;}catch(e){if(e.code!=='ENOENT')throw e;}
  if((expectedHash??null)!==old)throw Error('Filen er ændret siden læsning. Læs den igen før en rettelse.');check();
  const temp=join(dirname(target),'jarvis-write-'+randomUUID()+'.tmp');const f=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(content);await f.sync();await f.close();check();await this.checked(row,path,{write:true});await rename(temp,target);}catch(e){await f.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}
  return {path,sha256:digest(content)};
 }
 async changes(row){
  if(row.worktree!==join(this.root,row.id))throw Error('Forkert arbejdsmappe.');
  const {stdout}=await this.run(['status','--porcelain=v1','-z','--untracked-files=all'],row.worktree);const paths=[];
  for(const entry of stdout.split('\0').filter(Boolean)){const status=entry.slice(0,2),path=entry.slice(3);if(![' M','M ','??','AM','A '].includes(status)||!codexWritable(row.id,path))throw Error('Ændringer uden for det godkendte filscope blokerer publicering.');paths.push(path);}
  if(paths.length>20)throw Error('For mange ændrede filer.');
  const files=[];for(const path of paths.sort())files.push(await this.read(row,path));
  const packageJson=JSON.parse((await this.run(['show',row.baseSha+':jarvis-starter/package.json'])).stdout);const v=packageJson.version.split('.').map(Number);packageJson.version=`${v[0]}.${v[1]}.${v[2]+1}`;
  return {files,hash:digest(files.map(f=>[f.path,f.sha256])),summary:files.map(f=>f.path).join('\n')||'Ingen kodeændringer.',packageJson};
 }
 async test(row){
  const changes=await this.changes(row);if(!changes.files.length)throw Error('Der er ingen kodeændringer at teste.');
  const protectedTests=new Set(changes.files.flatMap(f=>testMap[f.path.split('/').at(-1)]||[]));
  if(changes.files.some(f=>f.path==='jarvis-starter/public/commerce.js'))throw Error('UI-ændringer kræver særskilt browserverifikation før draft-PR.');
  // A test-only task must still run the canonical contract for the explicitly
  // allowed module it imports; changing a test must not require a dummy edit.
  const generated='jarvis-starter/test/codex-task-'+row.id+'.test.mjs';
  const test=changes.files.find(f=>f.path===generated);
  if(test)for(const m of test.content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
   const target=relative(row.worktree,resolve(dirname(join(row.worktree,generated)),m[1]));
   if(CODEX_EDITABLE.includes(target))for(const name of testMap[target.split('/').at(-1)]||[])protectedTests.add(name);
  }
  if(!protectedTests.size)throw Object.assign(Error('Der mangler en beskyttet testkontrakt for ændringen.'),{code:'DEVELOPMENT_TEST_CONTRACT',noActionTaken:true});
  const files=new Map(),visit=async(path,trusted=false)=>{
   if(files.has(path))return;if(files.size>=250)throw Error('Testgrundlaget er for stort.');
   const full=trusted?join(this.sourceRoot,path):await this.checked(row,path);const stat=await lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200000)throw Error('Usikker testkilde.');
   const content=await readFile(full,'utf8');files.set(path,{path:path.slice('jarvis-starter/'.length),content});
   for(const m of content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
    const target=resolve(dirname(full),m[1]);const root=trusted?this.sourceRoot:row.worktree;const next=relative(root,target);if(next.startsWith('..')||isAbsolute(next))throw Error('Testimport forlader projektet.');
    // Canonical tests come from the installed reviewed code. Dependencies use
    // candidate sources, never a modifiable replacement of the protected test.
    await visit(next,next.startsWith('jarvis-starter/test/')&&!next.includes('codex-task-')&&!next.includes('/fixtures/codex-bridge-probe'));
   }
  };
  for(const f of changes.files)await visit(f.path);
  for(const name of protectedTests)await visit('jarvis-starter/test/'+name,true);
  const result=await this.tests([...files.values()]);const after=await this.changes(row);if(after.hash!==changes.hash)throw Error('Koden ændredes under testen. Resultatet gælder ikke længere.');
  return {status:result.status,contentHash:changes.hash,summary:String(result.summary||'').slice(-1600)};
 }
}
