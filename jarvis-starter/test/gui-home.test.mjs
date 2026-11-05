import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/smart-home.js', import.meta.url), 'utf8');
const home = vm.runInNewContext(`${source}\nJarvisHome;`);

test('GUI-T06 configuration, unknown connection and stale status cannot imply a connected device', () => {
  assert.match(home.connection({ connectionState: 'not_verified' }).label, /endnu ikke kontrolleret/);
  assert.match(home.connection({ connectionState: 'stale' }).label, /forældet/);
  assert.match(home.connection({}).label, /ukendt/);
  assert.equal(home.connection({ connectionState: 'connected' }).label, 'Forbundet');
});

test('GUI-T06 an empty, failed or conflicting device response cannot be labelled successful', () => {
  for (const result of [null, {}, { ok: false }, { ok: true, status: 'unknown' },
    { ok: true, outcome: 'failed' }, { alreadyRecorded: true, status: 'unknown' }])
    assert.equal(Boolean(home.confirmed(result)), false, JSON.stringify(result));
  assert.equal(home.confirmed({ ok: true }), true);
  assert.equal(home.confirmed({ alreadyRecorded: true, status: 'completed' }), true);
});

test('GUI-T06 last attempt, last success and error remain distinct after a connection failure', () => {
  const view = home.connection({ connectionState: 'unavailable', lastCheckedAt: '2026-11-05T09:15:00Z',
    lastSuccessfulAt: '2026-11-04T09:15:00Z', lastError: 'Syntetisk forbindelsesfejl' });
  assert.equal(view.checkedAt, '2026-11-05T09:15:00Z');
  assert.equal(view.successfulAt, '2026-11-04T09:15:00Z');
  assert.equal(view.error, 'Syntetisk forbindelsesfejl');
});
