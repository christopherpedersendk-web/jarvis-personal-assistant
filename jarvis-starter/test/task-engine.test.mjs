import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskEngine, nextCopenhagenTime } from '../task-engine.mjs';

test('daily Danish schedule respects CET/CEST and DST transitions', () => {
  assert.equal(nextCopenhagenTime(new Date('2026-11-03T06:00:00Z'), '07:30'), '2026-11-03T06:30:00.000Z');
  assert.equal(nextCopenhagenTime(new Date('2026-07-03T04:00:00Z'), '07:30'), '2026-07-03T05:30:00.000Z');
  assert.equal(nextCopenhagenTime(new Date('2026-03-29T06:00:00Z'), '07:30'), '2026-03-30T05:30:00.000Z');
});

test('daily briefing reschedules to the same local clock time', async () => {
  let now = new Date('2026-11-03T06:00:00Z');
  const engine = new TaskEngine({ state: { tasks: [], usage: { day: '', started: 0 } },
    save: async () => {}, now: () => now, runTask: async () => 'Briefing' });
  const task = await engine.create({ title: 'Morgen', prompt: 'Nyheder', category: 'briefing', dailyTime: '07:30' });
  assert.equal(task.nextRunAt, '2026-11-03T06:30:00.000Z');
  now = new Date('2026-11-03T06:31:00Z');
  await engine.tick();
  assert.equal(task.status, 'scheduled');
  assert.equal(task.nextRunAt, '2026-11-04T06:30:00.000Z');
});

test('creates and completes persistent one-off tasks', async () => {
  const state = { tasks: [], usage: { day: '', started: 0 } };
  let saves = 0;
  const engine = new TaskEngine({
    state, save: async () => { saves += 1; },
    now: () => new Date('2026-11-03T12:00:00Z'),
    runTask: async (_, keepId) => { await keepId('resp_test'); return 'Resultat med kilder'; },
  });
  const task = await engine.create({ title: 'Undersøg restauranter', prompt: 'Find muligheder til fredag' });
  assert.equal(task.status, 'scheduled');
  await engine.tick();
  assert.equal(task.status, 'completed');
  assert.equal(task.runs[0].result, 'Resultat med kilder');
  assert.equal(task.responseId, null);
  assert.equal(engine.currentUsage().started, 1);
  assert.ok(saves >= 3);
});

test('recurring tasks wait for next run and respect daily budget', async () => {
  let now = new Date('2026-11-03T12:00:00Z');
  let calls = 0;
  const engine = new TaskEngine({
    state: { tasks: [], usage: { day: '', started: 0 } },
    save: async () => {}, now: () => now, maxRunsPerDay: 1,
    runTask: async () => `Run ${++calls}`,
  });
  const task = await engine.create({ title: 'Daglige nyheder', prompt: 'Opsummér nyheder', intervalMinutes: 60 });
  await engine.tick();
  assert.equal(calls, 1);
  assert.equal(task.status, 'scheduled');
  now = new Date('2026-11-03T13:10:00Z');
  await engine.tick();
  assert.equal(calls, 1, 'daily budget prevents a second run');
  now = new Date('2026-11-04T12:00:00Z');
  await engine.tick();
  assert.equal(calls, 2);
});

test('validates intervals, pauses, resumes and archives', async () => {
  const engine = new TaskEngine({
    state: { tasks: [], usage: { day: '', started: 0 } },
    save: async () => {}, now: () => new Date('2026-11-03T12:00:00Z'), runTask: async () => 'OK',
  });
  await assert.rejects(engine.create({ title: 'For tit', prompt: 'x', intervalMinutes: 5 }), /mindst hver time/);
  const task = await engine.create({ title: 'Planlagt', prompt: 'En undersøgelse', runAt: '2026-11-04T12:00:00Z' });
  await engine.action(task.id, 'pause');
  assert.equal(task.status, 'paused');
  await engine.tick();
  assert.equal(task.runs.length, 0);
  await engine.action(task.id, 'resume');
  assert.equal(task.status, 'scheduled');
  await engine.action(task.id, 'archive');
  assert.equal(engine.list().length, 0);
});

test('removing an inactive task hides it but keeps its history', async () => {
  const state = { tasks: [], usage: { day: '', started: 0 } };
  const engine = new TaskEngine({ state, save: async () => {}, runTask: async () => 'OK' });
  const task = await engine.create({ title: 'Gammel prisagent', prompt: 'Overvåg denne vare' });
  await engine.remove(task.id);
  assert.equal(engine.list().length, 0);
  assert.equal(state.tasks[0].status, 'archived');
  await assert.rejects(engine.remove(task.id), /findes ikke/);
});
