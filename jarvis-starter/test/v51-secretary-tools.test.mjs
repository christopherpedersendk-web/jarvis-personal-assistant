import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableState } from '../durable-state.mjs';
import { PersonalTasks } from '../personal-tasks.mjs';
import { FollowUpCases } from '../follow-up-cases.mjs';
import { ActionJournal } from '../action-journal.mjs';
import { createSecretaryToolHandler, secretaryWrites } from '../secretary-tools.mjs';
import { assistantTools, validateAssistantTool } from '../assistant-tools.mjs';
const now = () => new Date('2026-11-06T12:00:00Z');
const input = { title: 'Ring til værksted', purpose: 'Aftal service', durationMinutes: 15 };
async function fixture(channel) {
  const store = new DurableState({ initial: { personalTasks: [], followUpCases: [], actionJournal: [] }, write: async () => {} });
  const state = store.state, save = () => store.save(), transact = (...args) => store.transact(...args);
  const personalTasks = new PersonalTasks({ state, save, now }), followUps = new FollowUpCases({ state, save, now });
  const handler = createSecretaryToolHandler({ personalTasks, followUps, transact, state, now });
  const journal = new ActionJournal({ state, save, transact, now }); await store.initialize();
  const invoke = async (name, args = {}, callId) => {
    validateAssistantTool(name, args);
    return secretaryWrites.has(name) ? journal.invoke({ name, call_id: callId }, args, handler, channel) : handler(name, args, { channel });
  };
  return { state, invoke, create: () => invoke('create_personal_task', input) };
}
for (const channel of ['text', 'discord', 'voice']) {
  test(`${channel}: create preserves actual owner channel and task purpose`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    assert.equal(task.source.channel, channel); assert.equal(task.status, 'pending'); assert.equal(task.purpose, input.purpose);
    assert.equal(f.state.actionJournal[0].status, 'completed');
  });
  test(`${channel}: change keeps omitted fields and requires latest revision`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    const result = await f.invoke('update_personal_task', { id: task.id, expectedRevision: 1, title: 'Ring mandag' });
    assert.equal(result.task.purpose, input.purpose); assert.equal(result.task.revision, 2);
    await assert.rejects(f.invoke('update_personal_task', { id: task.id, expectedRevision: 1, title: 'Stale' }), /ændret/);
    assert.equal(f.state.personalTasks[0].title, 'Ring mandag');
  });
  test(`${channel}: same call never creates a second task`, async () => {
    const f = await fixture(channel); await f.invoke('create_personal_task', input, 'same-call');
    const again = await f.invoke('create_personal_task', input, 'same-call');
    assert.equal(again.alreadyRecorded, true); assert.equal(f.state.personalTasks.length, 1);
    await assert.rejects(f.invoke('create_personal_task', { ...input, title: 'Changed' }, 'same-call'), /grundlag/);
  });
  test(`${channel}: review reflects completed work without pretending execution`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    await f.invoke('complete_personal_task', { id: task.id, expectedRevision: 1 });
    const review = await f.invoke('get_weekly_review');
    assert.equal(review.openTasks.length, 0); assert.equal(review.completedTasks[0].id, task.id);
    assert.match(review.note, /ingen påmindelse/);
  });
  test(`${channel}: completed tasks cannot silently reopen`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    await f.invoke('complete_personal_task', { id: task.id, expectedRevision: 1 });
    await assert.rejects(f.invoke('update_personal_task', { id: task.id, expectedRevision: 2, title: 'Again' }), /afsluttet/);
  });
  test(`${channel}: timezone-free dates are rejected without a task`, async () => {
    const f = await fixture(channel);
    await assert.rejects(f.invoke('create_personal_task', { ...input, deadline: '2026-11-07T12:00:00' }));
    assert.equal(f.state.personalTasks.length, 0);
  });
  test(`${channel}: model cannot forge source or permission fields`, async () => {
    const f = await fixture(channel);
    await assert.rejects(f.invoke('create_personal_task', { ...input, source: { kind: 'system' }, approved: true }));
    assert.equal(f.state.actionJournal.length, 0);
  });
  test(`${channel}: arbitrary action name is rejected before dispatch`, async () => {
    const f = await fixture(channel);
    await assert.rejects(f.invoke('send_money', { approved: true })); assert.equal(f.state.actionJournal.length, 0);
  });
  test(`${channel}: follow-up requires an existing current task source`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    const args = { taskId: task.id, expectedRevision: 1, awaiting: 'Svar fra værksted', nextCheckAt: '2026-11-07T12:00:00+01:00', stopCondition: 'Tid aftalt' };
    const result = await f.invoke('create_follow_up_case', args);
    assert.equal(result.case.source.id, task.id); assert.equal(result.case.nextCheckAt, '2026-11-07T11:00:00.000Z');
    await assert.rejects(f.invoke('create_follow_up_case', { ...args, expectedRevision: 99 }));
    assert.equal(f.state.followUpCases.length, 1);
  });
  test(`${channel}: completed follow-up no longer appears due`, async () => {
    const f = await fixture(channel), { task } = await f.create();
    const { case: follow } = await f.invoke('create_follow_up_case', { taskId: task.id, expectedRevision: 1, awaiting: 'Svar', nextCheckAt: '2026-11-05T12:00:00Z', stopCondition: 'Svar modtaget' });
    assert.equal((await f.invoke('list_follow_up_cases')).due.length, 1);
    await f.invoke('update_follow_up_case', { id: follow.id, expectedRevision: 1, action: 'complete' });
    assert.equal((await f.invoke('list_follow_up_cases')).due.length, 0);
  });
}
test('shared catalog exposes secretary functions exactly once', () => {
  assert.equal(new Set(assistantTools.map(t => t.name)).size, assistantTools.length);
  for (const name of secretaryWrites) assert.equal(assistantTools.filter(t => t.name === name).length, 1);
});
