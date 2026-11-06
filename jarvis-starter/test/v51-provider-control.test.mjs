import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderControl } from '../provider-control.mjs';
import { DurableState } from '../durable-state.mjs';
async function fixture({ initial = {}, env = {}, now = () => new Date('2026-11-06T12:00:00Z'), write = async () => {} } = {}) {
  const store = new DurableState({ initial, write }); await store.initialize();
  const control = new ProviderControl({ state: store.state, transact: (...a) => store.transact(...a), save: () => store.save(), env, now, isTransactionActive: () => Boolean(store.context.getStore()) });
  return { store, control };
}
const options = { method: 'POST', body: { model: 'synthetic-model', input: 'test', max_output_tokens: 100 } };
test('atomic admission prevents concurrent calls exceeding the daily limit', async () => {
  const { control } = await fixture({ env: { JARVIS_API_CALLS_PER_DAY: '1' } }); let sends = 0;
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => control.request('/responses', options, async () => { sends++; return { status: 'completed', usage: { input_tokens: 3, output_tokens: 5 } }; })));
  assert.equal(sends, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(control.snapshot().reservedOrUsedOutputTokens, 5);
});
test('a timed-out paid request keeps its reservation after restart and midnight', async () => {
  const { control, store } = await fixture();
  await assert.rejects(control.request('/responses', options, async () => { throw new Error('private upstream'); }));
  const restarted = (await fixture({ initial: JSON.parse(JSON.stringify(store.state)), now: () => new Date('2026-11-07T12:00:00Z') })).control;
  assert.equal(restarted.snapshot().reservedOrUsedOutputTokens, 100); assert.equal(restarted.snapshot().unresolved, 1);
  assert.doesNotMatch(JSON.stringify(restarted.snapshot()), /private upstream|"input":/);
});
test('background polling reconciles usage without charging another creation', async () => {
  const { control } = await fixture();
  await control.request('/responses', options, async () => ({ id: 'resp_synthetic', status: 'queued' }));
  await control.request('/responses/resp_synthetic', {}, async () => ({ id: 'resp_synthetic', status: 'completed', usage: { input_tokens: 20, output_tokens: 30 } }));
  assert.equal(control.snapshot().calls, 1); assert.equal(control.snapshot().reservedOrUsedOutputTokens, 30);
});
test('missing usage never releases a reservation', async () => {
  const { control } = await fixture();
  await control.request('/responses', options, async () => ({ status: 'completed' }));
  assert.equal(control.snapshot().reservedOrUsedOutputTokens, 100);
});
test('persisted stop rejects new calls; resume never revives an older scope', async () => {
  const { control } = await fixture(); const old = control.scope(); let sends = 0;
  await control.stop(true);
  await assert.rejects(control.request('/responses', options, async () => { sends++; }), { code: 'ASSISTANT_STOPPED' });
  await control.stop(false);
  await assert.rejects(control.run(() => control.request('/responses', options, async () => { sends++; }), old), { code: 'ASSISTANT_STOPPED' });
  assert.equal(sends, 0);
});
test('stop aborts active fetch, conservatively retaining its possible cost', async () => {
  const { control } = await fixture(); let started; const ready = new Promise(r => { started = r; });
  const call = control.request('/responses', options, async (_, o) => { started(); return new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted')))); });
  const rejected = assert.rejects(call); await ready; await control.stop(true); await rejected;
  assert.equal(control.snapshot().unresolved, 1);
});
test('failed durable admission sends nothing', async () => {
  let fail = false, sends = 0;
  const { control } = await fixture({ write: async () => { if (fail) throw new Error('disk full'); } }); fail = true;
  await assert.rejects(control.request('/responses', options, async () => { sends++; })); assert.equal(sends, 0);
});
test('request and output limits reject before sending; config is fail-closed', async () => {
  const { control } = await fixture({ env: { JARVIS_API_INPUT_BYTES: '5' } });
  await assert.rejects(control.request('/responses', options, async () => assert.fail('must not send')), { code: 'API_REQUEST_LIMIT' });
  await assert.rejects(fixture({ env: { JARVIS_API_CALLS_PER_DAY: 'NaN' } }));
});

test('nested state transaction cannot send before its reservation becomes durable', async () => {
  const { control, store } = await fixture(); let sends = 0;
  await assert.rejects(store.transact([], () => control.request('/responses', options, async () => { sends++; })), { code: 'API_TRANSACTION_SCOPE' });
  assert.equal(sends, 0);
});

test('hosted search invocations are reserved before send and cannot exceed the daily cap',async()=>{
 const {control}=await fixture({env:{JARVIS_HOSTED_TOOL_CALLS_PER_DAY:'2'}});
 let sends=0;
 const send=async(path,options)=>{sends++;assert.equal(options.body.max_tool_calls,2);return {status:'completed',usage:{input_tokens:1,output_tokens:1}};};
 await control.request('/responses',{method:'POST',body:{tools:[{type:'web_search'}]}},send);
 await assert.rejects(control.request('/responses',{method:'POST',body:{tools:[{type:'web_search'}]}},send),/grænse/);
 assert.equal(sends,1);assert.equal(control.snapshot().reservedHostedToolCalls,2);
});
test('OpenClaw search uses shared durable request admission and preserves unknown reservations',async()=>{
 const {control}=await fixture({env:{JARVIS_API_CALLS_PER_DAY:'1'}});
 await assert.rejects(control.externalSearch(async()=>{throw new Error('transport');}));
 await assert.rejects(control.externalSearch(async()=>assert.fail('must not send')),/grænse/);
 assert.equal(control.snapshot().unresolved,1);
});
