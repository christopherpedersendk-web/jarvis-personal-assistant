import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PersonalKnowledge, HYBRID_RETRIEVAL_STRATEGY } from '../personal-knowledge.mjs';
import { LocalSemanticProvider } from '../local-semantic-provider.mjs';
import { IncrementalSemanticIndex } from '../semantic-index.mjs';

// These controlled ranks test fusion invariants, NOT semantic model quality.
// The separate immutable 80-question benchmark still runs the real E5 model.
const memory = (id, text) => ({ id, text, status: 'confirmed', confirmed: true, revision: 1,
  source: { kind: 'user', channel: 'manual' } });
const turn = () => new Promise(resolve => setImmediate(resolve));

test('B3 generic lexical overlap cannot demote a strong semantic paraphrase out of the shortlist', async () => {
  const state = { memories: [memory('real', 'Dagens første timer er bedst til fordybelse i enerum.'),
    ...Array.from({ length: 12 }, (_, i) => memory(`incidental-${i}`, `Rammer hjælper med forskellige emner på side ${i}.`))] };
  const scores = Object.fromEntries(state.memories.map((record, i) => [`memory:${record.id}`, i === 0 ? 0.91 : 0.84 - i / 1000]));
  const knowledge = new PersonalKnowledge({ state, semanticScorer: async () => scores });
  assert.ok(knowledge.search('Hvilke rammer hjælper min koncentration?', { limit: 5 }).every(doc => doc.id !== 'memory:real'));
  const result = await knowledge.retrieve('Hvilke rammer hjælper min koncentration?', { limit: 5 });
  assert.equal(result.mode, 'local-hybrid'); assert.equal(result.matches[0].id, 'memory:real');
  assert.equal(result.matches[0].retrieval.lexicalRank, null);
  assert.equal(result.matches[0].retrieval.strategy, HYBRID_RETRIEVAL_STRATEGY);
  assert.equal(result.matches.filter(doc => doc.retrieval.selectedBy === 'exact-lexical-complement').length, 0);
});

test('B3 exact distinctive lexical evidence can contribute a source absent from the semantic top five', async () => {
  const state = { memories: [...Array.from({ length: 10 }, (_, i) => memory(`semantic-${i}`, `Et andet gyldigt notat om aftaler på side ${i}.`)),
    memory('exact', 'Aftalenummer ZK42 findes i den grønne dokumentmappe.')] };
  const scores = Object.fromEntries(state.memories.map((record, i) => [`memory:${record.id}`, 0.95 - i / 30]));
  const knowledge = new PersonalKnowledge({ state, semanticScorer: async () => scores });
  const result = await knowledge.retrieve('Hvad er aftalenummer ZK42?', { limit: 5 });
  assert.deepEqual(result.matches.slice(0, 4).map(doc => doc.id), ['memory:semantic-0', 'memory:semantic-1', 'memory:semantic-2', 'memory:semantic-3']);
  assert.equal(result.matches[4].id, 'memory:exact');
  assert.equal(result.matches[4].retrieval.selectedBy, 'exact-lexical-complement');
  assert.equal(result.matches[4].retrieval.lexicalEvidence.completeExactMatch, true);
});

test('B3 asking for more results preserves the ranking prefix; sources appear once', async () => {
  const state = { memories: Array.from({ length: 15 }, (_, i) => memory(`m${i}`, i === 11 || i === 14
    ? `Aftalenummer ZK42 er registreret i oversigt ${i}.` : `Forskellig oplysning ${i}.`)) };
  const scores = Object.fromEntries(state.memories.map((record, i) => [`memory:${record.id}`, 0.98 - i / 50]));
  const knowledge = new PersonalKnowledge({ state, semanticScorer: async () => scores });
  const first = await knowledge.searchHybrid('aftalenummer ZK42', { limit: 5 });
  const more = await knowledge.searchHybrid('aftalenummer ZK42', { limit: 12 });
  assert.deepEqual(first.map(doc => doc.id), more.slice(0, 5).map(doc => doc.id));
  assert.equal(more.length, new Set(more.map(doc => doc.id)).size);
  assert.equal(more.filter(doc => doc.retrieval.selectedBy === 'exact-lexical-complement').length, 2);
});

test('B3 Danish lexical fallback ignores grammatical fillers, not negation, and rejects short prefix coincidences', () => {
  const state = { memories: [memory('robot', 'Robotværkstedet har åbent.'), memory('negative', 'Jeg ønsker ikke støj i læserummet.'),
    memory('positive', 'Støj er del af værkstedets arbejde.')] };
  const knowledge = new PersonalKnowledge({ state });
  assert.deepEqual(knowledge.search('ro'), [], 'a short token cannot mean every word sharing its prefix');
  assert.deepEqual(knowledge.search('Hvilken må jeg helst få?'), [], 'function words alone do not identify a personal source');
  const hits = knowledge.search('ikke støj');
  assert.equal(hits[0].id, 'memory:negative');
  assert.equal(hits.find(doc => doc.id === 'memory:negative').lexicalEvidence.completeExactMatch, true);
  assert.equal(hits.find(doc => doc.id === 'memory:positive').lexicalEvidence.completeExactMatch, false);
});

test('B5 a correction during inference falls back to the current view instead of burying its unembedded revision', async () => {
  let finish;
  const state = { memories: [memory('corrected', 'Cyklen står i skuret.'),
    ...Array.from({ length: 6 }, (_, i) => memory(`old-${i}`, `Et ubeslægtet notat ${i}.`))] };
  const knowledge = new PersonalKnowledge({ state, semanticScorer: () => new Promise(resolve => { finish = resolve; }) });
  const pending = knowledge.retrieve('Cyklen står kælderen', { limit: 5 }); await turn();
  state.memories[0].text = 'Cyklen står nu i kælderen.'; state.memories[0].revision++;
  finish(Object.fromEntries(state.memories.map(record => [`memory:${record.id}`, 0.9])));
  const result = await pending;
  assert.equal(result.mode, 'local-lexical'); assert.equal(result.semantic.status, 'source-changed');
  assert.equal(result.matches[0].source.revision, 2); assert.equal(result.matches[0].text, state.memories[0].text);
});

test('B3/B5 cold read timeout cancels its waiting batch without killing the loader; the next warm read works', async t => {
  class LoadingWorker extends EventEmitter {
    stopped = false;
    postMessage(message) { queueMicrotask(() => this.emit('message', { type: 'result', id: message.id,
      vectors: message.texts.map(() => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)), inferenceMs: 1 })); }
    async terminate() { this.stopped = true; this.emit('exit', 0); }
  }
  let worker;
  const provider = new LocalSemanticProvider({ directory: '/synthetic-cold-loader', workerFactory: () => (worker = new LoadingWorker()) });
  t.after(() => provider.close());
  const index = new IncrementalSemanticIndex({ embedBatch: provider.embedBatch.bind(provider) });
  const state = { memories: [memory('place', 'Cyklen står i kælderen.')] };
  const knowledge = new PersonalKnowledge({ state, semanticScorer: index.score.bind(index) });
  const cold = await knowledge.retrieve('cyklen', { semanticTimeoutMs: 50 });
  assert.equal(cold.mode, 'local-lexical'); assert.equal(cold.semantic.status, 'timeout');
  assert.equal(cold.matches[0].id, 'memory:place');
  assert.equal(provider.stats().status, 'loading'); assert.equal(provider.stats().queued, 0); assert.equal(worker.stopped, false);
  worker.emit('message', { type: 'ready' }); await provider.prepare();
  const warm = await knowledge.retrieve('cyklen');
  assert.equal(warm.mode, 'local-hybrid'); assert.equal(warm.matches[0].id, 'memory:place');
  assert.equal(provider.stats().failed, 0); assert.equal(provider.stats().cancelled, 1);
});
