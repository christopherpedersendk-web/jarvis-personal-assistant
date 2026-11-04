import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalKnowledge, getRecordedHouseholdDay, indexPersonalKnowledge } from '../personal-knowledge.mjs';
import { planPersonalTasks } from '../capacity-planner.mjs';
import { FollowUpCases } from '../follow-up-cases.mjs';
import { TaskEngine, normalizeObservation } from '../task-engine.mjs';
import { loadBundledSkills } from '../skills-registry.mjs';
import { IncrementalSemanticIndex } from '../semantic-index.mjs';
import { PersonalClaims } from '../personal-claims.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOW = new Date('2026-11-04T08:00:00.000Z');
const at = (day, h, min = 0) => new Date(Date.parse(`${day}T00:00:00.000Z`) + h * 3_600_000 + min * 60_000).toISOString();
const slot = (start, end) => ({ start, end });

test('R09 retrieves exact near dates even when 300 distant future entries exist', () => {
  const days = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [
    at('2028-01-01', 12 + 24 * index).slice(0, 10), { adults: 1, children: [] },
  ]));
  days['2026-11-04'] = { adults: 2, children: [{ age: 8, portion: 0.65 }] };
  days['2026-11-05'] = { adults: 1, children: [] };
  days['2026-11-11'] = { adults: 3, children: [] };
  const state = { mealHousehold: { configured: true, adults: 2, children: [], revision: 4, days } };
  const indexed = indexPersonalKnowledge(state, { now: NOW });
  for (const date of ['2026-11-04', '2026-11-05', '2026-11-11']) {
    assert.ok(indexed.some(doc => doc.id === `household:${date}`), `Missing nearby date ${date}`);
    assert.equal(getRecordedHouseholdDay(state, date).source.revision, 4);
  }
  const unknown = getRecordedHouseholdDay(state, '2026-11-06');
  assert.equal(unknown.recorded, false);
  assert.doesNotMatch(JSON.stringify(unknown), /"adults":2/);
  assert.throws(() => getRecordedHouseholdDay(state, '2026-02-30'), /dato/i);
});

test('semantic provider timeout and failure fall back to current local valid documents', async () => {
  const state = { memories: [
    { id: 'confirmed', text: 'Julegaven er et brætspil.', status: 'confirmed', source: { kind: 'user', channel: 'manual' } },
    { id: 'pending', text: 'Julegaven er en elcykel.', status: 'proposed', confirmed: false },
  ] };
  let knowledge = new PersonalKnowledge({ state, now: () => NOW,
    semanticScorer: () => new Promise(() => {}) });
  let start = Date.now();
  assert.equal((await knowledge.searchHybrid('brætspil', { semanticTimeoutMs: 50 }))[0].source.id, 'confirmed');
  assert.ok(Date.now() - start < 3000);
  knowledge = new PersonalKnowledge({ state, now: () => NOW, semanticScorer: async () => { throw new Error('offline'); } });
  assert.equal((await knowledge.searchHybrid('brætspil'))[0].source.id, 'confirmed');
  assert.deepEqual(await knowledge.searchHybrid('elcykel'), []);
});

test('embedding cache updates changed revisions, forgets archived sources and requires external opt-in', async () => {
  assert.throws(() => new IncrementalSemanticIndex({ embed: async () => [1], external: true }), /tilvalg/);
  let calls = 0;
  const embed = async value => { calls++; const normalized = String(value).toLocaleLowerCase('da-DK');
    return [normalized.includes('blå') ? 1 : 0, normalized.includes('grøn') ? 1 : 0]; };
  const index = new IncrementalSemanticIndex({ embed });
  const state = { memories: [{ id: 'm1', text: 'Blå farve', status: 'confirmed', confirmed: true,
    revision: 1, source: { kind: 'user', channel: 'manual' } }] };
  const knowledge = new PersonalKnowledge({ state, now: () => NOW,
    semanticScorer: index.score.bind(index) });
  assert.equal((await knowledge.searchHybrid('blå', { limit: 5 }))[0].source.id, 'm1');
  const first = calls;
  await knowledge.searchHybrid('blå');
  assert.equal(calls, first + 1, 'a repeated query embeds only query, not unchanged documents');
  state.memories[0].revision = 2;
  state.memories[0].text = 'Grøn farve';
  assert.equal((await knowledge.searchHybrid('grøn'))[0].source.revision, 2);
  assert.equal(index.stats().cachedDocuments, 1);
  state.memories[0].archived = true;
  assert.deepEqual(await knowledge.searchHybrid('grøn'), []);
  assert.equal(index.stats().cachedDocuments, 0);
});

test('B1/B2 proposals, confirmations, conflict and explicit replacement preserve sources and history', async () => {
  const state = {};
  let saves = 0;
  const claims = new PersonalClaims({ state, now: () => NOW, save: async () => { saves++; } });
  const original = await claims.propose({ subject: 'favoritfrugt', value: 'Æbler er min favorit.',
    category: 'preference', source: { kind: 'user', channel: 'manual' } });
  const knowledge = new PersonalKnowledge({ state, now: () => NOW });
  assert.equal(original.status, 'proposed');
  assert.deepEqual(knowledge.search('favoritfrugt'), []);
  await claims.decision(original.id, 1, 'confirm');
  assert.equal(knowledge.search('favoritfrugt')[0].source.revision, 2);
  const conflicting = await claims.propose({ subject: 'favoritfrugt', value: 'Pærer er min favorit.',
    category: 'preference', source: { kind: 'user', channel: 'discord' } });
  assert.deepEqual(knowledge.search('Pærer'), [], 'unreviewed change stays out of active context');
  await claims.decision(conflicting.id, 1, 'confirm');
  assert.equal(claims.conflicts().length, 1);
  assert.deepEqual(knowledge.search('favoritfrugt'), [], 'opposing confirmed claims cannot silently win retrieval');
  const replacement = await claims.propose({ subject: 'favoritfrugt', value: 'Pærer er fortsat min favorit.',
    category: 'preference', source: { kind: 'user', channel: 'manual' } });
  await claims.decision(replacement.id, 1, 'confirm', { supersedesId: conflicting.id });
  assert.equal(claims.conflicts().length, 1, 'the older opposing claim still requires review');
  await claims.decision(original.id, 2, 'archive');
  assert.equal(claims.conflicts().length, 0);
  assert.equal(knowledge.search('favoritfrugt')[0].source.id, replacement.id);
  assert.equal(claims.list().find(item => item.id === conflicting.id).status, 'superseded');
  assert.ok(saves >= 7);
});

test('B1 validity and privacy exclude expired claims and reject secret-shaped text', async () => {
  const state = {};
  const manager = new PersonalClaims({ state, now: () => NOW });
  await assert.rejects(manager.propose({ subject: 'konto', value: 'password=verysecretpassword',
    source: { kind: 'user', channel: 'manual' } }), /hemmeligheder/);
  await assert.rejects(manager.propose({ subject: 'konto', value: 'Ingen hemmelighed',
    source: { kind: 'user', channel: 'private-env' } }), /kilde/);
  const expired = await manager.propose({ subject: 'midlertidigdeadline', value: 'Fristen var i går.',
    category: 'temporary', source: { kind: 'user', channel: 'manual' }, expiresAt: at('2026-11-03', 12) });
  await manager.decision(expired.id, 1, 'confirm');
  assert.deepEqual(new PersonalKnowledge({ state, now: () => NOW }).search('midlertidigdeadline'), []);
  assert.notEqual((await manager.propose({ subject: 'midlertidigdeadline', value: 'Fristen var i går.',
    source: { kind: 'user', channel: 'manual' } })).id, expired.id, 'an expired record does not block a new proposal');
});

test('80 Danish lexical retrieval questions report an honest top-five source metric', t => {
  const topics = ['akvarel', 'skak', 'kaniner', 'violin', 'altan', 'kartofler', 'rosmarin', 'cykling',
    'guitar', 'kunst', 'tog', 'morgenmad', 'bøger', 'kultur', 'svømning', 'kakao', 'forår', 'fodbold',
    'brætspil', 'klaver'];
  const state = { memories: topics.map((topic, index) => ({ id: `topic-${index}`, status: 'confirmed',
    confirmed: true, text: `Vigtig registreret personlig note om ${topic} med oplysninger fra brugerens egne noter.`,
    source: { kind: 'user', channel: 'manual' } })) };
  const knowledge = new PersonalKnowledge({ state, now: () => NOW });
  const questions = topics.flatMap((topic, index) => [
    { question: `Hvad ved JARVIS om ${topic}?`, id: `topic-${index}` },
    { question: `Vis mig min personlige note om ${topic}.`, id: `topic-${index}` },
    { question: `Hvor finder jeg registrerede oplysninger vedrørende ${topic}?`, id: `topic-${index}` },
    { question: `Hvilken kilde nævner ${topic}?`, id: `topic-${index}` },
  ]);
  assert.equal(questions.length, 80);
  const hits = questions.filter(({ question, id }) =>
    knowledge.search(question, { limit: 5 }).some(match => match.source.id === id)).length;
  const score = hits / questions.length;
  t.diagnostic(`Synthetic Danish lexical correct-source@5: ${hits}/${questions.length} (${(100 * score).toFixed(1)}%). This does not establish semantic paraphrase accuracy.`);
  assert.ok(score >= 0.9, `Observed local lexical source recall@5 was ${(score * 100).toFixed(1)}%`);
  assert.ok(knowledge.search('noter om enhjørningesyge').every(match => match.type !== 'memory') ||
    !knowledge.search('enhjørningesyge').length);
  // This synthetic lexical fixture is explicitly not evidence of Danish embedding quality.
});

test('Danish knowledge questions preserve negation, absent data, expired records and unresolved conflicts', () => {
  const now = () => NOW;
  const state = { memories: [
    { id: 'negation', status: 'confirmed', text: 'Jeg tåler ikke peanuts og spiser ikke nødder.',
      source: { kind: 'user', channel: 'manual' } },
    { id: 'expired', status: 'confirmed', text: 'Midlertidig adgang til sommerhuset udløb.',
      expiresAt: '2026-11-01T12:00:00Z', source: { kind: 'user', channel: 'manual' } },
  ], personalClaims: [
    { id: 'conflictA', subject: 'boepael', value: 'Aarhus', revision: 2, status: 'confirmed',
      source: { kind: 'user', channel: 'manual' } },
    { id: 'conflictB', subject: 'boepael', value: 'Odense', revision: 2, status: 'confirmed',
      source: { kind: 'user', channel: 'manual' } },
  ] };
  const knowledge = new PersonalKnowledge({ state, now });
  for (const query of ['Hvilke fødevarer spiser jeg ikke?', 'Er peanuts noget, jeg ikke tåler?',
    'Hvad er min registrerede begrænsning for nødder?', 'Hvilken kilde siger, at jeg ikke spiser nødder?'])
    assert.ok(knowledge.search(query, { limit: 5 }).some(doc => doc.source.id === 'negation'), query);
  for (const query of ['sommerhuset', 'boepael', 'svømmetider', 'ukendt fødselsdag'])
    assert.deepEqual(knowledge.search(query, { limit: 5 }), [], `No current unambiguous source for ${query}`);
});

function calendarReady(start, end) { return { status: 'ready', start, end }; }
function dailyRequest({ tasks, events = [], windows, coverage, bufferMinutes = 0 }) {
  return { tasks, calendarEvents: events, workWindows: windows,
    calendarCoverage: coverage || calendarReady(at('2026-11-04', 0), at('2026-11-06', 0)), bufferMinutes };
}

test('30 explicit planning scenarios validate windows, deadlines, events, dependencies and locks', async t => {
  const day = '2026-11-04';
  const window = slot(at(day, 7), at(day, 17));
  const coverage = calendarReady(at(day, 0), at('2026-11-05', 0));
  const scenarios = [];
  for (const minutes of [15, 30, 45, 60, 75, 90, 105, 120, 135, 150]) {
    scenarios.push({ name: `ledig kapacitet ${minutes} minutter`, input: dailyRequest({
      tasks: [{ id: 't', title: 'Rapport', durationMinutes: minutes }], windows: [window], coverage }),
    expected: true, expectedStart: at(day, 7) });
  }
  for (const minutes of [30, 45, 60, 75, 90, 105, 120, 135, 150, 165]) {
    scenarios.push({ name: `utilstrækkeligt tidsvindue ${minutes} minutter`, input: dailyRequest({
      tasks: [{ id: 't', durationMinutes: minutes, deadline: at(day, 7, 20) }],
      windows: [window], coverage }), expected: false, conflict: 'capacity' });
  }
  for (const minutes of [15, 30, 45, 60, 75, 90, 105, 120, 135, 150]) {
    scenarios.push({ name: `to afhængige opgaver med ${minutes} minutters efterfølger`, input: dailyRequest({
      tasks: [{ id: 'first', durationMinutes: 20 }, { id: 'second', durationMinutes: minutes, dependencies: ['first'] }],
      events: [slot(at(day, 7, 25), at(day, 8, 15))], windows: [window], coverage }),
    expected: true, dependencies: true });
  }
  assert.equal(scenarios.length, 30);
  for (const scenario of scenarios) await t.test(scenario.name, () => {
    const result = planPersonalTasks(scenario.input);
    assert.equal(result.feasible, scenario.expected, JSON.stringify(result.conflicts));
    if (scenario.expectedStart) assert.equal(result.proposals[0].start, scenario.expectedStart);
    if (scenario.conflict) assert.ok(result.conflicts.some(c => c.code === scenario.conflict));
    if (scenario.dependencies) {
      const first = result.proposals.find(x => x.taskId === 'first');
      const second = result.proposals.find(x => x.taskId === 'second');
      assert.ok(Date.parse(second.start) >= Date.parse(first.end));
    }
  });
});

test('unknown calendar coverage never turns into free time; locked choices remain explicit conflicts', () => {
  const day = '2026-11-04';
  const windows = [slot(at(day, 7), at(day, 12))];
  const tasks = [{ id: 'task', durationMinutes: 60 }];
  assert.equal(planPersonalTasks({ tasks, workWindows: windows }).conflicts[0].code, 'calendar-unknown');
  const result = planPersonalTasks(dailyRequest({ tasks: [{ ...tasks[0], lockedStart: at(day, 9) }],
    events: [slot(at(day, 8), at(day, 10))], windows }));
  assert.equal(result.feasible, false);
  assert.equal(result.conflicts[0].code, 'locked-conflict');
  assert.throws(() => planPersonalTasks(dailyRequest({ tasks: [
    { id: 'a', durationMinutes: 60, dependencies: ['b'] },
    { id: 'b', durationMinutes: 60, dependencies: ['a'] },
  ], windows })), /Cirkulær/);
});

test('timezone/DST inputs require unambiguous offsets and respect real instants', () => {
  const start = '2026-03-29T01:00:00+01:00';
  const end = '2026-03-29T04:00:00+02:00';
  const result = planPersonalTasks({ tasks: [{ id: 'dst', durationMinutes: 90 }],
    workWindows: [slot(start, end)], calendarCoverage: calendarReady(start, end) });
  assert.equal(result.feasible, true);
  assert.equal((Date.parse(result.proposals[0].end) - Date.parse(result.proposals[0].start)) / 60000, 90);
  assert.throws(() => planPersonalTasks({ tasks: [{ id: 'bad', durationMinutes: 60, deadline: '2026-03-29T02:30' }],
    workWindows: [slot(start, end)], calendarCoverage: calendarReady(start, end) }), /tidszone/);
});

test('follow-up records are revision-bound and closed cases never reappear', async () => {
  const state = {};
  let now = NOW; let saves = 0;
  const manager = new FollowUpCases({ state, now: () => now, save: async () => { saves++; } });
  const created = await manager.create({ awaiting: 'Tilbagemelding om kontrakten',
    source: { kind: 'project', id: 'project1', revision: 4 },
    nextCheckAt: at('2026-11-04', 7), stopCondition: 'Svar modtaget' });
  assert.equal(manager.due().length, 1);
  const delayed = await manager.update(created.id, 1, 'snooze', { nextCheckAt: at('2026-11-05', 7) });
  assert.equal(manager.due().length, 0);
  assert.equal(delayed.revision, 2);
  await assert.rejects(manager.update(created.id, 1, 'complete'), /revisionen/);
  now = new Date(at('2026-11-05', 8));
  assert.equal(manager.due().length, 1);
  const observed = await manager.update(created.id, 2, 'observe', {
    observation: { status: 'unknown', subject: 'Kontraktsvar', source: 'Ejerens indbakke' },
  });
  assert.equal(observed.observations[0].status, 'unknown');
  const closed = await manager.update(created.id, 3, 'cancel');
  assert.equal(closed.status, 'cancelled');
  assert.equal(manager.due().length, 0);
  await assert.rejects(manager.update(created.id, 4, 'snooze', { nextCheckAt: at('2026-11-06', 7) }), /ikke genåbnes/);
  assert.ok(saves >= 4);
});

function engineFixture(runTask) {
  let now = NOW;
  const state = { tasks: [] };
  const notices = [];
  const engine = new TaskEngine({ state, now: () => now, save: async () => {},
    runTask, notify: async (task, status) => { notices.push(status); } });
  return { engine, state, notices, setNow: value => { now = new Date(value); } };
}

test('R13 temporary monitoring failures retry boundedly and preserve ordinary recurrence', async () => {
  let calls = 0;
  const f = engineFixture(async () => { if (++calls <= 2) throw new Error('HTTP 503'); return 'Fungerer igen'; });
  const task = await f.engine.create({ title: 'Prisovervågning', prompt: 'Læs pris', category: 'monitor',
    intervalMinutes: 60, retryPolicy: { maxRetries: 1, delayMinutes: 5 } });
  await f.engine.tick();
  assert.equal(task.status, 'scheduled');
  assert.equal(task.nextRunAt, at('2026-11-04', 8, 5));
  assert.equal(task.lastRunStatus, 'failed');
  assert.deepEqual(f.notices, ['failed']);
  f.setNow(at('2026-11-04', 8, 5));
  await f.engine.tick();
  assert.equal(task.nextRunAt, at('2026-11-04', 9, 5));
  assert.deepEqual(f.notices, ['failed'], 'no repeated failure storm');
  f.setNow(at('2026-11-04', 9, 5));
  await f.engine.tick();
  assert.equal(task.lastRunStatus, 'completed');
  assert.equal(task.consecutiveFailures, 0);
  assert.equal(task.nextRunAt, at('2026-11-04', 10, 5));
});

test('permanent and unknown outcomes pause repeat jobs; restart cannot blindly re-run', async () => {
  let calls = 0;
  const f = engineFixture(async () => { calls++; const error = new Error('Login expired'); error.permanent = true; throw error; });
  const task = await f.engine.create({ title: 'Leverandøropfølgning', prompt: 'Undersøg ændring', intervalMinutes: 60 });
  await f.engine.tick();
  assert.equal(task.status, 'paused');
  f.setNow(at('2026-11-05', 8));
  await f.engine.tick();
  assert.equal(calls, 1);
  const uncertain = engineFixture(async () => { const error = new Error('Write outcome unknown'); error.unknownOutcome = true; throw error; });
  const job = await uncertain.engine.create({ title: 'Gentaget job', prompt: 'Test', intervalMinutes: 60 });
  await uncertain.engine.tick();
  assert.equal(job.status, 'paused');
  assert.equal(job.runs[0].status, 'unknown');
  const persisted = { tasks: [{ ...job, status: 'running', nextRunAt: NOW.toISOString() }] };
  const restarted = new TaskEngine({ state: persisted, save: async () => {}, runTask: async () => { throw Error('must not run'); }, now: () => NOW });
  assert.equal(persisted.tasks[0].status, 'interrupted');
  await restarted.tick();
  assert.equal(persisted.tasks[0].runs.length, 1);
  const resumable = { tasks: [{ ...job, id: 'safe', status: 'running', category: 'monitor',
    responseId: 'resp_already_saved', nextRunAt: null }] };
  let resumedId = '';
  const resumedEngine = new TaskEngine({ state: resumable, save: async () => {},
    runTask: async current => { resumedId = current.responseId; return 'Eksisterende svar genoptaget'; }, now: () => NOW });
  assert.equal(resumable.tasks[0].status, 'scheduled');
  await resumedEngine.tick();
  assert.equal(resumedId, 'resp_already_saved');
  assert.equal(resumable.tasks[0].lastRunStatus, 'completed');
});

test('structured observations preserve unknown status and versioned skills do not grant tools', async () => {
  assert.throws(() => normalizeObservation({ status: 'unchanged', source: 'example' }), /emne/);
  const f = engineFixture(async () => ({ summary: 'Kilden utilgængelig', observation: {
    status: 'unknown', subject: 'Mælkepris', source: 'syntetisk Nemlig-read', unit: 'DKK', value: null } }));
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const registry = await loadBundledSkills(root);
  assert.ok(registry.catalog().every(item => /\d+\.\d+\.\d+/.test(item.version)));
  assert.equal(registry.resolve('daily-briefing', '1.0.0').permissions, 'existing-authorized-tools-only');
  assert.throws(() => registry.resolve('daily-briefing', '7.0.0'), /findes ikke/);
  const protectedEngine = new TaskEngine({ state: { tasks: [] }, save: async () => {},
    runTask: async () => 'OK', skillsRegistry: registry, now: () => NOW });
  await assert.rejects(protectedEngine.create({ title: 'Job', prompt: 'Test', skillId: 'daily-briefing', skillVersion: '7.0.0' }), /findes ikke/);
  const valid = await protectedEngine.create({ title: 'Job', prompt: 'Test', skillId: 'daily-briefing', skillVersion: '1.0.0' });
  assert.equal(valid.skillVersion, '1.0.0');
  const task = await f.engine.create({ title: 'Læsning', prompt: 'Se pris', intervalMinutes: 60 });
  await f.engine.tick();
  assert.equal(task.runs[0].status, 'unknown');
  assert.equal(task.runs[0].observation.status, 'unknown');
  assert.equal(task.status, 'scheduled');
});

test('monitoring suppresses unchanged and duplicate changed notifications without hiding run history', async () => {
  const observations = [
    { status: 'changed', value: 39 }, { status: 'changed', value: 39 },
    { status: 'unchanged', value: 39 }, { status: 'changed', value: 40 },
  ];
  let index = 0;
  const f = engineFixture(async () => ({ summary: 'Pris kontrolleret', observation: {
    ...observations[index++], subject: 'Kaffe', unit: 'DKK', variant: '500 g', source: 'Syntetisk butik' } }));
  const task = await f.engine.create({ title: 'Pris på kaffe', prompt: 'Læs kaffens pris', intervalMinutes: 60 });
  for (const hour of [8, 9, 10, 11]) {
    f.setNow(at('2026-11-04', hour));
    await f.engine.tick();
  }
  assert.equal(task.runs.length, 4);
  assert.deepEqual(f.notices, ['completed', 'completed']);
  assert.equal(task.runs[0].observation.value, 40);
});
