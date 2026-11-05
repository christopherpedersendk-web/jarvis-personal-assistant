import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSemanticProcess } from '../local-semantic-process.mjs';
import { LocalSemanticProvider } from '../local-semantic-provider.mjs';
import { PersonalKnowledge } from '../personal-knowledge.mjs';
import { IncrementalSemanticIndex } from '../semantic-index.mjs';

// Transport/fault tests only. These vectors are explicitly synthetic; the
// separate CI acceptance must still run the immutable genuine E5 model.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-semantic-process-'));
  const module = join(dir, 'transport-fixture.mjs');
  await writeFile(module, `process.once('message', initial => {
    if (initial.type !== 'initialize') process.exit(2);
    process.send({type:'ready', pid:process.pid, directory:initial.directory,
      inherited:Object.keys(process.env), execArgv:process.execArgv, rssBytes:process.memoryUsage().rss});
    process.on('message', message => {
      if (message.texts[0] === 'fatal-exit') process.exit(134);
      if (message.texts[0] === 'fatal-signal') process.kill(process.pid, 'SIGKILL');
      if (message.texts[0] === 'wait') return;
      process.send({type:'result', id:message.id, vectors:message.texts.map(() => Array(384).fill(0.25)),
        inferenceMs:1,rssBytes:process.memoryUsage().rss});
    });
  }); process.on('disconnect', () => process.exit(0));`);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, module };
}

test('A3/B3 model transport is a separate process without credentials, inherited preloads or shell arguments', async t => {
  const f = await fixture(t);
  const poisoned = ['OPENAI_API_KEY', 'NEMLIG_PASS', 'NODE_OPTIONS', 'HTTPS_PROXY', 'JARVIS_ACCESS_TOKEN'];
  const before = Object.fromEntries(poisoned.map(key => [key, process.env[key]]));
  let child;
  try {
    for (const key of poisoned) process.env[key] = key === 'NODE_OPTIONS' ? '--require=/synthetic-missing-preload' : 'synthetic-not-a-real-secret';
    child = new LocalSemanticProcess({ directory: f.dir, module: f.module });
  } finally {
    for (const key of poisoned) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
  t.after(() => child.terminate());
  const [ready] = await once(child, 'message');
  assert.equal(ready.type, 'ready'); assert.notEqual(ready.pid, process.pid);
  assert.equal(ready.directory, f.dir);
  for (const key of [...poisoned, 'HOME', 'USERPROFILE', 'CODEX_HOME']) assert.ok(!ready.inherited.includes(key), key);
  assert.deepEqual(ready.execArgv, ['--max-old-space-size=512']);
  const result = once(child, 'message'); child.postMessage({ id: 1, texts: ['syntetisk tekst'], kind: 'query' });
  assert.equal((await result)[0].vectors[0].length, 384);
  await child.terminate(); assert.equal(child.closed, true);
});

for (const fault of ['fatal-exit', 'fatal-signal']) test(`A3/B5 ${fault} stays in the model child, rejects queued reads, and a later read can recover`, async t => {
  const f = await fixture(t); let children = 0;
  const provider = new LocalSemanticProvider({ directory: f.dir, maxPending: 4,
    workerFactory: () => { children++; return new LocalSemanticProcess({ directory: f.dir, module: f.module }); } });
  t.after(() => provider.close());
  await provider.prepare();
  const results = await Promise.allSettled([provider.embed(fault), provider.embed('queued-read')]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'SEMANTIC_WORKER_STOPPED'));
  assert.equal(provider.stats().status, 'unavailable'); assert.equal(provider.stats().queued, 0);
  assert.equal(children, 1, 'a native failure is not blindly retried in the same request');
  const vector = await provider.embed('explicit-later-read');
  assert.equal(vector.length, 384); assert.equal(children, 2);
  assert.equal(provider.stats().isolation, 'child-process');
  assert.ok(provider.stats().peakSampledChildRssBytes > 0);
});

test('A3/B5 killing one timed-out inference leaves the parent responsive and the next read usable', async t => {
  const f = await fixture(t); let active;
  const provider = new LocalSemanticProvider({ directory: f.dir, requestTimeoutMs: 50,
    workerFactory: () => (active = new LocalSemanticProcess({ directory: f.dir, module: f.module })) });
  t.after(() => provider.close());
  await provider.prepare(); const original = active;
  await assert.rejects(provider.embed('wait'), { code: 'SEMANTIC_INFERENCE_TIMEOUT' });
  await original.exit; assert.equal(original.closed, true);
  assert.equal((await provider.embed('later')).length, 384);
});

test('B5 a crashed model does not prevent current lexical fallback or leak old source text', async t => {
  const f = await fixture(t);
  const provider = new LocalSemanticProvider({ directory: f.dir,
    workerFactory: () => new LocalSemanticProcess({ directory: f.dir, module: f.module }) });
  t.after(() => provider.close());
  const index = new IncrementalSemanticIndex({ embedBatch: provider.embedBatch.bind(provider) });
  const knowledge = new PersonalKnowledge({ state: { memories: [{ id: 'current', text: 'fatal-exit', revision: 1,
    confirmed: true, status: 'confirmed', source: { kind: 'user', channel: 'manual' } }] }, semanticScorer: index.score.bind(index) });
  const result = await knowledge.retrieve('fatal-exit', { semanticTimeoutMs: 2000 });
  assert.equal(result.mode, 'local-lexical'); assert.equal(result.matches[0].id, 'memory:current');
  assert.equal(provider.stats().status, 'unavailable');
});

test('I5 optional runtime pins the targeted sharp fix and does not change the model or inference major version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../local-semantic-runtime/package.json', import.meta.url)));
  assert.equal(manifest.dependencies['@huggingface/transformers'], '3.8.1');
  assert.equal(manifest.overrides.sharp, '0.35.5');
  assert.equal(manifest.private, true);
});

test('I5 optional runtime commits the audited exact public integrity lock and CI consumes it without re-resolution', async () => {
  const lock = JSON.parse(await readFile(new URL('../local-semantic-runtime/package-lock.json', import.meta.url)));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages['node_modules/sharp'].version, '0.35.5');
  assert.equal(lock.packages['node_modules/@huggingface/transformers'].version, '3.8.1');
  assert.equal(lock.packages['node_modules/onnxruntime-node'].version, '1.21.0');
  for (const [path, item] of Object.entries(lock.packages)) if (path) {
    assert.match(item.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(item.link, undefined);
  }
  const workflow = await readFile(new URL('../../.github/workflows/v48-visual.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: npm ci --prefix local-semantic-runtime/);
  assert.doesNotMatch(workflow, /run: npm install --prefix local-semantic-runtime/);
});
