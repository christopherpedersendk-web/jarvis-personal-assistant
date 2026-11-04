import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizerCore, buildCommandCenter } from '../organizer-core.mjs';

function setup(now = '2026-11-04T12:00:00Z') {
  const state = { organizer: [], inbox: [], approvals: [], projects: [], tasks: [] };
  let saves = 0;
  const organizer = new OrganizerCore({ state, save: async () => { saves++; }, now: () => new Date(now) });
  return { state, organizer, saved: () => saves };
}

test('creates private collections, edits notes, checks off and removes items', async () => {
  const { organizer, saved } = setup();
  const collection = await organizer.create({ title: 'Indkøb', type: 'shopping' });
  const item = await organizer.addItem(collection.id, { text: 'Havremælk', notes: 'Køb to' });
  assert.equal(organizer.list()[0].items[0].notes, 'Køb to');
  await organizer.updateItem(collection.id, item.id, { done: true, notes: 'Købt' });
  assert.equal(item.done, true);
  assert.equal(item.notes, 'Købt');
  assert.equal(organizer.search('købt').length, 1);
  await organizer.removeItem(collection.id, item.id);
  assert.equal(organizer.findCollection(collection.id).items.length, 0);
  await organizer.archive(collection.id);
  assert.equal(organizer.list().length, 0);
  assert.ok(saved() >= 5);
});

test('validates dates and stores annual birthdays with next occurrence', async () => {
  const { organizer } = setup('2026-11-04T12:00:00Z');
  const list = await organizer.create({ title: 'Familie', type: 'dates' });
  await organizer.addItem(list.id, { text: 'Mors fødselsdag', date: '1980-11-11', annual: true });
  await organizer.addItem(list.id, { text: 'En årsdag', date: '2026-11-05' });
  assert.equal(organizer.upcoming(10)[0].daysUntil, 1);
  assert.equal(organizer.upcoming(10)[1].daysUntil, 7);
  assert.equal(organizer.upcoming(10)[1].date, '2026-11-11');
  await assert.rejects(organizer.addItem(list.id, { text: 'Dårlig dato', date: '2026-02-30' }), /gyldig kalenderdato/);
});

test('leap day birthday is scheduled for the next leap year', async () => {
  const { organizer } = setup('2026-03-01T12:00:00Z');
  const list = await organizer.create({ title: 'Fødselsdage', type: 'dates' });
  await organizer.addItem(list.id, { text: 'Skudårsdag', date: '2000-02-29', annual: true });
  assert.equal(organizer.upcoming(1000)[0].date, '2028-02-29');
});

test('uses optimistic updates to avoid overwriting newer notes', async () => {
  const { organizer } = setup();
  const list = await organizer.create({ title: 'Gaver', type: 'gifts' });
  const item = await organizer.addItem(list.id, { text: 'Brætspil' });
  await assert.rejects(organizer.updateItem(list.id, item.id, { text: 'Bog', updatedAt: '2000-01-01T00:00:00Z' }), /opdateret på en anden enhed/);
});

test('proactive Command Center reports only saved evidence and actual run results', async () => {
  const { state, organizer } = setup();
  const list = await organizer.create({ title: 'Familiedatoer', type: 'dates' });
  await organizer.addItem(list.id, { text: 'Fødselsdag', date: '2001-11-07', annual: true });
  state.tasks.push({ id: 't1', title: 'Morgenbriefing', category: 'briefing', status: 'scheduled', runs: [
    { at: '2026-11-04T06:30:00Z', status: 'completed', result: 'Nyheder med kilder' } ] });
  state.tasks.push({ id: 't2', title: 'Sko', category: 'monitor', status: 'scheduled', runs: [
    { at: '2026-11-04T07:00:00Z', status: 'completed', result: 'CHANGE prisfald' },
    { at: '2026-11-03T07:00:00Z', status: 'completed', result: 'NO_CHANGE' } ] });
  const dashboard = buildCommandCenter({ state, organizer, now: new Date('2026-11-04T12:00:00Z') });
  assert.equal(dashboard.upcoming[0].daysUntil, 3);
  assert.equal(dashboard.briefing.result, 'Nyheder med kilder');
  assert.equal(dashboard.monitor.result, 'CHANGE prisfald');
  assert.ok(dashboard.suggestions.some(x => x.source.kind === 'organizer'));
  assert.ok(dashboard.suggestions.every(x => x.source));
});
