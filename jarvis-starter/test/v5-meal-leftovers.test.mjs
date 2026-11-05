import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner } from '../meal-planner.mjs';
import { productObservation } from '../shopping-planner.mjs';

const profile = { householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: 50 };
const recipe = (id, name = 'ris', extra = {}) => ({ id, title: 'Syntetisk ' + id, minutes: 25, diet: 'vegan', servings: 2,
  ingredients: [{ name, quantity: 250, unit: 'g' }], themes: ['party'],
  sourceRef: { kind: 'recipe', id, revision: 1 }, ...extra });
async function fixture(days = 4) {
  const recipes = [recipe('source-rice'), recipe('target-bulgur', 'bulgur')], state = {}; let saves = 0;
  const planner = new MealPlanner({ state, now: () => new Date('2026-11-05T09:00:00Z'),
    save: async () => { saves++; }, recipes: () => recipes });
  await planner.setProfile(profile); await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: plan.dishes.map((dish, index) =>
    ({ date: dish.date, recipeId: index ? 'target-bulgur' : 'source-rice' })) });
  return { planner, plan, state, recipes, saves: () => saves };
}
const link = (f, from = 0, to = 1, extra = {}) => ({ fromDate: f.plan.dishes[from].date,
  toDate: f.plan.dishes[to].date, servings: f.plan.dishes[to].servings, minutes: 12, ...extra });
const apply = (f, links) => f.planner.setPlannedLeftovers(f.plan.id, { expectedRevision: f.plan.revision, links });
const edits = (f, index, patch) => ({ expectedRevision: f.plan.revision,
  dishes: f.plan.dishes.map((dish, i) => ({ date: dish.date, ...(i === index ? patch : {}) })) });

test('E1 explicit planned leftovers count extra cooking on the source day and zero new ingredients on the target; no stock or consumption is created', async () => {
  const f = await fixture(2), original = structuredClone(f.plan.dishes), inventory = structuredClone(f.state.mealInventory);
  assert.equal(f.plan.plannedLeftovers, undefined, 'similar recipes alone never infer actual or planned leftovers');
  await apply(f, [link(f)]);
  assert.equal(f.plan.dishes[0].plannedCookServings, 4);
  assert.deepEqual(f.plan.dishes[0].ingredients, [{ name: 'ris', quantity: 500, unit: 'g' }]);
  assert.equal(f.plan.dishes[1].leftoverFromDate, original[0].date);
  assert.equal(f.plan.dishes[1].minutes, 12); assert.deepEqual(f.plan.dishes[1].ingredients, []);
  const source = f.plan.dishes[1].sourceRefs.find(ref => ref.kind === 'meal-plan');
  assert.equal(source.id, f.plan.id); assert.equal(source.date, original[0].date);
  assert.match(source.dishFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(f.plan.dishes[1].reasons.some(reason => reason.includes('ikke bevis på tilberedning')));
  await f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision });
  assert.equal(f.plan.shoppingList.length, 1); assert.equal(f.plan.shoppingList[0].quantity, 500);
  assert.deepEqual(f.state.mealInventory, inventory); assert.equal(f.state.nemligProposals, undefined);
  assert.equal(f.state.completedActions, undefined); assert.equal(f.state.calendarEvents, undefined);
});

test('E1 removing planned leftovers restores both original manual meals and exact ingredient snapshots, while retaining current locks and extras', async () => {
  const f = await fixture(3);
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { title: 'Min egen bulgurret', ingredients: [{ name: 'bulgur', quantity: 333.333, unit: 'g' }] }));
  const original = structuredClone(f.plan.dishes);
  await f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision });
  await f.planner.editShoppingList(f.plan.id, { expectedRevision: f.plan.revision,
    items: [...f.plan.shoppingList, { name: 'kaffe', quantity: 1, unit: 'pakke' }] });
  const extras = structuredClone(f.plan.manualShoppingExtras);
  await apply(f, [link(f)]);
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { locked: true }));
  await apply(f, []);
  assert.deepEqual(f.plan.dishes[0], original[0]);
  assert.deepEqual(f.plan.dishes[1], { ...original[1], locked: true });
  assert.deepEqual(f.plan.dishes[2], original[2]); assert.deepEqual(f.plan.manualShoppingExtras, extras);
  assert.equal(f.plan.status, 'draft'); assert.equal(f.plan.shoppingRevision, null); assert.deepEqual(f.plan.shoppingList, []);
  assert.equal(f.plan.needsReview, true); assert.deepEqual(f.plan.plannedLeftovers, []);
});

test('E1 leftover writes require the exact plan revision and identical normalized links are true no-ops', async () => {
  const f = await fixture(), links = [link(f, 0, 2), link(f, 0, 1)], oldRevision = f.plan.revision;
  await apply(f, links); const saved = structuredClone(f.plan), count = f.saves();
  await apply(f, links.toReversed()); assert.deepEqual(f.plan, saved); assert.equal(f.saves(), count);
  await assert.rejects(f.planner.setPlannedLeftovers(f.plan.id, { expectedRevision: oldRevision, links }), /revision/);
  await assert.rejects(f.planner.setPlannedLeftovers(f.plan.id, { links }), /revision/);
  assert.deepEqual(f.plan, saved); assert.equal(f.saves(), count);
});

test('E1 incomplete, backward, out-of-week, duplicate, chained or partial-meal links reject without publishing a partial plan', async () => {
  const f = await fixture();
  for (const links of [undefined, {}, [null], [link(f, 1, 0)], [link(f, 0, 0)],
    [link(f, 0, 1, { toDate: '2026-11-20' })], [link(f), link(f, 2, 1)], [link(f), link(f, 1, 2)],
    [link(f, 0, 1, { servings: 1 })], [link(f, 0, 1, { servings: '2' })],
    [link(f, 0, 1, { servings: Number.NaN })], [link(f, 0, 1, { minutes: undefined })],
    [link(f, 0, 1, { minutes: 0 })], [link(f, 0, 1, { minutes: 12.5 })],
    [link(f, 0, 1, { minutes: 721 })], Array.from({ length: 7 }, () => link(f))]) {
    const before = structuredClone(f.state), count = f.saves();
    await assert.rejects(apply(f, links)); assert.deepEqual(f.state, before); assert.equal(f.saves(), count);
  }
});

test('E1 explicit skipped days and locked target choices cannot be replaced by a new leftover link', async () => {
  const f = await fixture();
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { locked: true }));
  const locked = structuredClone(f.plan); await assert.rejects(apply(f, [link(f)]), /Lås måldagen op/); assert.deepEqual(f.plan, locked);
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { locked: false, skip: true }));
  const skipped = structuredClone(f.plan); await assert.rejects(apply(f, [link(f, 0, 1, { servings: 2 })]), /Begge dage/); assert.deepEqual(f.plan, skipped);
});

test('E1 the source ingredient content must satisfy a stricter target diet even if the source recipe claims vegan', async () => {
  const f = await fixture(2);
  const original = structuredClone(f.plan);
  await assert.rejects(f.planner.updatePlan(f.plan.id, edits(f, 0, { title: 'Kylling mærket forkert', diet: 'vegan',
    ingredients: [{ name: 'kyllingebryst', quantity: 350, unit: 'g' }] })), /kostvalg/);
  assert.deepEqual(f.plan, original, 'the shared label/ingredient rule now rejects the bad new edit even before linking');
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { theme: 'vegan' }));
  // Retain the original link-time regression for a synthetic old saved record
  // that predates the stricter input check; no real user incident is implied.
  Object.assign(f.plan.dishes[0], { title: 'Kylling mærket forkert', diet: 'vegan',
    ingredients: [{ name: 'kyllingebryst', quantity: 350, unit: 'g' }],
    ingredientBasis: [{ name: 'kyllingebryst', quantity: 350, unit: 'g' }] });
  const before = structuredClone(f.plan); await assert.rejects(apply(f, [link(f)]), /kostvalg/); assert.deepEqual(f.plan, before);
});

test('E1 source servings are scaled once for multiple targets and the explicit cooking bound rejects over-allocation', async () => {
  const f = await fixture(3);
  await f.planner.updatePlan(f.plan.id, edits(f, 1, { servings: 1.25 }));
  await f.planner.updatePlan(f.plan.id, edits(f, 2, { servings: 3.5 }));
  await apply(f, [link(f, 0, 1), link(f, 0, 2)]);
  assert.equal(f.plan.dishes[0].plannedCookServings, 6.75); assert.equal(f.plan.dishes[0].ingredients[0].quantity, 843.75);
  await apply(f, [link(f, 0, 2)]); assert.equal(f.plan.dishes[0].ingredients[0].quantity, 687.5);
  assert.equal(f.plan.dishes[1].recipeId, 'target-bulgur');
  const huge = await fixture(3);
  for (const index of [0, 1, 2]) await huge.planner.updatePlan(huge.plan.id, edits(huge, index, { servings: 72 }));
  const before = structuredClone(huge.plan); await assert.rejects(apply(huge, [link(huge), link(huge, 0, 2)]), /144/);
  assert.deepEqual(huge.plan, before);
});

test('E1 unrelated edits and regeneration preserve both ends of a planned-leftover link and all manual extras', async () => {
  const f = await fixture(); await apply(f, [link(f)]);
  const linked = structuredClone(f.plan.dishes.slice(0, 2));
  await f.planner.updatePlan(f.plan.id, edits(f, 2, { title: 'Mit uafhængige måltid' }));
  assert.deepEqual(f.plan.dishes.slice(0, 2), linked);
  await f.planner.regenerateUnlocked(f.plan.id, { expectedRevision: f.plan.revision });
  assert.deepEqual(f.plan.dishes.slice(0, 2), linked); assert.equal(f.plan.dishes[2].title, 'Mit uafhængige måltid');
});

test('E1 linked meal, portions and attendance cannot be silently changed or moved; explicit unlink enables the change', async () => {
  const f = await fixture(); await apply(f, [link(f)]);
  for (const [index, patch] of [[0, { servings: 3 }], [1, { recipeId: 'target-bulgur' }], [1, { theme: 'quick' }],
    [0, { ingredients: [{ name: 'ris', quantity: 700, unit: 'g' }] }]]) {
    const before = structuredClone(f.plan); await assert.rejects(f.planner.updatePlan(f.plan.id, edits(f, index, patch)), /restefordeling/);
    assert.deepEqual(f.plan, before);
  }
  await assert.rejects(f.planner.swapDishes(f.plan.id, { expectedRevision: f.plan.revision,
    firstDate: f.plan.dishes[0].date, secondDate: f.plan.dishes[2].date }), /restefordeling/);
  await f.planner.setDay(f.plan.dishes[1].date, { adults: 3, children: [] });
  const stale = structuredClone(f.plan);
  await assert.rejects(f.planner.updatePlan(f.plan.id, { expectedRevision: f.plan.revision, refreshHousehold: true }), /restefordeling/);
  assert.deepEqual(f.plan, stale);
  await apply(f, []); assert.equal(f.plan.householdStale, true);
  await f.planner.updatePlan(f.plan.id, { expectedRevision: f.plan.revision, refreshHousehold: true });
  assert.equal(f.plan.dishes[1].servings, 3); assert.equal(f.plan.dishes[1].recipeId, 'target-bulgur');
});

test('E1 removing links retains an original now-archived recipe as a stale manual choice, never silently substitutes or loses it', async () => {
  const f = await fixture(2); const target = structuredClone(f.plan.dishes[1]);
  await apply(f, [link(f)]); f.recipes.splice(1, 1);
  await apply(f, []); assert.deepEqual(f.plan.dishes[1], target); assert.equal(f.plan.recipeStale, true);
  await assert.rejects(f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision }), /grundlag/);
});

test('E1 leftover pricing uses the extra source requirements once and never prices the restored target meal at the same time', async () => {
  const f = await fixture(2), rice = { Id: '501', Name: 'Ris', Price: 20, Unit: '500 g', IsAvailable: true }, observedAt = '2026-11-05T08:00:00Z';
  f.state.shoppingDrafts = [{ id: 'synthetic-price', revision: 1, items: [{ lineId: 'rice', ingredient: 'ris', candidates: [rice],
    productObservations: { '501': productObservation(rice, observedAt) } }] }];
  await apply(f, [link(f)]);
  assert.equal(f.plan.priceEstimate.estimatedProductsDkk, 20); assert.equal(f.plan.priceEstimate.lines.length, 1);
  assert.equal(f.plan.priceEstimate.lines[0].quantity, 500); assert.deepEqual(f.plan.priceEstimate.unknownIngredients, []);
  await apply(f, []); assert.equal(f.plan.priceEstimate.estimatedProductsDkk, null);
  assert.ok(f.plan.priceEstimate.unknownIngredients.some(item => item.name === 'bulgur'));
});
