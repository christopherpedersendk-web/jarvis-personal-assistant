import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalClaims, currentClaim } from '../personal-claims.mjs';
import { PersonalKnowledge } from '../personal-knowledge.mjs';
import { DurableState } from '../durable-state.mjs';

const NOW = new Date('2026-11-05T10:00:00Z');
const input = extra => ({ subject: 'arbejdsrejse', value: 'Jeg cykler til kontoret.', category: 'preference',
  source: { kind: 'user', channel: 'manual', id: 'note:syntetisk' }, ...extra });
async function fixture() {
  let fail = false, disk, writes = 0;
  const store = new DurableState({ initial: {}, write: async text => {
    if (fail) throw new Error('synthetic rename failure'); disk = JSON.parse(text); writes++;
  } });
  const claims = new PersonalClaims({ state: store.state, save: () => store.save(), now: () => NOW });
  const knowledge = new PersonalKnowledge({ state: store.state, now: () => NOW });
  await store.initialize();
  const call = (method, ...args) => store.transact(['personalClaims'], () => claims[method](...args));
  const confirmed = async (extra = {}) => { const proposed = await call('propose', input(extra)); return call('decision', proposed.id, 1, 'confirm'); };
  return { store, claims, knowledge, call, confirmed, fail: value => { fail = value; }, disk: () => structuredClone(disk), writes: () => writes };
}

test('B2 a proposed edit is revision-bound, preserves source history and remains excluded from retrieval', async () => {
  const f = await fixture(), p = await f.call('propose', input());
  const changed = await f.call('update', p.id, { expectedRevision: 1, value: 'Jeg tager sporvognen.', sourceId: 'note:ny' });
  assert.equal(changed.revision, 2); assert.equal(changed.status, 'proposed');
  assert.equal(changed.revisions[0].value, p.value); assert.deepEqual(changed.revisions[0].source, p.source);
  assert.deepEqual(changed.source, { kind: 'user', channel: 'manual', id: 'note:ny' });
  assert.deepEqual(f.knowledge.search('sporvognen'), []);
  await assert.rejects(f.call('update', p.id, { expectedRevision: 1, value: 'Gammel kladde' }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.claims.list()[0].value, changed.value);
});

test('B2 identical proposal saves are true no-ops but changed provenance or validity is not silently deduplicated', async () => {
  const f = await fixture(), p = await f.call('propose', input()), before = f.writes();
  assert.deepEqual(await f.call('update', p.id, { expectedRevision: 1, value: p.value, sourceId: p.source.id }), p);
  assert.equal(f.writes(), before);
  assert.equal((await f.call('propose', input())).id, p.id);
  assert.notEqual((await f.call('propose', input({ expiresAt: '2026-11-10T10:00:00Z' }))).id, p.id);
  assert.notEqual((await f.call('propose', input({ source: { kind: 'user', channel: 'manual', id: 'note:anden' } }))).id, p.id);
});

test('B2 confirmed corrections create a separate proposal and retain the prior active fact until exact owner review', async () => {
  const f = await fixture(), old = await f.confirmed();
  await assert.rejects(f.call('update', old.id, { expectedRevision: 2, value: 'Overført uden review' }), { code: 'REVISION_CONFLICT' });
  const correction = await f.call('propose', input({ value: 'Jeg tager sporvognen til kontoret.', correctsId: old.id, correctsRevision: 2 }));
  assert.equal(f.claims.list().find(x => x.id === old.id).status, 'confirmed');
  assert.ok(f.knowledge.search('kontoret').some(x => x.id === `claim:${old.id}`));
  assert.ok(!f.knowledge.search('sporvognen').some(x => x.id === `claim:${correction.id}`));
  await assert.rejects(f.call('decision', correction.id, 1, 'confirm'), { code: 'REVISION_CONFLICT' });
  const changed = await f.call('decision', correction.id, 1, 'confirm', { supersedesId: old.id, supersedesRevision: 2 });
  assert.equal(changed.status, 'confirmed'); assert.equal(changed.supersedesRevision, 2);
  assert.equal(f.claims.list().find(x => x.id === old.id).status, 'superseded');
  const results = f.knowledge.search('kontoret');
  assert.ok(results.some(x => x.id === `claim:${correction.id}`)); assert.ok(!results.some(x => x.id === `claim:${old.id}`));
  assert.equal(changed.revisions[0].status, 'proposed');
  assert.equal('supersedesId' in changed.revisions[0], false, 'history is the exact pre-confirmation record');
});

test('B2 replacement rejects a missing/stale original revision before touching either record', async () => {
  const f = await fixture(), old = await f.confirmed();
  const p = await f.call('propose', input({ value: 'En anden registreret oplysning.' })), before = f.disk();
  for (const options of [{ supersedesId: old.id }, { supersedesId: old.id, supersedesRevision: 1 }])
    await assert.rejects(f.call('decision', p.id, 1, 'confirm', options), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(f.disk(), before); assert.equal(f.claims.list().find(x => x.id === old.id).revision, 2);
  await assert.rejects(f.call('propose', input({ correctsId: old.id, correctsRevision: 1 })), { code: 'REVISION_CONFLICT' });
});

test('B2 invalidation immediately excludes a fact and retains reviewed revisions and sources', async () => {
  const f = await fixture(), old = await f.confirmed();
  assert.ok(f.knowledge.search('arbejdsrejse').length);
  const invalid = await f.call('decision', old.id, 2, 'invalidate');
  assert.equal(invalid.status, 'invalid'); assert.equal(invalid.invalidatedBy, 'user');
  assert.equal(currentClaim(invalid, NOW), false); assert.deepEqual(f.knowledge.search('arbejdsrejse'), []);
  assert.equal(invalid.revisions[1].status, 'confirmed'); assert.deepEqual(invalid.revisions[1].source, old.source);
  await assert.rejects(f.call('decision', old.id, 2, 'invalidate'), { code: 'REVISION_CONFLICT' });
});

test('B2 a correction cannot silently replace an original invalidated after the proposal was reviewed', async () => {
  const f = await fixture(), old = await f.confirmed();
  const p = await f.call('propose', input({ value: 'Jeg går nu.', correctsId: old.id, correctsRevision: 2 }));
  await f.call('decision', old.id, 2, 'invalidate');
  await assert.rejects(f.call('decision', p.id, 1, 'confirm', { supersedesId: old.id, supersedesRevision: 2 }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.claims.list().find(x => x.id === p.id).status, 'proposed');
  assert.deepEqual(f.knowledge.search('arbejdsrejse'), []);
});

test('B2 disk failure during replacement leaves both facts, sources and histories unchanged; queue recovers', async () => {
  const f = await fixture(), old = await f.confirmed();
  const p = await f.call('propose', input({ value: 'Jeg går nu.', correctsId: old.id, correctsRevision: 2 }));
  const before = f.disk(), visible = f.claims.list(); f.fail(true);
  await assert.rejects(f.call('decision', p.id, 1, 'confirm', { supersedesId: old.id, supersedesRevision: 2 }), /rename failure/);
  assert.deepEqual(f.disk(), before); assert.deepEqual(f.claims.list(), visible);
  f.fail(false); await f.call('decision', p.id, 1, 'confirm', { supersedesId: old.id, supersedesRevision: 2 });
  assert.equal(f.claims.list().find(x => x.id === p.id).status, 'confirmed');
});

test('B2 two concurrent replacements of the same original publish exactly one reviewed transition', async () => {
  const f = await fixture(), old = await f.confirmed();
  const proposals = await Promise.all(['Jeg går.', 'Jeg tager tog.'].map(value => f.call('propose', input({ value, correctsId: old.id, correctsRevision: 2 }))));
  const results = await Promise.allSettled(proposals.map(p => f.call('decision', p.id, 1, 'confirm', { supersedesId: old.id, supersedesRevision: 2 })));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.claims.list().filter(x => x.status === 'confirmed').length, 1);
  assert.equal(f.claims.list().filter(x => x.status === 'proposed').length, 1);
});

test('B1 source reference, validity and category are validated before mutation, with no secret leakage into history', async () => {
  const f = await fixture(), p = await f.call('propose', input()), before = f.disk();
  for (const patch of [{ sourceId: 'password=syntheticsecret' }, { sourceId: 'https://user:secret@example.invalid/x' },
    { sourceId: 'x'.repeat(121) }, { validFrom: '2026-02-31T12:00:00Z' }, { validFrom: '2026-11-05T24:00:00Z' },
    { expiresAt: '2026-11-05T12:00' }, { category: 'automatically-confirmed' }, { status: 'confirmed' }, { source: { kind: 'assistant' } }])
    await assert.rejects(f.call('update', p.id, { expectedRevision: 1, ...patch }));
  assert.deepEqual(f.disk(), before);
  const future = await f.call('update', p.id, { expectedRevision: 1, validFrom: '2026-11-10T08:00:00+01:00', expiresAt: '2026-11-20T09:00:00+01:00', sourceId: '' });
  assert.equal(future.validFrom, '2026-11-10T07:00:00.000Z'); assert.equal(future.source.id, undefined);
  const confirmed = await f.call('decision', p.id, 2, 'confirm');
  assert.equal(currentClaim(confirmed, NOW), false);
});
