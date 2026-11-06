import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscordVoice} from '../discord-voice.mjs';
import {discordPcmToWav,speechPcmToDiscord,createDiscordAudio} from '../discord-audio.mjs';
import {ProviderControl} from '../provider-control.mjs';
import {DurableState} from '../durable-state.mjs';
const ownerId='111111111111111111',guildId='222222222222222222',channelId='333333333333333333',textChannelId='444444444444444444';
async function fixture(overrides={}){
 const store=new DurableState({initial:{},write:async()=>{}});await store.initialize();
 const state=store.state,save=()=>store.save(),transact=(...a)=>store.transact(...a);
 const control=new ProviderControl({state,save,transact}),seen=[];
 const connection={listen(){seen.push('listen');},close(){seen.push('close');},async play(){seen.push('play');}};
 const voice=new DiscordVoice({state,save,transact,control,config:()=>({userId:ownerId,guildId}),enabled:true,channelId,
 connect:async()=>connection,transcribe:async()=>{seen.push('transcribe');return 'Hvad skal vi spise?';},reply:async()=>{seen.push('reply');return 'Et syntetisk svar';},
 speak:async()=>{seen.push('speak');return Buffer.alloc(100);},notify:async()=>{seen.push('notify');},...overrides});
 return {voice,state,control,seen,connection};
}
const identity={ownerId,guildId,textChannelId};
test('Discord voice rejects foreign owner/server and remains opt-in',async()=>{
 const f=await fixture();await assert.rejects(f.voice.join({...identity,ownerId:channelId}));await assert.rejects(f.voice.join({...identity,guildId:channelId}));
 f.voice.enabled=false;await assert.rejects(f.voice.join(identity));assert.deepEqual(f.seen,[]);assert.equal(f.state.discordVoiceSessions,undefined);
});
test('Discord voice announces before listening and never transcribes another user',async()=>{
 const f=await fixture();await f.voice.join(identity);const id=f.voice.active.id;
 assert.deepEqual(f.seen,['notify','listen']);await f.voice.receive(id,channelId,Buffer.alloc(38400));assert.equal(f.seen.includes('transcribe'),false);
 await f.voice.receive(id,ownerId,Buffer.alloc(38400));assert.deepEqual(f.seen,['notify','listen','transcribe','reply','notify','speak','play']);
 const scope=f.voice.active.scope;await f.voice.stop();assert.throws(()=>f.control.assertAllowed(scope));assert.equal(f.voice.snapshot().status,'disconnected');assert.equal(f.state.discordVoiceSessions[0].status,'closed');
});
test('stop while connecting destroys a late connection and cannot start listening',async()=>{
 let resolve,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>resolve=r);
 const f=await fixture({connect:async()=>{entered();return pending;}});
 const joining=f.voice.join(identity);const rejected=assert.rejects(joining);await ready;await f.voice.stop();resolve(f.connection);await rejected;
 assert.deepEqual(f.seen,['close']);assert.equal(f.voice.snapshot().status,'disconnected');
});
test('voice stop aborts pending transcription and cannot dispatch a late answer',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const f=await fixture({transcribe:async(_pcm,signal)=>{entered(signal);await pending;return 'Opret opgave';}});
 await f.voice.join(identity);const receiving=f.voice.receive(f.voice.active.id,ownerId,Buffer.alloc(38400));const signal=await ready;
 await f.voice.stop();assert.equal(signal.aborted,true);release();await receiving;assert.equal(f.seen.includes('reply'),false);
});
test('late join failure and disconnect from an old session cannot close its replacement',async()=>{
 let release,entered,oldOptions,calls=0;
 const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const f=await fixture({connect:async options=>{if(calls++===0){oldOptions=options;entered();return pending;}return f.connection;}});
 const joining=f.voice.join(identity),rejected=assert.rejects(joining);
 await ready;await f.voice.stop();await f.voice.join(identity);const replacement=f.voice.active.id;
 let oldClosed=false;release({close(){oldClosed=true;}});await rejected;
 await oldOptions.onDisconnect();
 assert.equal(oldClosed,true);assert.equal(f.voice.active.id,replacement);assert.equal(f.voice.snapshot().status,'listening');
 await f.voice.stop();
});
test('voice day reservations survive recovery and do not reconnect sessions',async()=>{
 const f=await fixture({secondsPerSession:5,secondsPerDay:5});await f.voice.join(identity);await f.voice.stop();await f.voice.recover();
 await assert.rejects(f.voice.join(identity),/opbrugt/);assert.equal(f.voice.snapshot().reservedSecondsToday,5);assert.equal(f.voice.active,null);
});
test('audio conversion checks channel order, duration and byte bounds',()=>{
 const input=Buffer.alloc(12);for(let i=0;i<6;i++)input.writeInt16LE(1000,i*2);const wav=discordPcmToWav(input);
 assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readInt16LE(44),1000);assert.equal(wav.length,46);
 const mono=Buffer.alloc(4);mono.writeInt16LE(1000);mono.writeInt16LE(2000,2);
 const stereo=speechPcmToDiscord(mono);assert.deepEqual([0,2,4,6].map(i=>stereo.readInt16LE(i)),[1000,1000,1500,1500]);
 assert.throws(()=>discordPcmToWav(Buffer.alloc(3840004)));assert.throws(()=>speechPcmToDiscord(Buffer.alloc(3)));
});
test('audio provider reserves before transport, aborts on stop and never retries',async()=>{
 const f=await fixture();let calls=0;
 const audio=createDiscordAudio({apiKey:'synthetic',control:f.control,fetcher:async()=>{calls++;throw new Error('synthetic network failure');}});
 await assert.rejects(audio.transcribe(Buffer.alloc(38400),new AbortController().signal));assert.equal(calls,1);assert.equal(f.control.snapshot().unresolved,1);
 await f.control.stop(true);await assert.rejects(audio.speak('Hej',new AbortController().signal));assert.equal(calls,1);
});
test('Discord audio follows current file-transcription fields and shares stop control with Realtime speech',async()=>{
 const f=await fixture();let form,spoken;
 const audio=createDiscordAudio({apiKey:'synthetic',control:f.control,fetcher:async(_url,options)=>{form=options.body;return Response.json({text:'Hej'});},
  speechRenderer:async input=>{spoken=input;assert.equal(f.control.snapshot().calls,2);return Buffer.from([1,0,2,0]);}});
 assert.equal(await audio.transcribe(Buffer.alloc(38400),new AbortController().signal),'Hej');
 assert.equal(form.get('model'),'gpt-transcribe');assert.equal(form.get('languages[]'),'da');assert.equal(form.has('language'),false);
 assert.equal((await audio.speak('Hej',new AbortController().signal)).length,16);assert.equal(spoken.model,'gpt-realtime-2.1-mini');
 assert.equal(f.control.snapshot().calls,2);assert.equal(f.control.snapshot().reservedOrUsedOutputTokens,0,'request accounting is not an invented audio token measurement');
});
