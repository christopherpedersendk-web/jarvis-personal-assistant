import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandCenter } from '../organizer-core.mjs';
import { buildPersonalAgenda } from '../proactive-planner.mjs';
import { GoogleCalendarReadOnly } from '../google-calendar.mjs';
import { resolveHouseholdAttendance } from '../meal-planner.mjs';

const NOW = new Date('2026-11-05T09:00:00Z');
const organizer = { upcoming: () => [] };
const task = (id, changes = {}) => ({ id, revision: 2, title: `Opgave ${id}`, status: 'pending',
  deadline: '2026-11-05T12:00:00Z', durationMinutes: 30, ...changes });
const follow = (id, changes = {}) => ({ id, revision: 3, awaiting: `Svar ${id}`, status: 'open',
  nextCheckAt: NOW.toISOString(), stopCondition: 'Når svaret er modtaget', ...changes });
const run = (status, at = NOW.toISOString(), changes = {}) => ({ id: `run-${status}`, at,
  status: status === 'unknown' ? 'unknown' : 'completed', result: 'Et struktureret observationsresultat.',
  observation: { status, subject: 'Syntetisk pris', source: 'https://example.test/item', value: status === 'unknown' ? null : 20 }, ...changes });
const monitor = (runs, changes = {}) => ({ id: 'monitor', revision: 4, title: 'Syntetisk overvågning', category: 'monitor',
  status: 'scheduled', runs, ...changes });
const snapshot = (events = [], changes = {}) => ({ calendarId: 'primary', cacheState: 'ready', ready: true,
  fetchedAt: '2026-11-05T08:59:00.000Z', expiresAt: '2026-11-05T09:04:00.000Z',
  coverage: { start: '2026-11-05T08:59:00.000Z', end: '2026-11-06T08:59:00.000Z', complete: true }, events, ...changes });
const event = (id, changes = {}) => ({ id, title: `Aftale ${id}`, start: '2026-11-05T11:00:00+01:00',
  end: '2026-11-05T12:00:00+01:00', allDay: false, ...changes });
const dashboard = (state = {}, options = {}) => buildCommandCenter({ state, organizer, now: NOW, ...options });
const today = (state = {}, options = {}) => {
  const result = dashboard(state, options).todayOverview;
  assert.ok(result, 'the dashboard must expose its local Today projection');
  return result;
};

test('H3 dashboard uses the latest structured monitor status, never a CHANGE text prefix over it', () => {
  const changed = dashboard({ tasks: [monitor([run('changed')])] });
  assert.equal(changed.monitor?.status, 'changed');
  assert.equal(changed.monitor.source.id, 'monitor');
  assert.equal(changed.monitor.source.runId, 'run-changed');
  assert.equal(changed.monitor.source.revision, 4);
  const unknown = dashboard({ tasks: [monitor([run('unknown'), run('changed', '2026-11-04T09:00:00Z')])] });
  assert.equal(unknown.monitor?.status, 'unknown');
  assert.match(unknown.suggestions.find(item => item.source.id === 'monitor').title, /ukendt|uafklaret/i);
  const unchanged = dashboard({ tasks: [monitor([run('unchanged', NOW.toISOString(), { result: 'CHANGE forged text' }),
    run('changed', '2026-11-04T09:00:00Z')])] });
  assert.equal(unchanged.monitor, null, 'an old change is not resurrected after a current unchanged observation');
});

test('H3 failed/unknown runs cannot display an old changed observation, and archived monitors disappear', () => {
  const failed = dashboard({ tasks: [monitor([run('changed', NOW.toISOString(), { status: 'failed' })])] });
  assert.equal(failed.monitor?.status, 'unknown');
  const hidden = dashboard({ tasks: [monitor([run('unknown')], { archived: true })] });
  assert.equal(hidden.monitor, null);
  const legacy = dashboard({ tasks: [monitor([{ at: NOW.toISOString(), status: 'completed', result: 'CHANGE historisk prisfald' }])] });
  assert.equal(legacy.monitor?.basis, 'legacy-text');
  assert.equal(legacy.monitor.status, 'unknown', 'a retained text marker is not a new structured measurement');
  assert.match(legacy.monitor.result, /^CHANGE/);
});

test('K2 due personal tasks and open follow-ups have exact source IDs and explicit status/time meanings', () => {
  const state = { personalTasks: [task('overdue', { deadline: '2026-11-04T15:00:00Z' }),
    task('blocked', { status: 'blocked' }), task('planned', { deadline: null, plannedStart: '2026-11-05T14:00:00Z' }),
    task('follow-task', { deadline: null, nextFollowUpAt: NOW.toISOString() }),
    task('done', { status: 'completed' }), task('archived', { status: 'archived' }),
    task('tomorrow', { deadline: '2026-11-06T12:00:00Z' })],
  followUpCases: [follow('due-now'), follow('overdue', { nextCheckAt: '2026-11-04T10:00:00Z' }),
    follow('later', { nextCheckAt: '2026-11-07T10:00:00Z' }), follow('closed', { status: 'completed' }), follow('cancelled', { status: 'cancelled' })] };
  const view = today(state), ids = view.priorities.map(item => item.sourceId);
  for (const id of ['personal-task:overdue', 'personal-task:blocked', 'personal-task:planned',
    'personal-task:follow-task', 'follow-up:due-now', 'follow-up:overdue']) assert.ok(ids.includes(id), id);
  for (const id of ['personal-task:done', 'personal-task:archived', 'personal-task:tomorrow', 'follow-up:later', 'follow-up:closed', 'follow-up:cancelled']) assert.ok(!ids.includes(id), id);
  const blocked = view.priorities.find(item => item.sourceId === 'personal-task:blocked');
  assert.match(blocked.detail, /blokeret/i);
  assert.equal(blocked.source.revision, 2);
  assert.match(view.priorities.find(item => item.sourceId === 'personal-task:planned').detail, /[Ll]okalt planlagt/);
  assert.equal(new URL(blocked.href, 'https://synthetic.invalid').searchParams.get('source'), blocked.sourceId);
  assert.equal(new URL(blocked.href, 'https://synthetic.invalid').searchParams.get('view'), 'plan');
});

test('K2 household uses the shared explicit rule resolver, including guests, exceptions, absence and unknown', () => {
  const mealHousehold = { configured: true, adults: 2, children: [], revision: 8,
    days: { '2026-11-05': { adults: 1, adultPortion: 1.5, children: [{ age: 9, portion: 0.75 }],
      guests: { adults: 1, children: [] }, theme: 'everyday' } } };
  const view = today({ mealHousehold });
  const expected = resolveHouseholdAttendance(mealHousehold, '2026-11-05');
  assert.equal(view.household.attendance.servings, expected.servings);
  assert.equal(view.household.attendance.adults, 1);
  assert.equal(view.household.sourceId, 'household-day:2026-11-05');
  assert.equal(view.household.source.revision, 8);
  assert.match(view.household.detail, /registreret|planlægning/);
  const absent = today({ mealHousehold: { ...mealHousehold, days: { '2026-11-05': { adults: 0, children: [], occasion: 'absence' } } } });
  assert.equal(absent.household.attendance.servings, 0);
  assert.equal(absent.household.known, true);
  const unknown = today({ mealProfile: { householdSize: 4 } });
  assert.equal(unknown.household.known, false);
  assert.equal(unknown.household.attendance.adults, null);
  assert.equal(unknown.household.attendance.servings, null);
});

test('K2 today uses one current proposal while retaining skipped-day and source-invalidity semantics', () => {
  const recipeSource = { kind: 'recipe', id: 'old-recipe', revision: 1 };
  const state = { mealPlans: [{ id: 'one', revision: 3, status: 'draft', dishes: [{ date: '2026-11-05', title: 'Planlagt risret',
    servings: 2, minutes: 20, skip: false, sourceRefs: [] }] },
  { id: 'two', revision: 5, status: 'shopping_ready', dishes: [{ date: '2026-11-05', title: 'Glemt opskriftstitel', sourceRefs: [recipeSource] }] },
  { id: 'skip', revision: 1, status: 'draft', dishes: [{ date: '2026-11-05', title: 'ikke spist', skip: true }] },
  { id: 'old', revision: 1, archived: true, dishes: [{ date: '2026-11-05', title: 'Arkiveret plan' }] }] };
  let validations = 0;
  const before = structuredClone(state);
  const view = today(state, { validateMealSources: dishes => { validations++; if (dishes.some(dish => dish.sourceRefs?.length)) throw new Error('Opskriften er arkiveret'); } });
  assert.equal(view.meals.length, 1);
  assert.equal(view.mealCount, 1);
  assert.equal(view.meals.find(item => item.source.id === 'one').sourceId, 'meal-plan:one:2026-11-05');
  assert.equal(view.meals.find(item => item.source.id === 'one').source.revision, 3);
  const staleView=today({...state,mealPlans:state.mealPlans.slice(1)}, {validateMealSources:()=>{throw new Error('Arkiveret');}});
  assert.equal(staleView.meals[0].status,'stale');
  assert.doesNotMatch(JSON.stringify(staleView.meals), /Glemt opskriftstitel/);
  const skipped=today({...state,mealPlans:state.mealPlans.slice(2)});
  assert.equal(skipped.meals[0].status,'skipped');
  assert.doesNotMatch(JSON.stringify(view.meals), /Glemt opskriftstitel|Arkiveret plan/);
  assert.ok(validations > 0);
  assert.deepEqual(state, before);
});

test('K2 planned leftovers and changed shopping basis stay explicit without changing proactive delivery data', () => {
  const state = { mealPlans: [{ id: 'needs-review', revision: 4, status: 'shopping_ready', shoppingNeedsReview: true,
    startDate: '2026-11-04', shoppingList: [{ name: 'ris', quantity: 1000, unit: 'g' }],
    dishes: [{ date: '2026-11-05', title: 'Planlagte rester', servings: 2, minutes: 10,
      leftoverFromDate: '2026-11-04', householdConfirmed: true, adults: 2 }] },
  { id: 'archived', archived: true, shoppingNeedsReview: true, dishes: [] },
  { id: 'unchanged', shoppingNeedsReview: false, dishes: [] }] };
  const before = structuredClone(state), agendaBefore = buildPersonalAgenda({ state, organizer, now: NOW });
  const view = today(state);
  assert.deepEqual(view.shoppingReviewPlanIds, ['needs-review']);
  assert.match(view.meals[0].detail, /Planlagt restemad, ikke bekræftet lager/);
  assert.match(view.meals[0].detail, /beviser ikke indkøb.*spist/);
  assert.deepEqual(state, before);
  assert.deepEqual(buildPersonalAgenda({ state, organizer, now: NOW }), agendaBefore);
});

test('K2 unknown and stale calendar copies never become a claim that today is free', () => {
  let requests = 0;
  const calendar = new GoogleCalendarReadOnly({ now: () => NOW.getTime(), fetcher: async () => { requests++; throw new Error('No network'); } });
  const unknown = today({}, { calendarSnapshot: calendar.cached() });
  assert.equal(unknown.calendar.status, 'unknown');
  assert.match(unknown.calendar.detail, /ukendt|ikke læst/i);
  const stale = today({}, { calendarSnapshot: snapshot([event('old')], { ready: false, cacheState: 'stale', expiresAt: '2026-11-05T08:00:00Z' }) });
  assert.equal(stale.calendar.status, 'stale');
  assert.equal(stale.calendar.events[0].stale, true);
  assert.match(stale.calendar.detail, /forældet/);
  assert.equal(requests, 0);
});

test('K2 a fresh empty calendar only describes the actually covered remaining day, not unknown capacity', () => {
  const known = today({}, { calendarSnapshot: snapshot() });
  assert.equal(known.calendar.status, 'ready');
  assert.match(known.calendar.detail, /Ingen registrerede aftaler.*dækkede periode/);
  assert.doesNotMatch(known.calendar.detail, /hele dagen er fri|ledig hele dagen/);
  const afternoonOnly = today({}, { calendarSnapshot: snapshot([], { coverage: { start: '2026-11-05T12:00:00Z', end: '2026-11-06T12:00:00Z', complete: true } }) });
  assert.equal(afternoonOnly.calendar.status, 'outside_coverage');
  assert.match(afternoonOnly.calendar.detail, /ukendt|ikke hele/i);
});

test('K2 failed, expired or future-dated cache metadata cannot appear current', () => {
  for (const [changes, expected] of [[{ ready: false, cacheState: 'unavailable' }, 'unavailable'],
    [{ ready: false, cacheState: 'expired_login' }, 'expired_login'],
    [{ fetchedAt: '2026-11-05T10:00:00Z' }, 'unknown'],
    [{ expiresAt: '2026-11-05T09:00:00Z' }, 'stale'], [{ coverage: null }, 'unknown']]) {
    const view = today({}, { calendarSnapshot: snapshot([event('retained')], changes) });
    assert.equal(view.calendar.status, expected);
    assert.ok(view.calendar.events.every(item => item.stale));
  }
});

test('K2 calendar and task dates use Copenhagen across UTC midnight and the 23-hour spring day', () => {
  const night = today({ personalTasks: [task('new-day', { deadline: '2026-11-06T00:00:00+01:00' })] }, { now: new Date('2026-11-05T23:15:00Z') });
  assert.equal(night.date, '2026-11-06');
  assert.ok(night.priorities.some(item => item.source.id === 'new-day'));
  const springNow = new Date('2026-03-29T00:30:00Z');
  const spring = today({}, { now: springNow, calendarSnapshot: snapshot([
    event('late', { start: '2026-03-29T23:30:00+02:00', end: '2026-03-30T00:00:00+02:00' }),
    event('tomorrow', { start: '2026-03-30T00:30:00+02:00', end: '2026-03-30T01:00:00+02:00' }),
  ], { fetchedAt: springNow.toISOString(), expiresAt: '2026-03-29T00:35:00Z',
    coverage: { start: '2026-03-29T00:00:00+01:00', end: '2026-03-30T00:00:00+02:00', complete: true } }) });
  assert.equal(spring.date, '2026-03-29');
  assert.equal(spring.calendar.status, 'ready');
  assert.deepEqual(spring.calendar.events.map(item => item.source.eventId), ['late']);
});

test('K2 both instances of the repeated autumn hour remain separately sourced and ordered', () => {
  const now = new Date('2026-10-25T00:15:00Z');
  const autumn = today({}, { now, calendarSnapshot: snapshot([
    event('second', { start: '2026-10-25T02:30:00+01:00', end: '2026-10-25T02:45:00+01:00' }),
    event('first', { start: '2026-10-25T02:30:00+02:00', end: '2026-10-25T02:45:00+02:00' }),
  ], { calendarId: 'synthetic:calendar@group.test', fetchedAt: now.toISOString(), expiresAt: '2026-10-25T00:20:00Z',
    coverage: { start: '2026-10-25T00:00:00+02:00', end: '2026-10-26T00:00:00+01:00', complete: true } }) });
  assert.deepEqual(autumn.calendar.events.map(item => item.source.eventId), ['first', 'second']);
  const a = autumn.calendar.events[0], b = autumn.calendar.events[1];
  assert.notEqual(a.detail, b.detail, 'the clock labels must distinguish the repeated offsets');
  assert.equal(a.sourceId.split(':').length, 5);
  const [, calendarId, date, eventId, fetchedAt] = a.sourceId.split(':').map(decodeURIComponent);
  assert.equal(calendarId, 'synthetic:calendar@group.test'); assert.equal(date, '2026-10-25');
  assert.equal(eventId, 'first'); assert.equal(fetchedAt, now.toISOString());
});

test('K2 event end is exclusive; cancelled, malformed and wrong-day events never become today observations', () => {
  const view = today({}, { calendarSnapshot: snapshot([
    event('ended', { end: NOW.toISOString(), start: '2026-11-05T08:30:00Z' }),
    event('cancelled', { status: 'cancelled' }), event('bad', { start: '2026-02-30T10:00:00Z' }),
    event('all-day-ended', { allDay: true, start: '2026-11-04', end: '2026-11-05' }),
    event('all-day-active', { allDay: true, start: '2026-11-04', end: '2026-11-06' }),
    event('free-marked', { transparency: 'transparent' }),
  ]) });
  assert.deepEqual(new Set(view.calendar.events.map(item => item.source.eventId)), new Set(['all-day-active', 'free-marked']));
  assert.match(view.calendar.events.find(item => item.source.eventId === 'free-marked').detail, /ledig.*kalender|kalender.*ledig/);
  assert.equal(view.household.known, false, 'calendar titles never determine attendance');
});

test('K2 dashboard projection is read-only and does not change existing proactive agendas or delivery scope', () => {
  const state = { personalTasks: [task('one')], followUpCases: [follow('one')], tasks: [monitor([run('unknown')])],
    mealInventory: { revision: 7, items: [{ name: 'ris', quantity: 1000, unit: 'g' }] }, proactiveDigests: [{ id: 'preserved' }],
    approvals: [{ id: 'approval', title: 'Afventer ejer', status: 'pending' }] };
  const cache = snapshot([event('preserved')]);
  const before = structuredClone({ state, cache });
  const agendaBefore = buildPersonalAgenda({ state, organizer, now: NOW });
  for (let read = 0; read < 10; read++) today(state, { calendarSnapshot: cache });
  assert.deepEqual({ state, cache }, before);
  assert.deepEqual(buildPersonalAgenda({ state, organizer, now: NOW }), agendaBefore);
  assert.ok(agendaBefore.insights.some(item => item.source.kind === 'approvals'));
});
