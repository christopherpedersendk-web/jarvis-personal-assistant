import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { historyPage, uiBootstrap, overviewSummary } from '../ui-read-model.mjs';

const history = Array.from({ length: 65 }, (_, i) => ({ role: 'user', text: `Syntetisk besked ${i}`, at: new Date(Date.UTC(2026, 10, 5, 8, i)).toISOString() }));

test('J1 history pages contain every stored message once, in order, with bounded size', () => {
  let page = historyPage(history), combined = [...page.items], requests = 1;
  assert.equal(page.items.length, 20); assert.equal(page.total, 65);
  while (page.nextCursor) { page = historyPage(history, { cursor: page.nextCursor }); combined = [...page.items, ...combined]; requests++; }
  assert.equal(requests, 4); assert.deepEqual(combined, history);
});

test('J1 history cursor fails honestly if new messages make its snapshot stale', () => {
  const page = historyPage(history);
  assert.throws(() => historyPage([...history, { text: 'Ny besked' }], { cursor: page.nextCursor }), error => error.status === 409 && error.code === 'HISTORY_CHANGED');
  assert.equal(history.length, 65);
});

test('J1 malformed history cursor and excessive page size cannot bypass the bound', () => {
  for (const limit of [0, -1, 51, 1.5, 'many']) assert.throws(() => historyPage(history, { limit }), error => error.status === 400);
  for (const cursor of ['x'.repeat(241), '@bad', Buffer.from('{}').toString('base64url'), Buffer.from('{"before":999,"revision":"bad"}').toString('base64url')])
    assert.throws(() => historyPage(history, { cursor }), error => error.status === 400);
});

test('J1 bootstrap does not carry unrelated domains, original recipes, action args or secrets', () => {
  const state = { schemaVersion: 1, preferences: 'Syntetisk note', playbook: 'Syntetisk procedure', history,
    organizer: [{ items: Array.from({ length: 400 }, () => ({ text: 'Unødvendigt ved start' })) }],
    recipeMemories: [{ original: 'Originalt kildemateriale' }], personalClaims: [{ value: 'Bekræftet, men ikke startdata' }],
    settings: { anything: 'private-marker' }, actionJournal: [{ args: { marker: 'not-for-boot' } }],
    inbox: [{ read: false }], approvals: [{ status: 'pending' }] };
  const snapshot = JSON.stringify(state);
  const result = uiBootstrap(state, { tasks: [], projects: [], configured: false, pushEnabled: false });
  assert.equal(result.history.length, 20); assert.equal(result.historyPagination.total, 65);
  for (const key of ['organizer', 'recipeMemories', 'personalClaims', 'settings', 'actionJournal', 'tasks', 'projects']) assert.equal(key in result, false);
  assert.equal(JSON.stringify(result).includes('private-marker'), false);
  assert.equal(JSON.stringify(state), snapshot, 'read model must be pure');
});

test('A2/J1 summary preserves unknown latest outcome and counts queued/retrying separately from success', () => {
  const summary = overviewSummary({ inbox: [], approvals: [] }, [
    { title: 'Afventer', status: 'queued', runs: [{ at: '2026-11-05T09:00:00Z', status: 'unknown' }] },
    { title: 'Læsekilde', status: 'retrying', runs: [{ at: '2026-11-04T09:00:00Z', status: 'failed' }] },
  ], []);
  assert.equal(summary.runningCount, 1); assert.equal(summary.scheduledCount, 1); assert.equal(summary.latestTask.status, 'unknown');
});

const healthSource = await readFile(new URL('../public/system-health.js', import.meta.url), 'utf8');
const presentation = vm.runInNewContext(`${healthSource}\nJarvisHealth.presentation;`);
test('K2/I1 normal or unavailable observations do not become fabricated incidents or a successful backup', () => {
  const result = presentation({ storage: { ready: true }, discord: { status: 'disabled' }, backup: { result: 'unavailable' } });
  assert.equal(result.discord, 'Slået fra'); assert.equal(result.backup, 'Ikke verificeret'); assert.equal(result.warnings.length, 0);
  assert.equal(presentation({ backup: { result: 'success', lastFinished: '' } }).backup, 'Ikke verificeret');
});

test('A4/K2 storage failure and unknown delivery remain visible outside collapsed details', () => {
  const result = presentation({ storage: { ready: false, reason: 'Gemning er usikker' },
    discord: { status: 'connected', unknownMessageCount: 1, ingressGap: { status: 'requires_review' } }, backup: { result: 'timeout' } });
  assert.equal(result.storage, 'Ikke klar'); assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.some(text => /Ingen automatisk gentagelse/.test(text)));
});
