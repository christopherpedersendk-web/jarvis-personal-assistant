import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { browserUrl } from './browser-workspace.mjs';
import { fetchRecipeResource } from './recipe-fetch.mjs';
import { dockerProcessEnvironment, localDockerEndpoint, runBoundedProcess } from './subprocess-safety.mjs';

export function browserContainerArgs(image, name) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Browseren kræver et lokalt image med præcist SHA256-ID.');
  return ['run','--rm','--init','--pull=never','--name',name,'--network=none','--read-only',
    '--cap-drop=ALL','--security-opt=no-new-privileges',
    '--security-opt=seccomp='+fileURLToPath(new URL('./browser-runtime/seccomp.json',import.meta.url)),'--user=1000:1000','--pids-limit=128',
    '--memory=768m','--cpus=1','--shm-size=128m','--ipc=private',
    '--tmpfs=/tmp:rw,nosuid,nodev,size=128m','-i',image];
}
export function createIsolatedBrowser({ env=process.env, fetchResource=fetchRecipeResource }={}) {
  if (env.JARVIS_DYNAMIC_BROWSER !== 'yes') return null;
  const image=env.JARVIS_BROWSER_IMAGE || '';
  browserContainerArgs(image,'validation');
  const environment=dockerProcessEnvironment(env);
  return async function render(url,{signal,allowUrl}={}) {
    const initial=browserUrl(url),name='jarvis-browser-'+randomUUID();
    const endpoint=await localDockerEndpoint((binary,args,timeoutMs)=>runBoundedProcess(binary,args,{environment,timeoutMs,maxOutputBytes:1024}),{environment:env});
    if(!endpoint.ok)throw new Error(endpoint.reason);
    const host=endpoint.host;
    const args=['--host',host,...browserContainerArgs(image,name)];
    let child, buffer='',total=0,requests=0,bytes=0,finished=false;
    const decoder=new StringDecoder('utf8');
    let resourceQueue=Promise.resolve();
    const lifetime=new AbortController(),deadline=AbortSignal.timeout(20000), abort=AbortSignal.any([lifetime.signal,deadline,...(signal?[signal]:[])]);
    const send=message=>{if(!finished&&!child.stdin.destroyed) child.stdin.write(JSON.stringify(message)+'\n');};
    try {
      return await new Promise((resolve,reject)=>{
        const finish=(error,value)=>{if(finished)return;finished=true;abort.removeEventListener('abort',onAbort);error?reject(error):resolve(value);};
        const onAbort=()=>finish(new Error('Browserlæsningen blev afbrudt.'));
        if(abort.aborted)return onAbort();
        abort.addEventListener('abort',onAbort,{once:true});
        child=spawn('docker',args,{env:environment,stdio:['pipe','pipe','pipe'],shell:false});
        child.stdin.on('error',()=>finish(new Error('Browserforbindelsen blev lukket.')));
        child.on('error',()=>finish(new Error('Isoleret browser er ikke tilgængelig.')));
        child.on('close',()=>finish(new Error('Browseren sluttede uden et verificeret resultat.')));
        child.stderr.on('data',chunk=>{total+=chunk.length;if(total>1000000)finish(new Error('Browserens outputgrænse er nået.'));});
        child.stdout.on('data',chunk=>{
          total+=chunk.length;buffer+=decoder.write(chunk);
          if(total>1000000||buffer.length>600000)return finish(new Error('Browserens outputgrænse er nået.'));
          let end;while((end=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
            let message;try{message=JSON.parse(line);}catch{return finish(new Error('Ugyldigt browserresultat.'));}
            if(message.type==='error')return finish(new Error(`Browseren kunne ikke fuldføre ${['launch','context','navigation','extract'].includes(message.stage)?message.stage:'runtime'} (${['sandbox','executable','runtime'].includes(message.reason)?message.reason:'runtime'}).`));
            if(message.type==='result'){
              if(typeof message.html!=='string'||Buffer.byteLength(message.html)>500000)return finish(new Error('Ugyldigt sideuddrag.'));
              return finish(null,{buffer:Buffer.from(message.html),url:initial.href,contentType:'text/html'});
            }
            if(message.type!=='request'||!Number.isSafeInteger(message.id)||++requests>25)return finish(new Error('Browserens anmodningsgrænse er nået.'));
            resourceQueue=resourceQueue.then(async()=>{
              try {
                if(abort.aborted||finished||bytes>=4000000)throw new Error();
                const target=browserUrl(message.url);
                if(target.origin!==initial.origin||!allowUrl?.(target))throw new Error();
                const resource=await fetchResource(target.href,{kind:'browser',signal:abort,maxBytes:Math.min(500000,4000000-bytes),timeoutMs:8000,
                  allowUrl:next=>browserUrl(next.href).origin===initial.origin&&allowUrl(next)});
                bytes+=resource.buffer.length;if(bytes>4000000)throw new Error();
                send({type:'resource',id:message.id,ok:true,body:resource.buffer.toString('base64'),contentType:resource.contentType});
              }catch{send({type:'resource',id:message.id,ok:false});}
            });
          }
        });
        send({type:'start',url:initial.href});
      });
    } finally {
      finished=true;lifetime.abort();child?.kill('SIGKILL');
      // Killing the CLI alone does not guarantee termination of its container.
      const cleanup=await runBoundedProcess('docker',['--host',host,'rm','--force',name],
        {environment,timeoutMs:5000,maxOutputBytes:1024});
      if(!cleanup.ok&&!cleanup.output.includes('No such container')) throw new Error('Browserens oprydning kunne ikke bekræftes. Kontrollér containerdriften.');
    }
  };
}
