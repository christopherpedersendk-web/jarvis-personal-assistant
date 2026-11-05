import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner, resolveHouseholdAttendance } from '../meal-planner.mjs';

const clock = () => new Date('2026-11-05T12:00:00Z');
function fixture() {
  const state = {}; let saves = 0;
  const planner = new MealPlanner({ state, now: clock, save: async () => { saves++; } });
  return { planner, state, saves: () => saves };
}
const profile = (extra = {}) => ({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null, ...extra });

test('D1/D2 residents, explicit guests and adult factors follow date override before rhythm before default', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, adultPortion: 1.25, children: [{ age: 8, portion: 0.75 }],
    rhythm: { anchorMonday: '2026-11-02', weeks: [{ '1': { adults: 1, adultPortion: 0.75, children: [],
      guests: { adults: 1, adultPortion: 1.5, children: [{ age: 4, portion: 0.5 }] }, theme: 'quick' } }] } });
  assert.equal(planner.attendanceFor('2026-11-02').servings, 2.75);
  assert.equal(planner.attendanceFor('2026-11-02').attendanceSource, 'recurring-rhythm');
  assert.equal(planner.attendanceFor('2026-11-03').servings, 3.25);
  assert.equal(planner.attendanceFor('2026-11-03').attendanceSource, 'household-defaults');
  await planner.setDay('2026-11-02', { expectedRevision: planner.household().revision, adults: 1, adultPortion: 1,
    children: [{ age: 8, portion: 0.75 }], guests: { adults: 2, children: [] }, occasion: 'holiday', theme: 'party' });
  const override = planner.attendanceFor('2026-11-02');
  assert.equal(override.attendanceSource, 'day-override');
  assert.equal(override.occasion, 'holiday');
  assert.equal(override.servings, 3.75);
  assert.equal(override.adults, 1, 'guest adults are distinct from residents, never counted twice');
  const plan = await planner.createPlan({ startDate: '2026-11-02', days: 3, calendarBusyDates: ['2026-11-03'] });
  assert.deepEqual(plan.dishes.map(dish => dish.servings), [3.75, 3.25, 3.25]);
  assert.equal(plan.dishes[1].adults, 2, 'calendar load is not attendance information');
  assert.deepEqual(plan.dishes[0].sourceRefs.find(ref => ref.kind.startsWith('household')), { kind: 'household-day', date: '2026-11-02' });
  await planner.removeDay('2026-11-02', { expectedRevision: planner.household().revision });
  assert.equal(planner.attendanceFor('2026-11-02').servings, 2.75);
});

test('D1 explicit absence yields no dinner even with a saved roster; holiday never infers attendance', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [{ age: 4 }], rhythm: {
    anchorMonday: '2026-11-02', weeks: [{ '4': { adults: 1, children: [], guests: { adults: 3, children: [] } } }] } });
  await planner.setDay('2026-11-05', { occasion: 'absence' });
  const absent = planner.attendanceFor('2026-11-05');
  assert.equal(absent.servings, 0); assert.equal(absent.skip, true);
  assert.equal(absent.adults, 0); assert.deepEqual(absent.children, []); assert.equal(absent.guests.adults, 0);
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  assert.deepEqual(plan.dishes[0].ingredients, []); assert.equal(plan.dishes[0].servings, 0);
  await planner.setDay('2026-11-06', { occasion: 'holiday' });
  assert.equal(planner.attendanceFor('2026-11-06').servings, 2.5, 'holiday is a label, not evidence of extra diners');
  const empty = fixture().planner;
  await assert.rejects(empty.setDay('2026-11-05', { occasion: 'holiday' }), /voksne/);
  assert.equal(empty.household().configured, false);
});

test('D1/D2 invalid guest counts, factors and age dates cannot partially publish a day', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [] });
  const before = planner.household();
  for (const bad of [
    { guests: { adults: 23, children: [] } },
    { guests: { adults: 1, adultPortion: 0, children: [] } },
    { guests: { adults: 0, children: [{ age: 18 }] } },
    { adultPortion: 4 },
    { occasion: 'calendar-inferred' },
    { children: [{ age: 5, ageRecordedAt: '2026-02-30' }] },
  ]) await assert.rejects(planner.setDay('2026-11-05', bad));
  assert.deepEqual(planner.household(), before);
});

test('D2 age checking is explicit, does not invent birthdays and does not invalidate unchanged portion calculations', async () => {
  const f = fixture();
  await f.planner.setHousehold({ adults: 2, children: [{ age: 8, portion: 0.75 }] });
  assert.equal(f.planner.household().children[0].ageRecordedAt, undefined, 'legacy callers do not fabricate a confirmation date');
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 2 });
  const before = structuredClone(plan);
  await f.planner.setHousehold({ expectedRevision: f.planner.household().revision, adults: 2,
    children: [{ age: 8, portion: 0.75, ageRecordedAt: '2026-11-05' }] });
  assert.deepEqual(plan, before, 'checking the same age is not a changed meal requirement');
  assert.equal(f.planner.household().children[0].ageRecordedAt, '2026-11-05');
  assert.equal(f.planner.household().children[0].birthDate, undefined);
  const after = f.saves();
  await f.planner.setHousehold({ adults: 2, children: [{ age: 8, portion: 0.75, ageRecordedAt: '2026-11-05' }] });
  assert.equal(f.saves(), after, 'identical dated rows remain a true no-op');
});

test('R10 semantic no-op ignores object key ordering but stale revisions are rejected even for identical data', async () => {
  const f = fixture();
  await f.planner.setHousehold({ adults: 2, children: [], days: {
    '2026-11-05': { adults: 1, children: [], guests: { adults: 1, children: [] }, occasion: 'holiday' },
    '2026-11-06': { adults: 0, children: [], occasion: 'absence' },
  } });
  const before = f.planner.household(); const written = f.saves();
  await f.planner.setHousehold({ expectedRevision: before.revision, adults: 2, children: [], days: {
    '2026-11-06': before.days['2026-11-06'], '2026-11-05': before.days['2026-11-05'],
  } });
  assert.equal(f.saves(), written); assert.equal(f.planner.household().revision, before.revision);
  await assert.rejects(f.planner.setHousehold({ expectedRevision: before.revision - 1, adults: 2, children: [] }), /ændret et andet sted/);
  await assert.rejects(f.planner.setDay('2026-11-05', { ...before.days['2026-11-05'], expectedRevision: before.revision - 1 }), /ændret et andet sted/);
  await assert.rejects(f.planner.removeDay('2026-11-05', { expectedRevision: before.revision - 1 }), /ændret et andet sted/);
  assert.deepEqual(f.planner.household(), before);
});

test('K5 recovered profile drafts remain bound to their original revision and reset is idempotent', async () => {
  const f = fixture();
  const baseline = f.planner.profile();
  await f.planner.setProfile({ ...profile({ avoid: ['ris'] }), expectedRevision: baseline.revision || 1 });
  const saved = f.planner.profile();
  await assert.rejects(f.planner.setProfile({ ...profile(), expectedRevision: 1 }), /ændret et andet sted/);
  assert.deepEqual(f.planner.profile(), saved);
  const writes = f.saves();
  await f.planner.setProfile({ ...saved, expectedRevision: saved.revision }); assert.equal(f.saves(), writes);
  await assert.rejects(f.planner.resetProfile({ expectedRevision: 1 }), /ændret et andet sted/);
  await f.planner.resetProfile({ expectedRevision: saved.revision });
  const resetWrites = f.saves(); const resetRevision = f.planner.profile().revision;
  await f.planner.resetProfile({ expectedRevision: resetRevision });
  assert.equal(f.saves(), resetWrites); assert.equal(f.planner.profile().revision, resetRevision);
});

test('E2 household refresh changes only affected days, keeps locks and manual portions, and updates the exact source', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision,
    dishes: plan.dishes.map((dish, index) => ({ date: dish.date, ...(index === 0 ? { servings: 3.5, locked: true } : {}) })) });
  const prior = structuredClone(plan.dishes);
  await planner.setDay('2026-11-06', { guests: { adults: 2, children: [] } });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, refreshHousehold: true });
  assert.deepEqual(plan.dishes[0], prior[0]); assert.deepEqual(plan.dishes[2], prior[2]);
  assert.equal(plan.dishes[1].servings, 4);
  assert.deepEqual(plan.dishes[1].sourceRefs.find(ref => ref.kind.startsWith('household')), { kind: 'household-day', date: '2026-11-06' });
  await planner.setDay('2026-11-05', { adults: 4, children: [] });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, refreshHousehold: true });
  assert.equal(plan.dishes[0].servings, 3.5, 'explicit household refresh is not permission to erase manual portions');
  assert.equal(plan.dishes[0].locked, true); assert.equal(plan.dishes[0].recipeId, prior[0].recipeId);
  assert.deepEqual(plan.dishes[0].ingredients, prior[0].ingredients);
  assert.equal(plan.dishes[0].householdBasis.servings, 4, 'the visible manual difference has an accurate new household basis');
});

test('E2 editing one dinner leaves other dishes and their original explanation bytes untouched', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  const unchanged = JSON.stringify(plan.dishes.slice(1));
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: plan.dishes.map((dish, index) => ({ date: dish.date,
    ...(index === 0 ? { title: 'Min syntetiske ret', ingredients: [{ name: 'kartofler', quantity: 500, unit: 'g' }], diet: 'vegan' } : {}) })) });
  assert.equal(JSON.stringify(plan.dishes.slice(1)), unchanged);
  assert.ok(plan.dishes[0].recipeId.startsWith('custom:'));
});

test('J4/B3 pure household lookup shares meal precedence and leaves unknown attendance unknown', async () => {
  const empty = resolveHouseholdAttendance({ configured: false, adults: null, children: [], days: {} }, '2026-11-05');
  assert.equal(empty.householdConfirmed, false); assert.equal(empty.adults, null); assert.equal(empty.servings, null);
  const { planner } = fixture();
  await planner.setHousehold({ adults: 1, adultPortion: 1.5, children: [], rhythm: {
    anchorMonday: '2026-11-02', weeks: [{ '4': { adults: 2, children: [{ age: 5 }] } }] } });
  await planner.setDay('2026-11-06', { adults: 2, children: [], guests: { adults: 1, children: [] }, occasion: 'holiday' });
  const household = planner.household(); const before = JSON.stringify(household);
  for (const date of ['2026-11-04', '2026-11-05', '2026-11-06'])
    assert.deepEqual(resolveHouseholdAttendance(household, date), planner.attendanceFor(date));
  assert.equal(JSON.stringify(household), before, 'lookup is pure and must not publish normalization or timestamps');
});
