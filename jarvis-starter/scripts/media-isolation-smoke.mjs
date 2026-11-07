// All media generated here are synthetic. Real model quality is NOT measured.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIsolatedMedia,mediaContainerArgs} from '../isolated-media.mjs';
const root=await mkdtemp(join(tmpdir(),'jarvis-media-smoke-')),report={at:new Date().toISOString(),candidate:process.env.JARVIS_CANDIDATE_SHA||null,image:process.env.JARVIS_MEDIA_IMAGE,status:'running',model:'not_run',cases:[]};
const image=process.env.JARVIS_MEDIA_IMAGE;
function run(binary,args){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH},shell:false});let data='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Synthetic probe timeout'));},60000);child.stdout.on('data',x=>data+=x);child.stderr.on('data',x=>data+=x);child.on('error',reject);child.on('close',c=>{clearTimeout(timer);c===0?resolve(data):reject(new Error(data.slice(-3000)));});});}
const normalize=createIsolatedMedia({env:{PATH:process.env.PATH,JARVIS_DISCORD_MEDIA:'yes',JARVIS_MEDIA_IMAGE:image}});
try{
 const actual=(await run('git',['rev-parse','HEAD'])).trim();if(report.candidate)assert.equal(actual,report.candidate);report.candidate=actual;
 report.decoderVersion=(await run('docker',['run','--rm','--network=none','--entrypoint','ffmpeg',image,'-version'])).split('\n')[0];
 const args=mediaContainerArgs(image,'jarvis-media-containment');args.pop();args.push('--entrypoint','node',image,'-e',`
 const fs=require('fs'),net=require('net'),assert=require('assert/strict');
 assert.notEqual(process.getuid(),0);assert.equal(process.env.OPENAI_API_KEY,undefined);
 assert.throws(()=>fs.writeFileSync('/app/must-not-write','x'));
 assert.throws(()=>fs.readFileSync('${root}/host-sentinel'));
 const status=fs.readFileSync('/proc/self/status','utf8');assert.match(status,/CapEff:\\s+0000000000000000/);assert.match(status,/NoNewPrivs:\\s+1/);
 const s=net.connect({host:'1.1.1.1',port:443});s.on('connect',()=>{process.exitCode=1;s.destroy();});s.on('error',()=>{});setTimeout(()=>s.destroy(),500);
 `);
 await writeFile(root+'/host-sentinel','synthetic-local-only');await run('docker',args);report.cases.push('non-root/read-only/capability/host-file/network isolation');
 const protocols=await run('docker',['run','--rm','--network=none','--entrypoint','ffmpeg',image,'-protocols']);
 for(const blocked of ['http','https','tcp','tls','concat','subfile','crypto'])assert.equal(new RegExp(`^\\s*${blocked}\\s*$`,'m').test(protocols),false);report.cases.push('decoder compiled without network/nested protocols');
 for(const [ext,type]of [['jpg','image/jpeg'],['png','image/png'],['webp','image/webp']]){
  const file=root+'/image.'+ext;await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x240','-frames:v','1',file]);
  const r=await normalize({buffer:await readFile(file),contentType:type});assert.equal(r.kind,'image');assert.equal(r.frames.length,1);report.cases.push(ext+' decoded/normalized/metadata removed');
 }
 const cases=[['mp4','libx264',false,'testsrc2'],['mp4','libx264',true,'testsrc2'],['webm','libvpx',false,'testsrc2'],['webm','libvpx-vp9',false,'testsrc2'],['mp4','libx264',false,'color=black']];
 for(const [i,[ext,codec,audio,source]]of cases.entries()){
  const file=root+`/video-${i}.${ext}`,src=source==='testsrc2'?'testsrc2=size=320x240:rate=10':'color=black:size=320x240:rate=10';
  await run('ffmpeg',['-v','error','-f','lavfi','-i',src,...(audio?['-f','lavfi','-i','sine=frequency=440:sample_rate=16000']:[]),'-t','6','-c:v',codec,'-threads','1',...(audio?['-c:a','aac','-ac','1']:['-an']),file]);
  const input={buffer:await readFile(file),contentType:ext==='mp4'?'video/mp4':'video/webm'},r=await normalize(input);
  assert.equal(r.kind,'video');assert.equal(r.frames.length,2);assert.ok(r.duration<=60);assert.equal(Boolean(r.wav),audio);assert.ok(r.frames.every(f=>f.seconds>0&&f.seconds<r.duration));report.cases.push('video '+i+': sampled frames'+(audio?' + WAV':' without audio'));
  if(i===0){const abort=new AbortController(),pending=normalize(input,{signal:abort.signal});setTimeout(()=>abort.abort(),100);await assert.rejects(pending);report.cases.push('abort during startup/decoding removes container');}
 }
 // Deterministic active-worker stop: the same isolated image/limits, with a
 // synthetic hung worker rather than timing an abort before Docker has started.
 let ready;const workerReady=new Promise(r=>ready=r),abort=new AbortController();
 const hung=createIsolatedMedia({env:{PATH:process.env.PATH,JARVIS_DISCORD_MEDIA:'yes',JARVIS_MEDIA_IMAGE:image},spawnProcess:(binary,args,options)=>{
  const fixtureArgs=[...args];fixtureArgs.splice(fixtureArgs.lastIndexOf(image),0,'--entrypoint','node');
  fixtureArgs.push('-e',"process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('synthetic-worker-ready');setInterval(()=>{},1000);});");
  const child=spawn(binary,fixtureArgs,options);child.stdout.on('data',chunk=>{if(chunk.toString().includes('synthetic-worker-ready'))ready();});return child;
 }});
 const pending=hung({buffer:Buffer.alloc(100,1),contentType:'video/mp4'},{signal:abort.signal});
 await Promise.race([workerReady,pending.then(()=>assert.fail('synthetic hung worker must not finish'))]);
 abort.abort();await assert.rejects(pending);report.cases.push('confirmed running hung worker stopped and removed');
 await assert.rejects(normalize({buffer:Buffer.alloc(100,1),contentType:'video/mp4'}));report.cases.push('malformed container rejected');
 const long=root+'/long.mp4';await run('ffmpeg',['-v','error','-f','lavfi','-i','color=black:size=32x32:rate=1','-t','61','-c:v','libx264','-threads','1',long]);
 await assert.rejects(normalize({buffer:await readFile(long),contentType:'video/mp4'}));report.cases.push('actual >60-second duration rejected');
 const remaining=await run('docker',['ps','-a','--filter','name=jarvis-media-','--format','{{.Names}}']);assert.equal(remaining.trim(),'');report.cases.push('no remaining media containers');report.status='passed';
}catch(error){report.status='failed';report.error=error.message;throw error;}
finally{await rm(root,{recursive:true,force:true});await mkdir('artifacts/media',{recursive:true});await writeFile('artifacts/media/containment.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
