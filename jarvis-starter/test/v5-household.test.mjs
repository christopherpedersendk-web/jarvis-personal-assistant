import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner } from '../meal-planner.mjs';
import { ShoppingPlanner } from '../shopping-planner.mjs';
import { NemligShopping } from '../nemlig-connector.mjs';
import { RecipeMemory } from '../recipe-memory.mjs';

const now = () => new Date('2026-11-04T12:00:00Z');
const profile = changes => ({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null, ...changes });
function fixture() {
  const state = {}; let writes = 0;
  const planner = new MealPlanner({ state, now, save: async () => { writes++; } });
  return { planner, state, saves: () => writes };
}

test('R10 identical profile, household and day saves are no-ops; only affected dates become stale', async () => {
  const f = fixture();
  await f.planner.setHousehold({ adults: 2, children: [] });
  const a = await f.planner.createPlan({ startDate: '2026-11-05', days: 2 });
  const b = await f.planner.createPlan({ startDate: '2026-11-10', days: 2 });
  await f.planner.buildShoppingList(a.id, { expectedRevision: a.revision });
  await f.planner.buildShoppingList(b.id, { expectedRevision: b.revision });
  const revisions = [a.revision, b.revision, f.planner.household().revision];
  const before = f.saves();
  await f.planner.setHousehold({ adults: 2, children: [] });
  await f.planner.setProfile(profile());
  assert.equal(f.saves(), before);
  assert.deepEqual([a.revision, b.revision, f.planner.household().revision], revisions);
  await f.planner.setDay('2026-11-05', { adults: 1, children: [] });
  assert.equal(a.revision, revisions[0] + 1);
  assert.equal(b.revision, revisions[1]);
  const dayRevision = f.planner.household().revision;
  const persisted = f.saves();
  await f.planner.setDay('2026-11-05', { adults: 1, children: [] });
  assert.equal(f.planner.household().revision, dayRevision);
  assert.equal(f.saves(), persisted);
});

test('multiweek family rhythm resolves weekdays with date override then cycle then default', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [{ age: 8 }], rhythm: {
    anchorMonday: '2026-11-02', weeks: [
      { '1': { adults: 1, children: [], theme: 'quick' } },
      { '1': { adults: 0, children: [], skip: true } },
    ] } });
  assert.equal(planner.attendanceFor('2026-11-02').attendanceSource, 'recurring-rhythm');
  assert.equal(planner.attendanceFor('2026-11-02').servings, 1);
  assert.equal(planner.attendanceFor('2026-11-09').skip, true);
  assert.equal(planner.attendanceFor('2026-11-16').servings, 1);
  assert.equal(planner.attendanceFor('2026-11-10').attendanceSource, 'household-defaults');
  await planner.setDay('2026-11-09', { adults: 3, children: [], theme: 'party', skip: false });
  assert.equal(planner.attendanceFor('2026-11-09').attendanceSource, 'day-override');
  assert.equal(planner.attendanceFor('2026-11-09').servings, 3);
  await planner.removeDay('2026-11-09');
  assert.equal(planner.attendanceFor('2026-11-09').skip, true);
  await assert.rejects(planner.setHousehold({ adults: 2, children: [], rhythm: { anchorMonday: '2026-11-03', weeks: [{}] } }), /mandag/);
});

test('R08 hard avoid terms match whole ingredient words and known synonyms, not word fragments', async () => {
  const { planner } = fixture();
  await planner.setProfile(profile({ avoid: ['ris'] }));
  assert.ok(planner.recipes().some(recipe => recipe.ingredients.some(item => item.name === 'ris')));
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  assert.ok(plan.dishes.every(dish => dish.ingredients.every(item => item.name !== 'ris')));
  await planner.setProfile(profile({ avoid: ['tomat'] }));
  const other = await planner.createPlan({ startDate: '2026-11-15', days: 2 });
  assert.ok(other.dishes.every(dish => dish.ingredients.every(item => !/tomat/u.test(item.name))));
  const unsafe = { id: 'mislabelled', title: 'Angiveligt vegansk', diet: 'vegan', minutes: 5, servings: 2,
    ingredients: [{ name: 'vegansk ost med æg', quantity: 100, unit: 'g' }] };
  const separate = new MealPlanner({ state: {}, now, recipes: () => [unsafe] });
  await separate.setProfile(profile({ diet: 'vegan' }));
  const safePlan = await separate.createPlan({ startDate: '2026-11-21', days: 1 });
  assert.notEqual(safePlan.dishes[0].recipeId, unsafe.id, 'a vegan marker must not hide actual incompatible ingredients');
});

test('locked dishes remain unchanged when unlocked days regenerate and manual extras survive recalculation', async () => {
  const { planner } = fixture();
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  await planner.updatePlan(plan.id, { expectedRevision: 1, dishes: plan.dishes.map((dish, index) => ({ date: dish.date, locked: index === 0 })) });
  const locked = structuredClone(plan.dishes[0]);
  await planner.regenerateUnlocked(plan.id, { expectedRevision: 2 });
  assert.deepEqual(plan.dishes[0], locked);
  await planner.buildShoppingList(plan.id, { expectedRevision: 3 });
  await planner.editShoppingList(plan.id, { expectedRevision: 4, items: [...plan.shoppingList.map(item => ({ name: item.name, quantity: item.quantity, unit: item.unit })), { name: 'kaffe', quantity: 1, unit: 'pakke' }] });
  await planner.buildShoppingList(plan.id, { expectedRevision: 5 });
  assert.ok(plan.shoppingList.some(item => item.name === 'kaffe' && item.quantity === 1));
  assert.ok(plan.manualShoppingExtras.some(item => item.name === 'kaffe'));
});

test('swapping meals retains destination portions and refuses locked days', async () => {
  const { planner } = fixture();
  await planner.setHousehold({ adults: 2, children: [] });
  await planner.setDay('2026-11-06', { adults: 1, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  const before = structuredClone(plan.dishes);
  await planner.swapDishes(plan.id, { expectedRevision: 1, firstDate: before[0].date, secondDate: before[1].date });
  assert.equal(plan.dishes[0].recipeId, before[1].recipeId);
  assert.equal(plan.dishes[1].recipeId, before[0].recipeId);
  assert.equal(plan.dishes[0].servings, 2);
  assert.equal(plan.dishes[1].servings, 1);
  assert.equal(plan.dishes[1].ingredients[0].quantity,
    Math.round(before[0].ingredientBasis[0].quantity / before[0].baseServings * 1000) / 1000);
  await planner.updatePlan(plan.id, { expectedRevision: 2, dishes: plan.dishes.map((dish, index) => ({ date: dish.date, locked: index === 0 })) });
  await assert.rejects(planner.swapDishes(plan.id, { expectedRevision: 3, firstDate: before[0].date, secondDate: before[1].date }), /Lås/);
});

test('R07 price-only detail refresh updates amount, budget flag and review without basket writes', async () => {
  const plan = { id: 'synthetic-plan', revision: 1, status: 'shopping_ready', budgetTargetDkk: 30,
    shoppingList: [{ name: 'ris', quantity: 500, unit: 'g' }], dishes: [] };
  const state = { mealPlans: [plan], mealProfile: profile() };
  const calls = [];
  const product = { Id: '123', Name: 'Ris', Unit: '500 g', Price: 20, IsAvailable: true };
  const nemlig = new NemligShopping({ state, now, callTool: async (name) => {
    calls.push(name);
    if (name === 'get_basket') return { Lines: [] };
    if (name === 'search_products') return [product];
    if (name === 'get_product_details') return { ...product, Price: 99 };
    if (name === 'set_basket_quantities') throw new Error('Testen tillader ingen kurvskrivning.');
  } });
  const shopping = new ShoppingPlanner({ state, now, nemlig, meals: { getPlan: () => plan, profile: () => profile() } });
  const draft = await shopping.create(plan.id);
  assert.equal(draft.estimatedProductsDkk, 20);
  assert.equal(draft.overBudget, false);
  await assert.rejects(shopping.propose(draft.id, { expectedRevision: draft.revision }), /opdateret/);
  const refreshed = shopping.get(draft.id);
  assert.equal(refreshed.estimatedProductsDkk, 99);
  assert.equal(refreshed.overBudget, true);
  assert.equal(refreshed.items[0].needsReview, true);
  assert.ok(refreshed.priceCheckedAt);
  assert.equal(calls.includes('set_basket_quantities'), false);
});

test('reviewed recipe instructions and explicit favorite/do-not-suggest feedback remain available', async () => {
  const state = {};
  const recipes = new RecipeMemory({ state, now });
  const captured = await recipes.capture({ text: 'Grøn gryde' });
  assert.equal(captured.processingStatus, 'review_required');
  const confirmed = await recipes.update(captured.id, { expectedRevision: 1, confirmed: true,
    title: 'Grøn gryde', diet: 'vegan', minutes: 30, servings: 2,
    ingredients: [{ name: 'kikærter', quantity: 400, unit: 'g' }],
    instructions: 'Kog kikærterne og servér.' });
  assert.equal(confirmed.processingStatus, 'ready');
  await recipes.update(captured.id, { expectedRevision: 2, favorite: true, doNotSuggest: true });
  assert.equal(recipes.get(captured.id).confirmed, true, 'feedback must not silently unconfirm reviewed content');
  assert.equal(recipes.usable()[0].doNotSuggest, true);
  assert.equal(recipes.usable()[0].favorite, true);
  assert.equal(recipes.instructions(captured.id).instructions, 'Kog kikærterne og servér.');
  const planner = new MealPlanner({ state: {}, now, recipes: () => recipes.usable() });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  assert.ok(plan.dishes.every(dish => dish.recipeId !== captured.id));
});

test('confirmed inventory is reserved once across active plans; expired entries are not deducted', async () => {
  const f = fixture();
  await f.planner.setInventory({ expectedRevision: 1, items: [
    { name: 'ris', quantity: 500, unit: 'g', lastConfirmedAt: '2026-11-01T10:00:00Z' },
    { name: 'mælk', quantity: 1, unit: 'l', lastConfirmedAt: '2026-11-01T10:00:00Z', expiresAt: '2026-11-03' },
  ] });
  f.state.mealPlans = [
    { id: 'reserved', status: 'shopping_ready', dishes: [{ skip: false, diet: 'omnivore', theme: 'everyday',
      ingredients: [{ name: 'ris', quantity: 400, unit: 'g' }] }] },
    { id: 'second', revision: 1, status: 'draft', dishes: [{ skip: false, diet: 'omnivore', theme: 'everyday',
      ingredients: [{ name: 'ris', quantity: 300, unit: 'g' }, { name: 'mælk', quantity: 500, unit: 'ml' }] }] },
  ];
  const inventory = f.planner.inventory();
  assert.equal(inventory.items.find(item => item.name === 'ris').reservedQuantity, 400);
  assert.equal(inventory.items.find(item => item.name === 'ris').availableQuantity, 100);
  assert.equal(inventory.items.find(item => item.name === 'mælk').availableQuantity, 0);
  assert.equal(inventory.items.find(item => item.name === 'mælk').expired, true);
  const second = await f.planner.buildShoppingList('second', { expectedRevision: 1 });
  assert.equal(second.shoppingList.find(item => item.name === 'ris').pantryUsed, 100);
  assert.equal(second.shoppingList.find(item => item.name === 'ris').quantity, 200);
  assert.equal(second.shoppingList.find(item => item.name === 'mælk').quantity, 500);
  assert.equal(f.state.mealInventory.items.find(item => item.name === 'ris').quantity, 500,
    'preparing a plan must not silently consume registered stock');
});
