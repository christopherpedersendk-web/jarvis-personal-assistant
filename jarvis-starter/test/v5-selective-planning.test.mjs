import test from 'node:test';
import assert from 'node:assert/strict';
import { planPersonalTasks, planningInstant } from '../capacity-planner.mjs';
import { PersonalTasks } from '../personal-tasks.mjs';

const at = (hour, minute = 0) => new Date(Date.parse('2026-11-05T00:00:00Z') + (hour * 60 + minute) * 60_000).toISOString();
const span = (start, end) => ({ start: at(start), end: at(end) });
const task = (id, changes = {}) => ({ id, title: id, durationMinutes: 60, ...changes });
const previous = (id, start, minutes = 60) => ({ taskId: id, start: at(start), end: at(start, minutes) });
const request = changes => ({ tasks: [task('a')], workWindows: [span(8, 17)], calendarEvents: [],
  calendarCoverage: { status: 'ready', start: at(0), end: at(24) }, ...changes });
const proposal = (plan, id = 'a') => plan.proposals.find(item => item.taskId === id);
const conflict = (plan, code) => assert.ok(plan.conflicts.some(item => item.code === code), JSON.stringify(plan.conflicts));

// Distinct constraints and state changes, not 30 variants of duration alone.
const scenarios = [
  ['ingen arbejdstidsvinduer giver ikke et tomt, godkendt forslag', request({ workWindows: [] }), p => conflict(p, 'no-windows')],
  ['manglende kalenderdata er ukendt, også med et tidligere valg', request({ calendarCoverage: null, previousProposals: [previous('a', 10)] }), p => { conflict(p, 'calendar-unknown'); assert.equal(p.proposals.length, 0); }],
  ['delvis kalenderdækning kan ikke dække et senere arbejdsvindue', request({ calendarCoverage: { status: 'ready', start: at(0), end: at(12) } }), p => conflict(p, 'calendar-unknown')],
  ['bekræftet tom kalender giver første sammenhængende blok', request({}), p => { assert.equal(p.feasible, true); assert.equal(proposal(p).start, at(8)); }],
  ['overlappende arbejdstidsvinduer samles uden falsk kapacitetsmangel', request({ tasks: [task('a', { durationMinutes: 90 })], workWindows: [span(8, 9), span(8.5, 10)] }), p => assert.equal(proposal(p).end, at(9.5))],
  ['individuelle vinduer skæres med de generelle arbejdstider', request({ tasks: [task('a', { allowedWindows: [span(12, 13), span(9, 10)] })], workWindows: [span(8, 9.5), span(11, 15)] }), p => assert.equal(proposal(p).start, at(12))],
  ['arbejde splittes ikke lydløst over en frokostpause', request({ tasks: [task('a', { durationMinutes: 120 })], workWindows: [span(8, 9), span(10, 11)] }), p => conflict(p, 'capacity')],
  ['en kalenderaftale flytter fleksibelt arbejde', request({ calendarEvents: [span(8, 9.5)] }), p => assert.equal(proposal(p).start, at(9.5))],
  ['en heldagsreservation efterlader ikke opdigtet ledig tid', request({ calendarEvents: [span(0, 24)] }), p => { conflict(p, 'capacity'); assert.equal(p.proposals.length, 0); }],
  ['kalenderens afslutning får én efterfølgende buffer', request({ calendarEvents: [span(8, 9)], bufferMinutes: 15 }), p => assert.equal(proposal(p).start, at(9, 15))],
  ['buffer adskiller to lokale arbejdsblokke', request({ tasks: [task('a'), task('b')], bufferMinutes: 15 }), p => assert.equal(proposal(p, 'b').start, at(9, 15))],
  ['varighedsusikkerhed reserveres uden at ændre nominal sluttid', request({ tasks: [task('a', { durationUncertaintyMinutes: 30 }), task('b')] }), p => { assert.equal(proposal(p).end, at(9)); assert.equal(proposal(p).reservedUntil, at(9.5)); assert.equal(proposal(p, 'b').start, at(9.5)); }],
  ['usikkerhed kan gøre en ellers tilstrækkelig blok for kort', request({ tasks: [task('a', { durationUncertaintyMinutes: 15 })], workWindows: [span(8, 9)] }), p => conflict(p, 'capacity')],
  ['tidligste start respekteres', request({ tasks: [task('a', { earliestStart: at(13) })] }), p => assert.equal(proposal(p).start, at(13))],
  ['en opgave må slutte præcis ved fristen', request({ tasks: [task('a', { deadline: at(9) })] }), p => assert.equal(proposal(p).end, at(9))],
  ['en for tidlig frist bliver forklaret som konflikt', request({ tasks: [task('a', { deadline: at(8.5) })] }), p => conflict(p, 'capacity')],
  ['prioritet bryder lighed mellem opgaver uden frist', request({ tasks: [task('a', { priority: 1 }), task('b', { priority: 5 })] }), p => assert.equal(proposal(p, 'b').start, at(8))],
  ['kort deadline har forrang over høj prioritet ved samme kapacitet', request({ tasks: [task('a', { deadline: at(9), priority: 1 }), task('b', { priority: 5 })] }), p => assert.equal(proposal(p).start, at(8))],
  ['en kæde med tre afhængigheder placeres i rækkefølge', request({ tasks: [task('c', { dependencies: ['b'] }), task('b', { dependencies: ['a'] }), task('a')] }), p => assert.equal(proposal(p, 'c').start, at(10))],
  ['en diamantgraf kræver begge parallelle forudsætninger afsluttet', request({ tasks: [task('a'), task('b', { dependencies: ['a'] }), task('c', { dependencies: ['a'] }), task('d', { dependencies: ['b', 'c'] })] }), p => assert.equal(proposal(p, 'd').start, at(11))],
  ['en umulig forudsætning gør ikke efterfølgeren gyldig', request({ tasks: [task('a', { durationMinutes: 600 }), task('b', { dependencies: ['a'] })] }), p => { conflict(p, 'dependency-unavailable'); assert.equal(p.proposals.length, 0); }],
  ['låst arbejde beholdes og fleksibelt arbejde kan placeres omkring det', request({ tasks: [task('a', { lockedStart: at(10) }), task('b')] }), p => { assert.equal(proposal(p).start, at(10)); assert.equal(proposal(p).placement, 'locked'); assert.equal(proposal(p, 'b').start, at(8)); }],
  ['en ny kalenderkonflikt flytter aldrig en låst opgave', request({ tasks: [task('a', { lockedStart: at(10) })], calendarEvents: [span(10, 11)] }), p => { conflict(p, 'locked-conflict'); assert.equal(proposal(p), undefined); }],
  ['to overlappende låse rapporteres, ikke automatisk løses', request({ tasks: [task('a', { lockedStart: at(10) }), task('b', { lockedStart: at(10.5) })] }), p => { conflict(p, 'locked-conflict'); assert.equal(p.proposals.length, 1); }],
  ['låst efterfølger skubber en forudsætnings seneste mulige sluttid frem', request({ tasks: [task('a'), task('b', { lockedStart: at(9), dependencies: ['a'] })] }), p => { assert.equal(p.feasible, true); assert.equal(proposal(p, 'b').start, at(9)); }],
  ['låst efterfølger med umulig forudsætning fjernes fra gyldige forslag', request({ tasks: [task('a'), task('b', { lockedStart: at(8.5), dependencies: ['a'] })] }), p => { conflict(p, 'dependency-unavailable'); assert.equal(p.proposals.length, 0); }],
  ['et nyt højprioriteret arbejde overskriver ikke et gyldigt tidligere valg', request({ tasks: [task('a'), task('b', { priority: 5 })], previousProposals: [previous('a', 8)] }), p => { assert.equal(proposal(p).start, at(8)); assert.equal(proposal(p).placement, 'preserved'); assert.equal(proposal(p, 'b').start, at(9)); }],
  ['kun kalenderberørt tidligere valg flyttes, en uafhængig eftermiddag bevares', request({ tasks: [task('a'), task('b')], previousProposals: [previous('a', 10), previous('b', 14)], calendarEvents: [span(10, 11)] }), p => { assert.equal(proposal(p).placement, 'moved'); assert.equal(proposal(p, 'b').start, at(14)); assert.deepEqual(p.changes.map(x => x.taskId), ['a']); }],
  ['ændret forudsætning flytter berørt efterfølger, ikke en uafhængig opgave', request({ tasks: [task('a', { earliestStart: at(12) }), task('b', { dependencies: ['a'] }), task('c')], previousProposals: [previous('a', 8), previous('b', 9), previous('c', 15)] }), p => { assert.equal(proposal(p).start, at(12)); assert.equal(proposal(p, 'b').start, at(13)); assert.equal(proposal(p, 'c').start, at(15)); }],
  ['længere varighed bevarer et muligt tidligere starttidspunkt', request({ tasks: [task('a', { durationMinutes: 90 }), task('b')], previousProposals: [previous('a', 10), previous('b', 14)] }), p => { assert.equal(proposal(p).placement, 'preserved'); assert.equal(proposal(p).end, at(11.5)); assert.equal(proposal(p, 'b').placement, 'preserved'); }],
  ['et gemt lokalt valg har forrang over et ældre simuleret forslag', request({ tasks: [task('a', { preferredStart: at(13) })], previousProposals: [previous('a', 10)] }), p => assert.equal(proposal(p).start, at(13))],
  ['arkiveret opgave i gamle forslag ignoreres uden at genopstå', request({ previousProposals: [previous('removed', 8)] }), p => { assert.deepEqual(p.ignoredPreviousTaskIds, ['removed']); assert.equal(p.proposals.length, 1); assert.equal(proposal(p).taskId, 'a'); }],
  ['sommertidens manglende time reducerer reel kapacitet', request({ tasks: [task('a', { durationMinutes: 150 })], workWindows: [{ start: '2026-03-29T01:00:00+01:00', end: '2026-03-29T04:00:00+02:00' }], calendarCoverage: { status: 'ready', start: '2026-03-29T00:00:00Z', end: '2026-03-29T02:00:00Z' } }), p => conflict(p, 'capacity')],
  ['vintertidens gentagne klokkeslæt med forskellige offsets er forskellige instanter', request({ tasks: [task('a', { lockedStart: '2026-10-25T02:00:00+01:00', durationMinutes: 30 })], workWindows: [{ start: '2026-10-25T01:00:00+02:00', end: '2026-10-25T04:00:00+01:00' }], calendarEvents: [{ start: '2026-10-25T02:00:00+02:00', end: '2026-10-25T02:30:00+02:00' }], calendarCoverage: { status: 'ready', start: '2026-10-24T22:00:00Z', end: '2026-10-25T04:00:00Z' } }), p => { assert.equal(p.feasible, true); assert.equal(proposal(p).start, '2026-10-25T01:00:00.000Z'); }],
  ['kilderevision følger nuværende opgave frem for gammel simulationsrevision', request({ tasks: [task('a', { source: { kind: 'personal-task', id: 'a', revision: 4 } })], previousProposals: [{ ...previous('a', 10), source: { kind: 'personal-task', id: 'a', revision: 1 } }] }), p => assert.equal(proposal(p).source.revision, 4)],
  ['manuel start uden for nyt tilladt vindue bliver forklaret og genplaceret', request({ tasks: [task('a', { preferredStart: at(10), allowedWindows: [span(13, 16)] })] }), p => { assert.equal(proposal(p).start, at(13)); assert.equal(proposal(p).placement, 'moved'); assert.match(proposal(p).explanation, /tidsvindue/); }],
  ['buffer før kalenderaftale tælles én gang', request({ tasks: [task('a', { durationMinutes: 45, lockedStart: at(8) })], bufferMinutes: 15, calendarEvents: [span(9, 10)] }), p => { assert.equal(p.feasible, true); assert.equal(proposal(p).reservedUntil, at(9)); }],
  ['flere låste efterfølgeres forudsætninger respekterer den tidligste grænse', request({ tasks: [task('a', { durationMinutes: 30 }), task('b', { durationMinutes: 30, dependencies: ['a'] }), task('c', { lockedStart: at(9), dependencies: ['b'] })] }), p => { assert.equal(p.feasible, true); assert.equal(proposal(p, 'b').start, at(8.5)); }],
];

for (const [name, input, check] of scenarios) test(`C3/C4 scenarie: ${name}`, () => {
  const snapshot = structuredClone(input);
  const result = planPersonalTasks(input);
  check(result);
  assert.deepEqual(input, snapshot, 'simulation mutates no task, calendar or previous manual choice');
  for (const choice of result.proposals) {
    assert.ok(Date.parse(choice.end) > Date.parse(choice.start));
    assert.ok(Date.parse(choice.reservedUntil) >= Date.parse(choice.end));
  }
});

test('C3 scenario set covers at least thirty different constraint/change narratives', () => {
  assert.ok(scenarios.length >= 30);
  assert.equal(new Set(scenarios.map(([name]) => name)).size, scenarios.length);
});

test('C3 shared time parser rejects nonexistent civil dates, ambiguous offset-free input and invalid offsets', () => {
  for (const value of ['2026-02-30T10:00:00Z', '2026-11-05T25:00:00Z', '2026-03-29T02:30',
    '2026-11-05T10:00:00+14:15', '2026-11-05T10:00:00-15:00']) assert.throws(() => planningInstant(value));
  assert.equal(planningInstant('2026-11-05T10:00:00+01:00'), Date.parse(at(9)));
});

test('C3 cyclic/duplicate/unknown dependencies and invalid prior choices are rejected', () => {
  assert.throws(() => planPersonalTasks(request({ tasks: [task('a', { dependencies: ['b'] }), task('b', { dependencies: ['a'] })] })), /Cirkulær/);
  assert.throws(() => planPersonalTasks(request({ tasks: [task('a', { dependencies: ['b', 'b'] }), task('b')] })), /dobbelte/);
  assert.throws(() => planPersonalTasks(request({ tasks: [task('a', { dependencies: ['absent'] })] })), /Ukendt/);
  assert.throws(() => planPersonalTasks(request({ previousProposals: [previous('a', 8), previous('a', 9)] })), /unikke/);
  assert.throws(() => planPersonalTasks(request({ timeZone: 'Not/AZone' })), /IANA/);
});

test('C2/C4 planned local placements are revision-bound, preserved without a calendar write and still editable after constraints change', async () => {
  const state = {}, saved = [];
  const manager = new PersonalTasks({ state, save: async () => saved.push(structuredClone(state)) });
  const created = await manager.create({ title: 'Syntetisk privat arbejde', purpose: 'En selvstændig plan uden indkøb', durationMinutes: 60 });
  const chosen = await manager.update(created.id, { expectedRevision: 1, plannedStart: at(10) });
  assert.equal(chosen.revision, 2); assert.equal(chosen.plannedStart, at(10));
  assert.equal(manager.toPlanningTasks()[0].preferredStart, at(10));
  assert.equal((await manager.update(created.id, { expectedRevision: 2, plannedStart: at(10) })).revision, 2);
  assert.equal(saved.length, 2, 'identical local placement is a no-op');
  await assert.rejects(manager.update(created.id, { expectedRevision: 1, plannedStart: at(11) }), /ændret/);
  const changed = await manager.update(created.id, { expectedRevision: 2, allowedWindows: [span(13, 16)] });
  const plan = planPersonalTasks(request({ tasks: manager.toPlanningTasks() }));
  assert.equal(proposal(plan, created.id).placement, 'moved');
  assert.equal(proposal(plan, created.id).start, at(13));
  assert.equal(changed.plannedStart, at(10), 'simulation never silently persists the new proposal');
  assert.equal(manager.validateProposals(plan.proposals).valid, true);
  await manager.update(created.id, { expectedRevision: 3, plannedStart: at(13), lockedStart: at(13) });
  assert.equal(planPersonalTasks(request({ tasks: manager.toPlanningTasks() })).proposals[0].placement, 'locked');
  assert.deepEqual(Object.keys(state), ['personalTasks']);
});

test('C4 independent validation rejects stale revisions, overlap and missing prerequisites', async () => {
  const manager = new PersonalTasks({ state: {} });
  const first = await manager.create({ title: 'Først', purpose: 'Forberedelse', durationMinutes: 30 });
  const second = await manager.create({ title: 'Så', purpose: 'Afslutning', durationMinutes: 30, dependencies: [first.id] });
  const plan = planPersonalTasks(request({ tasks: manager.toPlanningTasks() }));
  assert.equal(manager.validateProposals(plan.proposals).valid, true);
  const forged = plan.proposals.map(item => item.taskId === second.id ? { ...item, start: at(8), end: at(8.5), reservedUntil: at(8.5) } : item);
  const check = manager.validateProposals(forged);
  assert.ok(check.conflicts.some(item => item.code === 'dependency-conflict'));
  assert.ok(check.conflicts.some(item => item.code === 'task-overlap'));
  await manager.update(first.id, { expectedRevision: 1, title: 'Ret til forberedelse' });
  assert.ok(manager.validateProposals(plan.proposals).conflicts.some(item => item.code === 'source-revision-conflict'));
});
