import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRecipeDraft } from '../recipe-extractor.mjs';

test('recipe image extraction is a bounded draft-only request without tools or account context', async () => {
  let payload;
  const result = await extractRecipeDraft({ text: 'Opskrift: tomatsuppe', images: [{ buffer: Buffer.from([1, 2, 3]), contentType: 'image/png' }] },
    { model: 'configured-model', normalize:async()=>({version:1,kind:'image',width:1,height:1,frames:[{seconds:0,data:Buffer.from([255,216,255,1]).toString('base64')}],wav:null}),request: async body => {
      payload = body;
      return { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"title":"Tomatsuppe","diet":"unknown","minutes":null,"servings":null,"ingredients":[],"themes":[],"instructions":""}' }] }] };
    } });
  assert.equal(payload.model, 'configured-model'); assert.equal(payload.store, false);
  assert.deepEqual(payload.tools, []); assert.equal(payload.text.format.strict, true);
  assert.equal(payload.input[0].content[1].type, 'input_image');
  assert.match(payload.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(result.diet, 'unknown'); assert.equal(result.confirmed, undefined);
});

test('recipe extractor refuses unsupported media and incomplete or refused output without a retry', async () => {
  let calls = 0; const request = async () => { calls++; return { status: 'incomplete' }; };
  await assert.rejects(extractRecipeDraft({ images: [{ buffer: Buffer.from('svg'), contentType: 'image/svg+xml' }] }, { request, model: 'configured' }), /Ugyldigt/);
  assert.equal(calls, 0);
  await assert.rejects(extractRecipeDraft({ text: 'recipe' }, { request, model: 'configured' }), /fuldstændigt/);
  assert.equal(calls, 1);
});
