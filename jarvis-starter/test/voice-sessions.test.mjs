import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSessions } from '../voice-sessions.mjs';
import { ProviderControl } from '../provider-control.mjs';
import { DurableState } from '../durable-state.mjs';
async function fixture({hangup=async()=>true,initial={}}={}) {
 const store=new DurableState({initial,write:async()=>{}});await store.initialize();
 const args={state:store.state,transact:(...a)=>store.transact(...a),save:()=>store.save()};
 const control=new ProviderControl({...args});
 const voice=new VoiceSessions({...args,control,hangup,env:{JARVIS_VOICE_SECONDS_PER_SESSION:'10',JARVIS_VOICE_SECONDS_PER_DAY:'20'}});
 return {voice,control,store,args};
}
test('voice session requires exact owner, active lease and live stop generation',async()=>{
 const {voice,control}=await fixture();const scope=control.current();const id=await voice.reserve(scope,'owner');
 assert.throws(()=>voice.authorize(id,'owner'));
 await voice.attach(id,'/v1/realtime/calls/rtc_synthetic');
 assert.throws(()=>voice.authorize(id,'someone-else'));
 assert.equal(voice.authorize(id,'owner').generation,scope.generation);
 await control.stop(true);await control.stop(false);
 assert.throws(()=>voice.authorize(id,'owner'));
 await voice.closeAll();assert.equal(voice.snapshot().active,0);
});
test('voice reservations serialize admission and survive a restart without resetting the limit',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.voice.reserve(f.control.current(),'owner'),f.voice.reserve(f.control.current(),'owner')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const id=results.find(r=>r.status==='fulfilled').value;
 await f.voice.attach(id,'/v1/realtime/calls/rtc_1');await f.voice.close(id);
 const id2=await f.voice.reserve(f.control.current(),'owner');await f.voice.attach(id2,'/v1/realtime/calls/rtc_2');await f.voice.close(id2);
 const second=await fixture({initial:JSON.parse(JSON.stringify(f.store.state))});
 await assert.rejects(second.voice.reserve(second.control.current(),'owner'),/opbrugt/);
});
test('failed hangup remains unknown and prevents a new session',async()=>{
 const {voice,control}=await fixture({hangup:async()=>false});const id=await voice.reserve(control.current(),'owner');
 await voice.attach(id,'/v1/realtime/calls/rtc_1');await voice.close(id);
 assert.equal(voice.snapshot().unresolved,1);assert.throws(()=>voice.authorize(id,'owner'));
 await assert.rejects(voice.reserve(control.current(),'owner'),/uafklaret/);
});
test('stop during creation closes the newly returned provider call and never authorizes it',async()=>{
 let ended=0;const {voice,control}=await fixture({hangup:async()=>{ended++;return true;}});
 const id=await voice.reserve(control.current(),'owner');await control.stop(true);
 await assert.rejects(voice.attach(id,'/v1/realtime/calls/rtc_late'));
 assert.equal(ended,1);assert.equal(voice.snapshot().active,0);
});
test('malicious provider Location cannot direct hangup to a different URL',async()=>{
 const {voice,control}=await fixture();const id=await voice.reserve(control.current(),'owner');
 for(const url of ['https://evil.org/v1/realtime/calls/a','/v1/realtime/calls/a?secret=1','/v1/realtime/calls/../admin'])
 await assert.rejects(voice.attach(id,url));
 assert.throws(()=>voice.authorize(id,'owner'));
});

test('known provider rejection closes reservation; ambiguous server failure remains blocked',async()=>{
 const f=await fixture();const id=await f.voice.reserve(f.control.current(),'owner');
 await f.voice.rejected(id,500);await assert.rejects(f.voice.reserve(f.control.current(),'owner'));
 await f.voice.rejected(id,400);const next=await f.voice.reserve(f.control.current(),'owner');assert.notEqual(next,id);
 await f.voice.rejected(next,429);
});
