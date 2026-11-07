import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {dockerProcessEnvironment,localDockerEndpoint,runBoundedProcess} from './subprocess-safety.mjs';

export function mediaContainerArgs(image,name){
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Medier kræver et lokalt containerimage med præcist SHA256-ID.');
 return ['run','--rm','--init','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
  '--user=1000:1000','--pids-limit=48','--memory=512m','--cpus=1','--ipc=private','--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=96m','-i',image];
}

export function validateNormalizedMedia(value){
 if(value?.version!==1||!['image','video'].includes(value.kind)||!Array.isArray(value.frames)||value.frames.length<1||value.frames.length>(value.kind==='image'?1:12)||
  !Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width*value.height>20_000_000||
  (value.kind==='video'&&(!Number.isFinite(value.duration)||value.duration<=0||value.duration>60)))throw new Error('Ugyldigt resultat fra medieisoleringen.');
 for(const f of value.frames){
  if(!Number.isFinite(f.seconds)||f.seconds<0||f.seconds>(value.duration||0)||typeof f.data!=='string'||f.data.length>(value.kind==='image'?214000:35000)||!/^[A-Za-z0-9+/]+={0,2}$/.test(f.data))throw new Error('Ugyldigt billeduddrag.');
  const b=Buffer.from(f.data,'base64');if(b[0]!==255||b[1]!==216||b[2]!==255)throw new Error('Ugyldigt normaliseret JPEG.');
 }
 if(value.wav!==null&&(typeof value.wav!=='string'||value.wav.length>2_574_000||!/^UklGR/.test(value.wav)))throw new Error('Ugyldigt lyduddrag.');
 return value;
}

export function createIsolatedMedia({env=process.env,spawnProcess=spawn,run=runBoundedProcess}={}){
 if(env.JARVIS_DISCORD_MEDIA!=='yes')return null;
 const image=env.JARVIS_MEDIA_IMAGE||'';mediaContainerArgs(image,'validation');
 const environment=dockerProcessEnvironment(env);
 return async({buffer,contentType},{signal}={})=>{
  if(!Buffer.isBuffer(buffer)||buffer.length>30*1024*1024)throw new Error('Mediet overstiger grænsen.');
  signal?.throwIfAborted();
  const endpoint=await localDockerEndpoint((binary,args,timeoutMs)=>run(binary,args,{environment,timeoutMs,maxOutputBytes:1024}),{environment:env});
  if(!endpoint.ok)throw new Error(endpoint.reason);
  const name='jarvis-media-'+randomUUID(),args=['--host',endpoint.host,...mediaContainerArgs(image,name)];
  let child,done=false;
  const abort=AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])]);
  try{
   return await new Promise((resolve,reject)=>{
    let size=0,chunks=[];
    const finish=(error,value)=>{if(done)return;done=true;abort.removeEventListener('abort',onAbort);error?reject(error):resolve(value);};
    const onAbort=()=>finish(new Error('Mediebehandlingen blev stoppet eller tog for lang tid.'));
    if(abort.aborted)return onAbort();abort.addEventListener('abort',onAbort,{once:true});
    child=spawnProcess('docker',args,{env:environment,stdio:['pipe','pipe','pipe'],shell:false});
    child.on('error',()=>finish(new Error('Isoleret mediecontainer er ikke tilgængelig.')));
    child.stdin.on('error',()=>finish(new Error('Mediecontainerens forbindelse blev afbrudt.')));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>3_100_000)return finish(new Error('Mediecontainerens outputgrænse er nået.'));chunks.push(chunk);});
    child.stderr.on('data',chunk=>{size+=chunk.length;if(size>3_100_000)finish(new Error('Mediecontainerens outputgrænse er nået.'));});
    child.on('close',code=>{
     try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(code!==0&&['missing_component','missing_library','runtime_constraint','invalid_media'].includes(parsed.code))return finish(new Error('Mediecontainer afviste filen: '+parsed.code+'. Ingen analyse er sendt.'));
      if(code!==0)throw new Error();finish(null,validateNormalizedMedia(parsed));}
     catch{finish(new Error('Mediet kunne ikke valideres eller dekodes. Ingen analyse er sendt.'));}
    });
    child.stdin.end(JSON.stringify({version:1,contentType,data:buffer.toString('base64')}));
   });
  }finally{
   child?.kill('SIGKILL');
   const cleanup=await run('docker',['--host',endpoint.host,'rm','--force',name],{environment,timeoutMs:5000,maxOutputBytes:1024});
   if(!cleanup.ok&&!cleanup.output.includes('No such container'))throw new Error('Mediecontainerens oprydning kunne ikke bekræftes. Kontrollér containerdriften før et nyt forsøg.');
  }
 };
}
