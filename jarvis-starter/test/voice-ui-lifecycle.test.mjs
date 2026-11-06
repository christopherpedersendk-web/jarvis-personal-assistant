import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function stopVoice() {'),source.indexOf("$('voice-toggle').addEventListener('click'"));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({media,api}={}){
 const closed=[],peers=[],elements=new Map();let stoppedTracks=0,tools=0;
 const stream={getTracks:()=>[{stop:()=>stoppedTracks++}]};
 const ctx={token:'synthetic-owner',voiceGeneration:0,voiceLease:null,voicePoll:null,peer:null,microphone:null,remoteAudio:null,startingVoice:false,aiReady:true,
  $:id=>{if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}}});return elements.get(id);},
  window:{isSecureContext:true},navigator:{mediaDevices:{getUserMedia:()=>media?.promise||Promise.resolve(stream)}},
  document:{createElement:()=>({play:async()=>{},pause(){}})},
  RTCPeerConnection:class {constructor(){peers.push(this);}close(){this.closed=true;}addTrack(){}createDataChannel(){return this.channel={readyState:'open'};}async createOffer(){return {sdp:'synthetic-offer'};}async setLocalDescription(){}async setRemoteDescription(){this.remote=true;}},
  api:api||(async()=>''),fetch:async(_path,options)=>{closed.push(JSON.parse(options.body).leaseId);return {ok:true};},setInterval:()=>1,clearInterval(){},
  toast(){},openAiSetup(){},recordTranscript(){},handleVoiceTool:async()=>{tools++;},JSON};
 vm.runInNewContext(code+'\nglobalThis.operations={startVoice,stopVoice};',ctx);
 return {ctx,stream,closed,peers,stoppedTracks:()=>stoppedTracks,tools:()=>tools,...ctx.operations};
}
test('stopping during microphone permission prevents connection and stops a late microphone',async()=>{
 const media=deferred(),f=fixture({media});const starting=f.startVoice();f.stopVoice();media.resolve(f.stream);await starting;
 assert.equal(f.peers.length,0);assert.equal(f.stoppedTracks(),1);assert.equal(f.ctx.startingVoice,false);
});
test('late SDP after stop is closed with its original lease and cannot replace a newer session',async()=>{
 const requests=[],f=fixture({api:async(path,options)=>{if(path==='/api/voice/close')return {};const d=deferred();requests.push({options,...d});return d.promise;}});
 const first=f.startVoice();while(requests.length<1)await new Promise(r=>setImmediate(r));f.stopVoice();
 const second=f.startVoice();while(requests.length<2)await new Promise(r=>setImmediate(r));
 requests[1].options.responseMeta.leaseId='new-lease';requests[1].resolve('new-sdp');await second;
 requests[0].options.responseMeta.leaseId='old-lease';requests[0].resolve('old-sdp');await first;
 assert.deepEqual(f.closed,['old-lease']);assert.equal(f.ctx.voiceLease,'new-lease');assert.equal(f.peers[1].remote,true);assert.equal(f.peers[0].remote,undefined);
 f.peers[0].channel.onmessage({data:JSON.stringify({type:'response.output_item.done',item:{type:'function_call'}})});assert.equal(f.tools(),0);f.stopVoice();
});
