import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalTasks } from '../personal-tasks.mjs';
import { planPersonalTasks } from '../capacity-planner.mjs';

const NOW = new Date('2026-11-04T08:00:00.000Z');
const date = (hour, minute = 0) => new Date(Date.parse('2026-11-04T00:00:00Z') + hour * 3_600_000 + minute * 60_000).toISOString();
const input = (changes = {}) => ({ title: 'Forbered revisionsmøde', purpose: 'Gennemgå materiale før kundemøde',
  expectedOutcome: 'Færdige reviewnoter', durationMinutes: 60, priority: 4,
  earliestStart: date(8), deadline: date(16), nextFollowUpAt: date(14),
  source: { kind: 'project', id: 'audit-2026', revision: 2 }, projectId: 'audit-2026', ...changes });

function fixture(saveImpl = async () => {}) {
  const state = { tasks: [{ id: 'automated-job', status: 'scheduled' }] };
  let saves = 0;
  const manager = new PersonalTasks({ state, now: () => NOW, save: async () => { saves++; await saveImpl(); } });
  return { state, manager, saves: () => saves };
}

test('C1/C2 personal tasks have a separate revisioned model and keep source, project and follow-up', async () => {
  const f = fixture();
  const task = await f.manager.create(input());
  assert.equal(task.status, 'pending');
  assert.equal(task.revision, 1);
  assert.equal(task.source.revision, 2);
  assert.equal(task.projectId, 'audit-2026');
  assert.equal(task.purpose, 'Gennemgå materiale før kundemøde');
  assert.equal(task.expectedOutcome, 'Færdige reviewnoter');
  assert.equal(task.durationMinutes, 60);
  assert.equal(task.nextFollowUpAt, date(14));
  assert.equal(f.state.tasks.length, 1, 'automated TaskEngine jobs are never migrated into personal work');
  assert.equal(f.state.personalTasks.length, 1);
  task.title = 'External mutation';
  assert.equal(f.manager.list()[0].title, 'Forbered revisionsmøde');
  assert.equal(f.saves(), 1);
});

test('time windows and dates reject nonexistent dates, omitted offsets, inverted ranges and impossible locks', async () => {
  const f = fixture();
  const invalid = [
    input({ deadline: '2026-02-30T12:00:00Z' }),
    input({ deadline: '2026-11-04T12:00:00' }),
    input({ earliestStart: date(16), deadline: date(8) }),
    input({ durationMinutes: 60, lockedStart: date(15, 30), deadline: date(16) }),
    input({ lockedStart: date(9), allowedWindows: [{ start: date(12), end: date(14) }] }),
    input({ allowedWindows: [{ start: date(12), end: date(10) }] }),
    input({ title: '', purpose: 'Test' }),
    input({ durationMinutes: 0 }),
    input({ priority: 10 }),
    input({ source: { kind: 'project', id: 'x', token: 'synthetic-secret' } }),
    input({ unknown: true }),
  ];
  for (const item of invalid) await assert.rejects(f.manager.create(item));
  assert.equal(f.manager.list().length, 0);
});

test('revision controls updates, no-op saves, completion and irreversible local archiving', async () => {
  const f = fixture();
  const original = await f.manager.create(input());
  const same = await f.manager.update(original.id, { expectedRevision: 1, title: original.title });
  assert.equal(same.revision, 1);
  assert.equal(f.saves(), 1, 'unchanged values cause no persistence or invalidation');
  const edited = await f.manager.update(original.id, { expectedRevision: 1,
    title: 'Gennemgå revisionsmateriale', status: 'in_progress', durationMinutes: 90 });
  assert.equal(edited.revision, 2);
  assert.equal(edited.status, 'in_progress');
  await assert.rejects(f.manager.update(original.id, { expectedRevision: 1, priority: 5 }), /ændret/);
  await assert.rejects(f.manager.update(original.id, { expectedRevision: 2, status: 'completed' }), /complete/);
  const completed = await f.manager.complete(original.id, 2);
  assert.equal(completed.revision, 3);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.completedAt, NOW.toISOString());
  assert.deepEqual(f.manager.toPlanningTasks(), []);
  await assert.rejects(f.manager.update(original.id, { expectedRevision: 3, title: 'Modified after done' }), /afsluttet/);
  await assert.rejects(f.manager.complete(original.id, 3), /allerede/);
  assert.equal((await f.manager.archive(original.id, 3)).status, 'archived', 'completed work can later leave the active list');
  const separate = await f.manager.create(input({ title: 'Arkiverbar opgave' }));
  await f.manager.archive(separate.id, 1);
  assert.equal(f.manager.list().length, 0);
  assert.equal(f.manager.list({ includeArchived: true }).length, 2);
});

test('dependencies are validated, circular links rejected, and completed prerequisites leave scheduling input', async () => {
  const f = fixture();
  const first = await f.manager.create(input({ title: 'Forbered materiale', durationMinutes: 45 }));
  const second = await f.manager.create(input({ title: 'Gennemgå med leder', durationMinutes: 60,
    dependencies: [first.id], earliestStart: date(8) }));
  await assert.rejects(f.manager.update(first.id, { expectedRevision: 1, dependencies: [second.id] }), /Cirkulær/);
  await assert.rejects(f.manager.archive(first.id, 1), /afhænger/);
  const tasks = f.manager.toPlanningTasks();
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.find(task => task.id === second.id).dependencies, [first.id]);
  const result = planPersonalTasks({ tasks, workWindows: [{ start: date(8), end: date(16) }],
    calendarCoverage: { status: 'ready', start: date(7), end: date(17) }, calendarEvents: [] });
  assert.equal(result.feasible, true);
  assert.equal(f.manager.validateProposals(result.proposals).valid, true);
  const completed = await f.manager.complete(first.id, 1);
  assert.equal(completed.status, 'completed');
  const remaining = f.manager.toPlanningTasks();
  assert.equal(remaining.length, 1);
  assert.deepEqual(remaining[0].dependencies, []);
  await assert.rejects(f.manager.create(input({ title: 'Ukendt reference', dependencies: ['missing-task'] })), /findes ikke/);
});

test('blocked dependencies and personal time windows cannot be silently treated as valid capacity', async () => {
  const f = fixture();
  const first = await f.manager.create(input({ title: 'Afvent dokumentation' }));
  const second = await f.manager.create(input({ title: 'Beslut efter dokumentation', dependencies: [first.id] }));
  await f.manager.update(first.id, { expectedRevision: 1, status: 'blocked' });
  assert.throws(() => f.manager.toPlanningTasks(), /utilgængelig/);
  await f.manager.update(first.id, { expectedRevision: 2, status: 'pending' });
  const restricted = await f.manager.create(input({ title: 'Kun eftermiddag', durationMinutes: 30,
    allowedWindows: [{ start: date(13), end: date(15) }] }));
  const proposals = planPersonalTasks({ tasks: f.manager.toPlanningTasks(),
    workWindows: [{ start: date(8), end: date(16) }], calendarCoverage: { status: 'ready',
      start: date(7), end: date(17) }, calendarEvents: [] });
  assert.equal(proposals.feasible, true, 'the planner must honor global and individual windows');
  const checked = f.manager.validateProposals(proposals.proposals);
  assert.equal(checked.valid, true, 'a valid proposal must pass independent post-validation');
  const scheduledRestricted = proposals.proposals.find(c => c.taskId === restricted.id);
  assert.ok(scheduledRestricted.start >= date(13), 'restricted work must actually start in the afternoon');
  const forged = proposals.proposals.map(p => p.taskId === restricted.id ?
    { ...p, start: date(8), end: date(8.5) } : p);
  const invalid = f.manager.validateProposals(forged);
  assert.equal(invalid.valid, false, 'out-of-window proposals must still be rejected');
  assert.ok(invalid.conflicts.some(c => c.taskId === restricted.id && c.code === 'personal-window-conflict'));
  assert.ok(f.manager.list().find(x => x.id === second.id));
});

test('failed persistence restores the previously visible personal task revision', async () => {
  let fail = false;
  const f = fixture(async () => { if (fail) throw new Error('Synthetic disk failure'); });
  const task = await f.manager.create(input());
  fail = true;
  await assert.rejects(f.manager.update(task.id, { expectedRevision: 1, title: 'Unpersisted title' }), /Synthetic/);
  assert.equal(f.manager.list()[0].title, task.title);
  assert.equal(f.manager.list()[0].revision, 1);
  await assert.rejects(f.manager.complete(task.id, 1), /Synthetic/);
  assert.equal(f.manager.list()[0].status, 'pending');
  await assert.rejects(f.manager.create(input({ title: 'Unpersisted new record' })), /Synthetic/);
  assert.equal(f.manager.list().length, 1);
});
