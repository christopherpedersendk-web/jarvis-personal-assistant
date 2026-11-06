import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from './helpers/synthetic-env.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const credential = 'synthetic-browser-http-owner-token';
// Preload only in this disposable test process. No production mock flag or
// general-purpose network hook exists in the application.
import { browserNetworkFixture as networkFixture } from './helpers/browser-network.mjs';
test('authenticated HTTP browser flow: assets, review, one read, draft revision, stop/restart and no submit route', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-browser-http-'));
  let child, base, logs = '';
  async function stop() { if (child && child.exitCode === null) { const end = new Promise(r => child.once('exit', r)); child.kill(); await end; } }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  async function start(research = false) {
    const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(networkFixture + `
globalThis.fetch = async (url, options) => {
 if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('Unexpected provider');
 const body=JSON.parse(options.body);
 if(body.tool_choice!=='none'||body.tools.length||body.input.length!==1)throw new Error('Unsafe summary contract');
 return new Response(JSON.stringify({id:'resp_synthetic',output:[{content:[{type:'output_text',text:'Syntetisk resumé: to retter.'}]}],usage:{input_tokens:20,output_tokens:10}}),{status:200});
};`)}`, 'server.mjs'], {
      cwd: root, env: syntheticServerEnv({ dataDir: dir, port, accessToken: credential, modelKey: 'sk-synthetic-browser-test', browserResearch: research }), stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + b).slice(-3000); });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(300) })).ok) return; } catch {}
      if (child.exitCode !== null) break; await delay(40);
    }
    assert.fail('Synthetic startup failed: ' + logs);
  }
  async function request(path, body, expected = 200, auth = true) {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(r.status, expected, path); return r.json();
  }
  await start();
  const disabled = await request('/api/message', {message:'!web læs 00000000-0000-0000-0000-000000000000'}, 502);
  assert.match(disabled.error, /ikke aktiveret/);
  await request('/api/message', {message:'!web læs 00000000-0000-0000-0000-000000000000'}, 401, false);
  for (const path of ['/api/voice/tool','/api/assistant/tool']) {
    const call={name:'create_personal_task',args:{title:'Unauthorized',purpose:'Lease check',durationMinutes:10},callId:'old-client'};
    await request(path,call,401,false);
    await request(path,call,409);
  }
  for(const path of ['/api/smart-home/hue/control','/api/smart-home/sonos/action']) {
    await request(path,{},401,false);
    assert.equal((await request(path,{},409)).code,'CAPABILITY_DEFERRED');
  }
  for (const path of ['/browser-workspace.js', '/browser-workspace.css']) assert.equal((await fetch(base + path)).status, 200);
  for (const [path, body] of [['/api/browser', undefined], ['/api/browser/sites', {}], ['/api/browser/preview', {}], ['/api/browser/read', {}], ['/api/browser/draft', {}]]) await request(path, body, 401, false);
  assert.deepEqual((await request('/api/browser')).origins, []);
  await request('/api/browser/sites', { origins: ['https://restaurant.example.org'], expectedRevision: 1 });
  const p = await request('/api/browser/preview', { url: 'https://restaurant.example.org/menu' });
  assert.equal((await request('/api/browser')).readsToday, 0);
  const read = await request('/api/browser/read', { intentId: p.intentId }); assert.equal(read.page.title, 'Syntetisk menu');
  assert.equal(Object.hasOwn(await request('/api/state'), 'browserWorkspace'), false, 'untrusted web data and approval internals stay out of general state responses');
  await request('/api/browser/read', { intentId: p.intentId }, 409);
  const draft = (await request('/api/browser/draft', { readId: read.id, contentHash: read.page.contentHash, title: 'Middag', details: 'To personer kl. 18' })).draft;
  assert.equal(draft.externalStatus, 'not_submitted');
  await request('/api/browser/submit', { id: draft.id }, 404);
  await request('/api/assistant/tool', { name: 'browser_read', args: { url: 'https://restaurant.example.org' } }, 409);
  const old = await request('/api/browser/preview', { url: 'https://restaurant.example.org/menu' });
  await request('/api/assistant/control', { stopped: true }); await stop(); await start();
  assert.equal((await request('/api/browser')).stopped, true);
  assert.match((await request('/api/discord/report-channel', {}, 409)).error, /stoppet/);
  assert.equal((await request('/api/browser')).drafts[0].id, draft.id);
  await request('/api/browser/preview', { url: 'https://restaurant.example.org/menu' }, 409);
  await request('/api/assistant/control', { stopped: false });
  await request('/api/browser/read', { intentId: old.intentId }, 409);
  await request('/api/browser/draft', { id: draft.id, expectedRevision: 1, title: 'Middag', details: 'Tre personer' });
  await request('/api/browser/draft', { id: draft.id, expectedRevision: 1, title: 'Middag', details: 'Forældet' }, 409);
  await request('/api/browser/delete-draft', { id: draft.id, expectedRevision: 2 });
  assert.equal((await request('/api/browser')).drafts.length, 0);
  await stop(); await start(true);
  const review = await request('/api/browser/preview', { url: 'https://restaurant.example.org/menu' });
  const before = (await request('/api/state')).history;
  const research = await request('/api/message', {message:'!web læs '+review.intentId});
  assert.match(research.answer, /Syntetisk resumé/); assert.match(research.answer, /Kilde: https:\/\/restaurant.example.org\/menu/);
  assert.deepEqual((await request('/api/state')).history, before, 'isolated summary does not poison assistant history');
  await request('/api/message', {message:'!web læs '+review.intentId}, 502);

});
