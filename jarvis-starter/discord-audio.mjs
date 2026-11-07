import {renderRealtimeSpeech} from './realtime-speech.mjs';
// Discord decoder: signed 16-bit 48 kHz stereo. Transcription: 16 kHz mono WAV.
export function discordPcmToWav(pcm) {
 if(!Buffer.isBuffer(pcm)||pcm.length<12||pcm.length>3840000||pcm.length%4)throw new Error('Ugyldigt lydformat.');
 const frames=Math.floor(pcm.length/12),output=Buffer.alloc(44+frames*2);
 output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVEfmt ',8);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);
 output.writeUInt32LE(16000,24);output.writeUInt32LE(32000,28);output.writeUInt16LE(2,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++){let sum=0;for(let j=0;j<6;j++)sum+=pcm.readInt16LE(i*12+j*2);output.writeInt16LE(Math.round(sum/6),44+i*2);}return output;
}
// Provider's PCM output is 24 kHz mono s16le; Discord Raw expects 48 kHz stereo.
export function speechPcmToDiscord(pcm) {
 if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2||pcm.length>2880000)throw new Error('Ugyldigt talesvar.');
 const result=Buffer.alloc(pcm.length*4);
 for(let i=0;i<pcm.length/2;i++){const a=pcm.readInt16LE(i*2),b=i+1<pcm.length/2?pcm.readInt16LE(i*2+2):a;
  for(let c=0;c<2;c++){result.writeInt16LE(a,i*8+c*2);result.writeInt16LE(Math.round((a+b)/2),i*8+4+c*2);}}
 return result;
}
async function boundedBody(response,maxBytes){let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Lydsvaret oversteg grænsen.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
export function createDiscordAudio({apiKey,control,fetcher=fetch,speechRenderer=renderRealtimeSpeech,env={}}) {
 const request=async(path,body,headers,signal,maxBytes,model)=>{
  const scope=control.current(),id=await control.reserve({model,max_output_tokens:1},scope);
  try {
   const result=await control.controlled(async stopped=>{
    const response=await fetcher('https://api.openai.com/v1/audio/'+path,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,...headers},body,signal:AbortSignal.any([stopped,signal,AbortSignal.timeout(30000)])});
    if(!response.ok){await response.body?.cancel();throw new Error('Lydudbyderen afviste anmodningen.');}
    return boundedBody(response,maxBytes);
   },scope);
   // Request admission only. Audio tokens/currency are deliberately NOT inferred.
   await control.settle(id,null,'completed');return result;
  }catch(error){await control.settle(id,null,'unknown').catch(()=>{});throw error;}
 };
 const transcribeWav=async(wav,signal)=>{
   if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>1_930_000||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('Ugyldigt WAV-uddrag.');
   const form=new FormData(),model=env.OPENAI_DISCORD_TRANSCRIBE_MODEL||'gpt-transcribe';
   form.set('model',model);form.set(model.startsWith('gpt-transcribe')?'languages[]':'language','da');form.set('file',new Blob([wav],{type:'audio/wav'}),'speech.wav');
   const data=JSON.parse((await request('transcriptions',form,{},signal,16000,model)).toString());
   if(typeof data.text!=='string'||data.text.length>5000)throw new Error('Transskriptionen er ugyldig.');return data.text;
 };
 return {
  transcribeWav,
  transcribe(pcm,signal){return transcribeWav(discordPcmToWav(pcm),signal);},
  async speak(text,signal){if(typeof text!=='string'||!text.trim()||text.length>1600)throw new Error('Talesvaret er for langt.');
   const model=env.OPENAI_DISCORD_TTS_MODEL||'gpt-realtime-2.1-mini',scope=control.current(),id=await control.reserve({model,max_output_tokens:1},scope);
   try{
    const pcm=await control.controlled(stopped=>speechRenderer({text,apiKey,model,signal:AbortSignal.any([stopped,signal])}),scope);
    const audio=speechPcmToDiscord(pcm);await control.settle(id,null,'completed');return audio;
   }catch(error){await control.settle(id,null,'unknown').catch(()=>{});throw error;}
  }
 };
}
