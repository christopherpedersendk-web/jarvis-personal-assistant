import {Readable} from 'node:stream';
import prism from 'prism-media';
import {joinVoiceChannel,entersState,VoiceConnectionStatus,EndBehaviorType,createAudioPlayer,createAudioResource,StreamType,AudioPlayerStatus,NoSubscriberBehavior} from '@discordjs/voice';
// This adapter uses Jarvis' existing Gateway. It never logs in another bot.
export async function connectDiscordVoice({gateway,guildId,channelId,ownerId,onAudio,onDisconnect}) {
 const members=gateway.voiceMembers(guildId,channelId);
 if(!members.includes(ownerId)||members.some(id=>id!==ownerId&&id!==gateway.botId))throw new Error('Stemmekanalen skal indeholde ejeren og ingen andre deltagere.');
 const connection=joinVoiceChannel({guildId,channelId,selfDeaf:false,selfMute:false,adapterCreator:gateway.voiceAdapterCreator(guildId),group:'jarvis'});
 let closed=false,listening=false,capture=null;
 const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});
 const close=()=>{if(closed)return;closed=true;listening=false;capture?.destroy();capture=null;player.stop(true);connection.destroy();};
 connection.on('error',()=>{close();Promise.resolve(onDisconnect()).catch(()=>{});});
 connection.on('stateChange',(_before,after)=>{if(!closed&&[VoiceConnectionStatus.Disconnected,VoiceConnectionStatus.Destroyed].includes(after.status)){close();Promise.resolve(onDisconnect()).catch(()=>{});}});
 try{await entersState(connection,VoiceConnectionStatus.Ready,15000);}catch{close();throw new Error('Discord-stemmetransporten kunne ikke etableres.');}
 connection.subscribe(player);
 connection.receiver.speaking.on('start',userId=>{
  if(closed||!listening||capture||userId!==ownerId)return;
  listening=false;
  const stream=connection.receiver.subscribe(ownerId,{end:{behavior:EndBehaviorType.AfterSilence,duration:800}});capture=stream;
  const decoder=new prism.opus.Decoder({rate:48000,channels:2,frameSize:960});
  let bytes=0,tooLong=false,chunks=[],done=false;
  const timer=setTimeout(()=>{tooLong=true;stream.destroy();decoder.destroy();finish();},20000);timer.unref();
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);stream.unpipe(decoder);stream.destroy();decoder.destroy();capture=null;
   const pcm=tooLong?null:Buffer.concat(chunks);chunks=[];
   Promise.resolve(!closed&&pcm?onAudio(pcm):undefined).catch(()=>{}).finally(()=>{if(!closed)listening=true;});};
  stream.on('error',()=>{tooLong=true;finish();});decoder.on('error',()=>{tooLong=true;finish();});decoder.on('end',finish);
  decoder.on('data',chunk=>{bytes+=chunk.length;if(bytes>3840000){tooLong=true;finish();}else chunks.push(chunk);});
  stream.pipe(decoder);
 });
 return {listen(){if(!closed)listening=true;},close,
  async play(pcm){if(closed)throw new Error('Stemmeforbindelsen er lukket.');
   player.play(createAudioResource(Readable.from([pcm]),{inputType:StreamType.Raw}));
   await entersState(player,AudioPlayerStatus.Playing,5000);await entersState(player,AudioPlayerStatus.Idle,65000);
  }};
}
