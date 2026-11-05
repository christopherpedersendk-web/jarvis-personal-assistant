import test from 'node:test';
import assert from 'node:assert/strict';
import { FollowUpCases } from '../follow-up-cases.mjs';

const input = nextCheckAt => ({ awaiting: 'Syntetisk svar', nextCheckAt, stopCondition: 'Svar bekræftet af ejer',
  source: { kind: 'user', id: 'synthetic-review' } });
const invalid = ['2026-02-30T12:00:00Z', '2026-11-05T24:00:00Z', '2026-11-05T12:00:00+14:15',
  '2026-11-05T12:00:00-15:00', 'November 5, 2026 12:00:00Z', '2026-11-05T12:00'];

test('C5 shared time validation rejects impossible civil dates and offsets without inventing a later follow-up', async () => {
  const state = {}; let saves = 0;
  const cases = new FollowUpCases({ state, save: async () => { saves++; } });
  for (const nextCheckAt of invalid) await assert.rejects(cases.create(input(nextCheckAt)), /dato|tidspunkt|tidszone/i);
  assert.deepEqual(state.followUpCases, []); assert.equal(saves, 0);
  const record = await cases.create(input('2028-02-29T12:00:00+01:00'));
  assert.equal(record.nextCheckAt, '2028-02-29T11:00:00.000Z'); assert.equal(saves, 1);
});

test('C5 invalid snooze or observation follow-up dates do not mutate observations, revision or stop conditions', async () => {
  const state = {}; let saves = 0;
  const cases = new FollowUpCases({ state, save: async () => { saves++; } });
  const record = await cases.create(input('2026-11-06T12:00:00+01:00')), before = structuredClone(state);
  for (const nextCheckAt of invalid) for (const action of ['snooze', 'observe']) {
    await assert.rejects(cases.update(record.id, 1, action, { nextCheckAt,
      observation: { status: 'unknown', subject: 'Syntetisk svar', source: 'user:synthetic-review' } }));
    assert.deepEqual(state, before);
  }
  assert.equal(saves, 1);
});

test('C5 explicit DST offsets preserve their actual instants rather than choosing an ambiguous local time', async () => {
  const cases = new FollowUpCases({ state: {} });
  const first = await cases.create(input('2026-10-25T02:30:00+02:00'));
  const second = await cases.create(input('2026-10-25T02:30:00+01:00'));
  assert.equal(Date.parse(second.nextCheckAt) - Date.parse(first.nextCheckAt), 3_600_000);
  assert.equal((await cases.update(first.id, 1, 'snooze', { nextCheckAt: '2026-03-29T03:30:00+02:00' })).nextCheckAt,
    '2026-03-29T01:30:00.000Z');
});
