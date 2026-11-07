import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrganizerCore } from '../organizer-core.mjs';
import { PersonalKnowledge, indexPersonalKnowledge } from '../personal-knowledge.mjs';
import { loadBundledSkills } from '../skills-registry.mjs';
import { integrationCatalog, normalizedIntegrationEvent } from '../integration-catalog.mjs';
import { DEFAULT_PROACTIVE_SETTINGS, ProactivePlanner, buildPersonalAgenda, validateProactiveSettings, withinQuietHours } from '../proactive-planner.mjs';

function fixture(now = '2026-11-04T06:31:00Z') {
  const state = { settings: {}, organizer: [], memories: [], tasks: [], projects: [], approvals: [], inbox: [], history: [] };
  let current = new Date(now);
  let saves = 0;
  const organizer = new OrganizerCore({ state, now: () => current, save: async () => { saves++; } });
  return { state, organizer, now: () => current, setNow: value => { current = new Date(value); }, saves: () => saves,
    save: async () => { saves++; } };
}

test('personal knowledge retrieves only saved, active items with source IDs', async () => {
  const { state, organizer } = fixture();
  const collection = await organizer.create({ title: 'Familiefødselsdage', type: 'dates' });
  const item = await organizer.addItem(collection.id, { text: 'Mormors fødselsdag', date: '1967-11-06', annual: true, notes: 'Gaveidé: puslespil' });
  state.memories.push({ id: 'favorite', text: 'Jeg elsker fantasybøger', archived: false });
  state.memories.push({ id: 'old', text: 'Hemmeligt arkaisk projekt', archived: true });
  state.tasks.push({ id: 'task1', title: 'Undersøg cykler', status: 'scheduled', prompt: 'Find budgetcykel' });
  state.history.push({ role: 'user', text: 'Samtalens private hemmelighed', channel: 'text' });
  const knowledge = new PersonalKnowledge({ state });
  const result = knowledge.search('fødselsdag');
  assert.equal(result[0].source.collectionId, collection.id);
  assert.equal(result[0].source.itemId, item.id);
  assert.ok(result[0].score > 0);
  assert.equal(knowledge.search('fantasy')[0].source.id, 'favorite');
  assert.equal(knowledge.search('arkaisk').length, 0);
  assert.equal(knowledge.search('hemmelighed').length, 0, 'chat transcripts must be opt-out by default');
  assert.ok(indexPersonalKnowledge(state).every(document => !document.id.startsWith('history:')));
  assert.throws(() => knowledge.search(' '), /Søgningen/);
});

test('optional semantic retrieval may only rank the already allowlisted documents', async () => {
  const { state } = fixture();
  state.memories.push({ id: 'a', text: 'En ferie i Norge' });
  const knowledge = new PersonalKnowledge({ state, semanticScorer: async () => ({ 'memory:a': 1, 'memory:evil': 999 }) });
  const hits = await knowledge.searchHybrid('rejse');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'memory:a');
});

test('bundled SKILL.md are structured, selected by triggers, and forbid symlinked skill files', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const skills = await loadBundledSkills(root);
  assert.equal(skills.catalog().length, 12, 'four current local versions, four exact historical versions and four reviewed research integrations');
  assert.equal(skills.catalog().filter(skill => skill.current && skill.version === '1.1.0').length, 4);
  assert.equal(skills.catalog().filter(skill => !skill.current && skill.version === '1.0.0').length, 4);
  assert.match(skills.context('Giv mig gaveidéer til jul'), /Gaveplanlægning/);
  assert.match(skills.context('Lav en madplan'), /Madplan og indkøb/);
  assert.equal(skills.context('Hej med dig'), '');

  const temporary = await mkdtemp(join(tmpdir(), 'jarvis-skills-'));
  await mkdir(join(temporary, 'skills', 'daily-briefing'), { recursive: true });
  await symlink(join(root, 'skills', 'daily-briefing', 'SKILL.md'), join(temporary, 'skills', 'daily-briefing', 'SKILL.md'));
  await assert.rejects(loadBundledSkills(temporary), /almindelig fil/);
});

test('integration catalog reveals capabilities and status, never credentials or live claims for planned adapters', () => {
  const catalog = integrationCatalog({ discordStatus: 'connected', discordConfigured: true, huePaired: true });
  assert.equal(catalog.find(x => x.id === 'discord').status, 'connected');
  assert.equal(catalog.find(x => x.id === 'hue').status, 'configured');
  assert.equal(catalog.find(x => x.id === 'google-calendar').implementation, 'available');
  assert.equal(catalog.find(x => x.id === 'google-calendar').permissions.externalWrite, false);
  assert.equal(catalog.find(x => x.id === 'nemlig').permissions.externalWrite, true);
  assert.equal(catalog.find(x => x.id === 'nest').status, 'not_configured');
  assert.doesNotMatch(JSON.stringify(catalog), /token|password|secret/i);
  assert.deepEqual(normalizedIntegrationEvent({ provider: 'nest', kind: 'doorbell.press', reference: 'event-1', occurredAt: '2026-11-04T12:00:00Z', image: 'private photo' }),
    { provider: 'nest', kind: 'doorbell.press', reference: 'event-1', occurredAt: '2026-11-04T12:00:00.000Z' });
  assert.throws(() => normalizedIntegrationEvent({ provider: 'stranger', kind: 'doorbell.press', reference: 'event-1', occurredAt: '2026-11-04T12:00:00Z' }), /Ukendt/);
});

test('personal agenda never invents events; sources reflect saved organizer/tasks and pending approvals', async () => {
  const f = fixture();
  const collection = await f.organizer.create({ title: 'Familie', type: 'dates' });
  await f.organizer.addItem(collection.id, { text: 'Fødselsdag', date: '1990-11-05', annual: true });
  f.state.tasks.push({ id: 'failed', title: 'Rejseovervågning', status: 'failed' });
  f.state.approvals.push({ id: 'approve', title: 'Koncertbilletter', status: 'pending' });
  const agenda = buildPersonalAgenda({ state: f.state, organizer: f.organizer, now: f.now() });
  assert.ok(agenda.today.some(x => x.title === 'Fødselsdag' && x.source.kind === 'organizer'));
  assert.ok(agenda.insights.some(x => x.title.includes('Rejseovervågning') && x.source.id === 'failed'));
  assert.ok(agenda.insights.some(x => x.source.kind === 'approvals'));
  assert.ok(agenda.today.every(x => x.source));
  assert.ok(agenda.week.every(x => x.source));
});

test('daily proactive briefing writes one inbox entry, deduplicates, and does not DM without separate opt-in', async () => {
  const f = fixture();
  const collection = await f.organizer.create({ title: 'Vigtige datoer', type: 'dates' });
  await f.organizer.addItem(collection.id, { text: 'Familiefødselsdag', date: '1990-11-05', annual: true });
  let dmCount = 0;
  f.state.settings.discordAlertsEnabled = true;
  const planner = new ProactivePlanner({ ...f, notify: async () => { dmCount++; return true; } });
  const produced = await planner.tick();
  assert.equal(produced.length, 1);
  assert.equal(produced[0].itemCount, 1);
  assert.equal(f.state.inbox.length, 1);
  assert.match(f.state.inbox[0].text, /Familiefødselsdag/);
  assert.equal(dmCount, 0, 'additional proactive Discord opt-in must be required');
  assert.equal((await planner.tick()).length, 0);
  assert.equal(f.state.inbox.length, 1);
  assert.ok(f.saves() >= 2);
});

test('proactive Discord requires both toggles and respects quiet hours', async () => {
  const f = fixture();
  f.state.approvals.push({ id: 'abc', status: 'pending' });
  const dm = [];
  const planner = new ProactivePlanner({ ...f, notify: async (title, text) => { dm.push({ title, text }); return true; } });
  await planner.configure({ discordEnabled: true, dailyTime: '07:30' });
  await planner.tick();
  assert.equal(dm.length, 0);
  f.setNow('2026-11-05T06:31:00Z');
  f.state.settings.discordAlertsEnabled = true;
  await planner.tick();
  assert.equal(dm.length, 1);
  assert.ok(f.state.proactiveDigests[0].discordDelivered);
  assert.equal(withinQuietHours({ minutes: 23 * 60 }, DEFAULT_PROACTIVE_SETTINGS), true);
  assert.equal(withinQuietHours({ minutes: 8 * 60 }, DEFAULT_PROACTIVE_SETTINGS), false);
  await planner.configure({ dailyTime: '23:00' });
  f.setNow('2026-11-06T22:02:00Z'); // 23:02 dansk vintertid
  assert.equal((await planner.tick()).length, 0, 'quiet hours block delivery');
});

test('weekly digests follow Danish Sunday and Danish summer time, with empty digests not generating inbox noise', async () => {
  const f = fixture('2026-11-08T17:05:00Z'); // Søndag 18:05 CET
  f.state.tasks.push({ id: 'failed', title: 'Testopgave', status: 'failed' });
  const planner = new ProactivePlanner({ ...f });
  const records = await planner.tick();
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'weekly');
  f.setNow('2026-06-04T05:31:00Z'); // 07:31 CEST
  await planner.tick();
  assert.ok(f.state.proactiveDigests.some(x => x.key === 'daily:2026-06-04'));

  const empty = fixture('2026-11-08T17:05:00Z');
  const quietPlanner = new ProactivePlanner({ ...empty });
  await quietPlanner.tick();
  assert.equal(empty.state.inbox.length, 0);
  assert.equal((await quietPlanner.tick()).length, 0);
});

test('proactive settings reject unknown and invalid fields', () => {
  assert.equal(validateProactiveSettings({ dailyTime: '08:15' }).dailyTime, '08:15');
  assert.throws(() => validateProactiveSettings({ dailyTime: '25:00' }), /HH:MM/);
  assert.throws(() => validateProactiveSettings({ quietStart: '07:00' }), /Stilletid/);
  assert.throws(() => validateProactiveSettings({ executeShell: true }), /Ukendt/);
  assert.throws(() => validateProactiveSettings({ discordEnabled: 'true' }), /sand eller falsk/);
});
