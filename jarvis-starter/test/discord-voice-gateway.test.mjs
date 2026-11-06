import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscordGateway} from '../discord-gateway.mjs';
const guild='222222222222222222',owner='111111111111111111',bot='999999999999999999',channel='333333333333333333';
const event=(t,d)=>({data:JSON.stringify({op:0,t,d})});
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
