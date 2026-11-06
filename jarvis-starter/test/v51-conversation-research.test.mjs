import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createWebResearch, mapsSearchLink } from '../web-research.mjs';
import { createSecretaryToolHandler } from '../secretary-tools.mjs';
import { DurableState } from '../durable-state.mjs';
import { TaskEngine } from '../task-engine.mjs';
import { ActionJournal } from '../action-journal.mjs';
import { validateAssistantTool } from '../assistant-tools.mjs';

for (const channel of ['text', 'discord', 'voice']) {
  test(`${channel}: web research has citations, bounded calls and no private context/action tools`, async () => {
    let request;
    const searchWeb = createWebResearch({ model: () => 'test-model', request: async (path, options) => {
      request = { path, ...options };
      return { status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: 'Restaurant på Testvej 1.', annotations: [{ type: 'url_citation', url: 'https://example.org/menu', title: 'Menu' }, { type: 'url_citation', url: 'javascript:alert(1)' }] }] }] };
    } });
    const handler = createSecretaryToolHandler({ searchWeb });
    const result = await handler('search_web', { query: 'Restaurant test menu' }, { channel });
    assert.equal(result.searched, true); assert.equal(result.sources.length, 1);
    assert.equal(request.body.input, 'Restaurant test menu'); assert.equal(request.body.store, false);
    assert.deepEqual(request.body.tools, [{ type: 'web_search' }]); assert.equal(request.body.max_tool_calls, 2);
    assert.equal(request.body.tool_choice, 'required'); assert.equal(result.untrustedData, true);
    const map = await handler('get_maps_link', { name: 'Test & mad', address: 'Testvej 1, København' }, { channel });
    assert.equal(new URL(map.url).searchParams.get('query'), 'Test & mad, Testvej 1, København');
    await assert.rejects(handler('search_web', { query: 'x'.repeat(241) }, { channel }));
  });
  test(`${channel}: reviewed report runs once with a durable call ID; paused job stays paused`, async () => {
    let executions = 0;
    const store = new DurableState({ initial: {}, write: async () => {} });
    const save = () => store.save(), transact = (...args) => store.transact(...args);
    const engine = new TaskEngine({ state: store.state, save, transact, runTask: async () => { executions++; return 'Rapport'; } });
    const handler = createSecretaryToolHandler({ taskEngine: engine });
    const journal = new ActionJournal({ state: store.state, save, transact });
    await store.initialize();
    const job = await engine.create({ title: 'Morgenrapport', prompt: 'Læs offentlige nyheder', activation: 'paused' });
    const args = { id: job.id, expectedRevision: job.revision };
    validateAssistantTool('run_report_job', args);
    await assert.rejects(handler('run_report_job', args, { channel }), /Planlægning/);
    assert.equal(executions, 0);
    await engine.action(job.id, 'resume', { expectedRevision: job.revision });
    const listed = await handler('list_report_jobs', {}, { channel });
    const current = listed.jobs.find(t => t.id === job.id);
    const call = { name: 'run_report_job', call_id: 'run-once' }, reviewed = { id: job.id, expectedRevision: current.revision };
    const accepted = await journal.invoke(call, reviewed, handler, channel);
    assert.equal(accepted.accepted, true);
    assert.equal((await journal.invoke(call, reviewed, handler, channel)).alreadyRecorded, true);
    await engine.tick();
    // The engine may be finishing the action-triggered tick; await it without replay.
    for (let i = 0; i < 30 && engine.list()[0].status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(executions, 1);
    await assert.rejects(handler('run_report_job', reviewed, { channel }), /Læs rapporten igen/);
  });
}
test('incomplete provider research is not presented as completed', async () => {
  const search = createWebResearch({ model: () => 'test', request: async () => ({ status: 'incomplete' }) });
  await assert.rejects(search('test'), /ikke færdig/);
});
test('uncited response explicitly reports unverified current information', async () => {
  const search = createWebResearch({ model: () => 'test', request: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'Unknown' }] }] }) });
  const result = await search('test'); assert.equal(result.searched, false); assert.match(result.note, /ikke kildeverificeret/);
});
test('Maps query is encoded without injecting extra parameters', () => {
  const url = new URL(mapsSearchLink('A & B', 'x&api=evil#fragment'));
  assert.equal(url.searchParams.get('api'), '1'); assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('query'), 'A & B, x&api=evil#fragment');
});
test('chat links use safe anchors while HTML remains inert text', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const a = source.indexOf('function appendChatLinks('), b = source.indexOf('\nfunction acceptHistoryPage(', a);
  const render = vm.runInNewContext(source.slice(a,b) + '\nappendChatLinks', { URL, document: { createTextNode: text => ({ text }), createElement: tag => ({ tag }) } });
  const children = []; render({ append: x => children.push(x) }, '<img src=x onerror=alert(1)> https://example.org/menu. javascript:alert(1)');
  const link = children.find(x => x.tag === 'a');
  assert.equal(link.href, 'https://example.org/menu'); assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(children.filter(x => x.tag).length, 1); assert.match(children[0].text, /<img/);
});
