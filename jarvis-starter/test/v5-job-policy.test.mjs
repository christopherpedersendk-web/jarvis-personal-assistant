import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableState } from '../durable-state.mjs';
import { TaskEngine } from '../task-engine.mjs';
import { SkillsRegistry } from '../skills-registry.mjs';

async function fixture({ now = '2026-11-05T10:00:00Z', skills = [] } = {}) {
  let disk, error = null, calls = 0, notifications = 0;
  const store = new DurableState({ initial: {}, write: async raw => {
    if (error) throw error;
    disk = JSON.parse(raw);
  } });
  const engine = new TaskEngine({ state: store.state, save: () => store.save(), transact: (keys, action) => store.transact(keys, action),
    now: () => new Date(now), skillsRegistry: new SkillsRegistry(skills),
    runTask: async () => { calls++; return 'Syntetisk læseresultat'; }, notify: async () => { notifications++; return true; } });
  await store.initialize();
  return { engine, store, calls: () => calls, notifications: () => notifications, disk: () => disk,
    setNow: value => { now = value; }, failWith: value => { error = value; }, task: id => store.state.tasks.find(item => item.id === id) };
}
const input = { title: 'Pauset og gennemgåelig', prompt: 'Læs kun den syntetiske kilde.', activation: 'paused' };

test('H2 creating a paused job has zero executions even if the server immediately ticks', async () => {
  const f = await fixture();
  const task = await f.engine.create(input);
  await f.engine.tick();
  assert.equal(f.task(task.id).status, 'paused');
  assert.equal(f.calls(), 0);
  assert.equal(f.notifications(), 0);
  assert.deepEqual(f.task(task.id).permissions, ['web.search']);
  const priorClient = await f.engine.create({ title: 'Eksisterende klient', prompt: 'Syntetisk research' });
  await f.engine.tick();
  assert.equal(f.task(priorClient.id).status, 'completed', 'existing clients retain explicit scheduled creation semantics');
  assert.equal(f.calls(), 1);
});

test('H2 paused edits bind an exact revision and never activate or discard history', async () => {
  const f = await fixture();
  const task = await f.engine.create(input);
  const next = await f.engine.update(task.id, { expectedRevision: task.revision, title: 'Revideret politik',
    timeZone: 'UTC', budget: { maxRunsPerDay: 2, maxOutputTokens: 1000 }, activation: 'paused',
    retryPolicy: { maxRetries: 0, delayMinutes: 10 }, missedRunPolicy: { mode: 'pause', maxLatenessMinutes: 20 },
    deliveryPolicy: { channel: 'inbox', quietStart: '21:00', quietEnd: '08:00', deduplicate: true } });
  assert.equal(next.status, 'paused');
  assert.equal(next.revision, 2);
  assert.equal(next.id, task.id);
  assert.equal(next.createdAt, task.createdAt);
  assert.deepEqual(next.runs, task.runs);
  assert.equal(next.timeZone, 'UTC');
  await f.engine.tick();
  assert.equal(f.calls(), 0);
  await assert.rejects(f.engine.update(task.id, { expectedRevision: 1, title: 'Forældet kladde' }),
    error => error.code === 'REVISION_CONFLICT' && error.status === 409);
  assert.equal(f.task(task.id).title, 'Revideret politik');
  await assert.rejects(f.engine.action(task.id, 'resume', { expectedRevision: 1 }), { code: 'REVISION_CONFLICT' });
  await f.engine.action(task.id, 'resume', { expectedRevision: 2 });
  assert.equal(f.task(task.id).status, 'scheduled');
  await assert.rejects(f.engine.update(task.id, { expectedRevision: 3, title: 'Aktiv ændring' }), /Pause jobbet/);
});

test('H2 job revisions bind reviewed skill versions, structured parameters and fixed permissions', async () => {
  const f = await fixture({ skills: [
    { name: 'reviewed-skill', version: '1.0.0', body: 'Gennemgået læseprocedure 1', permissions: 'existing-authorized-tools-only' },
    { name: 'reviewed-skill', version: '2.0.0', body: 'Gennemgået læseprocedure 2', permissions: 'existing-authorized-tools-only' },
  ] });
  const task = await f.engine.create({ ...input, skillId: 'reviewed-skill', skillVersion: '1.0.0', parameters: { emne: 'Test', maxPris: 100 } });
  const next = await f.engine.update(task.id, { expectedRevision: 1, skillId: 'reviewed-skill', skillVersion: '2.0.0', parameters: { emne: 'Anden test' } });
  assert.equal(next.skillVersion, '2.0.0');
  assert.notEqual(next.skillContentHash, task.skillContentHash);
  assert.deepEqual(next.parameters, { emne: 'Anden test' });
  for (const invalid of [ { skillId: 'reviewed-skill', skillVersion: '3.0.0' }, { permissions: ['basket.write'] },
    { parameters: { nested: { instruction: 'write' } } }, { activation: 'scheduled' }, { runAt: '2026-10-25T02:30' } ])
    await assert.rejects(f.engine.update(task.id, { expectedRevision: 2, ...invalid }));
  assert.equal(f.task(task.id).revision, 2);
  const detached = await f.engine.update(task.id, { expectedRevision: 2, skillId: null, skillVersion: null });
  assert.equal(detached.skillId, null);
  assert.equal(detached.skillContentHash, null);
});

test('H2 failed policy persistence retains the original revision, status and exact error', async () => {
  const f = await fixture();
  const task = await f.engine.create(input);
  const before = structuredClone(f.disk());
  const error = new Error('synthetic ENOSPC');
  f.failWith(error);
  await assert.rejects(f.engine.update(task.id, { expectedRevision: 1, title: 'Ikke gemt' }), actual => actual === error);
  assert.deepEqual(f.disk(), before);
  assert.equal(f.task(task.id).title, task.title);
  assert.equal(f.task(task.id).revision, 1);
  assert.equal(f.calls(), 0);
});

test('H2 unresolved response and local checkpoints cannot be rebound by policy editing', async () => {
  const f = await fixture();
  const task = await f.engine.create(input);
  await f.store.transact(['tasks'], async () => { f.task(task.id).responseId = 'synthetic-existing-response'; await f.store.save(); });
  await assert.rejects(f.engine.update(task.id, { expectedRevision: 1, title: 'Må ikke genbinde' }), /eksisterende kørsel/);
  await f.store.transact(['tasks'], async () => { f.task(task.id).responseId = null; await f.store.save(); });
  f.engine.pendingCheckpoints.set(`outcome:${task.id}:synthetic`, async () => {});
  await assert.rejects(f.engine.update(task.id, { expectedRevision: 1, title: 'Må ikke genbinde' }), /kontrolpunkt/);
  assert.equal(f.task(task.id).revision, 1);
});

test('H2 paused job editing cannot change a prior run quiet policy after its reviewed execution', async () => {
  const f = await fixture({ now: '2026-11-05T21:30:00Z' });
  const task = await f.engine.create({ ...input, activation: 'scheduled', intervalMinutes: 1440,
    deliveryPolicy: { channel: 'inbox', quietStart: '22:00', quietEnd: '07:00', deduplicate: true } });
  await f.engine.tick();
  assert.equal(f.notifications(), 0);
  const paused = await f.engine.action(task.id, 'pause');
  await f.engine.update(task.id, { expectedRevision: paused.revision,
    deliveryPolicy: { channel: 'inbox', quietStart: '20:00', quietEnd: '21:00', deduplicate: true } });
  await f.engine.tick();
  assert.equal(f.notifications(), 0, 'prior bound quiet period must not change through a new draft');
  f.setNow('2026-11-06T06:01:00Z');
  await f.engine.tick();
  assert.equal(f.notifications(), 1);
  assert.equal(f.calls(), 1, 'editing did not activate another model run');
});

test('H2 job policy validation rejects stored secrets, malformed activation and missing review revisions', async () => {
  const f = await fixture();
  for (const invalid of [ { activation: 'true' }, { prompt: 'api_key=sk-abcdefgh1234567890' },
    { parameters: { password: 'adgangskode=syntetisk-hemmelighed' } } ])
    await assert.rejects(f.engine.create({ ...input, ...invalid }));
  const task = await f.engine.create(input);
  await assert.rejects(f.engine.update(task.id, { title: 'Mangler revision' }), /basisrevision/);
  assert.equal(f.task(task.id).revision, 1);
});
