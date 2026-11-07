import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createHash} from 'node:crypto';
import {containedOpenClawArgs,createContainedOpenClawBrowser} from '../contained-openclaw-browser.mjs';
const image='sha256:'+'a'.repeat(64),url='https://www.proshop.dk/USB-kabel/Test/3298156';
test('native browser is opt-in and only read-only public dependencies enter its networkless sandbox',()=>{
 assert.equal(createContainedOpenClawBrowser({env:{}}),null);assert.throws(()=>createContainedOpenClawBrowser({env:{JARVIS_OPENCLAW_CONTAINER:'yes',JARVIS_BROWSER_IMAGE:image}}));
 const input={image,name:'jarvis-openclaw-browser-abc',runtimeModules:'/public/node_modules',nodeBinary:'/public/node',host:'www.proshop.dk',address:'104.18.12.219'},args=containedOpenClawArgs(input);
 for(const f of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000','--pull=never','--ipc=private'])assert(args.includes(f));
 const mounts=args.filter((_,i)=>args[i-1]==='--mount');assert.equal(mounts.length,4);assert(mounts.every(x=>x.endsWith(',readonly')));assert(mounts.every(x=>!x.includes('/shared')&&!x.includes('docker.sock')&&!x.includes('.env')));
 for(const patch of [{address:'127.0.0.1'},{address:'169.254.169.254'},{host:'internal.local'},{runtimeModules:'/public,readonly=false'},{nodeBinary:'/secret\nvalue'}])assert.throws(()=>containedOpenClawArgs({...input,...patch}));
});
async function fixture(t,{requests=[],cleanup=true,changeResult=false,addresses=[{address:'104.18.12.219'}],wait=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'jarvis-native-contract-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(dir+'/node_modules/openclaw',{recursive:true});await writeFile(dir+'/node_modules/openclaw/package.json',JSON.stringify({name:'openclaw',version:'2026.11.1'}));await writeFile(dir+'/node','synthetic binary, never executed');
 const replies=[],fetches=[],runs=[],settled=[];let launches=0,stops=0;const c=new AbortController(),control={current:()=>({requestId:'synthetic',generation:0}),assertAllowed:()=>c.signal.throwIfAborted(),reserve:async()=>({id:'reservation'}),controlled:fn=>fn(c.signal),settle:async(_r,_u,status)=>settled.push(status)};
 const spawnProcess=()=>{launches++;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{stops++;};let index=0;
  const next=()=>{if(wait)return;if(index<requests.length){child.stdout.write(JSON.stringify({type:'request',id:index+1,url:requests[index++]})+'\n');return;}const snapshot='Synthetic product';child.stdout.write(JSON.stringify({type:'result',runtime:'2026.11.1',url:changeResult?'https://www.amazon.de/':url,snapshot,snapshotHash:createHash('sha256').update(snapshot).digest('hex')})+'\n');};
  child.stdin.on('data',x=>{const m=JSON.parse(x.toString());if(m.type==='resource')replies.push(m);setImmediate(next);});return child;};
 const env={JARVIS_OPENCLAW_CONTAINER:'yes',JARVIS_BROWSER_IMAGE:image,JARVIS_OPENCLAW_RUNTIME_DIRECTORY:dir,JARVIS_OPENCLAW_NODE:dir+'/node',DOCKER_HOST:'unix:///synthetic/docker.sock',PRODUCTION_SECRET:'must-not-enter-cli'};
 const reader=createContainedOpenClawBrowser({env,control,spawnProcess,lookup:async()=>addresses,fetchResource:async(target,options)=>{fetches.push({target,options});return {url:target,buffer:Buffer.from('public source'),contentType:'text/html'};},run:async(_binary,args,options)=>{runs.push({args,options});return {ok:cleanup,output:cleanup?'removed':'denied'};}});
 return {reader,env,control,dir,replies,fetches,runs,settled,c,launches:()=>launches,stops:()=>stops};
}
test('broker accepts only same-origin public GET resources and records actual bounded source result',async t=>{
 const f=await fixture(t,{requests:[url,'https://127.0.0.1/','http://169.254.169.254/','https://www.amazon.de/','https://www.proshop.dk/private?token=secret']});const result=await f.reader.read(url,'proshop');assert.equal(result.authority,'none');assert.equal(result.trust,'untrusted-web-data');assert.equal(result.source,'openclaw-contained-browser');assert.deepEqual(f.replies.map(x=>x.ok),[true,false,false,false,false]);assert.equal(f.fetches.length,1);assert.equal(f.fetches[0].options.kind,'browser');assert.equal(result.usage.tokens,null);assert.deepEqual(f.settled,['completed']);assert.equal(f.runs.length,1);assert.equal(f.runs[0].options.environment.PRODUCTION_SECRET,undefined);assert.equal(f.stops(),1);
});
test('private or mixed DNS is rejected before container launch',async t=>{
 const f=await fixture(t,{addresses:[{address:'104.18.12.219'},{address:'192.168.1.1'}]});await assert.rejects(f.reader.read(url,'proshop'),/DNS/);assert.equal(f.launches(),0);assert.equal(f.fetches.length,0);
});
test('changed native destination or unconfirmed cleanup cannot return an accepted product',async t=>{
 const changed=await fixture(t,{changeResult:true});await assert.rejects(changed.reader.read(url,'proshop'),/browsergrundlag/);assert.deepEqual(changed.settled,['unknown']);
 const cleanup=await fixture(t,{cleanup:false});await assert.rejects(cleanup.reader.read(url,'proshop'),/oprydning/);assert.deepEqual(cleanup.settled,['unknown']);
});
test('stop tears down the owned container and cannot turn a late result into completion',async t=>{
 const f=await fixture(t,{wait:true});const pending=f.reader.read(url,'proshop');while(!f.launches())await new Promise(r=>setTimeout(r,1));f.c.abort();await assert.rejects(pending,/afbrudt/);assert.equal(f.stops(),1);assert.equal(f.runs.length,1);assert.deepEqual(f.settled,['unknown']);
});
test('wrong installed versions fail before any container is started',async t=>{
 const f=await fixture(t);await writeFile(f.dir+'/node_modules/openclaw/package.json',JSON.stringify({name:'openclaw',version:'wrong'}));await assert.rejects(f.reader.read(url,'proshop'),/version/);assert.equal(f.launches(),0);

});

test('a symlinked Node binary is rejected without starting Docker',async t=>{
 const f=await fixture(t);await symlink(f.dir+'/node',f.dir+'/node-link');const linked=createContainedOpenClawBrowser({env:{...f.env,JARVIS_OPENCLAW_NODE:f.dir+'/node-link'},control:f.control});await assert.rejects(linked.read(url,'proshop'),/symbolske/);assert.equal(f.launches(),0);
});
