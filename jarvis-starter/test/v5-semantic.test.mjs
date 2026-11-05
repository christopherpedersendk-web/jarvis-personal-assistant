import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile, access, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncrementalSemanticIndex } from '../semantic-index.mjs';
import { LocalSemanticProvider } from '../local-semantic-provider.mjs';
import { LOCAL_SEMANTIC_MODEL, LOCAL_SEMANTIC_MANIFEST_SHA256, verifyLocalSemanticModel } from '../semantic-model-manifest.mjs';
import { prepareLocalSemanticModel } from '../scripts/prepare-local-semantic-model.mjs';
import { PersonalKnowledge, indexPersonalKnowledge } from '../personal-knowledge.mjs';
import { DANISH_MEMORY_QUESTIONS, DANISH_MEMORY_SAFETY_QUESTIONS, makeDanishMemoryEvaluationState,
  EVALUATION_NOW } from '../scripts/fixtures/danish-memory-evaluation.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const record = (id, text) => ({ id, text, status: 'confirmed', confirmed: true, revision: 1,
  source: { kind: 'user', channel: 'manual' } });
const testVector = value => Array.from({ length: 384 }, (_, index) => index === 0 ? value : 0);

test('B3 manifest pins genuine multilingual model files, dimensions and audited runtime; no downloader is implicit', async () => {
  assert.equal(LOCAL_SEMANTIC_MODEL.runtimeVersion, '3.8.1');
  assert.equal(LOCAL_SEMANTIC_MODEL.dimensions, 384);
  assert.match(LOCAL_SEMANTIC_MODEL.revision, /^[a-f0-9]{40}$/);
  assert.match(LOCAL_SEMANTIC_MANIFEST_SHA256, /^[a-f0-9]{64}$/);
  for (const file of LOCAL_SEMANTIC_MODEL.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(file.bytes > 0);
  }
  assert.equal(LOCAL_SEMANTIC_MODEL.files.reduce((sum, item) => sum + item.bytes, 0), 135_392_016);
  let requests = 0;
  await assert.rejects(prepareLocalSemanticModel('/not-downloaded', { fetchFile: () => { requests++; } }), /accept-public-download/);
  assert.equal(requests, 0);
  let workers = 0;
  const provider = new LocalSemanticProvider({ directory: '/missing-model', workerFactory: () => { workers++; } });
  assert.equal(provider.stats().status, 'not-started'); assert.equal(workers, 0);
  await provider.close();
});

test('B3 corrupt/missing/symlinked local assets fail closed without loading a runtime or overwriting files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-semantic-integrity-'));
  await assert.rejects(verifyLocalSemanticModel(directory), /mangler/);
  const config = join(directory, 'config.json');
  const original = Buffer.alloc(658, 'x');
  await writeFile(config, original);
  await assert.rejects(verifyLocalSemanticModel(directory), { code: 'SEMANTIC_MODEL_INTEGRITY' });
  let requests = 0;
  await assert.rejects(prepareLocalSemanticModel(directory, { allowPublicDownload: true, fetchFile: () => { requests++; } }), /indholdshash/);
  assert.deepEqual(await readFile(config), original); assert.equal(requests, 0);
  const linked = `${directory}-link`;
  await symlink(directory, linked);
  await assert.rejects(verifyLocalSemanticModel(linked), /ikke et link/);
});

test('B3 failed public model preparation never publishes partial/corrupt data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-semantic-download-test-'));
  const directory = join(root, 'model');
  const urls = [];
  await assert.rejects(prepareLocalSemanticModel(directory, { allowPublicDownload: true,
    fetchFile: async url => { urls.push(url); return new Response('invalid', { status: 200 }); } }), /ikke publiceret/);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes(LOCAL_SEMANTIC_MODEL.revision));
  await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.equal((await readdir(root)).filter(path => path.startsWith('.jarvis-semantic-download-')).length, 1);
});

class FakeWorker extends EventEmitter {
  constructor() { super(); this.sent = []; this.stopped = false; queueMicrotask(() => this.emit('message', { type: 'ready' })); }
  postMessage(message) { this.sent.push(message); }
  respond() { const sent = this.sent.at(-1); this.emit('message', { type: 'result', id: sent.id,
    vectors: sent.texts.map(() => testVector(1)), inferenceMs: 2 }); }
  async terminate() { this.stopped = true; this.emit('exit', 0); }
}

test('B3/A3 local encoder has a bounded waiting queue and cancelling a waiting read does not cancel an active read', async t => {
  let worker;
  const provider = new LocalSemanticProvider({ directory: '/synthetic-test-only', maxPending: 1,
    workerFactory: () => (worker = new FakeWorker()) });
  t.after(() => provider.close());
  await provider.prepare();
  const first = provider.embedBatch(['Første'], { kind: 'passage' });
  await turn();
  assert.equal(worker.sent.length, 1); assert.equal(worker.sent[0].kind, 'passage');
  const controller = new AbortController();
  const waiting = provider.embedBatch(['Venter'], { signal: controller.signal });
  const cancelled = assert.rejects(waiting, { code: 'SEMANTIC_CANCELLED' });
  await assert.rejects(provider.embedBatch(['For meget']), { code: 'SEMANTIC_QUEUE_FULL' });
  controller.abort(); await cancelled;
  assert.equal(provider.stats().queued, 0); assert.equal(provider.stats().running, true);
  worker.respond(); assert.deepEqual(await first, [testVector(1)]);
  assert.equal(provider.stats().embeddedTexts, 1);
  assert.equal(provider.stats().network, 'disabled');
});

test('B3/A3 inference timeout stops the worker and safely permits a subsequent local read', async t => {
  const workers = [];
  const provider = new LocalSemanticProvider({ directory: '/synthetic-test-only', requestTimeoutMs: 50,
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  t.after(() => provider.close());
  await assert.rejects(provider.embed('Vent for evigt'), { code: 'SEMANTIC_INFERENCE_TIMEOUT' });
  assert.equal(workers[0].stopped, true);
  const next = provider.embed('Prøv en ny lokal læsning');
  await turn(); workers[1].respond();
  assert.deepEqual(await next, testVector(1));
  assert.equal(provider.stats().status, 'ready');
});

test('B3 missing genuine local model reports unavailable; it is never replaced by pretend embeddings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-semantic-absent-'));
  const provider = new LocalSemanticProvider({ directory });
  t.after(() => provider.close());
  await assert.rejects(provider.embed('Kun syntetisk tekst'), { code: 'SEMANTIC_MODEL_UNAVAILABLE' });
  assert.equal(provider.stats().embeddedTexts, 0);
  assert.equal(provider.stats().status, 'unavailable');
});

test('B3 worker construction failure rejects waiting reads and a later request may recover', async t => {
  let fail = true, worker;
  const provider = new LocalSemanticProvider({ directory: '/synthetic-test-only', workerFactory: () => {
    if (fail) throw new Error('worker limit');
    return worker = new FakeWorker();
  } });
  t.after(() => provider.close());
  await assert.rejects(provider.embed('Test'), { code: 'SEMANTIC_WORKER_FAILED' });
  fail = false;
  const next = provider.embed('Test igen');
  await turn(); worker.respond();
  assert.deepEqual(await next, testVector(1));
});

test('B5 overlapping semantic indexing cannot resurrect an older revision or removed source', async () => {
  const held = deferred(); let calls = 0;
  const index = new IncrementalSemanticIndex({ embed: async (text, { kind }) => {
    calls++;
    if (text === 'Gammel' && kind === 'passage') return held.promise;
    return text === 'Ny' ? [0, 1] : [1, 0];
  } });
  const old = index.score('Spørgsmål', [{ id: 'source', text: 'Gammel', revision: 1 }]);
  const latest = index.score('Spørgsmål', [{ id: 'source', text: 'Ny', revision: 2 }]);
  held.resolve([1, 0]);
  assert.deepEqual(await old, {});
  await latest;
  assert.match(index.cache.get('source').key, /^2:/);
  assert.deepEqual(index.cache.get('source').embedding, [0, 1]);
  assert.deepEqual(await index.score('Spørgsmål', []), {});
  assert.equal(index.stats().cachedDocuments, 0);
  assert.equal(calls, 3, 'old passage, new passage, latest query; old snapshot was not searched');
});

test('B5 failed indexing recovers, unchanged sources are not re-embedded and source types do not flush the other index entries', async () => {
  let fail = true;
  const index = new IncrementalSemanticIndex({ embed: async () => { if (fail) throw new Error('midlertidig fejl'); return [1, 0]; } });
  const state = { memories: [record('note', 'Et kort notat')], organizer: [{ id: 'list', title: 'Min liste', items: [{ id: 'item', text: 'Et andet notat' }] }] };
  const knowledge = new PersonalKnowledge({ state, semanticScorer: index.score.bind(index) });
  assert.equal((await knowledge.retrieve('notat')).mode, 'local-lexical');
  fail = false;
  await knowledge.searchHybrid('notat', { types: ['memory'] });
  assert.equal(index.stats().cachedDocuments, 2);
  const embedded = index.stats().embeddedDocuments;
  await knowledge.searchHybrid('notat', { types: ['organizer'] });
  assert.equal(index.stats().embeddedDocuments, embedded);
  state.memories[0].revision++;
  state.memories[0].text = 'Et rettet notat';
  await knowledge.searchHybrid('notat');
  assert.equal(index.stats().embeddedDocuments, embedded + 1);
});

test('B2/B5 correction, archive and expiry during inference are enforced before results or model context return', async () => {
  const held = deferred();
  const state = { memories: [record('editable', 'Min yndlingsfarve er blå.'), record('removed', 'Den blå hue'),
    { ...record('expired', 'Blå midlertidig låneaftale'), expiresAt: '2026-11-05T09:00:01Z' }] };
  let now = new Date(EVALUATION_NOW);
  const knowledge = new PersonalKnowledge({ state, now: () => now,
    semanticScorer: () => held.promise });
  const result = knowledge.contextAsync('blå');
  await turn();
  state.memories[0].text = 'Min yndlingsfarve er grøn.'; state.memories[0].revision++;
  state.memories[1].archived = true;
  now = new Date('2026-11-05T09:00:02Z');
  held.resolve({ 'memory:editable': 1, 'memory:removed': 1, 'memory:expired': 1, 'memory:injected': 1 });
  assert.equal(await result, '', 'stale semantic scores do not keep invalid or corrected blue facts alive');
  knowledge.semanticScorer = async () => ({ 'memory:editable': 1 });
  assert.match(await knowledge.contextAsync('grøn'), /revision 2.*grøn/);
});

test('B5 semantic timeout/abort returns current lexical facts and aborts provider work', async () => {
  const state = { memories: [record('n', 'Haven er grøn.')] };
  let receivedSignal;
  const knowledge = new PersonalKnowledge({ state, semanticScorer: (_query, _docs, { signal }) => {
    receivedSignal = signal; return new Promise(() => {});
  } });
  const timed = knowledge.retrieve('haven', { semanticTimeoutMs: 50 });
  state.memories[0].text = 'Haven er nu omplantet.'; state.memories[0].revision++;
  const result = await timed;
  assert.equal(result.semantic.status, 'timeout'); assert.equal(receivedSignal.aborted, true);
  assert.equal(result.matches[0].text, state.memories[0].text);
  const controller = new AbortController();
  const cancelled = knowledge.retrieve('haven', { semanticTimeoutMs: 10_000, signal: controller.signal });
  controller.abort();
  assert.equal((await cancelled).semantic.status, 'cancelled');
});

test('B3 fixed Danish benchmark contains 80 distinct relevant questions plus 16 safety cases; invalid facts are not candidates', () => {
  const state = makeDanishMemoryEvaluationState();
  const documents = indexPersonalKnowledge(state, { now: new Date(EVALUATION_NOW) });
  assert.equal(DANISH_MEMORY_QUESTIONS.length, 80);
  assert.equal(new Set(DANISH_MEMORY_QUESTIONS.map(item => item.question)).size, 80);
  assert.equal(new Set(DANISH_MEMORY_QUESTIONS.flatMap(item => item.relevant)).size, 40);
  assert.equal(DANISH_MEMORY_SAFETY_QUESTIONS.length, 16);
  for (const question of DANISH_MEMORY_QUESTIONS) assert.ok(question.relevant.every(id => documents.some(doc => doc.id === id)));
  for (const question of DANISH_MEMORY_SAFETY_QUESTIONS) {
    assert.equal(question.relevant.length, 0);
    assert.ok(documents.every(doc => !question.forbidden.includes(doc.id)));
  }
  assert.ok(DANISH_MEMORY_QUESTIONS.some(item => item.category === 'negation-or-boundary'));
});

test('I5 legacy organizer, job, project, recipe and provenance secrets never reach either retrieval path', async () => {
  const hidden = 'specialneedle password=synthetic-sensitive-value';
  const state = {
    memories: [record('valid', 'Haven er grøn.'), record('secret-note', hidden)],
    organizer: [{ id: 'l', title: hidden, items: [{ id: 'i', text: 'specialneedle i en liste' }] }],
    tasks: [{ id: 'job', title: 'specialneedle', prompt: hidden }],
    projects: [{ id: 'project', title: 'specialneedle', description: hidden }],
    recipes: [{ id: 'recipe', title: hidden, status: 'confirmed', ingredients: [] }],
    personalClaims: [{ id: 'claim', subject: 'emne', value: 'specialneedle', status: 'confirmed', revision: 2,
      source: { kind: 'user', channel: 'manual', id: hidden } }],
  };
  let seen;
  const knowledge = new PersonalKnowledge({ state, semanticScorer: async (_query, documents) => {
    seen = documents; return Object.fromEntries(documents.map(doc => [doc.id, 1]));
  } });
  assert.deepEqual(knowledge.search('specialneedle'), []);
  await knowledge.searchHybrid('specialneedle');
  assert.deepEqual(seen.map(doc => doc.id), ['memory:valid']);
  assert.doesNotMatch(JSON.stringify(seen), /specialneedle|synthetic-sensitive-value/);
});

test('D1/R09 exact household facts and effective defaults stay distinct; explicit guest/portion grounds survive retrieval', () => {
  const state = { mealHousehold: { configured: true, adults: 2, adultPortion: 0.9,
    children: [{ age: 8, portion: 0.6, ageRecordedAt: '2026-11-01' }], revision: 3, days: {
      '2026-11-06': { adults: 1, children: [], guests: { adults: 2, adultPortion: 0.8, children: [{ age: 5, portion: 0.5 }] }, occasion: 'holiday' },
    } } };
  const knowledge = new PersonalKnowledge({ state, now: () => new Date(EVALUATION_NOW) });
  assert.equal(knowledge.householdDay('2026-11-05').recorded, false);
  const ordinary = knowledge.effectiveHouseholdDay('2026-11-05');
  assert.equal(ordinary.authority, 'household-defaults');
  assert.equal(ordinary.servings, 2.4); assert.equal(ordinary.source.revision, 3);
  const exception = knowledge.householdDay('2026-11-06');
  assert.equal(exception.servings, 3.1); assert.equal(exception.guests.adults, 2);
  assert.equal(exception.occasion, 'holiday');
  assert.equal(knowledge.effectiveHouseholdDay('2026-11-06').authority, 'day-override');
  assert.match(knowledge.search('Gæster ferie')[0].text, /Gæster.*Ferie/);
  assert.equal(new PersonalKnowledge({ state: {} }).effectiveHouseholdDay('2026-11-05').known, false);
});
