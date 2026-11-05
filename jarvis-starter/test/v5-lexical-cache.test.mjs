import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalKnowledge } from '../personal-knowledge.mjs';
import { makeDanishMemoryEvaluationState, DANISH_MEMORY_QUESTIONS, DANISH_MEMORY_SAFETY_QUESTIONS,
  EVALUATION_NOW } from '../scripts/fixtures/danish-memory-evaluation.mjs';

test('J1/B5 tokenisation reuse preserves exact rankings, scores and source evidence on all fixed Danish questions', async () => {
  const state = makeDanishMemoryEvaluationState(), now = () => new Date(EVALUATION_NOW);
  const reused = new PersonalKnowledge({ state, now });
  for (const entry of [...DANISH_MEMORY_QUESTIONS, ...DANISH_MEMORY_SAFETY_QUESTIONS]) {
    const uncached = new PersonalKnowledge({ state, now });
    assert.deepEqual(reused.search(entry.question, { limit: 20 }), uncached.search(entry.question, { limit: 20 }), entry.id);
  }
  const first = reused.lexicalCache.get('memory:plant');
  assert.ok(first); await reused.retrieve('fredslilje');
  assert.equal(reused.lexicalCache.get('memory:plant'), first, 'unchanged document was not tokenised again');
});

test('B5 token cache never caches eligibility: corrections, archival, secret-shaped material and expiry invalidate immediately', () => {
  const state = makeDanishMemoryEvaluationState(); let at = new Date(EVALUATION_NOW);
  const knowledge = new PersonalKnowledge({ state, now: () => at });
  knowledge.search('fredslilje'); const original = knowledge.lexicalCache.get('memory:plant');
  const plant = state.memories.find(x => x.id === 'plant'); plant.text = 'Min nye plante er en orkidé.'; plant.revision++;
  assert.ok(knowledge.search('orkidé').some(doc => doc.id === 'memory:plant'));
  assert.notEqual(knowledge.lexicalCache.get('memory:plant'), original);
  plant.text = 'password=synthetic-private-value';
  assert.ok(!knowledge.search('orkidé').some(doc => doc.id === 'memory:plant'));
  assert.equal(knowledge.lexicalCache.has('memory:plant'), false);
  plant.text = 'En orkidé.'; plant.expiresAt = new Date(at.getTime() + 1000).toISOString(); knowledge.search('orkidé');
  at = new Date(at.getTime() + 1000); knowledge.search('orkidé'); assert.equal(knowledge.lexicalCache.has('memory:plant'), false);
  plant.expiresAt = null; knowledge.search('orkidé'); plant.archived = true;
  knowledge.search('hvad er det'); assert.equal(knowledge.lexicalCache.has('memory:plant'), false, 'even stopword-only reads remove invalid sources');
});

test('J1 token cache remains bounded for a large permitted organizer and does not truncate retrieval candidates', () => {
  const state = { organizer: Array.from({ length: 12 }, (_, c) => ({ id: `c${c}`, title: `Noter ${c}`, items: Array.from({ length: 200 }, (_, i) => ({
    id: `i${i}`, text: c === 0 && i === 0 ? 'unik sølvhejre' : `Syntetisk note ${c} ${i}` })) })) };
  const knowledge = new PersonalKnowledge({ state });
  assert.equal(knowledge.search('unik sølvhejre')[0].id, 'organizer:c0:i0');
  assert.equal(knowledge.lexicalCache.size, 2000);
  assert.equal(knowledge.search('unik sølvhejre')[0].id, 'organizer:c0:i0', 'eviction never deletes a real source');
});
