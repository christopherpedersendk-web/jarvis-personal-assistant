import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BoundedJobQueue } from '../bounded-queue.mjs';
import { planningTools } from '../planning-tools.mjs';

const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const from = source.indexOf('const mutatingTools = new Set(');
const to = source.indexOf('\nawait stateStore.initialize();', from);
function fixture({ response, save = async () => {}, configured = true } = {}) {
  const calls = [], effects = [], history = [], queue = new BoundedJobQueue();
  const tool = { type: 'function', name: 'create_collection', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: [] } };
  const handler = async (name, args) => { effects.push({ name, args }); return { saved: true }; };
  const result = vm.runInNewContext(source.slice(from, to) + '\n({ processTextMessage, discord, classifyChatFailure })', {
    state: { history: [] }, process: { env: {} }, validApiKey: configured, planningTools,
    organizerTools: [tool], knowledgeTools: [], homeTools: [],
    instructions: async () => 'Synthetic instructions', outputText: value => value.text || '',
    openaiJson: async (path, options) => { calls.push(structuredClone(options.body)); return response(calls.length, options.body); },
    handleOrganizerTool: handler, handlePlanningTool: handler, handleHomeTool: handler,
    actionJournal: { invoke: async (call, args, dispatch, channel) => dispatch(call.name, args, { channel }) },
    chatWorkQueue: queue, addMessage: async (...args) => { await save(...args); history.push(args); },
    DiscordGateway: class { constructor(options) { this.onMessage = options.onMessage; } },
    isRecipeCaptureRequest: () => false,
  });
  return { ...result, calls, effects, history, queue };
}
const call = n => ({ type: 'function_call', call_id: 'synthetic-' + n, name: 'create_collection', arguments: '{"text":"synthetic"}' });

for (const channel of ['text', 'discord']) test(`${channel}: a third tool round gets a final answer without replaying completed actions`, async () => {
  const f = fixture({ response: async n => n <= 3 ? { output: [call(n)] } : { output: [], text: 'Tre lokale resultater.' } });
  const answer = channel === 'discord' ? await f.discord.onMessage('Test') : await f.processTextMessage('Test');
  assert.equal(answer, 'Tre lokale resultater.'); assert.equal(f.calls.length, 4); assert.equal(f.effects.length, 3);
  assert.equal(f.calls[3].tool_choice, 'none'); assert.equal(f.history.length, 2);
  assert.equal(f.calls[3].input.filter(item => item.type === 'function_call_output').length, 3);
  assert.ok(f.calls.every(body => body.store === false && body.tools.every(tool => tool.strict === false)));
  const patch = f.calls[0].tools.find(tool => tool.name === 'update_household_day');
  assert.ok(!patch.parameters.required.includes('adults'), 'omitted patch fields must stay optional, not be rewritten as required by an API default');
});

test('a provider rejection before any tool gives a safe actionable cause and no_actions, not an unknown side effect', async () => {
  for (const [status, providerCode, expected] of [[401, '', 'CHAT_API_ACCESS'], [404, 'model_not_found', 'CHAT_MODEL'],
    [429, 'insufficient_quota', 'CHAT_QUOTA'], [429, '', 'CHAT_RATE_LIMIT'], [400, '', 'CHAT_API_REQUEST']]) {
    const f = fixture({ response: async () => { throw Object.assign(new Error('private upstream fragment'), { providerStatus: status, providerCode }); } });
    await assert.rejects(f.processTextMessage('hej'), error => {
      assert.equal(error.chatFailure.code, expected); assert.equal(error.chatFailure.outcome, 'no_actions');
      assert.doesNotMatch(error.chatFailure.message, /private upstream/); return true;
    });
    assert.equal(f.calls.length, 1); assert.equal(f.effects.length, 0); assert.equal(f.history.length, 0);
  }
});

test('failure after an executed tool stays unknown with the provider cause; no automatic retry', async () => {
  const f = fixture({ response: async n => {
    if (n === 1) return { output: [call(n)] };
    throw Object.assign(new Error('private upstream'), { providerStatus: 429 });
  } });
  await assert.rejects(f.processTextMessage('Syntetisk handling'), error => {
    assert.equal(error.chatFailure.outcome, 'unknown'); assert.equal(error.chatFailure.code, 'CHAT_RATE_LIMIT');
    assert.equal(error.unknownOutcome, true); return true;
  });
  assert.equal(f.effects.length, 1); assert.equal(f.calls.length, 2); assert.equal(f.queue.snapshot()[0].state, 'unknown');
});

test('an unexpected tool call in the final text-only response is never dispatched', async () => {
  const f = fixture({ response: async n => ({ output: [call(n)] }) });
  await assert.rejects(f.processTextMessage('Syntetisk lang handling'), error => error.chatFailure.code === 'CHAT_STEP_LIMIT' && error.unknownOutcome);
  assert.equal(f.effects.length, 3); assert.equal(f.calls.length, 4); assert.equal(f.history.length, 0);
});

test('history publication failure cannot be advertised as no_actions', async () => {
  const f = fixture({ response: async () => ({ output: [], text: 'Svar' }), save: async () => { throw new Error('disk'); } });
  await assert.rejects(f.processTextMessage('hej'), error => error.chatFailure.outcome === 'unknown');
  assert.equal(f.calls.length, 1); assert.equal(f.queue.snapshot()[0].state, 'unknown');
});

test('OpenAI transport preserves error status/code for classification without exposing the API body publicly', async () => {
  const begin = source.indexOf('async function openaiJson('), end = source.indexOf('\nasync function backgroundResearch(', begin);
  const openaiJson = vm.runInNewContext(source.slice(begin, end) + '\nopenaiJson', {
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 'insufficient_quota', message: 'synthetic private API fragment' } }) }),
    AbortSignal, apiKey: 'synthetic', knownSecrets: () => [], redactSecrets: value => value,
  });
  const f = fixture();
  await assert.rejects(openaiJson('/responses'), error => {
    assert.equal(error.providerStatus, 429); assert.equal(error.providerCode, 'insufficient_quota');
    const safe = f.classifyChatFailure(error).chatFailure;
    assert.equal(safe.code, 'CHAT_QUOTA'); assert.doesNotMatch(JSON.stringify(safe), /synthetic private/); return true;
  });
});
