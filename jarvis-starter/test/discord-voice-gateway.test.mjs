import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscordGateway} from '../discord-gateway.mjs';
import {DiscordVoice} from '../discord-voice.mjs';
import {ProviderControl} from '../provider-control.mjs';
import {DurableState} from '../durable-state.mjs';
const guild='222222222222222222',owner='111111111111111111',bot='999999999999999999',channel='333333333333333333';
const event=(t,d)=>({data:JSON.stringify({op:0,t,d})});
test('M5 owner mute and departure tear down the same transport immediately',()=>{
 for(const change of [{self_mute:true},{mute:true},{channel_id:null}]){
  let stopped=0,destroyed=0;const g=new DiscordGateway({onMessage:()=>{},voiceEnabled:true,onVoiceUnavailable:()=>{stopped++;}});
  g.config={guildId:guild,userId:owner};g.botId=bot;g.voiceStates.set(owner,{user_id:owner,guild_id:guild,channel_id:channel});g.voiceStates.set(bot,{user_id:bot,guild_id:guild,channel_id:channel});
  g.voiceAdapterCreator(guild)({destroy:()=>{destroyed++;}});g.handleGatewayMessage(event('VOICE_STATE_UPDATE',{guild_id:guild,user_id:owner,channel_id:channel,...change}),g.generation);
  assert.equal(stopped,1);assert.equal(destroyed,1);assert.equal(g.voiceAdapters.size,0);
 }
});
test('voice adapter reuses the existing gateway and accepts only configured guild events',()=>{
 const g=new DiscordGateway({onMessage:()=>{},voiceEnabled:true});g.config={guildId:guild,userId:owner};g.botId=bot;g.status='connected';
 const received=[];g.socket={readyState:1,send:value=>received.push(JSON.parse(value))};
 const methods={onVoiceStateUpdate:d=>received.push(d),onVoiceServerUpdate:d=>received.push(d),destroy:()=>received.push('destroy')};
 const adapter=g.voiceAdapterCreator(guild)(methods);
 assert.equal(adapter.sendPayload({op:4,d:{guild_id:guild,channel_id:channel}}),true);
 assert.equal(adapter.sendPayload({op:4,d:{guild_id:owner}}),false);assert.equal(adapter.sendPayload({op:2,d:{guild_id:guild}}),false);
 g.handleGatewayMessage(event('GUILD_CREATE',{id:guild,voice_states:[{user_id:owner,channel_id:channel}]}),g.generation);
 g.handleGatewayMessage(event('VOICE_SERVER_UPDATE',{guild_id:owner,endpoint:'not-used'}),g.generation);assert.equal(received.length,1);
 g.handleGatewayMessage(event('VOICE_SERVER_UPDATE',{guild_id:guild,endpoint:'synthetic'}),g.generation);assert.equal(received.length,2);
 assert.deepEqual(g.voiceMembers(guild,channel),[owner]);adapter.destroy();assert.equal(g.voiceAdapters.size,0);
});
test('another participant entering the selected channel tears down the voice adapter',async()=>{
 let stopped=0,destroyed=0;const g=new DiscordGateway({onMessage:()=>{},voiceEnabled:true,onVoiceUnavailable:()=>{stopped++;}});
 g.config={guildId:guild,userId:owner};g.botId=bot;
 g.voiceStates.set(owner,{user_id:owner,guild_id:guild,channel_id:channel});g.voiceStates.set(bot,{user_id:bot,guild_id:guild,channel_id:channel});
 g.voiceAdapterCreator(guild)({destroy:()=>{destroyed++;}});
 g.handleGatewayMessage(event('VOICE_STATE_UPDATE',{guild_id:guild,user_id:'888888888888888888',channel_id:channel}),g.generation);
 assert.equal(destroyed,1);assert.equal(stopped,1);assert.equal(g.voiceAdapters.size,0);
});
test('voice listening announcement uses the real gateway sender and stops on unconfirmed delivery',async()=>{
 for(const succeeds of [true,false]){
  const sent=[],events=[];
  const gateway=new DiscordGateway({onMessage:()=>{},voiceEnabled:true,fetcher:async(_url,options)=>{
   sent.push(JSON.parse(options.body));events.push('send');return {ok:succeeds,status:succeeds?200:403};
  }});gateway.config={enabled:true,guildId:guild,userId:owner,token:'synthetic-gateway-token'};gateway.generation=7;
  const store=new DurableState({initial:{},write:async()=>{}});await store.initialize();
  const state=store.state,save=()=>store.save(),transact=(...args)=>store.transact(...args);
  const control=new ProviderControl({state,save,transact});
  const voice=new DiscordVoice({state,save,transact,control,enabled:true,channelId:channel,config:()=>gateway.config,
   connect:async()=>({close:()=>events.push('close'),listen:()=>events.push('listen')}),notify:gateway.sendVoiceReply.bind(gateway)});
  if(succeeds){await voice.join({ownerId:owner,guildId:guild,textChannelId:channel});assert.deepEqual(events,['send','listen']);await voice.stop();}
  else{await assert.rejects(voice.join({ownerId:owner,guildId:guild,textChannelId:channel}));assert.deepEqual(events,['send','close']);assert.equal(voice.snapshot().status,'disconnected');}
  assert.equal(sent.length,1);assert.match(sent[0].content,/AI-genereret/);assert.deepEqual(sent[0].allowed_mentions,{parse:[]});
 }
});
