import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createGuiFixture, GUI_IDS, GUI_NOW } from '../scripts/fixtures/gui-redesign.mjs';

const code = await readFile(new URL('../public/gui-watches.js', import.meta.url), 'utf8');
const watches = vm.runInNewContext(`${code}\nJarvisWatches;`, { Date, Intl, URL });
const fixture = await createGuiFixture();
const make = id => structuredClone(fixture.tasks.find(task => task.id === id));

test('GUI-T07 a newer failed check retains the old price, source and actual success timestamp', () => {
  const task = make(GUI_IDS.stale), before = JSON.stringify(task);
  const view = watches.presentation(task, Date.parse(GUI_NOW));
  assert.equal(view.group, 'active'); assert.equal(view.check, 'failed'); assert.equal(view.freshness, 'stale');
  assert.equal(view.lastAttemptAt, '2026-11-05T09:10:00.000Z');
  assert.equal(view.lastSuccessAt, '2026-11-04T11:00:00.000Z');
  assert.equal(view.observedAt, '2026-11-04T11:00:00.000Z');
  assert.equal(view.source, 'https://example.invalid/robotstoevsuger');
  assert.match(view.value, /3\.299/); assert.equal(view.valueLabel, 'Senest kendte pris');
  assert.equal(JSON.stringify(task), before, 'presentation does not rewrite task history');
});

test('GUI-T07 the first valid measurement is known even when change from a previous value is unknown', () => {
  const task = make(GUI_IDS.monitor);
  task.runs[0].status = 'unknown'; task.runs[0].observation.status = 'unknown';
  const view = watches.presentation(task, Date.parse(GUI_NOW));
  assert.equal(view.check, 'success'); assert.match(view.checkLabel, /ændring endnu ikke afgjort/);
  assert.equal(view.freshness, 'fresh'); assert.match(view.value, /1\.899/);
});

test('GUI-T07 missing source, credentials in source URL and unstructured values never claim a verified price', () => {
  for (const source of ['', 'not-a-source', 'javascript:alert(1)', 'https://user:secret@example.invalid/item']) {
    const task = make(GUI_IDS.monitor); task.runs[0].observation.source = source;
    const view = watches.presentation(task, Date.parse(GUI_NOW));
    assert.equal(view.source, null); assert.equal(view.value, null); assert.equal(view.check, 'unknown');
    assert.equal(view.freshness, 'unknown');
  }
  const task = make(GUI_IDS.monitor); task.runs[0].observation.value = null;
  assert.equal(watches.presentation(task, Date.parse(GUI_NOW)).value, null);
});

test('GUI-T07 failure within the interval is unknown freshness, not a new success', () => {
  const task = make(GUI_IDS.stale);
  task.runs[1].observation.observedAt = '2026-11-05T08:30:00.000Z';
  task.runs[1].at = '2026-11-05T08:31:00.000Z';
  const view = watches.presentation(task, Date.parse(GUI_NOW));
  assert.equal(view.check, 'failed'); assert.equal(view.freshness, 'unknown');
  assert.equal(view.lastSuccessAt, '2026-11-05T08:31:00.000Z');
  assert.notEqual(view.lastAttemptAt, view.lastSuccessAt);
});

test('GUI-T07 changing criteria invalidates relevance without deleting the previous measurement', () => {
  const task = make(GUI_IDS.monitor);
  task.runs[0].binding = { prompt: 'Tidligere produktvariant', parameters: { variant: 'blue' } };
  const view = watches.presentation(task, Date.parse(GUI_NOW));
  assert.equal(view.changedCriteria, true); assert.equal(view.freshness, 'unknown');
  assert.match(view.value, /1\.899/); assert.match(view.freshnessLabel, /kriterierne er ændret/);
});

test('GUI-T07 paused status is independent from observations and never invents the next scheduled run', () => {
  const task = make(GUI_IDS.monitor); task.status = 'paused';
  const view = watches.presentation(task, Date.parse(GUI_NOW));
  assert.equal(view.group, 'paused'); assert.equal(view.check, 'success');
  assert.equal(view.nextRunAt, null); assert.ok(view.observation);
  assert.equal(watches.presentation(make(GUI_IDS.paused), Date.parse(GUI_NOW)).check, 'untried');
});

test('GUI-T07 unknown interval or a future measurement cannot establish freshness', () => {
  const task = make(GUI_IDS.monitor); task.intervalMinutes = 0;
  assert.equal(watches.presentation(task, Date.parse(GUI_NOW)).freshness, 'unknown');
  task.intervalMinutes = 360; task.runs[0].observation.observedAt = '2026-11-06T10:00:00.000Z';
  assert.equal(watches.presentation(task, Date.parse(GUI_NOW)).freshness, 'unknown');
});

test('GUI-T15 a daily Danish schedule uses the next local day across daylight-saving changes', () => {
  const task = make(GUI_IDS.monitor); task.intervalMinutes = 0; task.dailyTime = '07:30';
  task.runs[0].observation.observedAt = '2026-10-24T05:30:00.000Z';
  task.runs[0].at = '2026-10-24T05:31:00.000Z';
  assert.equal(watches.presentation(task, Date.parse('2026-10-25T06:29:00.000Z')).freshness, 'fresh');
  assert.equal(watches.presentation(task, Date.parse('2026-10-25T06:30:00.000Z')).freshness, 'stale');
  task.runs[0].observation.observedAt = '2026-03-28T06:30:00.000Z';
  assert.equal(watches.presentation(task, Date.parse('2026-03-29T05:29:00.000Z')).freshness, 'fresh');
  assert.equal(watches.presentation(task, Date.parse('2026-03-29T05:30:00.000Z')).freshness, 'stale');
});
