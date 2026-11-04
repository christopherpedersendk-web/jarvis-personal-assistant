import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizerCore } from '../organizer-core.mjs';
import { ProactiveReminders } from '../proactive-reminders.mjs';

test('proactive reminder creates one factual notice and does not repeat on every polling tick', async () => {
  let now = '2026-11-04T12:00:00Z';
  const state = { organizer: [], proactiveReminders: [] };
  const organizer = new OrganizerCore({ state, save: async () => {}, now: () => new Date(now) });
  const birthday = await organizer.create({ title: 'Familie', type: 'dates' });
  await organizer.addItem(birthday.id, { text: 'Mors fødselsdag', date: '1964-11-08', annual: true });
  const inbox = [];
  const reminders = new ProactiveReminders({ state, organizer, save: async () => {}, notify: x => { inbox.push(x); } });
  await reminders.tick();
  await reminders.tick();
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].text, /Mors fødselsdag: om 4 dage/);
  now = '2026-11-07T12:00:00Z';
  await reminders.tick();
  assert.equal(inbox.length, 2);
  await reminders.tick();
  assert.equal(inbox.length, 2);
});

test('user can disable automatic reminders', async () => {
  const state = { organizer: [], proactiveReminders: [] };
  const organizer = new OrganizerCore({ state, save: async () => {}, now: () => new Date('2026-11-04T12:00:00Z') });
  const list = await organizer.create({ title: 'Datoer', type: 'dates' });
  await organizer.addItem(list.id, { text: 'I morgen', date: '2026-11-05' });
  let notified = 0;
  const reminders = new ProactiveReminders({ state, organizer, save: async () => {}, enabled: () => false, notify: () => { notified++; } });
  await reminders.tick();
  assert.equal(notified, 0);
});
