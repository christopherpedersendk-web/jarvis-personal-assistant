import test from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingPlanner, productConstraints, productObservation } from '../shopping-planner.mjs';
import { ingredientConstraints, ingredientAmountKey } from '../food-identity.mjs';
import { MealPlanner } from '../meal-planner.mjs';
import { observedMealPrices, estimateMealRequirements } from '../meal-price-observations.mjs';

test('R08/G3 a shared ris/rice requirement retains the stricter relevant vegan diet before product selection', async () => {
  const plan = { id: 'synthetic-alias-diet', revision: 1, status: 'shopping_ready', shoppingList: [{ name: 'ris', quantity: 500, unit: 'g' }],
    dishes: [{ diet: 'omnivore', theme: 'everyday', ingredients: [{ name: 'ris', quantity: 250, unit: 'g' }] },
      { diet: 'vegan', theme: 'vegan', ingredients: [{ name: 'rice', quantity: 250, unit: 'g' }] }] };
  const profile = { diet: 'omnivore', avoid: [], pantry: [] }, state = { mealProfile: profile }; let reads = 0;
  const shopping = new ShoppingPlanner({ state, meals: { profile: () => profile, getPlan: () => plan }, nemlig: {
    basket: async () => { reads++; return { Lines: [] }; },
    search: async () => { reads++; return [{ Id: '999', Name: 'Ris', Ingredients: 'Ris, æg', Labels: ['vegan'], Price: 20, Unit: '500 g', IsAvailable: true }]; },
  } });
  const draft = await shopping.create(plan.id);
  assert.equal(draft.items[0].productId, '', 'an alias must not hide the vegan use of the same ingredient');
  assert.deepEqual(draft.items[0].candidates, []); assert.equal(draft.items[0].needsReview, true); assert.equal(reads, 2);
});

const at = '2026-11-05T08:00:00Z', now = () => new Date('2026-11-05T09:00:00Z');
const product = (Id, Name, Price, Ingredients = Name) => ({ Id, Name, Price, Ingredients, Unit: '500 g', IsAvailable: true });
function observation(item, ingredient = item.Name, constraints = null) {
  const assessment = constraints && productConstraints(item, constraints);
  return { id: 'synthetic-' + item.Id, revision: 2, items: [{ lineId: 'line-' + item.Id, ingredient,
    productId: item.Id, quantity: 1, candidates: [structuredClone(item)], productObservations: { [item.Id]: productObservation(item, at) },
    ...(assessment ? { reviewedProductFingerprint: assessment.evidenceFingerprint, reviewedConstraintsFingerprint: assessment.constraintsFingerprint } : {}) }] };
}
const ingredient = (name, quantity = 250, unit = 'g') => ({ name, quantity, unit });
const dish = (name, diet = 'omnivore', extra = {}) => ({ ingredients: [ingredient(name)], diet, theme: 'everyday', ...extra });

test('G3 shared ingredient constraints follow canonical aliases, but never substring ris inside frisk basilikum', () => {
  const profile = { diet: 'omnivore', avoid: [' TOMAT ', 'tomat'] };
  const dishes = [dish('ris'), dish('rice', 'vegan'), dish('frisk basilikum', 'omnivore'), dish('kylling', 'omnivore')];
  assert.deepEqual(ingredientConstraints(profile, dishes, 'RIS'), { diet: 'vegan', avoid: ['tomat'] });
  assert.equal(ingredientConstraints(profile, dishes, 'frisk basilikum').diet, 'omnivore');
  assert.equal(ingredientConstraints(profile, dishes, 'kylling').diet, 'omnivore');
  assert.equal(productConstraints(product('1', 'Frisk basilikum', 12), { diet: 'omnivore', avoid: ['ris'] }).conflicts.length, 0);
  assert.equal(ingredientAmountKey(ingredient('rice', 1, 'kg')), ingredientAmountKey(ingredient('RIS', 1000)));
});

test('G3 an unrelated vegan day and a skipped strict dish do not change another ingredient; linked leftovers do retain target constraints', () => {
  const profile = { diet: 'omnivore', avoid: [] };
  assert.equal(ingredientConstraints(profile, [dish('ris'), dish('rice', 'vegan', { skip: true }), dish('bulgur', 'vegan')], 'ris').diet, 'omnivore');
  const linked = { ingredients: [], ingredientBasis: [ingredient('rice')], diet: 'omnivore', theme: 'vegan', leftoverFromDate: '2026-11-05' };
  assert.equal(ingredientConstraints(profile, [dish('ris'), linked], 'ris').diet, 'vegan');
  assert.equal(ingredientConstraints({ diet: 'vegetarian', avoid: [] }, [dish('kylling')], 'kylling').diet, 'vegetarian');
});

test('E1/G3 a genuinely mixed week prices the chicken day and independent vegan day under their own relevant constraints', async () => {
  const state = { shoppingDrafts: [observation(product('2', 'Kylling', 40)), observation(product('3', 'Bulgur', 10))] };
  const planner = new MealPlanner({ state, now }); await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: [
    { date: plan.dishes[0].date, title: 'Syntetisk kylling', diet: 'omnivore', ingredients: [ingredient('kylling')] },
    { date: plan.dishes[1].date, title: 'Syntetisk vegansk bulgur', diet: 'vegan', theme: 'vegan', ingredients: [ingredient('bulgur')] },
  ] });
  assert.equal(plan.priceEstimate.estimatedProductsDkk, 50); assert.equal(plan.priceEstimate.lines.length, 2);
  assert.deepEqual(plan.priceEstimate.unknownIngredients, []);
});

test('E1/G3 a shared alias in a vegan meal excludes an egg-containing quote from the whole shared requirement', async () => {
  const state = { shoppingDrafts: [observation({ ...product('4', 'Ris', 10, 'Ris, eggs'), Labels: ['vegan'] })] };
  const planner = new MealPlanner({ state, now }); await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 2 });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: [
    { date: plan.dishes[0].date, title: 'Risret', diet: 'omnivore', ingredients: [ingredient('ris')] },
    { date: plan.dishes[1].date, title: 'Vegansk risret', diet: 'vegan', ingredients: [ingredient('rice')] },
  ] });
  assert.equal(plan.priceEstimate.estimatedProductsDkk, null); assert.equal(plan.priceEstimate.lines.length, 0);
  assert.equal(plan.priceEstimate.unknownIngredients[0].quantity, 500);
});

test('R08 declaring a recipe vegan cannot override eggs even for a globally omnivorous household', async () => {
  const planner = new MealPlanner({ state: {}, now }); const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  const before = structuredClone(plan);
  await assert.rejects(planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: [{ date: plan.dishes[0].date,
    title: 'Forkert label', diet: 'vegan', ingredients: [ingredient('eggs', 2, 'stk')] }] }), /kostvalg/);
  assert.deepEqual(plan, before);
});

test('G3/E1 branded price mappings require an actual current reviewed product and constraint fingerprint', () => {
  const branded = product('5', 'Syntetisk mærke fuldkornsris', 24, 'Ris');
  const requirement = [ingredient('rice', 500)], constraints = { diet: 'vegan', avoid: [] };
  const unreviewed = observation(branded, 'ris');
  assert.equal(estimateMealRequirements(requirement, observedMealPrices({ shoppingDrafts: [unreviewed] }, now()), constraints).estimatedProductsDkk, null);
  const reviewed = observation(branded, 'ris', constraints), quotes = observedMealPrices({ shoppingDrafts: [reviewed] }, now());
  const estimate = estimateMealRequirements(requirement, quotes, constraints);
  assert.equal(estimate.estimatedProductsDkk, 24); assert.equal(estimate.lines[0].source.lineId, 'line-5');
  assert.equal(estimateMealRequirements(requirement, quotes, { diet: 'vegan', avoid: ['jordnødder'] }).estimatedProductsDkk, null,
    'even a benign constraint change requires a new explicit branded mapping review');
  reviewed.items[0].candidates[0].Price = 25;
  assert.equal(observedMealPrices({ shoppingDrafts: [reviewed] }, now()).size, 0);
});

test('G3/E1 a reviewed label never rescues conflicting branded ingredients, wrong units or future observations', () => {
  const constraints = { diet: 'vegan', avoid: [] }, item = product('6', 'Syntetisk mærke ris med æg', 12, 'ris, æg');
  const state = { shoppingDrafts: [observation(item, 'ris', constraints)] }, quotes = observedMealPrices(state, now());
  assert.equal(estimateMealRequirements([ingredient('ris')], quotes, constraints).estimatedProductsDkk, null);
  const good = observation(product('7', 'Syntetisk mærke ris', 12), 'ris', constraints);
  assert.equal(estimateMealRequirements([ingredient('ris', 1, 'stk')], observedMealPrices({ shoppingDrafts: [good] }, now()), constraints).estimatedProductsDkk, null);
  good.items[0].productObservations['7'].observedAt = '2026-11-06T00:00:00Z';
  assert.equal(observedMealPrices({ shoppingDrafts: [good] }, now()).size, 0);
});

test('G3 retained proposals are locally rejected when a formerly permissive alias match now conflicts or lacks actual review', async () => {
  const plan = { id: 'retained', status: 'shopping_ready', revision: 1, shoppingList: [ingredient('ris')], dishes: [dish('rice', 'vegan')] };
  const state = { mealProfile: { diet: 'omnivore', avoid: [] } }, shopping = new ShoppingPlanner({ state,
    meals: { getPlan: () => plan, profile: () => state.mealProfile }, nemlig: {} });
  const { createHash } = await import('node:crypto');
  const draft = { planId: plan.id, planRevision: 1,
    listFingerprint: createHash('sha256').update(JSON.stringify(plan.shoppingList)).digest('hex'),
    items: [{ ingredient: 'ris', productId: '8', quantity: 1, needsReview: false, candidates: [product('8', 'Ris', 12, 'Ris, eggs')] }] };
  assert.throws(() => shopping.assertReviewedConstraints(draft), /gennemgang/);
  draft.items[0].candidates[0] = product('8', 'Ris', 12, 'Ris');
  assert.throws(() => shopping.assertReviewedConstraints(draft), /gennemgang/);
  const assessment = productConstraints(draft.items[0].candidates[0], { diet: 'vegan', avoid: [] });
  Object.assign(draft.items[0], { reviewedProductFingerprint: assessment.evidenceFingerprint, reviewedConstraintsFingerprint: assessment.constraintsFingerprint });
  assert.equal(shopping.assertReviewedConstraints(draft), plan);
});

test('G3 only the owner-review code path can establish a branded price mapping; caller-supplied review fields are ignored', async () => {
  const plan = { id: 'branded-owner-path', status: 'shopping_ready', revision: 1, shoppingList: [ingredient('ris')], dishes: [dish('rice', 'vegan')] };
  const item = product('9', 'Syntetisk mærke ris', 23, 'Ris'), state = { mealProfile: { diet: 'omnivore', avoid: [] } };
  const shopping = new ShoppingPlanner({ state, now, meals: { getPlan: () => plan, profile: () => state.mealProfile }, nemlig: {
    basket: async () => ({ Lines: [] }), search: async () => [structuredClone(item)] } });
  const draft = await shopping.create(plan.id), line = draft.items[0];
  const fake = productConstraints(item, { diet: 'vegan', avoid: [] });
  const edited = await shopping.update(draft.id, { expectedRevision: draft.revision, items: [{ lineId: line.lineId, productId: '9', quantity: 1,
    reviewedByOwner: true, reviewedProductFingerprint: fake.evidenceFingerprint, reviewedConstraintsFingerprint: fake.constraintsFingerprint }] });
  assert.equal(edited.items[0].needsReview, true);
  assert.equal(estimateMealRequirements([ingredient('ris')], observedMealPrices(state, now()), { diet: 'vegan', avoid: [] }).estimatedProductsDkk, null);
  const reviewed = await shopping.update(draft.id, { expectedRevision: edited.revision, items: [{ lineId: line.lineId, productId: '9', quantity: 1 }] }, { reviewedByOwner: true });
  assert.equal(reviewed.items[0].needsReview, false);
  assert.equal(estimateMealRequirements([ingredient('ris')], observedMealPrices(state, now()), { diet: 'vegan', avoid: [] }).estimatedProductsDkk, 23);
});
