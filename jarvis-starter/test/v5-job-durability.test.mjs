import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableState } from '../durable-state.mjs';
import { TaskEngine, nextLocalTime } from '../task-engine.mjs';
import { ProactivePlanner } from '../proactive-planner.mjs';
import { BoundedJobQueue } from '../bounded-queue.mjs';
import { SkillsRegistry } from '../skills-registry.mjs';

const NOW = '2026-11-05T08:00:00.000Z';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(options = {}) {
  let now = new Date(options.now || NOW);
  let disk;
  let writes = 0;
  let beforeWrite = async () => {};
  const store = new DurableState({ initial: options.initial || { tasks: [], settings: {}, inbox: [], proactiveDigests: [] },
    write: async contents => {
      const next = JSON.parse(contents);
      writes++;
      await beforeWrite(next, value => { disk = structuredClone(value); });
      disk = next;
    } });
  const save = () => store.save();
  const transact = (keys, action) => store.transact(keys, action);
  const engine = new TaskEngine({ state: store.state, save, transact, now: () => now,
    runTask: options.runTask || (async () => 'Syntetisk resultat'),
    notify: options.notify || (async () => {}), skillsRegistry: options.skillsRegistry || null,
    workQueue: options.workQueue || null, maxRunsPerDay: options.maxRunsPerDay || 10 });
  const proactive = new ProactivePlanner({ state: store.state, save, transact, now: () => now,
    organizer: { upcoming: () => [] }, notify: options.notifyDigest || (async () => true) });
  await store.initialize();
  return { engine, proactive, store, state: store.state, save, transact,
    disk: () => structuredClone(disk), writes: () => writes,
    task: id => store.state.tasks.find(item => item.id === id),
    setNow: value => { now = new Date(value); }, beforeWrite: fn => { beforeWrite = fn; },
    failOnce(predicate, error = new Error('syntetisk ENOSPC')) {
      let used = false;
      beforeWrite = async (next, publish) => {
        if (!used && predicate(next)) { used = true; if (error.statePublished) publish(next); throw error; }
      };
      return error;
    } };
}

test('job creation failure has no ghost, and usage reads never reset persisted state', async () => {
  const f = await fixture();
  const error = f.failOnce(next => next.tasks.length === 1);
  await assert.rejects(f.engine.create({ title: 'Fejlet kladde', prompt: 'Syntetisk læsning' }), actual => actual === error);
  assert.equal(f.state.tasks.length, 0);
  assert.equal(f.disk().tasks.length, 0);
  const task = await f.engine.create({ title: 'Næste opgave', prompt: 'Syntetisk læsning' });
  await f.engine.tick();
  assert.equal(f.task(task.id).status, 'completed');
  const before = f.disk().usage;
  const count = f.writes();
  f.setNow('2026-11-06T08:00:00Z');
  assert.equal(f.engine.currentUsage().started, 0);
  assert.deepEqual(f.state.usage, before);
  assert.equal(f.writes(), count);
});

test('a failed running checkpoint performs zero work, restores usage and can safely resume queued work', async () => {
  let calls = 0;
  const f = await fixture({ runTask: async () => { calls++; return 'Kun én læsning'; } });
  const task = await f.engine.create({ title: 'Kontrolleret start', prompt: 'Læs syntetisk kilde' });
  const failure = f.failOnce(next => next.tasks[0]?.status === 'running');
  await assert.rejects(f.engine.tick(), error => error === failure);
  assert.equal(calls, 0);
  assert.equal(f.state.usage.started, 0);
  assert.equal(f.task(task.id).status, 'queued');
  assert.equal(f.task(task.id).runs.length, 0, 'storage failure must not become an ordinary research failure/retry');
  await f.engine.tick();
  assert.equal(calls, 1);
  assert.equal(f.task(task.id).status, 'completed');
  assert.equal(f.state.usage.started, 1);
});

test('reads see only committed queued state while the durable running checkpoint is pending', async () => {
  const entered = deferred(); const release = deferred();
  let f;
  f = await fixture({ runTask: async () => {
    assert.equal(f.disk().tasks[0].status, 'running');
    assert.equal(f.disk().usage.started, 1);
    return 'Starten var gemt først';
  } });
  const task = await f.engine.create({ title: 'Læseisolering', prompt: 'Læs syntetisk kilde' });
  f.beforeWrite(async next => {
    if (next.tasks[0]?.status === 'running' && !next.tasks[0]?.responseId) { entered.resolve(); await release.promise; }
  });
  const running = f.engine.tick();
  await entered.promise;
  assert.equal(f.task(task.id).status, 'queued');
  assert.equal(f.state.usage.started, 0);
  assert.equal(f.disk().tasks[0].status, 'queued');
  release.resolve();
  await running;
  assert.equal(f.task(task.id).status, 'completed');
});

test('a completed worker with failed outcome save retries only the local checkpoint, never the worker', async () => {
  let calls = 0; let notices = 0;
  const f = await fixture({ runTask: async () => { calls++; return 'Resultatet skal bevares'; }, notify: async () => { notices++; } });
  const task = await f.engine.create({ title: 'Resultat før gemmefejl', prompt: 'Læs syntetisk kilde' });
  const failure = f.failOnce(next => next.tasks[0]?.status === 'completed');
  await assert.rejects(f.engine.tick(), error => error === failure && error.checkpointPending === true);
  assert.equal(calls, 1);
  assert.equal(notices, 0);
  assert.equal(f.task(task.id).status, 'running');
  assert.equal(f.disk().tasks[0].runs.length, 0);
  await f.engine.tick();
  assert.equal(calls, 1);
  assert.equal(notices, 1);
  assert.equal(f.task(task.id).runs[0].result, 'Resultatet skal bevares');
  assert.equal(f.disk().tasks[0].status, 'completed');
});

test('failed response-ID checkpoint retains ID in-process; recovery polls that same ID without a new request', async () => {
  let creates = 0; let polls = 0;
  const f = await fixture({ runTask: async (task, keepId) => {
    if (!task.responseId) { creates++; await keepId('resp_existing'); }
    else { assert.equal(task.responseId, 'resp_existing'); polls++; }
    return 'Samme betalte læsning';
  } });
  const task = await f.engine.create({ title: 'ID-kontrolpunkt', prompt: 'Læs syntetisk kilde' });
  const failure = f.failOnce(next => next.tasks[0]?.responseId === 'resp_existing');
  await assert.rejects(f.engine.tick(), error => error === failure);
  assert.equal(creates, 1); assert.equal(polls, 0);
  assert.equal(f.disk().tasks[0].status, 'running');
  assert.equal(f.disk().tasks[0].responseId, null);
  await f.engine.tick();
  assert.equal(creates, 1); assert.equal(polls, 1);
  assert.equal(f.task(task.id).status, 'completed');
  assert.equal(f.engine.currentUsage().started, 1, 'read-only continuation is not a new model generation');
});

test('restart without a durable response ID records unknown and does not re-run an interrupted request', async () => {
  let initialCalls = 0;
  const f = await fixture({ runTask: async (_task, keepId) => { initialCalls++; await keepId('resp_lost'); return 'ikke nået'; } });
  await f.engine.create({ title: 'Uafklaret start', prompt: 'Læs syntetisk kilde', intervalMinutes: 60 });
  f.failOnce(next => next.tasks[0]?.responseId === 'resp_lost');
  await assert.rejects(f.engine.tick(), /ENOSPC/);
  let restartedCalls = 0;
  const restarted = await fixture({ initial: f.disk(), runTask: async () => { restartedCalls++; return 'må ikke ske'; } });
  await restarted.engine.tick();
  assert.equal(initialCalls, 1); assert.equal(restartedCalls, 0);
  assert.equal(restarted.disk().tasks[0].status, 'interrupted');
  assert.equal(restarted.disk().tasks[0].lastRunStatus, 'unknown');
});

test('transient polling errors keep the durable response ID and preserve bounded recurring retries', async () => {
  let creates = 0; let polls = 0;
  const f = await fixture({ runTask: async (task, keepId) => {
    if (!task.responseId) { creates++; await keepId('resp_poll'); throw new Error('Syntetisk HTTP 503 under poll'); }
    assert.equal(task.responseId, 'resp_poll'); polls++; return 'Genoptaget kilde';
  } });
  const task = await f.engine.create({ title: 'Genoptag poll', prompt: 'Læs syntetisk kilde', intervalMinutes: 60 });
  await f.engine.tick();
  assert.equal(f.task(task.id).responseId, 'resp_poll');
  assert.equal(f.task(task.id).nextRunAt, '2026-11-05T08:05:00.000Z');
  f.setNow('2026-11-05T08:05:00Z');
  await f.engine.tick();
  assert.equal(creates, 1); assert.equal(polls, 1);
  assert.equal(f.task(task.id).runs[0].status, 'completed');
  assert.equal(f.task(task.id).responseId, null);
});

test('uncertain published running checkpoint fails closed before any worker call', async () => {
  let calls = 0;
  const f = await fixture({ runTask: async () => { calls++; return 'må ikke ske'; } });
  await f.engine.create({ title: 'Ukendt varighed', prompt: 'Læs syntetisk kilde' });
  const failure = Object.assign(new Error('syntetisk fsync-fejl efter rename'), { statePublished: true, code: 'STATE_DURABILITY_UNKNOWN' });
  f.failOnce(next => next.tasks[0]?.status === 'running', failure);
  await assert.rejects(f.engine.tick(), error => error === failure);
  assert.equal(f.disk().tasks[0].status, 'running');
  assert.equal(f.state.tasks[0].status, 'running');
  assert.equal(f.store.snapshot().ready, false);
  await assert.rejects(f.engine.tick(), /ukendt/);
  assert.equal(calls, 0);
});

test('notification intent is durable first; failed result save retries only the checkpoint', async () => {
  let notices = 0; let f;
  f = await fixture({ notify: async () => { notices++; assert.equal(f.disk().tasks[0].runs[0].delivery.status, 'sending'); } });
  await f.engine.create({ title: 'Leveringsjournal', prompt: 'Læs syntetisk kilde' });
  const failure = f.failOnce(next => next.tasks[0]?.runs[0]?.delivery?.status === 'delivered');
  await assert.rejects(f.engine.tick(), error => error === failure);
  assert.equal(notices, 1);
  assert.equal(f.disk().tasks[0].runs[0].delivery.status, 'sending');
  const interrupted = f.disk();
  await f.engine.tick();
  assert.equal(notices, 1);
  assert.equal(f.disk().tasks[0].runs[0].delivery.status, 'delivered');
  const restarted = await fixture({ initial: interrupted, notify: async () => { notices++; } });
  await restarted.engine.tick();
  assert.equal(notices, 1);
  assert.equal(restarted.disk().tasks[0].runs[0].delivery.status, 'unknown');
});

test('unknown notification outcome is visible and never automatically sent again', async () => {
  let notices = 0;
  const f = await fixture({ notify: async () => { notices++; throw new Error('syntetisk accept efterfulgt af timeout'); } });
  await f.engine.create({ title: 'Ukendt levering', prompt: 'Læs syntetisk kilde' });
  await f.engine.tick(); await f.engine.tick();
  assert.equal(notices, 1);
  assert.equal(f.disk().tasks[0].runs[0].delivery.status, 'unknown');
});

test('waiting background cancellation commits pause before cancellation succeeds and survives restart', async () => {
  const queue = new BoundedJobQueue({ concurrency: 1, maxWaiting: 2 });
  const release = deferred(); const enqueued = deferred();
  const blocker = queue.enqueue('Syntetisk ekstern ventetid', () => release.promise);
  const enqueue = queue.enqueue.bind(queue);
  queue.enqueue = (...args) => { const entry = enqueue(...args); enqueued.resolve(entry); return entry; };
  let calls = 0;
  const f = await fixture({ workQueue: queue, runTask: async () => { calls++; return 'må ikke ske'; } });
  const task = await f.engine.create({ title: 'Ventende opgave', prompt: 'Læs syntetisk kilde' });
  const tick = f.engine.tick();
  const entry = await enqueued.promise;
  const cancelled = await f.engine.cancelWaiting(entry.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(f.disk().tasks[0].status, 'paused');
  assert.equal(f.engine.currentUsage().started, 0);
  release.resolve(); await blocker.promise; await tick;
  await f.engine.tick();
  assert.equal(calls, 0);
  const restarted = await fixture({ initial: f.disk(), runTask: async () => { calls++; return 'må ikke ske'; } });
  await restarted.engine.tick();
  assert.equal(calls, 0); assert.equal(restarted.task(task.id).status, 'paused');
});

test('failed cancellation save reports failure and does not pretend the waiting job was cancelled', async () => {
  const queue = new BoundedJobQueue({ concurrency: 1, maxWaiting: 1 });
  const release = deferred(); const enqueued = deferred();
  const blocker = queue.enqueue('Syntetisk ventetid', () => release.promise);
  const enqueue = queue.enqueue.bind(queue);
  queue.enqueue = (...args) => { const entry = enqueue(...args); enqueued.resolve(entry); return entry; };
  let calls = 0;
  const f = await fixture({ workQueue: queue, runTask: async () => { calls++; return 'må ikke ske'; } });
  await f.engine.create({ title: 'Annullering med fejl', prompt: 'Læs syntetisk kilde' });
  const tick = f.engine.tick(); const entry = await enqueued.promise;
  const failure = f.failOnce(next => next.tasks[0]?.status === 'paused');
  await assert.rejects(f.engine.cancelWaiting(entry.id), error => error === failure);
  assert.equal(f.disk().tasks[0].status, 'queued');
  assert.equal(queue.snapshot().find(job => job.id === entry.id).state, 'queued');
  await f.engine.cancelWaiting(entry.id);
  release.resolve(); await blocker.promise; await tick;
  assert.equal(calls, 0);
});

test('execution binds the actual skill content, parameters, budget, timezone and fixed read permissions', async () => {
  const skill = { name: 'daily-briefing', version: '1.0.0', body: 'Gennemgået syntetisk procedure', permissions: 'existing-authorized-tools-only' };
  const registry = new SkillsRegistry([skill]);
  let execution;
  const f = await fixture({ skillsRegistry: registry, runTask: async task => { execution = task.execution; return 'Gennemgået binding'; } });
  const parameters = { subject: 'Syntetisk emne', limit: 3 };
  const task = await f.engine.create({ title: 'Bundet procedure', prompt: 'Læs syntetisk kilde',
    skillId: skill.name, skillVersion: skill.version, parameters, timeZone: 'UTC',
    budget: { maxRunsPerDay: 2, maxOutputTokens: 800 }, missedRunPolicy: { mode: 'skip', maxLatenessMinutes: 90 } });
  parameters.subject = 'Må ikke ændre den gemte binding';
  await f.engine.tick();
  assert.equal(execution.skill.body, skill.body);
  assert.equal(execution.parameters.subject, 'Syntetisk emne');
  assert.equal(execution.budget.maxOutputTokens, 800); assert.equal(execution.timeZone, 'UTC');
  assert.deepEqual(execution.permissions, ['web.search']);
  assert.equal(f.task(task.id).runs[0].binding.bindingHash, execution.bindingHash);
  assert.match(f.task(task.id).skillContentHash, /^[a-f0-9]{64}$/);
  const other = await f.engine.create({ title: 'Versionsbrud', prompt: 'Læs syntetisk kilde', skillId: skill.name, skillVersion: skill.version });
  skill.body = 'Indhold ændret uden version';
  await f.engine.tick();
  assert.equal(f.task(other.id).status, 'paused');
  assert.match(f.task(other.id).interruptionReason, /ændret uden/);
});

test('job policies reject permission/channel expansion, malformed parameters and invalid schedule contracts', async () => {
  const f = await fixture();
  const base = { title: 'Validering', prompt: 'Læs syntetisk kilde' };
  for (const change of [
    { permissions: ['web.search', 'basket.add'] }, { deliveryPolicy: { channel: 'stranger' } },
    { parameters: { callback: { url: 'https://synthetic.invalid' } } },
    { budget: { maxOutputTokens: 12001 } }, { missedRunPolicy: { mode: 'replay-every-missed-run' } },
    { timeZone: 'Mars/Unknown' }, { skillVersion: '1.0.0' }, { runAt: '2026-10-25T02:30:00' },
  ]) await assert.rejects(f.engine.create({ ...base, ...change }));
  assert.equal(f.state.tasks.length, 0);
});

test('exhausted per-job budget does not starve another eligible task', async () => {
  const calls = [];
  const f = await fixture({ runTask: async task => { calls.push(task.title); return 'Resultat'; } });
  await f.engine.create({ title: 'A', prompt: 'Læs A', intervalMinutes: 60, budget: { maxRunsPerDay: 1 } });
  await f.engine.tick();
  f.setNow('2026-11-05T09:00:00Z');
  await f.engine.create({ title: 'B', prompt: 'Læs B', intervalMinutes: 60 });
  await f.engine.tick();
  assert.deepEqual(calls, ['A', 'B']);
});

test('missed runs coalesce once, skip or pause according to the persisted explicit policy', async () => {
  for (const mode of ['coalesce', 'skip', 'pause']) {
    let calls = 0;
    const f = await fixture({ runTask: async () => { calls++; return 'Syntetisk resultat'; } });
    const task = await f.engine.create({ title: mode, prompt: 'Læs syntetisk kilde', intervalMinutes: 60,
      missedRunPolicy: { mode, maxLatenessMinutes: 60 } });
    f.setNow('2026-11-08T08:00:00Z');
    await f.engine.tick(); await f.engine.tick();
    assert.equal(calls, mode === 'coalesce' ? 1 : 0, 'never replay each missed hourly run');
    assert.equal(f.task(task.id).lastMissedRun.policy, mode);
    assert.equal(f.task(task.id).status, mode === 'pause' ? 'paused' : 'scheduled');
  }
});

test('daily DST fall-back runs only once per local date and spring gaps are explicit skips', async () => {
  let calls = 0;
  const f = await fixture({ now: '2026-10-25T00:00:00Z', runTask: async () => { calls++; return 'Daglig kørsel'; } });
  const task = await f.engine.create({ title: 'DST', prompt: 'Læs syntetisk kilde', dailyTime: '02:30' });
  assert.equal(task.nextRunAt, '2026-10-25T00:30:00.000Z');
  f.setNow('2026-10-25T00:30:00Z'); await f.engine.tick();
  assert.equal(f.task(task.id).nextRunAt, '2026-10-26T01:30:00.000Z');
  f.setNow('2026-10-25T01:30:00Z'); await f.engine.tick();
  assert.equal(calls, 1);
  assert.equal(nextLocalTime(new Date('2026-03-29T00:00:00Z'), '02:30'), '2026-03-30T00:30:00.000Z');
  assert.equal(nextLocalTime(new Date('2026-11-05T06:00:00Z'), '07:30', 'UTC'), '2026-11-05T07:30:00.000Z');
});

test('quiet-period deliveries coalesce to the latest pending result without hiding execution history', async () => {
  const notices = []; let calls = 0;
  const f = await fixture({ now: '2026-11-05T21:30:00Z', runTask: async () => `Resultat ${++calls}`,
    notify: async task => { notices.push(task.runs[0].result); } });
  const task = await f.engine.create({ title: 'Stilletid', prompt: 'Læs syntetisk kilde', intervalMinutes: 60 });
  await f.engine.tick();
  f.setNow('2026-11-05T22:30:00Z'); await f.engine.tick();
  assert.deepEqual(notices, []);
  assert.equal(f.task(task.id).runs.length, 2);
  assert.equal(f.task(task.id).runs[1].delivery.status, 'skipped');
  await f.engine.action(task.id, 'pause');
  f.setNow('2026-11-06T06:00:00Z'); await f.engine.tick();
  assert.deepEqual(notices, ['Resultat 2']);
  assert.equal(calls, 2);
});

test('proactive digest and inbox publish together; failed publication creates no dedupe ghost or external send', async () => {
  let deliveries = 0;
  const f = await fixture({ now: '2026-11-05T06:31:00Z', initial: {
    tasks: [], settings: { discordAlertsEnabled: true, proactive: { discordEnabled: true } },
    inbox: [], proactiveDigests: [], approvals: [{ id: 'synthetic', status: 'pending' }],
  }, notifyDigest: async () => { deliveries++; return true; } });
  const failure = f.failOnce(next => next.proactiveDigests.length === 1);
  await assert.rejects(f.proactive.tick(), error => error === failure);
  assert.equal(f.state.proactiveDigests.length, 0); assert.equal(f.state.inbox.length, 0);
  assert.equal(f.disk().proactiveDigests.length, 0); assert.equal(deliveries, 0);
  await f.proactive.tick(); await f.proactive.tick();
  assert.equal(f.disk().proactiveDigests.length, 1); assert.equal(f.disk().inbox.length, 1);
  assert.equal(deliveries, 1); assert.equal(f.disk().proactiveDigests[0].discordDelivery.status, 'delivered');
});

test('proactive delivery result-save failure and restart preserve unknown without resending', async () => {
  let deliveries = 0; let f;
  f = await fixture({ now: '2026-11-05T06:31:00Z', initial: {
    tasks: [], settings: { discordAlertsEnabled: true, proactive: { discordEnabled: true } },
    inbox: [], proactiveDigests: [], approvals: [{ id: 'synthetic', status: 'pending' }],
  }, notifyDigest: async () => { deliveries++; assert.equal(f.disk().proactiveDigests[0].discordDelivery.status, 'sending'); return true; } });
  const failure = f.failOnce(next => next.proactiveDigests[0]?.discordDelivery?.status === 'delivered');
  await assert.rejects(f.proactive.tick(), error => error === failure);
  assert.equal(deliveries, 1);
  const interrupted = f.disk();
  assert.equal(interrupted.proactiveDigests[0].discordDelivery.status, 'sending');
  await f.proactive.tick();
  assert.equal(deliveries, 1);
  assert.equal(f.disk().proactiveDigests[0].discordDelivered, true);
  const restarted = await fixture({ now: '2026-11-05T06:31:00Z', initial: interrupted, notifyDigest: async () => { deliveries++; return true; } });
  await restarted.proactive.tick();
  assert.equal(deliveries, 1);
  assert.equal(restarted.disk().proactiveDigests[0].discordDelivery.status, 'unknown');
  assert.equal(restarted.disk().proactiveDigests[0].discordDelivered, false);
});

test('revoked proactive opt-in cancels a pending unsent delivery without losing the local digest', async () => {
  let deliveries = 0;
  const f = await fixture({ now: '2026-11-05T06:31:00Z', initial: {
    tasks: [], settings: { discordAlertsEnabled: true, proactive: { discordEnabled: true } },
    inbox: [], proactiveDigests: [], approvals: [{ id: 'synthetic', status: 'pending' }],
  }, notifyDigest: async () => { deliveries++; return true; } });
  f.failOnce(next => next.proactiveDigests[0]?.discordDelivery?.status === 'sending');
  await assert.rejects(f.proactive.tick(), /ENOSPC/);
  assert.equal(f.disk().proactiveDigests[0].discordDelivery.status, 'pending');
  await f.proactive.configure({ discordEnabled: false });
  await f.proactive.tick();
  assert.equal(deliveries, 0);
  assert.equal(f.disk().inbox.length, 1);
  assert.equal(f.disk().proactiveDigests[0].discordDelivery.status, 'skipped');
});

test('bounded queue exposes terminal timing and unknown outcomes without leaking raw errors', async () => {
  const queue = new BoundedJobQueue();
  const unknown = queue.enqueue('Uafklaret syntetisk handling', async () => {
    throw Object.assign(new Error('do-not-log-synthetic-token'), { unknownOutcome: true });
  });
  await assert.rejects(unknown.promise, /do-not-log/);
  const record = queue.snapshot()[0];
  assert.equal(record.state, 'unknown'); assert.ok(record.endedAt); assert.equal(typeof record.runMs, 'number');
  assert.doesNotMatch(record.error, /do-not-log/);
  const partial = queue.enqueue('Delvist resultat', async () => ({ outcome: 'partially_completed' }));
  await partial.promise;
  assert.equal(queue.snapshot()[1].state, 'partially_completed');
});

test('bounded queue keeps long-running work visible while trimming completed history', async () => {
  const queue = new BoundedJobQueue({ concurrency: 2, maxWaiting: 1 });
  const release = deferred();
  const long = queue.enqueue('Lang syntetisk læsning', () => release.promise);
  for (let i = 0; i < 105; i++) await queue.enqueue(`Kort ${i}`, async () => i).promise;
  assert.equal(queue.snapshot().length, 100);
  assert.equal(queue.snapshot().find(job => job.id === long.id).state, 'running');
  release.resolve(); await long.promise;
});
