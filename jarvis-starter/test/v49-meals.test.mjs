import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner, MEAL_THEMES } from '../meal-planner.mjs';

const now = () => new Date('2026-11-04T10:00:00Z');
const profile = changes => ({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null, ...changes });
const fixture = extras => { const state = {}; const planner = new MealPlanner({ state, now, ...extras }); return { state, planner }; };
const rows = (plan, changes = {}) => plan.dishes.map((dish, index) => ({ date: dish.date, ...(changes[index] || {}) }));

test('v4.9 creates draft-only plans without inventing household counts from calendar', async () => {
  const { planner } = fixture();
  assert.equal(planner.household().configured, false);
  assert.equal(planner.household().adults, null);
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3, calendarBusyDates: ['2026-11-05'] });
  assert.equal(plan.status, 'draft');
  assert.equal(plan.revision, 1);
  assert.deepEqual(plan.shoppingList, []);
  assert.equal(plan.shoppingGeneratedAt, null);
  assert.equal(plan.dishes[0].adults, null);
  assert.equal(plan.dishes[0].householdConfirmed, false);
  assert.equal(plan.dishes[0].busyDay, true);
  assert.ok(plan.dishes[0].reasons.some(reason => reason.includes('ikke bekræftet')));
  assert.equal(new Set(plan.dishes.map(dish => dish.recipeId)).size, 3);
  const explicit = await planner.buildShoppingList(plan.id, { expectedRevision: 1 });
  assert.equal(explicit.status, 'shopping_ready');
  assert.equal(explicit.revision, 2);
  assert.equal(explicit.shoppingRevision, 2);
  assert.ok(explicit.shoppingList.length > 0);
});

test('per-date adults, child ages and editable portion estimates shape servings and themes', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [{ age: 4 }, { age: 10 }] });
  assert.deepEqual(planner.household().children, [{ age: 4, portion: 0.5 }, { age: 10, portion: 0.75 }]);
  await planner.setDay('2026-11-06', { adults: 1, children: [{ age: 17, portion: 1.25 }], theme: 'vegan' });
  await planner.setDay('2026-11-07', { adults: 0, children: [], theme: 'party' });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  assert.equal(plan.dishes[0].servings, 3.25);
  assert.equal(plan.dishes[0].adults, 2);
  assert.equal(plan.dishes[1].servings, 2.25);
  assert.equal(plan.dishes[1].theme, 'vegan');
  assert.equal(plan.dishes[1].diet, 'vegan');
  assert.equal(plan.dishes[1].attendanceSource, 'day-override');
  assert.equal(plan.dishes[2].skip, true);
  assert.deepEqual(plan.dishes[2].ingredients, []);
  assert.equal(plan.dishes[2].servings, 0);
  assert.equal(plan.servings, null, 'different per-day portions must not be presented as one household count');
});

test('household validates ages, counts, portions, dates and theme keys', async () => {
  const { planner } = fixture();
  assert.ok(MEAL_THEMES.includes('date'));
  await assert.rejects(planner.setHousehold({ adults: -1, children: [] }), /voksne/);
  await assert.rejects(planner.setHousehold({ adults: 25, children: [] }), /voksne/);
  await assert.rejects(planner.setHousehold({ adults: 2, children: [{ age: 18 }] }), /alder/);
  await assert.rejects(planner.setHousehold({ adults: 2, children: [{ age: 3, portion: 0 }] }), /Portionsfaktor/);
  await assert.rejects(planner.setHousehold({ adults: 24, children: [{ age: 4 }] }), /24 personer/);
  await assert.rejects(planner.setDay('2027-02-30', { adults: 2, children: [] }), /dato/);
  await assert.rejects(planner.setDay('2026-11-05', { theme: 'date' }), /voksne/);
  await assert.rejects(planner.setDay('2026-11-05', { adults: 2, children: [], theme: '__proto__' }), /tema/);
  await assert.rejects(planner.setDay('2026-11-05', { adults: 2, children: [], skip: 'false' }), /sand eller falsk/);
  assert.equal(planner.household().configured, false, 'rejected data must not partially change state');
});

test('global diet and avoid list remain hard constraints even for a party or child-friendly theme', async () => {
  const { planner } = fixture();
  await planner.setProfile(profile({ diet: 'vegan', avoid: ['tomat'] }));
  await planner.setHousehold({ adults: 2, children: [{ age: 7 }] });
  await planner.setDay('2026-11-05', { theme: 'party' });
  await planner.setDay('2026-11-06', { theme: 'child_friendly' });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  for (const dish of plan.dishes) {
    assert.equal(dish.diet, 'vegan');
    assert.equal(dish.ingredients.some(item => item.name.toLowerCase().includes('tomat')), false);
  }
  const revision = plan.revision;
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: revision,
    dishes: rows(plan, { 0: { recipeId: 'chicken-rice' } }) }), /kostvalg/);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: revision,
    dishes: rows(plan, { 0: { diet: 'vegan', ingredients: [{ name: 'kyllingebryst', quantity: 300, unit: 'g' }] } }) }), /kostvalg/);
  assert.equal(plan.revision, revision);
});

test('remembered, reviewed recipes are usable with source IDs but malformed inbox data cannot become recipes', async () => {
  const remembered = { id: 'recipe-1', title: 'Gemte kikærter', diet: 'vegan', minutes: 12, servings: 2,
    ingredients: [{ name: 'kikærter', quantity: 400, unit: 'g' }], themes: ['date'],
    sourceRef: { kind: 'recipe', id: 'recipe-1', revision: 3 } };
  const { planner } = fixture({ recipes: () => [remembered, { id: 'raw-photo', title: 'Ikke udtrukket' }] });
  await planner.setHousehold({ adults: 2, children: [] });
  await planner.setDay('2026-11-05', { theme: 'date' });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  assert.equal(planner.recipes().some(recipe => recipe.id === 'raw-photo'), false);
  assert.equal(plan.dishes[0].recipeId, 'recipe-1');
  assert.deepEqual(plan.dishes[0].sourceRefs[0], remembered.sourceRef);
  assert.ok(plan.dishes[0].reasons.some(reason => reason.includes('opskriftshukommelse')));
});

test('editing recipes and portions recalculates from a fixed basis without repeated rounding drift', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, { 0: { recipeId: 'tomato-pasta', servings: 3.25 } }) });
  const pasta = plan.dishes[0].ingredients.find(item => item.name === 'pasta');
  assert.equal(pasta.quantity, 325);
  await planner.updatePlan(plan.id, { expectedRevision: 2, dishes: rows(plan, { 0: { servings: 2 } }) });
  assert.equal(plan.dishes[0].ingredients.find(item => item.name === 'pasta').quantity, 200);
  await planner.updatePlan(plan.id, { expectedRevision: 3, dishes: rows(plan, { 0: { ingredients: [{ name: 'pasta', quantity: 500, unit: 'g' }] } }) });
  await planner.updatePlan(plan.id, { expectedRevision: 4, dishes: rows(plan, { 0: { servings: 4 } }) });
  assert.equal(plan.dishes[0].ingredients[0].quantity, 1000);
  await planner.updatePlan(plan.id, { expectedRevision: 5, dishes: rows(plan, { 0: { servings: 2 } }) });
  assert.equal(plan.dishes[0].ingredients[0].quantity, 500);
});

test('shopping aggregation converts compatible units and subtracts pantry only once for the whole plan', async () => {
  const { planner } = fixture();
  await planner.setProfile(profile({ pantry: [{ name: 'RIS', quantity: 0.25, unit: 'kg' }, { name: 'ris', quantity: 250, unit: 'g' },
    { name: 'kokosmælk', quantity: 0.2, unit: 'l' }] }));
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, {
    0: { diet: 'vegan', ingredients: [{ name: 'ris', quantity: 1, unit: 'kg' }, { name: 'kokosmælk', quantity: 400, unit: 'ml' }] },
    1: { diet: 'vegan', ingredients: [{ name: 'ris', quantity: 500, unit: 'g' }, { name: 'kokosmælk', quantity: 2, unit: 'dl' }] },
  }) });
  await planner.buildShoppingList(plan.id, { expectedRevision: 2 });
  assert.deepEqual(plan.shoppingList.find(item => item.name === 'ris'), { name: 'ris', unit: 'g', quantity: 1000, requiredQuantity: 1500, pantryUsed: 500 });
  assert.deepEqual(plan.shoppingList.find(item => item.name === 'kokosmælk'), { name: 'kokosmælk', unit: 'ml', quantity: 400, requiredQuantity: 600, pantryUsed: 200 });
  assert.equal(plan.priceStatus, 'unknown-until-retailer-lookup');
});

test('editing a reviewed plan invalidates its generated list and stale revisions never overwrite newer changes', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  await planner.buildShoppingList(plan.id, { expectedRevision: 1 });
  await planner.updatePlan(plan.id, { expectedRevision: 2, dishes: rows(plan, { 1: { skip: true } }) });
  assert.equal(plan.revision, 3);
  assert.equal(plan.status, 'draft');
  assert.deepEqual(plan.shoppingList, []);
  assert.equal(plan.shoppingGeneratedAt, null);
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 2 }), /revision/);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: 2, dishes: rows(plan) }), /revision/);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: 3, dishes: [{ date: plan.dishes[0].date }, { date: plan.dishes[0].date }] }), /datoer/);
  assert.equal(plan.revision, 3);
});

test('household changes invalidate only relevant plans and explicit refresh rescales existing meals', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  const later = await planner.createPlan({ startDate: '2026-11-10', days: 1 });
  await planner.buildShoppingList(plan.id, { expectedRevision: 1 });
  const original = cloneIngredients(plan.dishes[0].ingredients);
  await planner.setDay('2026-11-05', { adults: 4, children: [] });
  assert.equal(plan.householdStale, true);
  assert.equal(later.revision, 1);
  assert.equal(plan.dishes[0].servings, 2, 'old reviewed portions must not silently change');
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 3 }), /grundlag/);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: 3, dishes: rows(plan) }), /Husstanden/);
  await planner.updatePlan(plan.id, { expectedRevision: 3, refreshHousehold: true });
  assert.equal(plan.dishes[0].servings, 4);
  assert.equal(plan.householdStale, false);
  assert.deepEqual(plan.dishes[0].ingredients, original.map(item => ({ ...item, quantity: item.quantity * 2 })));
  await planner.buildShoppingList(plan.id, { expectedRevision: 4 });
  assert.equal(plan.status, 'shopping_ready');
});

function cloneIngredients(ingredients) { return ingredients.map(item => ({ ...item })); }

test('profile changes invalidate lists and require checking updated constraints before rebuilding', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, { 0: { recipeId: 'chicken-rice' } }) });
  await planner.buildShoppingList(plan.id, { expectedRevision: 2 });
  await planner.setProfile(profile({ diet: 'vegan' }));
  assert.equal(plan.profileStale, true);
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 4 }), /grundlag/);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: 4, dishes: rows(plan) }), /kostvalg/);
  await planner.updatePlan(plan.id, { expectedRevision: 4, dishes: rows(plan, { 0: { recipeId: 'bean-chili' } }) });
  assert.equal(plan.profileStale, false);
  await planner.buildShoppingList(plan.id, { expectedRevision: 5 });
  assert.equal(plan.status, 'shopping_ready');
});

test('shopping lists are editable with revision checks and reject duplicate canonical units', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await assert.rejects(planner.editShoppingList(plan.id, { expectedRevision: 1, items: [] }), /Opret/);
  await planner.buildShoppingList(plan.id, { expectedRevision: 1 });
  await assert.rejects(planner.editShoppingList(plan.id, { expectedRevision: 2, items: [
    { name: 'ris', quantity: 1, unit: 'kg' }, { name: 'RIS', quantity: 200, unit: 'g' },
  ] }), /én gang/);
  await planner.editShoppingList(plan.id, { expectedRevision: 2, items: [{ name: 'ris', quantity: 0.5, unit: 'kg' }] });
  assert.deepEqual(plan.shoppingList, [{ name: 'ris', quantity: 500, unit: 'g', manuallyEdited: true }]);
  assert.equal(plan.revision, 3);
  assert.equal(plan.shoppingRevision, 3);
});

test('legacy meal drafts retain their old list as history but require a new explicit list generation', async () => {
  const old = { id: 'legacy-plan', startDate: '2026-11-05', days: 1, servings: 2, status: 'draft',
    dishes: [{ date: '2026-11-05', recipeId: 'bean-chili', title: 'Chili', minutes: 35, servings: 2,
      ingredients: [{ name: 'ris', quantity: 160, unit: 'g' }] }], shoppingList: [{ name: 'ris', quantity: 160, unit: 'g' }] };
  const state = { mealPlans: [old] };
  const planner = new MealPlanner({ state, now });
  assert.deepEqual(old.legacyShoppingList, [{ name: 'ris', quantity: 160, unit: 'g' }]);
  assert.deepEqual(old.shoppingList, []);
  assert.equal(old.dishes[0].adults, null);
  assert.equal(old.revision, 1);
  await planner.buildShoppingList(old.id, { expectedRevision: 1 });
  assert.equal(old.status, 'shopping_ready');
});

test('local dates and day increments survive midnight and DST without inventing calendar occupancy', async () => {
  const { planner } = fixture({ now: () => new Date('2026-11-03T23:30:00Z') });
  const local = await planner.createPlan({ days: 1 });
  assert.equal(local.startDate, '2026-11-04');
  const dst = await planner.createPlan({ startDate: '2026-10-24', days: 3 });
  assert.deepEqual(dst.dishes.map(dish => dish.date), ['2026-10-24', '2026-10-25', '2026-10-26']);
  await assert.rejects(planner.createPlan({ startDate: '2026-11-05', days: 1, calendarBusyDates: ['2026-02-30'] }), /dato/);
});

test('archived or changed remembered recipes cannot silently generate a current shopping list', async () => {
  let recipes = [{ id: 'saved-1', title: 'Min risret', diet: 'vegan', minutes: 5, servings: 2,
    ingredients: [{ name: 'ris', quantity: 160, unit: 'g' }], themes: ['quick'],
    sourceRef: { kind: 'recipe', id: 'saved-1', revision: 1 } }];
  const { planner } = fixture({ recipes: () => recipes });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1, calendarBusyDates: ['2026-11-05'] });
  assert.equal(plan.dishes[0].recipeId, 'saved-1');
  recipes = recipes.map(recipe => ({ ...recipe, sourceRef: { ...recipe.sourceRef, revision: 2 } }));
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 1 }), /opskrift er ændret/);
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, { 0: { recipeId: 'saved-1' } }) });
  assert.equal(plan.dishes[0].sourceRefs[0].revision, 2);
  recipes = [];
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 2 }), /opskrift er ændret/);
});

test('explicit source invalidation revises affected plans before a cart can use an old list', async () => {
  const recipe = { id: 'saved-source', title: 'Gemte ris', diet: 'vegan', minutes: 5, servings: 2,
    ingredients: [{ name: 'ris', quantity: 160, unit: 'g' }], themes: [], sourceRef: { kind: 'recipe', id: 'saved-source', revision: 1 } };
  const { planner } = fixture({ recipes: () => [recipe] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1, calendarBusyDates: ['2026-11-05'] });
  await planner.buildShoppingList(plan.id, { expectedRevision: 1 });
  const result = await planner.invalidateRecipe('saved-source');
  assert.equal(result.changed, true);
  assert.equal(plan.revision, 3);
  assert.equal(plan.recipeStale, true);
  assert.equal(plan.status, 'draft');
  assert.deepEqual(plan.shoppingList, []);
  await assert.rejects(planner.buildShoppingList(plan.id, { expectedRevision: 3 }), /grundlag/);
});

test('refreshing a newly occupied day suggests a recipe but remains a reviewable draft', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 0, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  assert.equal(plan.dishes[0].recipeId, null);
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, { 0: { recipeId: null, skip: true } }) });
  await planner.setDay('2026-11-05', { adults: 2, children: [], skip: false });
  await planner.updatePlan(plan.id, { expectedRevision: 3, refreshHousehold: true });
  assert.equal(plan.dishes[0].servings, 2);
  assert.ok(plan.dishes[0].recipeId);
  assert.ok(plan.dishes[0].ingredients.length);
  assert.equal(plan.status, 'draft');
  assert.deepEqual(plan.shoppingList, []);
});

test('confirmed long-cook recipes share the 720-minute limit with the recipe library', async () => {
  const { planner } = fixture({ recipes: () => [{ id: 'slow-cook', title: 'Langtidsbagte bønner', diet: 'vegan', minutes: 660, servings: 4,
    ingredients: [{ name: 'bønner', quantity: 800, unit: 'g' }], themes: ['party'],
    sourceRef: { kind: 'recipe', id: 'slow-cook', revision: 1 } }] });
  assert.equal(planner.recipes().find(recipe => recipe.id === 'slow-cook')?.minutes, 660);
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: rows(plan, { 0: { recipeId: 'slow-cook', minutes: 720 } }) });
  assert.equal(plan.dishes[0].minutes, 720);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: 2, dishes: rows(plan, { 0: { minutes: 721 } }) }), /tilberedningstid/);
});
