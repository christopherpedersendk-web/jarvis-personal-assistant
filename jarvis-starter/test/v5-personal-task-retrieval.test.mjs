import test from 'node:test';
import assert from 'node:assert/strict';
import * as taskDomain from '../personal-tasks.mjs';
import { PersonalKnowledge, indexPersonalKnowledge } from '../personal-knowledge.mjs';

const NOW = new Date('2026-11-05T09:00:00Z');
const input = title => ({ title, purpose: 'Syntetisk afgrænsning af personlige opgaver', durationMinutes: 15 });

async function fixture(count) {
  const state = {};
  const tasks = new taskDomain.PersonalTasks({ state, now: () => NOW });
  let last;
  for (let index = 1; index <= count; index++) {
    last = await tasks.create(input(index === count ? 'Find zirkoniumcertifikatet' : `Almindelig opgave ${index}`));
  }
  return { state, tasks, last };
}

test('B3/C the accepted 201st personal task remains available in lexical and hybrid retrieval', async () => {
  const { state, tasks, last } = await fixture(201);
  const seen = [];
  // Controlled scores verify source coverage, not semantic model quality.
  const knowledge = new PersonalKnowledge({ state, now: () => NOW, semanticScorer: async (_query, documents) => {
    seen.push(...documents);
    return { [`personal-task:${last.id}`]: 0.9 };
  } });
  assert.equal(tasks.list().length, 201);
  assert.equal(indexPersonalKnowledge(state).filter(item => item.type === 'personal-task').length, 201);
  assert.equal(knowledge.search('zirkoniumcertifikatet')[0]?.source.id, last.id);
  const result = await knowledge.retrieve('certifikatet', { types: ['personal-task'] });
  assert.equal(result.mode, 'local-hybrid');
  assert.equal(result.matches[0]?.source.id, last.id);
  assert.equal(seen.length, 201);
  assert.equal(seen.at(-1).revision, 1);
});

test('B3/C all 250 permitted tasks are searchable and a 251st new task is rejected without mutation', async () => {
  const { state, tasks, last } = await fixture(250);
  const before = structuredClone(state);
  const knowledge = new PersonalKnowledge({ state, now: () => NOW });
  assert.equal(indexPersonalKnowledge(state).filter(item => item.type === 'personal-task').length, 250);
  assert.equal((await knowledge.retrieve('zirkoniumcertifikatet')).matches[0]?.source.id, last.id);
  await assert.rejects(tasks.create(input('Ikke optaget')), /250/);
  assert.deepEqual(state, before);
  assert.equal(taskDomain.MAX_PERSONAL_TASKS, 250, 'one named admission bound is shared by the domain contract');
});

test('B3/C non-archived completed tasks remain historical sources; archived records free capacity but are never retrieved', async () => {
  const { state, tasks, last } = await fixture(250);
  await tasks.complete(last.id, 1);
  const knowledge = new PersonalKnowledge({ state, now: () => NOW });
  const completed = knowledge.search('zirkoniumcertifikatet')[0];
  assert.equal(completed?.source.id, last.id);
  assert.match(completed.text, /Status: completed/);
  assert.equal(completed.source.revision, 2);
  await tasks.archive(last.id, 2);
  assert.deepEqual(knowledge.search('zirkoniumcertifikatet'), []);
  const replacement = await tasks.create(input('Find tungstenformularen'));
  assert.equal(tasks.list().length, 250);
  assert.equal(tasks.list({ includeArchived: true }).length, 251);
  assert.equal(knowledge.search('tungstenformularen')[0]?.source.id, replacement.id);
});

test('B3 prior persisted records above the admission limit are not silently dropped or mutated', async () => {
  const { state, tasks, last } = await fixture(250);
  const legacy = { ...structuredClone(last), id: 'legacy-251', title: 'Syntetisk molybdænaftale', revision: 7 };
  state.personalTasks.push(legacy);
  const before = structuredClone(state);
  const knowledge = new PersonalKnowledge({ state, now: () => NOW });
  assert.equal(tasks.list().length, 251);
  assert.equal((await knowledge.retrieve('molybdænaftale')).matches[0]?.source.id, legacy.id);
  assert.equal(indexPersonalKnowledge(state).filter(item => item.type === 'personal-task').length, 251);
  assert.deepEqual(state, before, 'readability does not migrate or delete preserved user data');
  await assert.rejects(tasks.create(input('Over grænsen')), /250/);
});

test('B3/B5 more than 2000 eligible sources use honest lexical fallback, retaining late task and type boundaries', async () => {
  const { state, last } = await fixture(250);
  state.organizer = Array.from({ length: 9 }, (_, collection) => ({ id: `collection-${collection}`, title: 'Syntetiske noter',
    items: Array.from({ length: 200 }, (_, item) => ({ id: `item-${collection}-${item}`, text: `Andet notat ${collection}-${item}` })) }));
  let calls = 0;
  const knowledge = new PersonalKnowledge({ state, now: () => NOW, semanticScorer: async () => { calls++; return {}; } });
  const result = await knowledge.retrieve('zirkoniumcertifikatet', { types: ['personal-task'] });
  assert.equal(result.mode, 'local-lexical');
  assert.equal(result.semantic.status, 'index-limit');
  assert.equal(result.matches[0]?.source.id, last.id);
  assert.equal(result.matches.every(item => item.type === 'personal-task'), true);
  assert.equal(calls, 0, 'the encoder limit is not bypassed or hidden behind a truncated subset');
  assert.ok(knowledge.lexicalCache.size <= 2000);
  assert.deepEqual((await knowledge.retrieve('zirkoniumcertifikatet', { types: ['memory'] })).matches, []);
});

test('B3/B5 late task corrections, archiving and secret exclusions still govern asynchronous results', async () => {
  const { state, tasks, last } = await fixture(201);
  let finish;
  const knowledge = new PersonalKnowledge({ state, now: () => NOW,
    semanticScorer: () => new Promise(resolve => { finish = resolve; }) });
  const pending = knowledge.retrieve('zirkoniumcertifikatet');
  await new Promise(resolve => setImmediate(resolve));
  await tasks.update(last.id, { expectedRevision: 1, title: 'Find platinoversigten' });
  finish({ [`personal-task:${last.id}`]: 0.9 });
  const result = await pending;
  assert.equal(result.semantic.status, 'source-changed');
  assert.deepEqual(result.matches, [], 'an old score cannot resurrect the old title');
  assert.equal(knowledge.search('platinoversigten')[0]?.source.revision, 2);
  state.personalTasks.at(-1).purpose = 'API_KEY=synthetic_secret_should_never_be_indexed';
  assert.deepEqual(knowledge.search('platinoversigten'), []);
  assert.equal(indexPersonalKnowledge(state).some(item => item.source.id === last.id), false);
  state.personalTasks.at(-1).purpose = 'Rettet, ikke-følsomt formål';
  await tasks.archive(last.id, 2);
  assert.deepEqual(knowledge.search('platinoversigten'), []);
});
