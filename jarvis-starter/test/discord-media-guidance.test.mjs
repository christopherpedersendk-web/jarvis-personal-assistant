import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscordMedia} from '../discord-media.mjs';
const owner='11111111111111111',guild='22222222222222222';
const meta={ownerId:owner,guildId:guild,channelId:'33333333333333333',messageId:'44444444444444444',mediaCount:1};
function fixture(){
 let calls=0;const unexpected=()=>{calls++;throw Error('unexpected work');};
 const state={},work=new DiscordMedia({state,transact:unexpected,save:unexpected,download:unexpected,normalize:unexpected,request:unexpected,enabled:false,config:()=>({enabled:true,token:'synthetic',userId:owner,guildId:guild}),control:{current:()=>({}),assertAllowed:()=>{}}});
 return {work,state,calls:()=>calls};
}
test('disabled standalone upload explains same-message recipe intake without processing or saving',async()=>{
 const f=fixture(),answer=await f.work.analyze('',meta);
 assert.match(answer,/ikke analyseret eller gemt/);
 assert.match(answer,/vedhæft det igen/);assert.match(answer,/Gem opskrift:/);assert.match(answer,/samme besked/);
 assert.match(answer,/højst 2 MB/);assert.match(answer,/udtræk er ikke garanteret/);
 assert.match(answer,/tekstbesked alene henter ikke/);
 assert.equal(f.calls(),0);assert.deepEqual(f.state,{});
});
test('disabled-media guidance still requires the existing sender and stop checks',async()=>{
 const f=fixture();await assert.rejects(f.work.analyze('',{...meta,ownerId:guild}));
 f.work.control.assertAllowed=()=>{throw Error('stopped');};await assert.rejects(f.work.analyze('',meta),/stopped/);
 assert.equal(f.calls(),0);assert.deepEqual(f.state,{});
});

