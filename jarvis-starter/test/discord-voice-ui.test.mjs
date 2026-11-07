import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public/assistant-control.js',import.meta.url),'utf8');
function fixture(api){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{id,textContent:'',value:'33333333333333333',disabled:false,classList:{contains:()=>false},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:get},token:'synthetic-owner',api});vm.runInContext(code,context);return {get,context,click:id=>get(id).handlers.click()};
}
const status={stopped:false,calls:0,limits:{callsPerDay:200,outputTokensPerDay:300000},reservedOrUsedOutputTokens:0,unresolved:0,discordVoice:{enabled:true,generation:7,channelId:'11111111111111111'}};
test('M5 web stop can interrupt pending join and late result cannot claim listening',async()=>{
 let resolve,entered;const pending=new Promise(r=>resolve=r),ready=new Promise(r=>entered=r),calls=[];
 const f=fixture(async(path,options)=>{if(!options)return status;const body=JSON.parse(options.body);calls.push(body);if(body.action==='start'){entered();return pending;}return status.discordVoice;});
 const join=f.click('discord-voice-start');await ready;assert.equal(f.get('discord-voice-stop').disabled,false);
 await f.click('discord-voice-stop');assert.match(f.get('discord-voice-action-status').textContent,/Stop er registreret/);
 resolve(status.discordVoice);await join;assert.doesNotMatch(f.get('discord-voice-action-status').textContent,/Lytter/);assert.equal(calls[0].expectedGeneration,7);assert.equal(calls[1].action,'stop');
});
test('M5 stop during status preflight prevents a late join POST',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),calls=[];
 const f=fixture(async(path,options)=>{if(!options)return pending;calls.push(JSON.parse(options.body));return status.discordVoice;});
 const join=f.click('discord-voice-start');await f.click('discord-voice-stop');resolve(status);await join;assert.deepEqual(calls,[{action:'stop',textChannelId:'33333333333333333'}]);
});
test('M5 global stop and logout invalidate pending voice UI completion',async()=>{
 for(const action of ['assistant-control-stop','logout']){
  let resolve,entered;const pending=new Promise(r=>resolve=r),ready=new Promise(r=>entered=r);
  const f=fixture(async(path,options)=>{if(!options)return status;if(path==='/api/discord/voice'){entered();return pending;}return {...status,stopped:true};});
  const join=f.click('discord-voice-start');await ready;await f.click(action);resolve(status.discordVoice);await join;
  assert.doesNotMatch(f.get('discord-voice-action-status').textContent,/Lytter/);
 }
});
