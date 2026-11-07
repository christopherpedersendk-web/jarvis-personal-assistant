// Runs only inside the no-network, read-only media container. No user filenames,
// URLs, shell syntax, decoder flags or environment variables cross this boundary.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const DEMUX={'image/png':'png_pipe','image/jpeg':'jpeg_pipe','image/webp':'webp_pipe','video/mp4':'mov','video/webm':'matroska'};
const IMAGE_CODEC={'image/png':'png','image/jpeg':'mjpeg','image/webp':'webp'};
const VIDEO_CODECS=new Set(['h264','hevc','av1','vp8','vp9']);
const AUDIO_CODECS=new Set(['aac','opus','vorbis','mp3','flac','pcm_s16le']);
function reject(){throw new Error('Mediet er beskadiget, ikke understøttet eller overstiger grænserne.');}

export function inspectMedia(info,type) {
 const streams=info.streams;if(!Array.isArray(streams)||streams.length<1||streams.length>2)reject();
 const videos=streams.filter(s=>s.codec_type==='video'),audio=streams.filter(s=>s.codec_type==='audio');
 if(videos.length!==1||audio.length>1||streams.length!==videos.length+audio.length)reject();
 const v=videos[0];
 if(!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||v.width<1||v.height<1||v.width*v.height>20_000_000)reject();
 const image=Boolean(IMAGE_CODEC[type]);
 if(image){if(v.codec_name!==IMAGE_CODEC[type]||audio.length||Number(v.nb_frames||1)>1)reject();return {kind:'image',width:v.width,height:v.height,duration:null,hasAudio:false};}
 if(!VIDEO_CODECS.has(v.codec_name)||audio.some(a=>!AUDIO_CODECS.has(a.codec_name)||a.channels>2||Number(a.sample_rate)>48000))reject();
 const durations=[info.format?.duration,...streams.map(s=>s.duration)].filter(x=>x!==undefined&&x!=='N/A').map(Number);
 if(!durations.length||durations.some(d=>!Number.isFinite(d)||d<=0||d>60))reject();
 return {kind:'video',width:v.width,height:v.height,duration:Math.max(...durations),hasAudio:audio.length===1};
}

export function decoderCommand(binary,args,{timeoutMs=10000,maxBytes=100000}={}) {
 return new Promise((resolve,rejectPromise)=>{
  const child=spawn(binary,args,{shell:false,env:{PATH:'/usr/bin:/usr/local/bin',LANG:'C'},stdio:['ignore','pipe','pipe']});
  let bytes=0,out=[],done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)child.kill('SIGKILL');error?rejectPromise(error):resolve(value);};
  const timer=setTimeout(()=>finish(new Error('Decoderens tidsgrænse er nået.')),timeoutMs);
  child.on('error',()=>finish(new Error('Decoder er ikke tilgængelig.')));
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>maxBytes)finish(new Error('Decoderens outputgrænse er nået.'));else out.push(b);});
  child.stderr.on('data',b=>{bytes+=b.length;if(bytes>maxBytes)finish(new Error('Decoderens outputgrænse er nået.'));});
  child.on('close',code=>finish(code!==0?new Error('Decoder afviste mediet.'):null,Buffer.concat(out).toString('utf8')));
 });
}

export async function normalizeMedia(input,{run=decoderCommand,tempRoot='/tmp'}={}) {
 const type=input?.contentType,format=DEMUX[type];
 if(!format||typeof input.data!=='string'||input.data.length>42_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))reject();
 let bytes=Buffer.from(input.data,'base64');
 if(bytes.length<12||bytes.length>(type.startsWith('image/')?10*1024*1024:30*1024*1024))reject();
 const dir=await mkdtemp(tempRoot+'/jarvis-media-');
 try{
  const file=dir+'/input';await writeFile(file,bytes,{mode:0o600});bytes=null;
  const readArgs=['-protocol_whitelist','file,pipe','-max_alloc','67108864','-threads','1','-f',format,'-i',file];
  const info=JSON.parse(await run('ffprobe',['-v','error',...readArgs,'-show_streams','-show_format','-of','json']));
  const meta=inspectMedia(info,type),frames=[];
  const count=meta.kind==='image'?1:Math.min(12,Math.max(1,Math.ceil(meta.duration/5)));
  for(let i=0;i<count;i++){
   const time=meta.kind==='image'?0:Math.round((i+.5)*meta.duration/count*1000)/1000,fileOut=dir+`/frame-${i}.jpg`;
   const width=meta.kind==='image'?1280:480,maxBytes=meta.kind==='image'?160000:26000;
   await run('ffmpeg',['-v','error','-nostdin','-y',...readArgs,...(meta.kind==='video'?['-ss',String(time)]:[]),'-map','0:v:0','-frames:v','1','-vf',`scale=w='min(${width},iw)':h='min(${width},ih)':force_original_aspect_ratio=decrease`,'-threads','1','-q:v',meta.kind==='image'?'5':'8','-map_metadata','-1','-update','1',fileOut]);
   if((await stat(fileOut)).size>maxBytes)throw new Error('Det normaliserede billede er for detaljeret til analysegrænsen.');
   const data=await readFile(fileOut);if(data[0]!==255||data[1]!==216)reject();
   frames.push({seconds:time,data:data.toString('base64')});await rm(fileOut);
  }
  let wav=null;
  if(meta.hasAudio){
   const audioFile=dir+'/audio.wav';
   await run('ffmpeg',['-v','error','-nostdin','-y',...readArgs,'-map','0:a:0','-vn','-t','60','-ac','1','-ar','16000','-c:a','pcm_s16le','-threads','1','-map_metadata','-1',audioFile]);
   if((await stat(audioFile)).size>1_930_000)reject();wav=(await readFile(audioFile)).toString('base64');
  }
  return {version:1,...meta,frames,wav,coverage:meta.kind==='image'?'normalized-image':'sampled-frames'};
 }finally{await rm(dir,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let length=0,chunks=[];
 try{
  for await(const chunk of process.stdin){length+=chunk.length;if(length>42_000_500)reject();chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));chunks=[];
  const result=await normalizeMedia(input);process.stdout.write(JSON.stringify(result)+'\n');
 }catch{process.stdout.write(JSON.stringify({error:'Mediet kunne ikke valideres og dekodes inden for grænserne.'})+'\n');process.exitCode=1;}
}
