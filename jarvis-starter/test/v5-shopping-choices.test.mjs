import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner } from '../meal-planner.mjs';
import { ShoppingPlanner } from '../shopping-planner.mjs';

async function fixture() {
  const state = {}; let saves = 0;
  const planner = new MealPlanner({ state, save: async () => { saves++; }, now: () => new Date('2026-11-05T09:00:00Z') });
  await planner.setHousehold({ adults: 2, children: [] });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  await planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: [{ date: plan.dishes[0].date,
    title: 'Syntetisk risret', diet: 'vegan', ingredients: [{ name: 'ris', quantity: 250, unit: 'g' }] }] });
  await planner.buildShoppingList(plan.id, { expectedRevision: plan.revision });
  return { state, planner, plan, saves: () => saves };
}

test('G1/E2 a pure meal-lock change and regeneration cannot discard the manually selected shopping quantity', async () => {
  const f = await fixture();
  await f.planner.editShoppingList(f.plan.id, { expectedRevision: f.plan.revision, items: [{ name: 'ris', quantity: 1000, unit: 'g' }] });
  await f.planner.updatePlan(f.plan.id, { expectedRevision: f.plan.revision, dishes: [{ date: f.plan.dishes[0].date, locked: true }] });
  await f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision });
  assert.equal(f.plan.shoppingList[0].quantity, 1000, 'the saved owner quantity must survive unchanged computed requirements');
  assert.equal(f.plan.shoppingNeedsReview, false);
  const choice = structuredClone(f.plan.manualShoppingOverrides);
  await f.planner.regenerateUnlocked(f.plan.id, { expectedRevision: f.plan.revision });
  await f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision });
  assert.deepEqual(f.plan.manualShoppingOverrides, choice); assert.equal(f.plan.shoppingList[0].quantity, 1000);
  assert.equal(f.plan.shoppingNeedsReview, false);
});

const update = (f, patch) => f.planner.updatePlan(f.plan.id, { expectedRevision: f.plan.revision,
  dishes: f.plan.dishes.map(dish => ({ date: dish.date, ...patch })) });
const build = f => f.planner.buildShoppingList(f.plan.id, { expectedRevision: f.plan.revision });
const edit = (f, items, extra = {}) => f.planner.editShoppingList(f.plan.id, { expectedRevision: f.plan.revision, items, ...extra });
const choice = (quantity, name = 'ris', unit = 'g') => ({ name, quantity, unit });

test('G1 changed portions retain absolute quantity and its original source, expose the deviation and block even external reads', async () => {
  const f = await fixture(); await edit(f, [choice(1000)]);
  const prior = structuredClone(f.plan.manualShoppingOverrides[0]), originalRevision = f.plan.revision;
  await update(f, { servings: 4 }); await build(f);
  assert.equal(f.plan.shoppingList[0].quantity, 1000); assert.equal(f.plan.shoppingNeedsReview, true);
  const row = f.plan.shoppingReview.rows[0];
  assert.equal(row.computedQuantity, 500); assert.equal(row.selectedQuantity, 1000); assert.equal(row.previousBasis.quantity, 250);
  assert.equal(row.basisChanged, true); assert.deepEqual(row.source, prior.source); assert.equal(row.source.revision, originalRevision);
  let reads = 0;
  const shopping = new ShoppingPlanner({ state: f.state, meals: f.planner, nemlig: {
    basket: async () => { reads++; return { Lines: [] }; }, search: async () => { reads++; return []; } } });
  await assert.rejects(shopping.create(f.plan.id), /ændret|gennemgang/); assert.equal(reads, 0);
  await edit(f, [choice(1000)]);
  assert.equal(f.plan.shoppingNeedsReview, false); assert.equal(f.plan.manualShoppingOverrides[0].base.quantity, 500);
  assert.equal(f.plan.shoppingList[0].quantity, 1000);
});

test('G1 removing the recipe requirement keeps the prior absolute choice as a reviewable detached extra', async () => {
  const f = await fixture(); await edit(f, [choice(1000)]);
  await update(f, { title: 'Syntetisk bulgur', diet: 'vegan', ingredients: [choice(300, 'bulgur')] }); await build(f);
  assert.equal(f.plan.shoppingList.find(row => row.name === 'ris').quantity, 1000);
  const row = f.plan.shoppingReview.rows.find(row => row.name === 'ris');
  assert.equal(row.computedQuantity, 0); assert.equal(row.removedFromPlan, true); assert.equal(row.needsReview, true);
  assert.deepEqual(f.plan.manualShoppingExtras, [choice(1000)]);
  await edit(f, [choice(300, 'bulgur')]);
  assert.equal(f.plan.manualShoppingOverrides.find(row => row.name === 'ris').quantity, 0);
  await update(f, { ingredients: [choice(200)], diet: 'vegan' }); await build(f);
  assert.equal(f.plan.shoppingList.some(row => row.name === 'ris'), false, 'an explicit deletion cannot be resurrected by a new requirement');
  assert.equal(f.plan.shoppingNeedsReview, true);
});

test('G1 both omitted and explicit-zero rows remain durable exclusions across rebuilds', async () => {
  for (const items of [[], [choice(0)]]) {
    const f = await fixture(); await edit(f, items); await update(f, { locked: true }); await build(f);
    assert.deepEqual(f.plan.shoppingList, []); assert.equal(f.plan.manualShoppingOverrides[0].quantity, 0);
    assert.equal(f.plan.shoppingReview.rows[0].excluded, true); assert.equal(f.plan.shoppingNeedsReview, false);
    await update(f, { servings: 3 }); await build(f);
    assert.deepEqual(f.plan.shoppingList, []); assert.equal(f.plan.shoppingNeedsReview, true);
  }
});

test('G1 saving an unchanged computed row does not freeze future calculated quantities', async () => {
  const f = await fixture(); await edit(f, [choice(250)]);
  assert.deepEqual(f.plan.manualShoppingOverrides, []);
  await update(f, { servings: 4 }); await build(f);
  assert.equal(f.plan.shoppingList[0].quantity, 500); assert.equal(f.plan.shoppingNeedsReview, false);
});

test('G1 equality with a later calculated need does not erase an earlier explicit override', async () => {
  const f = await fixture(); await edit(f, [choice(500)]); await update(f, { servings: 4 }); await build(f);
  assert.equal(f.plan.shoppingNeedsReview, true); await edit(f, [choice(500)]);
  assert.equal(f.plan.manualShoppingOverrides.length, 1);
  await update(f, { servings: 2 }); await build(f);
  assert.equal(f.plan.shoppingList[0].quantity, 500); assert.equal(f.plan.shoppingNeedsReview, true);
});

test('G1 explicit revision-bound useComputed resets only the selected override and a detached choice becomes absent', async () => {
  const f = await fixture(); await edit(f, [choice(1000), choice(1, 'kaffe', 'pakke')]);
  const revision = f.plan.revision;
  await assert.rejects(f.planner.editShoppingList(f.plan.id, { expectedRevision: revision - 1,
    items: f.plan.shoppingList, useComputed: [{ name: 'ris', unit: 'g' }] }), /revision/);
  await edit(f, f.plan.shoppingList, { useComputed: [{ name: 'rice', unit: 'kg' }] });
  assert.equal(f.plan.shoppingList.find(row => row.name === 'ris').quantity, 250);
  assert.deepEqual(f.plan.manualShoppingOverrides.map(row => row.name), ['kaffe']);
  await edit(f, f.plan.shoppingList, { useComputed: [{ name: 'kaffe', unit: 'pakke' }] });
  assert.deepEqual(f.plan.manualShoppingOverrides, []); assert.deepEqual(f.plan.manualShoppingExtras, []);
  assert.equal(f.plan.shoppingList.some(row => row.name === 'kaffe'), false);
});

test('G1 duplicate, unknown and invalid reset choices cannot mutate any saved quantity or source', async () => {
  const f = await fixture(); await edit(f, [choice(1000)]); const before = structuredClone(f.state);
  for (const useComputed of [[{ name: 'ris', unit: 'g' }, { name: 'rice', unit: 'kg' }],
    [{ name: 'ukendt', unit: 'g' }], [{ name: 'ris', unit: 'stone' }], 'all']) {
    await assert.rejects(edit(f, [choice(1000)], { useComputed })); assert.deepEqual(f.state, before);
  }
});

test('G1 a changed unit never fabricates a piece weight to satisfy a saved gram choice', async () => {
  const f = await fixture(); await edit(f, [choice(1000)]);
  await update(f, { ingredients: [choice(2, 'ris', 'stk')], diet: 'vegan' }); await build(f);
  assert.deepEqual(f.plan.shoppingList.map(({ name, unit, quantity }) => ({ name, unit, quantity })),
    [choice(1000), choice(2, 'ris', 'stk')]);
  assert.equal(f.plan.shoppingReview.rows[0].removedFromPlan, true); assert.equal(f.plan.shoppingNeedsReview, true);
});

test('G1 confirmed stock changes preserve the absolute choice and show required, stock-used and remaining quantities separately', async () => {
  const f = await fixture(); await edit(f, [choice(1000)]);
  await f.planner.setInventory({ expectedRevision: f.planner.inventory().revision, items: [
    { ...choice(200), lastConfirmedAt: '2026-11-05T08:00:00Z' } ] });
  await update(f, {}); await build(f);
  const row = f.plan.shoppingReview.rows[0];
  assert.equal(row.requiredQuantity, 250); assert.equal(row.pantryUsed, 200); assert.equal(row.computedQuantity, 50);
  assert.equal(row.selectedQuantity, 1000); assert.equal(row.needsReview, true);
  assert.equal(f.planner.inventory().items[0].quantity, 200, 'a list edit or reservation is not consumption');
});

test('G1 a forbidden saved extra stays visible for removal instead of becoming an uneditable dead-end or disappearing', async () => {
  const f = await fixture(); await edit(f, [choice(250), choice(4, 'æg', 'stk')]);
  await f.planner.setProfile({ ...f.planner.profile(), diet: 'vegan' }); await update(f, {}); await build(f);
  assert.ok(f.plan.shoppingList.some(row => row.name === 'æg')); assert.equal(f.plan.shoppingNeedsReview, true);
  assert.equal(f.plan.shoppingReview.rows.find(row => row.name === 'æg').conflicting, true);
  await assert.rejects(edit(f, f.plan.shoppingList), /konflikt/);
  await edit(f, [choice(250), choice(0, 'æg', 'stk')]);
  assert.equal(f.plan.shoppingNeedsReview, false); assert.equal(f.plan.shoppingList.some(row => row.name === 'æg'), false);
});

test('G1 synthetic v4.9.1 manual rows are adopted before list invalidation and remain explicitly provenance-unknown until reviewed', async () => {
  const f = await fixture();
  f.plan.shoppingList = [{ ...choice(1000), manuallyEdited: true }]; delete f.plan.manualShoppingOverrides;
  const before = JSON.stringify(f.state), view = f.planner.plans()[0];
  assert.equal(view.shoppingNeedsReview, true); assert.equal(JSON.stringify(f.state), before, 'read-time adoption must be pure');
  await update(f, { locked: true }); await build(f);
  assert.equal(f.plan.shoppingList[0].quantity, 1000); assert.equal(f.plan.shoppingNeedsReview, true);
  assert.equal(f.plan.manualShoppingOverrides[0].base, null);
  assert.equal(f.plan.manualShoppingOverrides[0].source.kind, 'legacy-shopping-edit');
  await edit(f, [choice(1000)]); assert.equal(f.plan.shoppingNeedsReview, false);
});

test('G1 legacy whole-list omission and manual extras survive a process restart and later rebuilding', async () => {
  const f = await fixture(); delete f.plan.manualShoppingOverrides;
  f.plan.shoppingList = [{ ...choice(1, 'kaffe', 'pakke'), manuallyEdited: true }]; f.plan.manualShoppingExtras = [choice(1, 'kaffe', 'pakke')];
  await update(f, { locked: true });
  const restarted = new MealPlanner({ state: JSON.parse(JSON.stringify(f.state)), now: () => new Date('2026-11-05T09:00:00Z') });
  const plan = restarted.getPlan(f.plan.id); await restarted.buildShoppingList(plan.id, { expectedRevision: plan.revision });
  assert.equal(plan.shoppingList.some(row => row.name === 'ris'), false); assert.equal(plan.shoppingList[0].name, 'kaffe');
  assert.equal(plan.manualShoppingOverrides.find(row => row.name === 'ris').quantity, 0);
  assert.equal(plan.shoppingNeedsReview, true);
});
