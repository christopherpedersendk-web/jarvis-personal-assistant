import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner } from '../meal-planner.mjs';
import { ShoppingPlanner, productObservation } from '../shopping-planner.mjs';
import { observedMealPrices, estimateMealRequirements } from '../meal-price-observations.mjs';

const observedAt = '2026-11-05T08:00:00.000Z';
const profile = extra => ({ householdSize: 2, diet: 'omnivore', pantry: [], avoid: [], budgetDkk: null, ...extra });
const product = (id, name, price, unit = '500 g', extra = {}) =>
  ({ Id: id, Name: name, Price: price, Unit: unit, IsAvailable: true, ...extra });
function recorded(products, at = observedAt, id = 'synthetic-observation') {
  return { id, revision: 1, createdAt: at, priceCheckedAt: at,
    items: products.map((item, index) => ({ lineId: id + '-line-' + index, ingredient: item.Name.toLocaleLowerCase('da-DK'),
      unit: 'g', productId: item.Id, quantity: 1, excluded: false, candidates: [structuredClone(item)],
      productObservedAt: at, productObservations: { [item.Id]: productObservation(item, at) } })) };
}
const recipe = (id, ingredient, extra = {}) => ({ id, title: 'Syntetisk ' + id, diet: 'vegan', minutes: 25, servings: 2,
  ingredients: [{ name: ingredient, quantity: 250, unit: 'g' }], themes: ['party'],
  sourceRef: { kind: 'recipe', id, revision: 1 }, ...extra });
async function fixture({ recipes = [], products = [], budgetDkk = null } = {}) {
  const state = { shoppingDrafts: products.length ? [recorded(products)] : [] };
  let moment = '2026-11-05T09:00:00.000Z', saves = 0;
  const planner = new MealPlanner({ state, now: () => new Date(moment), save: async () => { saves++; }, recipes: () => recipes });
  await planner.setProfile(profile({ budgetDkk }));
  await planner.setHousehold({ adults: 2, children: [], rhythm: { anchorMonday: '2026-11-02',
    weeks: [{ '1': { adults: 2, children: [], theme: 'party' }, '2': { adults: 2, children: [], theme: 'party' },
      '3': { adults: 2, children: [], theme: 'party' }, '4': { adults: 2, children: [], theme: 'party' },
      '5': { adults: 2, children: [], theme: 'party' }, '6': { adults: 2, children: [], theme: 'party' },
      '7': { adults: 2, children: [], theme: 'party' } }] } });
  return { state, planner, saves: () => saves, setNow: value => { moment = value; } };
}
const rows = (plan, patches = {}) => plan.dishes.map((dish, index) => ({ date: dish.date, ...patches[index] }));

test('E1 known comparable prices influence equally suitable reviewed recipes; unknown prices are not zero', async () => {
  const f = await fixture({ recipes: [recipe('reviewed-expensive', 'quinoa'), recipe('reviewed-cheap', 'bulgur'), recipe('reviewed-unknown', 'amarant')],
    products: [product('1', 'Quinoa', 40), product('2', 'Bulgur', 10)] });
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 1 });
  assert.equal(plan.dishes[0].recipeId, 'reviewed-cheap');
  assert.equal(plan.priceEstimate.estimatedProductsDkk, 10); assert.equal(plan.priceStatus, 'known-observed-estimate');
  assert.equal(plan.priceEstimate.lines[0].source.id, 'synthetic-observation');
  assert.equal(plan.priceEstimate.lines[0].source.observedAt, observedAt);
  const unknown = estimateMealRequirements([{ name: 'amarant', quantity: 250, unit: 'g' }], observedMealPrices(f.state, new Date('2026-11-05T09:00:00Z')));
  assert.equal(unknown.estimatedProductsDkk, null); assert.equal(unknown.status, 'unknown-until-retailer-lookup');
  assert.equal(unknown.unknownIngredients.length, 1);
});

test('E1 a varied week reuses an explicitly priced package without treating package surplus as stock or consumption', async () => {
  const f = await fixture({ recipes: [recipe('rice-red', 'ris'), recipe('rice-green', 'ris')],
    products: [product('3', 'Ris', 20, '1 kg')] });
  const inventory = JSON.stringify(f.state.mealInventory);
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 2 });
  assert.equal(new Set(plan.dishes.map(dish => dish.recipeId)).size, 2);
  assert.equal(plan.priceEstimate.estimatedProductsDkk, 20);
  assert.equal(plan.priceEstimate.lines[0].packages, 1); assert.equal(plan.priceEstimate.lines[0].quantity, 500);
  assert.equal(plan.priceEstimate.lines[0].surplusQuantity, 500);
  assert.ok(plan.dishes[1].reasons.some(reason => reason.includes('råvaregenbrug')));
  assert.equal(JSON.stringify(f.state.mealInventory), inventory);
  assert.deepEqual(plan.shoppingList, []); assert.equal(f.state.nemligProposals, undefined);
});

test('E1 reuse is ingredient/unit-aware and breaks otherwise equal week choices without repeating the same recipe', async () => {
  const f = await fixture({ recipes: [recipe('first-favorite', 'ris', { favorite: true }), recipe('shared-ingredient', 'ris'), recipe('unrelated', 'amarant')] });
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 2 });
  assert.equal(plan.dishes[0].recipeId, 'first-favorite'); assert.equal(plan.dishes[1].recipeId, 'shared-ingredient');
  assert.equal(plan.priceEstimate.estimatedProductsDkk, null); assert.equal(plan.priceEstimate.budgetStatus, 'not-set');
});

test('E1 partial known cost never becomes a complete total or an unfounded within-budget result', async () => {
  const f = await fixture({ products: [product('4', 'Ris', 20)], budgetDkk: 50 });
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await f.planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: rows(plan, { 0: {
    title: 'Min risret med ukendt krydderi', diet: 'vegan',
    ingredients: [{ name: 'ris', quantity: 500, unit: 'g' }, { name: 'safran', quantity: 1, unit: 'g' }] } }) });
  assert.equal(plan.priceEstimate.knownProductsDkk, 20); assert.equal(plan.priceEstimate.estimatedProductsDkk, null);
  assert.equal(plan.priceEstimate.budgetStatus, 'unknown');
  f.state.shoppingDrafts = [recorded([product('4', 'Ris', 99)], '2026-11-05T08:30:00.000Z')];
  const before = JSON.stringify(f.state), writes = f.saves(), view = f.planner.plans()[0];
  assert.equal(view.priceEstimate.estimatedProductsDkk, null); assert.equal(view.priceEstimate.knownProductsDkk, 99);
  assert.equal(view.priceEstimate.budgetStatus, 'over', 'a known lower bound already exceeds the budget');
  assert.equal(view.pricingStale, true); assert.equal(view.needsReview, true);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.saves(), writes, 'read-only view never writes or replans');
});

test('E1 observed price expiry invalidates the derived estimate without rewriting manual choices', async () => {
  const f = await fixture({ recipes: [recipe('kept-price-choice', 'ris')], products: [product('5', 'Ris', 20)] });
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await f.planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: rows(plan, { 0: { locked: true, servings: 3.25 } }) });
  const dish = structuredClone(plan.dishes[0]), before = JSON.stringify(f.state), writes = f.saves();
  f.setNow('2026-11-07T09:00:00Z');
  const current = f.planner.plans()[0];
  assert.equal(current.priceEstimate.estimatedProductsDkk, null); assert.equal(current.pricingStale, true);
  assert.deepEqual(current.dishes[0], dish); assert.equal(JSON.stringify(f.state), before); assert.equal(f.saves(), writes);
});

test('G3/E1 price matching never invents a piece weight or equates cooked rice with raw rice or basil', () => {
  const state = { shoppingDrafts: [recorded([product('6', 'Ris', 10), product('7', 'Broccoli', 12, '500 g'),
    product('8', 'Frisk basilikum', 15), product('9', 'Ris kogt', 17)])] };
  const quotes = observedMealPrices(state, new Date('2026-11-05T09:00:00Z'));
  for (const requirement of [{ name: 'broccoli', quantity: 1, unit: 'stk' }, { name: 'rå ris', quantity: 500, unit: 'g' },
    { name: 'ris drænet', quantity: 200, unit: 'g' }]) {
    const estimate = estimateMealRequirements([requirement], quotes);
    assert.equal(estimate.estimatedProductsDkk, null); assert.equal(estimate.lines.length, 0);
  }
  const rice = estimateMealRequirements([{ name: 'rice', quantity: 500, unit: 'g' }], quotes);
  assert.equal(rice.estimatedProductsDkk, 10); assert.equal(rice.lines[0].source.productId, '6');
});

test('G3/E1 a vegan label or exact name cannot override the actual product ingredient conflict', () => {
  const contaminated = product('10', 'Ris', 9, '500 g', { Ingredients: 'Ris, æg og mælk', Labels: ['vegan'] });
  const quotes = observedMealPrices({ shoppingDrafts: [recorded([contaminated])] }, new Date('2026-11-05T09:00:00Z'));
  const estimate = estimateMealRequirements([{ name: 'ris', quantity: 500, unit: 'g' }], quotes, { diet: 'vegan', avoid: [] });
  assert.equal(estimate.estimatedProductsDkk, null); assert.equal(estimate.lines.length, 0);
});

test('E1 future, stale, unverifiable and un-timestamped legacy candidate data cannot manufacture a current price', () => {
  const clock = new Date('2026-11-05T09:00:00Z');
  const old = recorded([product('11', 'Ris', 20)], '2026-11-01T08:00:00Z');
  const future = recorded([product('12', 'Bulgur', 10)], '2026-11-06T08:00:00Z');
  const changed = recorded([product('13', 'Quinoa', 30)]); changed.items[0].candidates[0].Price = 1;
  const legacy = recorded([product('14', 'Amarant', 12)]); delete legacy.items[0].productObservations;
  assert.equal(observedMealPrices({ shoppingDrafts: [old, future, changed, legacy] }, clock).size, 0);
});

test('E1 a newer unavailable observation suppresses an older otherwise valid price across drafts', () => {
  const old = recorded([product('15', 'Ris', 20)], '2026-11-05T08:00:00Z', 'old');
  const unavailable = product('15', 'Ris', 20, '500 g', { IsAvailable: false });
  const current = recorded([unavailable], '2026-11-05T08:30:00Z', 'new');
  current.items[0].candidates = []; current.items[0].productId = '';
  const quotes = observedMealPrices({ shoppingDrafts: [current, old] }, new Date('2026-11-05T09:00:00Z'));
  assert.equal(quotes.size, 0);
});

test('E1 inventory is deducted once and existing reservations are not silently spent by a second week', async () => {
  const f = await fixture({ recipes: [recipe('rice-reservations', 'ris', { ingredients: [{ name: 'ris', quantity: 750, unit: 'g' }] })],
    products: [product('16', 'Ris', 20)] });
  await f.planner.setInventory({ expectedRevision: 1, items: [{ name: 'ris', quantity: 1000, unit: 'g', lastConfirmedAt: observedAt }] });
  const first = await f.planner.createPlan({ startDate: '2026-11-05', days: 1 });
  assert.equal(first.priceEstimate.estimatedProductsDkk, 0); assert.equal(first.priceStatus, 'no-extra-ingredients');
  await f.planner.buildShoppingList(first.id, { expectedRevision: first.revision });
  const second = await f.planner.createPlan({ startDate: '2026-11-06', days: 1 });
  assert.equal(second.priceEstimate.lines[0].quantity, 500); assert.equal(second.priceEstimate.estimatedProductsDkk, 20);
  assert.equal(f.planner.inventory().items[0].quantity, 1000, 'planning has not consumed or purchased stock');
});

test('E1/E2 regenerating suggestions preserves custom and explicitly selected dishes, locks, portions and manual extras', async () => {
  const f = await fixture({ recipes: [recipe('reviewed-owner-choice', 'ris')], products: [product('17', 'Ris', 20)] });
  const plan = await f.planner.createPlan({ startDate: '2026-11-05', days: 3 });
  await f.planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: rows(plan, {
    0: { title: 'Mit særlige måltid', ingredients: [{ name: 'ris', quantity: 600, unit: 'g' }], diet: 'vegan', servings: 3.25 },
    1: { recipeId: 'reviewed-owner-choice', locked: true },
  }) });
  await f.planner.buildShoppingList(plan.id, { expectedRevision: plan.revision });
  await f.planner.editShoppingList(plan.id, { expectedRevision: plan.revision, items: [...plan.shoppingList.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
    { name: 'kaffe', quantity: 1, unit: 'pakke' }] });
  const kept = structuredClone(plan.dishes.slice(0, 2)), extras = structuredClone(plan.manualShoppingExtras);
  await f.planner.regenerateUnlocked(plan.id, { expectedRevision: plan.revision });
  assert.deepEqual(plan.dishes.slice(0, 2), kept); assert.deepEqual(plan.manualShoppingExtras, extras);
  assert.ok(plan.priceEstimate.unknownIngredients.some(item => item.name === 'kaffe'));
});

async function shoppingFixture() {
  let moment = '2026-11-05T08:00:00.000Z', detail = null, failed = false;
  const rice = product('100', 'Ris', 20), alternative = product('101', 'Ris', 22);
  const plan = { id: 'price-plan', revision: 1, status: 'shopping_ready', budgetTargetDkk: 30,
    shoppingList: [{ name: 'ris', quantity: 500, unit: 'g' }], dishes: [] };
  const state = { mealPlans: [plan], mealProfile: profile() }, calls = [];
  const shopping = new ShoppingPlanner({ state, now: () => new Date(moment),
    meals: { getPlan: () => plan, profile: () => profile() },
    nemlig: {
      basket: async () => { calls.push('basket-read'); return { Lines: [] }; },
      search: async () => { calls.push('search-read'); return [structuredClone(rice), structuredClone(alternative)]; },
      details: async id => { calls.push('detail-read:' + id); if (failed) throw new Error('Syntetisk kilde utilgængelig'); return structuredClone(detail || rice); },
      propose: async () => { calls.push('local-proposal'); return { id: 'local-only', status: 'pending-owner-click' }; },
    } });
  const draft = await shopping.create(plan.id);
  return { state, shopping, draft, calls, setNow: value => { moment = value; }, setProduct: value => { detail = value; }, fail: () => { failed = true; } };
}

test('G4/E1 refreshing the selected product cannot renew an unread alternative candidate', async () => {
  const f = await shoppingFixture(), old = f.draft.items[0].productObservations['101'].observedAt;
  f.setNow('2026-11-06T10:00:00.000Z'); await f.shopping.propose(f.draft.id, { expectedRevision: f.draft.revision });
  const refreshed = f.shopping.get(f.draft.id);
  assert.equal(refreshed.items[0].productObservedAt, '2026-11-06T10:00:00.000Z');
  assert.equal(refreshed.items[0].productObservations['100'].observedAt, '2026-11-06T10:00:00.000Z');
  assert.equal(refreshed.items[0].productObservations['101'].observedAt, old);
  const quotes = observedMealPrices(f.state, new Date('2026-11-06T10:00:00.000Z'));
  assert.deepEqual(quotes.get('ris|g').map(quote => quote.source.productId), ['100']);
  assert.deepEqual(f.calls, ['basket-read', 'search-read', 'detail-read:100', 'local-proposal']);
});

test('R07/G4 price-only 20→99 under a 30 DKK budget changes the observed evidence and requires review with zero basket writes', async () => {
  const f = await shoppingFixture();
  f.setNow('2026-11-05T09:00:00.000Z'); f.setProduct(product('100', 'Ris', 99));
  await assert.rejects(f.shopping.propose(f.draft.id, { expectedRevision: 1 }), /opdateret/);
  const revised = f.shopping.get(f.draft.id);
  assert.equal(revised.estimatedProductsDkk, 99); assert.equal(revised.overBudget, true); assert.equal(revised.items[0].needsReview, true);
  assert.equal(revised.items[0].productObservations['100'].observedAt, '2026-11-05T09:00:00.000Z');
  assert.equal(revised.items[0].productObservations['101'].observedAt, observedAt);
  assert.equal(f.calls.includes('local-proposal'), false);
});

test('G4/E1 an unavailable detail result retains a fresh negative observation, not an older price resurrection', async () => {
  const f = await shoppingFixture();
  f.state.shoppingDrafts.push(recorded([product('100', 'Ris', 20)], '2026-11-05T07:00:00.000Z', 'older-draft'));
  f.setNow('2026-11-05T09:00:00.000Z'); f.setProduct(product('100', 'Ris', 20, '500 g', { IsAvailable: false }));
  await assert.rejects(f.shopping.propose(f.draft.id, { expectedRevision: 1 }), /konflikt/);
  const row = f.shopping.get(f.draft.id).items[0];
  assert.equal(row.productId, ''); assert.equal(row.productObservations['100'].available, false);
  const quotes = observedMealPrices(f.state, new Date('2026-11-05T09:00:00Z'));
  assert.equal((quotes.get('ris|g') || []).some(quote => quote.source.productId === '100'), false);
});

test('G4/E1 failed detail reads do not advance any product observation or claim no change', async () => {
  const f = await shoppingFixture(), before = structuredClone(f.shopping.get(f.draft.id));
  f.setNow('2026-11-05T09:00:00.000Z'); f.fail();
  await assert.rejects(f.shopping.propose(f.draft.id, { expectedRevision: 1 }), /utilgængelig/);
  assert.deepEqual(f.shopping.get(f.draft.id), before); assert.equal(f.calls.includes('local-proposal'), false);
});
