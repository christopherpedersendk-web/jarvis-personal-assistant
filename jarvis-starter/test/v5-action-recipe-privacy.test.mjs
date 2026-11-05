import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableState } from '../durable-state.mjs';
import { ActionJournal, retainActionJournal } from '../action-journal.mjs';
import { RecipeMemory } from '../recipe-memory.mjs';
import { BoundedJobQueue } from '../bounded-queue.mjs';
import { containsSecret, redactSecrets, rejectSecrets } from '../privacy.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(initial = { actionJournal: [], recipes: [], affected: [] }, options = {}) {
  let disk; let fail = () => false;
  const store = new DurableState({ initial, write: async content => {
    const next = JSON.parse(content);
    if (fail(next)) throw new Error('Syntetisk lagerfejl');
    disk = next;
  } });
  const save = () => store.save();
  const transact = (keys, action) => store.transact(keys, action);
  const journal = new ActionJournal({ state: store.state, save, transact });
  const recipes = new RecipeMemory({ state: store.state, save, transact, ...options });
  await store.initialize();
  return { store, recipes, journal, disk: () => structuredClone(disk), fail: fn => { fail = fn; } };
}

test('A2/R05 write-ahead failure performs no action; later calls recover', async () => {
  const f = await fixture(); let calls = 0;
  f.fail(state => state.actionJournal.length > 0);
  await assert.rejects(f.journal.invoke({ name: 'synthetic', call_id: 'one' }, {}, async () => { calls++; }, 'web'), /lagerfejl/);
  assert.equal(calls, 0); assert.equal(f.store.state.actionJournal.length, 0);
  f.fail(() => false);
  await f.journal.invoke({ name: 'synthetic', call_id: 'one' }, {}, async () => { calls++; return { item: { id: 'x', revision: 1 } }; }, 'web');
  assert.equal(calls, 1); assert.equal(f.disk().actionJournal[0].status, 'completed');
  assert.deepEqual(f.disk().actionJournal[0].resultRefs, [{ kind: 'item', id: 'x', revision: 1 }]);
});

test('A2 concurrent same call ID is claimed exactly once and canonical arguments remain bound', async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred(); let calls = 0;
  const action = f.journal.invoke({ name: 'synthetic', call_id: 'same' }, { x: 1, y: 2 }, async () => {
    calls++; entered.resolve(); await release.promise; return { ok: true };
  }, 'web');
  await entered.promise;
  await assert.rejects(f.journal.invoke({ name: 'synthetic', call_id: 'same' }, { y: 2, x: 1 }, async () => { calls++; }, 'web'), /uafklaret/);
  release.resolve(); await action;
  assert.equal((await f.journal.invoke({ name: 'synthetic', call_id: 'same' }, { y: 2, x: 1 }, () => { calls++; }, 'web')).alreadyRecorded, true);
  await assert.rejects(f.journal.invoke({ name: 'synthetic', call_id: 'same' }, { x: 2, y: 2 }, () => { calls++; }, 'web'), /grundlag/);
  assert.equal(calls, 1);
});

test('A2 completed external action with failed final save stays unknown across restart and cannot replay', async () => {
  const f = await fixture(); let calls = 0;
  f.fail(state => state.actionJournal.some(item => item.status === 'completed'));
  await assert.rejects(f.journal.invoke({ name: 'synthetic', call_id: 'outcome' }, {}, async () => { calls++; return { ok: true }; }, 'web'), error => error.unknownOutcome === true);
  assert.equal(f.disk().actionJournal[0].status, 'unknown');
  const restarted = await fixture(f.disk());
  await assert.rejects(restarted.journal.invoke({ name: 'synthetic', call_id: 'outcome' }, {}, () => { calls++; }, 'web'), /uafklaret/);
  assert.equal(calls, 1);
});

test('A2 unresolved outcomes are never lost by bounded history retention', () => {
  const entries = [{ id: 'unknown', status: 'unknown' }, { id: 'partial', status: 'partially_completed' },
    ...Array.from({ length: 1100 }, (_, i) => ({ id: String(i), status: 'completed' }))];
  const retained = retainActionJournal(entries);
  assert.equal(retained.length, 1002);
  assert.ok(retained.some(item => item.id === 'unknown'));
  assert.ok(retained.some(item => item.id === 'partial'));
});

test('F1 receipt and processing are durable before extraction; failure preserves exact original and later explicit resume', async () => {
  let calls = 0; let f;
  f = await fixture(undefined, { extractor: async () => {
    calls++;
    assert.equal(f.disk().recipes[0].processingStatus, 'processing');
    assert.equal(f.disk().recipes[0].original.text, 'Min <originale> opskrift\n2 stk gulerod');
    return { title: 'Udtrukket kladde', ingredients: [{ name: 'gulerod', quantity: 2, unit: 'stk' }] };
  } });
  f.fail(state => state.recipes.some(item => item.processingStatus === 'review_required'));
  await assert.rejects(f.recipes.capture({ text: 'Min <originale> opskrift\n2 stk gulerod' }), /lagerfejl/);
  assert.equal(calls, 1);
  assert.equal(f.disk().recipes[0].processingStatus, 'processing');
  const restarted = await fixture(f.disk(), { extractor: async () => { calls++; return { title: 'Genoptaget kladde' }; } });
  assert.equal(calls, 1, 'startup does not call any model or external source');
  const receipt = restarted.recipes.list()[0];
  assert.equal(receipt.processingStatus, 'error');
  assert.equal(receipt.original.text, 'Min <originale> opskrift\n2 stk gulerod');
  await assert.rejects(restarted.recipes.resume(receipt.id, { expectedRevision: 0 }), /ændret/);
  const resumed = await restarted.recipes.resume(receipt.id, { expectedRevision: receipt.revision });
  assert.equal(calls, 2); assert.equal(resumed.processingStatus, 'review_required');
  assert.equal(resumed.confirmed, false); assert.equal(restarted.recipes.usable().length, 0);
  await assert.rejects(restarted.recipes.resume(receipt.id, { expectedRevision: resumed.revision }), /afbrudt/);
});

test('F1 failed receipt does no fetch/model work and dedupe preserves a received record', async () => {
  let reads = 0;
  const f = await fixture(undefined, { fetchResource: async () => { reads++; throw new Error('synthetic unavailable'); } });
  f.fail(state => state.recipes.length > 0);
  await assert.rejects(f.recipes.capture({ text: 'https://example.org/opskrift' }), /lagerfejl/);
  assert.equal(reads, 0); assert.deepEqual(f.recipes.list(), []);
  f.fail(() => false);
  const first = await f.recipes.capture({ text: 'https://example.org/opskrift' });
  const second = await f.recipes.capture({ text: 'https://example.org/opskrift' });
  assert.equal(reads, 1); assert.equal(second.id, first.id); assert.equal(second.duplicate, true);
  assert.equal(first.links[0].status, 'unavailable');
});

test('F3/A1 recipe edits and dependent invalidation share one commit, including rollback on failure', async () => {
  let f;
  f = await fixture(undefined, { onChanged: async id => { f.store.state.affected.push(id); await f.store.save(); } });
  const recipe = await f.recipes.capture({ text: 'Manuel kladde' });
  f.fail(state => state.affected.length > 0);
  await assert.rejects(f.recipes.update(recipe.id, { expectedRevision: 1, title: 'Må ikke gemmes' }), /lagerfejl/);
  assert.equal(f.recipes.get(recipe.id).title, 'Manuel kladde');
  assert.deepEqual(f.store.state.affected, []);
  f.fail(() => false);
  await f.recipes.update(recipe.id, { expectedRevision: 1, title: 'Gemt samlet' });
  assert.equal(f.disk().recipes[0].title, 'Gemt samlet');
  assert.deepEqual(f.disk().affected, [recipe.id]);
});

test('A3 recipe waiting work is bounded and cancellable without affecting active extraction or local reads', async () => {
  const release = deferred(); const entered = deferred(); let calls = 0;
  const f = await fixture(undefined, { queue: new BoundedJobQueue({ concurrency: 1, maxWaiting: 1 }), extractor: async () => {
    calls++; entered.resolve(); await release.promise; return { title: 'Eneste udtræk' };
  } });
  const first = f.recipes.capture({ text: 'Første kladde' }); await entered.promise;
  assert.equal(f.recipes.list()[0].processingStatus, 'processing');
  const second = f.recipes.capture({ text: 'Ventende kladde' });
  const cancelled = assert.rejects(second, error => error.code === 'JOB_CANCELLED');
  await assert.rejects(f.recipes.capture({ text: 'Over grænsen' }), error => error.code === 'JOB_QUEUE_FULL');
  f.recipes.cancelWaiting(f.recipes.jobs().find(job => job.state === 'queued').id);
  await cancelled; release.resolve(); await first;
  assert.equal(calls, 1); assert.equal(f.recipes.list().length, 1);
});

test('I5 secrets are excluded/redacted across nested exports and prompts without changing stored originals', () => {
  const key = 'sk-syntheticonly01234567890123456789';
  const data = { text: `Bevar almindelig tekst. ${key}`, nested: [{ password: 'secret with spaces', okay: true }],
    configuredToken: 'opaqueConfiguredSecret', intentToken: 'reviewed-owner-intent' };
  const before = structuredClone(data);
  const result = redactSecrets(data, ['opaqueConfiguredSecret']);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(result).includes('secret with spaces'), false);
  assert.equal(JSON.stringify(result).includes('opaqueConfiguredSecret'), false);
  assert.equal(result.intentToken, 'reviewed-owner-intent', 'owner click intent is not an external credential');
  assert.deepEqual(data, before);
  for (const source of [key, 'password = "secret with spaces"', '{"apiKey":"syntheticsecret"}', 'Authorization: Bearer synthetictoken']) {
    assert.equal(containsSecret(source), true);
    assert.throws(() => rejectSecrets(source), /adgangskoder/);
  }
  assert.equal(containsSecret('Jeg ønsker ikke at gemme en adgangskode her.'), false);
});
