import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {renderRealtimeSpeech} from '../realtime-speech.mjs';
function fixture(){
 const socket=new EventEmitter(),sent=[],abort=new AbortController();let options,url;
 socket.readyState=1;socket.send=raw=>sent.push(JSON.parse(raw));socket.terminate=()=>{socket.terminated=true;socket.emit('close');};
 const result=renderRealtimeSpeech({text:'Syntetisk svar',apiKey:'synthetic-key',signal:abort.signal,socketFactory:(u,o)=>{url=u;options=o;return socket;}});
 const event=value=>socket.emit('message',Buffer.from(JSON.stringify(value)));
 const start=()=>{event({type:'session.created'});event({type:'session.updated'});event({type:'response.created',response:{id:'one'}});};
 return {socket,sent,abort,result,event,start,options,url};
}
test('Realtime speech uses one current-model response without tools, history or redirects',async()=>{
 const f=fixture();f.start();f.event({type:'session.updated'});
 assert.equal(new URL(f.url).searchParams.get('model'),'gpt-realtime-2.1-mini');assert.doesNotMatch(f.url,/synthetic-key/);
 assert.equal(f.options.followRedirects,false);assert.equal(f.options.maxPayload,512000);
 assert.equal(f.sent.length,2);assert.deepEqual(f.sent[0].session.tools,[]);assert.equal(f.sent[0].session.tool_choice,'none');
 const response=f.sent[1].response;assert.equal(response.conversation,'none');assert.deepEqual(response.tools,[]);assert.equal(response.max_output_tokens,4096);
 assert.equal(response.input[0].content[0].text,'Syntetisk svar');
 f.event({type:'response.output_audio.delta',response_id:'one',delta:Buffer.from([1,2,3,4]).toString('base64')});
 f.event({type:'response.done',response:{id:'one',status:'completed'}});
 assert.deepEqual(await f.result,Buffer.from([1,2,3,4]));assert.equal(f.socket.terminated,true);
});
test('Realtime speech abort closes connecting sockets and does not send or retry',async()=>{
 const f=fixture(),rejected=assert.rejects(f.result,/kunne ikke bekræftes/);f.abort.abort();await rejected;
 f.event({type:'session.created'});assert.deepEqual(f.sent,[]);assert.equal(f.socket.terminated,true);
});
test('Realtime speech rejects incomplete, mismatched or oversized responses without exposing provider errors',async()=>{
 for(const fail of ['error','incomplete','wrong-response','oversized']){
  const f=fixture(),rejected=assert.rejects(f.result,error=>/kunne ikke bekræftes/.test(error.message)&&!error.message.includes('synthetic-secret'));f.start();
  if(fail==='error')f.event({type:'error',error:{message:'synthetic-secret'}});
  if(fail==='incomplete')f.event({type:'response.done',response:{id:'one',status:'incomplete'}});
  if(fail==='wrong-response')f.event({type:'response.output_audio.delta',response_id:'other',delta:'AAAA'});
  if(fail==='oversized')for(let i=0;i<8;i++)f.event({type:'response.output_audio.delta',response_id:'one',delta:Buffer.alloc(400000).toString('base64')});
  await rejected;assert.equal(f.socket.terminated,true);assert.equal(f.sent.filter(x=>x.type==='response.create').length,1);
  assert.equal(f.sent.at(-1).type,'response.cancel');
 }
});
