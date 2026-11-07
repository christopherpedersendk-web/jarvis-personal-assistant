import {spawn} from 'node:child_process';import {lookup as dnsLookup} from 'node:dns/promises';import {randomUUID,createHash} from 'node:crypto';import {readFile,lstat,realpath} from 'node:fs/promises';import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';import {StringDecoder} from 'node:string_decoder';
import {storeUrl,STORES} from './commerce.mjs';import {browserUrl} from './browser-workspace.mjs';import {publicInternetAddress,fetchRecipeResource} from './recipe-fetch.mjs';import {dockerProcessEnvironment,localDockerEndpoint,runBoundedProcess} from './subprocess-safety.mjs';
const here=fileURLToPath(new URL('./',import.meta.url)),digest=s=>createHash('sha256').update(s).digest('hex');
function mountPath(path){if(typeof path!=='string'||!path.startsWith('/')||/[,:\x00-\x1f\x7f]/.test(path))throw Error('Ugyldig isoleret runtime-sti.');return path;}
export function containedOpenClawArgs({image,name,runtimeModules,nodeBinary,host,address}){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^jarvis-openclaw-browser-[a-f0-9-]+$/.test(name)||!['www.proshop.dk','www.amazon.de'].includes(host)||!publicInternetAddress(address))throw Error('Ugyldigt isoleret browsergrundlag.');
 const bind=(source,target)=>['--mount',`type=bind,source=${mountPath(source)},target=${target},readonly`];
 return ['run','--rm','--init','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
  '--security-opt=seccomp='+join(here,'browser-runtime/seccomp.json'),'--user=1000:1000','--pids-limit=256','--memory=3g','--cpus=2','--shm-size=256m','--ipc=private','--tmpfs=/tmp:rw,nosuid,nodev,size=192m',
  '--add-host',host+':'+address,...bind(runtimeModules,'/openclaw/node_modules'),...bind(nodeBinary,'/pinned-node'),...bind(join(here,'browser-runtime/openclaw-worker.mjs'),'/worker/openclaw-worker.mjs'),...bind(join(here,'openclaw-runtime/commerce-browser-config.mjs'),'/worker/commerce-browser-config.mjs'),
  '--entrypoint','/pinned-node','-i',image,'/worker/openclaw-worker.mjs'];
}
async function runtimePaths(env){
 const runtime=mountPath(env.JARVIS_OPENCLAW_RUNTIME_DIRECTORY),binary=mountPath(env.JARVIS_OPENCLAW_NODE),modules=join(resolve(runtime),'node_modules');
 for(const path of [runtime,modules,binary]){const stat=await lstat(path);if(stat.isSymbolicLink()||await realpath(path)!==resolve(path))throw Error('Runtime-stier må ikke være symbolske links.');}
 if(!(await lstat(binary)).isFile()||!(await lstat(modules)).isDirectory())throw Error('Isoleret runtime mangler.');
 const pkg=JSON.parse(await readFile(join(modules,'openclaw/package.json'),'utf8'));if(pkg.name!=='openclaw'||pkg.version!=='2026.11.1')throw Error('OpenClaw matcher ikke den fastlåste version.');
 if(!(await realpath(join(modules,'openclaw'))).startsWith(modules+'/'))throw Error('Runtimepakken forlader den offentlige dependency-mappe.');
 return {runtimeModules:modules,nodeBinary:binary};
}
export function createContainedOpenClawBrowser({env=process.env,control,fetchResource=fetchRecipeResource,lookup=dnsLookup,spawnProcess=spawn,run=runBoundedProcess,now=()=>Date.now()}={}){
 if(env.JARVIS_OPENCLAW_CONTAINER!=='yes')return null;
 const image=env.JARVIS_BROWSER_IMAGE||'';if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Angiv præcist browserimage.');
 mountPath(env.JARVIS_OPENCLAW_RUNTIME_DIRECTORY);mountPath(env.JARVIS_OPENCLAW_NODE);
 const environment=dockerProcessEnvironment(env);let busy=false,reads=0;
 return {status:()=>({backend:'openclaw-contained',profile:'jarvis-commerce',rights:['public-product-read'],isolation:'network-none/bounded-GET-broker',reads,liveVerified:false,usageNote:'En operation reserveres i fælles journal. Tokens/pris og ekstern providerlukning er ukendt.'}),async read(url,store,{signal}={}){
  const approved=browserUrl(storeUrl(url,store)),scope=control.current();control.assertAllowed(scope);if(busy)throw Error('En OpenClaw-browserlæsning er allerede aktiv.');busy=true;let reservation;
  try{
   reservation=await control.reserve({model:'openclaw.contained-browser-read',max_output_tokens:1},scope);
   const result=await control.controlled(async stopped=>{
    const abort=AbortSignal.any([stopped,AbortSignal.timeout(90000),...(signal?[signal]:[])]);abort.throwIfAborted();
    const paths=await runtimePaths(env);abort.throwIfAborted();
    let timer;const addresses=await Promise.race([lookup(approved.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS-kontrollen tog for lang tid.')),5000);})]).finally(()=>clearTimeout(timer));
    if(!addresses?.length||addresses.some(x=>!publicInternetAddress(x.address)))throw Error('Butikkens DNS er ikke offentlig.');abort.throwIfAborted();
    const endpoint=await localDockerEndpoint((binary,args,timeoutMs)=>run(binary,args,{environment,timeoutMs,maxOutputBytes:1024}),{environment:env});if(!endpoint.ok)throw Error(endpoint.reason);abort.throwIfAborted();
    const name='jarvis-openclaw-browser-'+randomUUID(),args=['--host',endpoint.host,...containedOpenClawArgs({image,name,...paths,host:approved.hostname,address:addresses[0].address})];
    let child,buffer='',total=0,requests=0,bytes=0,finished=false,queue=Promise.resolve();const decoder=new StringDecoder('utf8'),lifetime=new AbortController(),resourceSignal=AbortSignal.any([abort,lifetime.signal]);
    const send=m=>{if(!finished&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(m)+'\n');};
    try{
     return await new Promise((accept,reject)=>{
      const finish=(error,value)=>{if(finished)return;finished=true;abort.removeEventListener('abort',onAbort);error?reject(error):accept(value);};
      const onAbort=()=>finish(Error('OpenClaw-browserlæsningen blev afbrudt.'));if(abort.aborted)return onAbort();abort.addEventListener('abort',onAbort,{once:true});
      child=spawnProcess('docker',args,{env:environment,stdio:['pipe','pipe','pipe'],shell:false});child.on('error',()=>finish(Error('Den isolerede OpenClaw-browser kunne ikke startes.')));child.on('close',()=>finish(Error('Browseren sluttede uden verificeret resultat.')));child.stdin.on('error',()=>finish(Error('Browserforbindelsen blev lukket.')));
      child.stderr.on('data',x=>{total+=x.length;if(total>1000000)finish(Error('Browserens outputgrænse er nået.'));});
      child.stdout.on('data',x=>{total+=x.length;buffer+=decoder.write(x);if(total>1000000||buffer.length>600000)return finish(Error('Browserens outputgrænse er nået.'));let end;
       while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{return finish(Error('Ugyldigt isoleret browserresultat.'));}
        if(m.type==='error')return finish(Error('Isoleret OpenClaw-browser fejlede under '+(['startup','launch','navigation','snapshot','cleanup'].includes(m.stage)?m.stage:'runtime')+'.'));
        if(m.type==='result'){
         if(m.runtime!=='2026.11.1'||m.url!==approved.href||typeof m.snapshot!=='string'||m.snapshot.length>25000||m.snapshotHash!==digest(m.snapshot))return finish(Error('Ugyldigt eller ændret browsergrundlag.'));
         return finish(null,{url:approved.href,requestedUrl:approved.href,observedAt:new Date(now()).toISOString(),snapshot:m.snapshot,snapshotHash:m.snapshotHash,trust:'untrusted-web-data',authority:'none',source:'openclaw-contained-browser',runtime:m.runtime,blocked:Object.fromEntries(['requests','writes','websockets','popups'].map(k=>[k,Number.isSafeInteger(m.blocked?.[k])&&m.blocked[k]>=0&&m.blocked[k]<=10000?m.blocked[k]:null])),usage:{operationReservations:1,brokerRequests:requests,brokerBytes:bytes,tokens:null,cost:null}});
        }
        if(m.type!=='request'||!Number.isSafeInteger(m.id)||m.id<1||++requests>25)return finish(Error('Browserens ressourcegrænse er nået.'));
        queue=queue.then(async()=>{try{
         if(finished||resourceSignal.aborted||bytes>=4000000)throw Error();const target=browserUrl(m.url);if(target.origin!==STORES[store].origin)throw Error();
         const r=await fetchResource(target.href,{kind:'browser',signal:resourceSignal,maxBytes:Math.min(500000,4000000-bytes),timeoutMs:8000,allowUrl:next=>browserUrl(next.href).origin===approved.origin});
         if(r.url&&r.url!==target.href)throw Error();bytes+=r.buffer.length;if(bytes>4000000)throw Error();send({type:'resource',id:m.id,ok:true,contentType:r.contentType,body:r.buffer.toString('base64')});
        }catch{send({type:'resource',id:m.id,ok:false});}});
       }
      });send({type:'start',url:approved.href});
     });
    }finally{
     finished=true;lifetime.abort();child?.kill('SIGKILL');const cleanup=await run('docker',['--host',endpoint.host,'rm','--force',name],{environment,timeoutMs:5000,maxOutputBytes:1024});
     if(!cleanup.ok&&!cleanup.output.includes('No such container'))throw Error('OpenClaw-browserens oprydning kunne ikke bekræftes.');
    }
   },scope);
   control.assertAllowed(scope);await control.settle(reservation,null,'completed');reads++;return result;
  }catch(error){if(reservation)await control.settle(reservation,null,'unknown').catch(()=>{});throw error;}finally{busy=false;}
 }};
}
