import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRecipeDraft} from '../recipe-extractor.mjs';
import {createIsolatedMedia} from '../isolated-media.mjs';
const image={buffer:Buffer.from('untrusted-original'),contentType:'image/png'};
const normalized={version:1,kind:'image',width:1,height:1,frames:[{seconds:0,data:Buffer.from([255,216,255,1]).toString('base64')}],wav:null};
test('recipe images use separate opt-in and must be normalized before any model request',async()=>{
 let calls=0;const request=async()=>{calls++;throw Error('unexpected');};
 assert.equal(createIsolatedMedia({env:{JARVIS_RECIPE_IMAGES:'yes'}}),null);
 await assert.rejects(extractRecipeDraft({images:[image]},{request,model:'fixture'}),/Isoleret/);
 await assert.rejects(extractRecipeDraft({images:[image]},{request,model:'fixture',normalize:async()=>({...normalized,kind:'video',duration:1})}),/kun billeder/);
 await assert.rejects(extractRecipeDraft({images:[image]},{request,model:'fixture',normalize:async()=>{throw Error('containment unavailable');}}));
 assert.equal(calls,0);
});
test('model receives only the normalized JPEG, no tools or original bytes',async()=>{
 let received;const controller=new AbortController();
 const result=await extractRecipeDraft({text:'Gem opskrift',images:[image],signal:controller.signal},{model:'fixture',normalize:async(input,{signal})=>{assert.equal(input,image);assert.equal(signal,controller.signal);return normalized;},request:async(body,signal)=>{received=body;assert.equal(signal,controller.signal);return {status:'completed',output:[{content:[{type:'output_text',text:'{"title":"Kladde"}'}]}]};}});
 assert.equal(result.title,'Kladde');assert.deepEqual(received.tools,[]);assert.equal(received.store,false);
 assert.equal(received.input[0].content[1].image_url,'data:image/jpeg;base64,'+normalized.frames[0].data);
 assert.equal(JSON.stringify(received).includes(image.buffer.toString('base64')),false);
});
test('missing image isolation yields a precise inbox diagnostic and never confirms a recipe',async()=>{
 const {RecipeMemory}=await import('../recipe-memory.mjs');const {mkdtemp}=await import('node:fs/promises');const state={recipes:[]};
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFzoAAAAASUVORK5CYII=','base64');
 const channelId='323456789012345678',id='523456789012345678';let calls=0;
 const memory=new RecipeMemory({state,dataDirectory:await mkdtemp('/tmp/recipe-isolation-'),extractor:input=>extractRecipeDraft(input,{model:'fixture',request:()=>{calls++;throw Error('unexpected model');}}),fetchResource:async()=>({contentType:'image/png',buffer:png})});
 const recipe=await memory.capture({attachments:[{id,filename:'recipe.png',contentType:'image/png',size:png.length,url:`https://cdn.discordapp.com/attachments/${channelId}/${id}/recipe.png`}],source:{channel:'discord',channelId,messageId:'423456789012345678'}});
 assert.equal(calls,0);assert.equal(recipe.confirmed,false);assert.match(recipe.extraction.messages.join(' '),/Isoleret opskriftsbilledudtræk er ikke konfigureret/);assert.deepEqual(memory.usable(),[]);
});
