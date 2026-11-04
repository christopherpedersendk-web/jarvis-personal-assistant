import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShoppingPlanner, productPackage, productConstraints } from '../shopping-planner.mjs';
import { NemligShopping } from '../nemlig-connector.mjs';

const now = () => new Date('2026-11-04T12:00:00Z');
function setup({ unit = '500 g', amount = 1200, existing = 1, name = 'ris', profile = {}, products, details } = {}) {
  const plan = { id: randomUUID(), revision: 2, status: 'shopping_ready', budgetTargetDkk: 30,
    shoppingList: [{ name, quantity: amount, unit: 'g' }], dishes: [] };
  const state = { mealPlans: [plan], mealProfile: { diet: 'omnivore', avoid: [], ...profile } }; const calls = []; let basket = { Lines: [{ Id: '123', Name: 'Ris', Quantity: existing }] };
  const product = { Id: '123', Name: 'Ris', Unit: unit, Price: 20, IsAvailable: true };
  const meals = { getPlan: id => { assert.equal(id, plan.id); return plan; }, profile: () => structuredClone(state.mealProfile) };
  const nemlig = new NemligShopping({ state, now, callTool: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_basket') return structuredClone(basket);
    if (name === 'search_products') return products || [product];
    if (name === 'get_product_details') return details ? details(args.product_id) : (products || [product]).find(x => String(x.Id) === args.product_id);
    if (name === 'set_basket_quantities') {
      basket.Lines[0].Quantity = args.items[0].quantity;
      return { results: args.items.map(x => ({ product_id: x.product_id, status: 'ok' })), basket };
    }
    throw new Error('Forbidden');
  } });
  const shopping = new ShoppingPlanner({ state, meals, nemlig, now });
  return { plan, state, calls, shopping, nemlig, meals, changeBasket: n => { basket.Lines[0].Quantity = n; },
    writes: () => calls.filter(x => x.name === 'set_basket_quantities') };
}

test('v4.9 shopping uses actual package sizes, existing basket and prices without any automatic writes', async () => {
  const f = setup();
  const draft = await f.shopping.create(f.plan.id);
  assert.equal(draft.items[0].quantity, 2, '1200g needs 3 x 500g; 1 pack is already in basket');
  assert.equal(draft.estimatedProductsDkk, 40); assert.equal(draft.overBudget, true);
  assert.equal(f.writes().length, 0);
  const proposal = await f.shopping.propose(draft.id, { expectedRevision: draft.revision });
  assert.equal(f.writes().length, 0);
  assert.deepEqual(proposal.sourcePlan, { id: f.plan.id, revision: 2 });
  assert.equal(proposal.additions[0].target, 3);
  await assert.rejects(f.nemlig.approve(proposal.id, true), /Genindlæs/);
  await f.nemlig.approve(proposal.id, true, proposal.revision);
  assert.equal(f.writes().length, 1);
  await assert.rejects(f.nemlig.approve(proposal.id, true, proposal.revision), /allerede/);
  assert.equal(f.writes().length, 1);
});

test('v4.9 unknown package units never turn recipe grams into invented pack counts', async () => {
  const f = setup({ unit: '' });
  const draft = await f.shopping.create(f.plan.id);
  assert.equal(draft.items[0].quantity, 0); assert.equal(draft.items[0].needsReview, true);
  assert.equal(draft.estimatedProductsDkk, null);
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 1 }), /uafklarede/);
  const edited = await f.shopping.update(draft.id, { expectedRevision: 1,
    items: [{ lineId: draft.items[0].lineId, productId: '123', quantity: 2 }] }, { reviewedByOwner: true });
  assert.equal(edited.revision, 2);
  assert.equal(edited.items[0].needsReview, false);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 1, items: [] }), /ændret/);
  await f.shopping.propose(draft.id, { expectedRevision: 2 });
  assert.equal(f.writes().length, 0);
});

test('v4.9 changing the source plan or shopping draft invalidates an old cart approval', async () => {
  const f = setup(); const draft = await f.shopping.create(f.plan.id);
  const proposal = await f.shopping.propose(draft.id, { expectedRevision: 1 });
  f.plan.revision++;
  await assert.rejects(f.nemlig.approve(proposal.id, true, 1), /Madplanen/);
  assert.equal(f.writes().length, 0);
  f.plan.revision--;
  await f.shopping.update(draft.id, { expectedRevision: 1, items: [{ lineId: draft.items[0].lineId, productId: '123', quantity: 1 }] });
  await assert.rejects(f.nemlig.approve(proposal.id, true, 1), /allerede/);
  assert.equal(f.writes().length, 0);
});

test('v4.9 cart proposal remains editable but stale browser revisions and changed baskets cannot write', async () => {
  const f = setup(); await f.nemlig.search('ris');
  const proposal = await f.nemlig.propose([{ productId: '123', quantity: 2 }]);
  await f.nemlig.revise(proposal.id, { expectedRevision: 1, items: [{ productId: '123', quantity: 3 }] });
  assert.equal(proposal.revision, 2); assert.equal(proposal.additions[0].target, 4);
  await assert.rejects(f.nemlig.approve(proposal.id, true, 1), /ændret/);
  f.changeBasket(2);
  await assert.rejects(f.nemlig.approve(proposal.id, true, 2), /kurven blev ændret/);
  assert.equal(f.writes().length, 0);
});

test('v4.9 shopping refuses drafts, unknown product IDs and omitted unresolved rows', async () => {
  const f = setup(); f.plan.status = 'draft';
  await assert.rejects(f.shopping.create(f.plan.id), /indkøbslisten/); assert.equal(f.calls.length, 0);
  f.plan.status = 'shopping_ready'; const draft = await f.shopping.create(f.plan.id);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 1, items: [] }), /alle linjer/);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 1,
    items: [{ lineId: draft.items[0].lineId, productId: '999', quantity: 2 }] }), /faktisk/);
  assert.equal(f.writes().length, 0);
});

test('package conversion never interprets a unit-price or nutritional number as a pack', () => {
  assert.deepEqual(productPackage({ Unit: '1,5 kg' }), { quantity: 1500, unit: 'g' });
  assert.deepEqual(productPackage({ Unit: '6 stk.' }), { quantity: 6, unit: 'stk' });
  assert.equal(productPackage({ UnitPrice: 12, Description: 'Protein 20 g' }), null);
  assert.equal(productPackage({ Unit: '10 kr/kg' }), null);
});

test('v4.9 rebuilds pack suggestions when the real basket changed since quantity calculation', async () => {
  const f = setup(); const draft = await f.shopping.create(f.plan.id);
  f.changeBasket(3);
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 1 }), /siden indkøbsforslaget/);
  assert.equal(f.writes().length, 0);
});

test('source changes during durable approval save prevent any external write', async () => {
  const f = setup(); const draft = await f.shopping.create(f.plan.id);
  const proposal = await f.shopping.propose(draft.id, { expectedRevision: 1 });
  f.nemlig.save = async () => { if (proposal.status === 'applying') f.plan.revision++; };
  await assert.rejects(f.nemlig.approve(proposal.id, true, 1), /Madplanen/);
  assert.equal(proposal.status, 'superseded'); assert.equal(f.writes().length, 0);
});

test('vegan/avoid constraints filter obvious egg pasta and cannot be bypassed by manually reselecting a legacy candidate', async () => {
  const egg = { Id: '123', Name: 'Pasta med æg', Unit: '500 g', Price: 20, IsAvailable: true };
  const f = setup({ name: 'pasta', profile: { diet: 'vegan', avoid: ['æg'] }, products: [egg] });
  const draft = await f.shopping.create(f.plan.id);
  assert.equal(draft.items[0].productId, ''); assert.equal(draft.items[0].needsReview, true);
  assert.deepEqual(draft.items[0].candidates, []);
  const saved = f.shopping.get(draft.id); saved.items[0].candidates.push(egg);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 1, items: [
    { lineId: draft.items[0].lineId, productId: '123', quantity: 2 },
  ] }, { reviewedByOwner: true }), /konflikt/);
  assert.equal(f.writes().length, 0);
});

test('diet labels never hide contradicting ingredients; token boundaries avoid accidental word fragments', () => {
  assert.equal(productConstraints({ Name: 'Pasta med ÆG', Vegan: true }, { diet: 'vegan', avoid: ['æg'] }).conflicts.length > 0, true);
  assert.equal(productConstraints({ Name: 'Vegansk ost', Description: 'Ingredienser: mælk' }, { diet: 'vegan' }).conflicts.length > 0, true);
  assert.equal(productConstraints({ Name: 'Pasta', Ingredients: [{ name: 'Egg powder' }] }, { diet: 'vegan' }).conflicts.length > 0, true);
  assert.equal(productConstraints({ Name: 'Pasta', Allergens: ['ÆGGEHVIDE'] }, { avoid: ['æg'] }).conflicts.length > 0, true);
  assert.equal(productConstraints({ Name: 'Pasta', Description: 'Indeholder &aelig;g' }, { avoid: ['æg'] }).conflicts.length > 0, true);
  assert.deepEqual(productConstraints({ Name: 'Havremælk', Description: 'Kostfibre' }, { diet: 'vegan', avoid: ['ost'] }).conflicts, []);
  const unknown = productConstraints({ Name: 'Vegansk ost', Vegan: true }, { diet: 'vegan' });
  assert.deepEqual(unknown.conflicts, []); assert.equal(unknown.requiresReview, true);
  assert.equal(productConstraints({ Name: 'Pasta al uovo' }, { diet: 'vegan' }).requiresReview, true, 'Unknown descriptions are not dietary clearance');
});

test('vegetarian and per-day vegan requirements apply to the relevant shopping ingredients', async () => {
  const chicken = { Id: '123', Name: 'Ris med kylling', Unit: '500 g', Price: 20 };
  const vegetarian = setup({ profile: { diet: 'vegetarian' }, products: [chicken] });
  assert.equal((await vegetarian.shopping.create(vegetarian.plan.id)).items[0].productId, '');
  const egg = { Id: '123', Name: 'Pasta med æg', Unit: '500 g', Price: 20 };
  const themed = setup({ name: 'pasta', products: [egg] });
  themed.plan.dishes = [{ theme: 'vegan', ingredients: [{ name: 'pasta', quantity: 200, unit: 'g' }] }];
  assert.equal((await themed.shopping.create(themed.plan.id)).items[0].productId, '');
});

test('model edits cannot clear unknown quantity or dietary review; trusted owner save may acknowledge uncertainty', async () => {
  const f = setup({ profile: { diet: 'vegan', avoid: ['æg'] } });
  const draft = await f.shopping.create(f.plan.id);
  assert.equal(draft.items[0].productId, '123'); assert.equal(draft.items[0].needsReview, true);
  const input = { lineId: draft.items[0].lineId, productId: '123', quantity: 2 };
  const modeled = await f.shopping.update(draft.id, { expectedRevision: 1, items: [input], reviewedByOwner: true });
  assert.equal(modeled.items[0].needsReview, true, 'Untrusted JSON cannot claim owner review');
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 2 }), /uafklarede/);
  const reviewed = await f.shopping.update(draft.id, { expectedRevision: 2, items: [input] }, { reviewedByOwner: true });
  assert.equal(reviewed.items[0].needsReview, false);
  await f.shopping.propose(draft.id, { expectedRevision: 3 });
  assert.equal(f.writes().length, 0);
  const unknown = setup({ unit: '' }); const other = await unknown.shopping.create(unknown.plan.id);
  const changed = await unknown.shopping.update(other.id, { expectedRevision: 1, items: [{ lineId: other.items[0].lineId, productId: '123', quantity: 1 }] });
  assert.equal(changed.items[0].needsReview, true);
});

test('fresh product details block hidden conflicts before any cart proposal and cannot be reselected', async () => {
  const product = { Id: '123', Name: 'Pasta', Unit: '500 g', Price: 20 };
  const f = setup({ name: 'pasta', profile: { diet: 'vegan' }, products: [product],
    details: () => ({ ...product, Ingredients: 'Durumhvede, æg' }) });
  const draft = await f.shopping.create(f.plan.id);
  await f.shopping.update(draft.id, { expectedRevision: 1, items: [{ lineId: draft.items[0].lineId, productId: '123', quantity: 2 }] }, { reviewedByOwner: true });
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 2 }), /kostkonflikt/);
  const blocked = f.shopping.get(draft.id); assert.equal(blocked.revision, 3); assert.equal(blocked.items[0].needsReview, true);
  assert.equal(blocked.items[0].productId, ''); assert.deepEqual(blocked.items[0].candidates, []);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 3, items: [{ lineId: draft.items[0].lineId, productId: '123', quantity: 1 }] }, { reviewedByOwner: true }), /faktisk/);
  assert.equal(f.state.nemligProposals.length, 0); assert.equal(f.writes().length, 0);
});

test('fresh detail or package changes invalidate earlier owner review rather than silently authorizing new facts', async () => {
  const product = { Id: '123', Name: 'Ris', Unit: '500 g', Price: 20 };
  const f = setup({ profile: { diet: 'vegan' }, products: [product], details: () => ({ ...product, Unit: '250 g', Ingredients: 'Ris' }) });
  const draft = await f.shopping.create(f.plan.id);
  const input = { lineId: draft.items[0].lineId, productId: '123', quantity: 2 };
  await f.shopping.update(draft.id, { expectedRevision: 1, items: [input] }, { reviewedByOwner: true });
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 2 }), /Vareoplysningerne blev opdateret/);
  assert.equal(f.shopping.get(draft.id).items[0].candidates[0].Unit, '250 g');
  assert.equal(f.shopping.get(draft.id).items[0].needsReview, true);
  await assert.rejects(f.shopping.update(draft.id, { expectedRevision: 2, items: [input] }, { reviewedByOwner: true }), /ændret/);
  await f.shopping.update(draft.id, { expectedRevision: 3, items: [{ ...input, quantity: 4 }] }, { reviewedByOwner: true });
  await f.shopping.propose(draft.id, { expectedRevision: 4 });
  assert.equal(f.writes().length, 0);
});

test('archived source recipes are rejected before reads and if invalidated during detail lookup', async () => {
  let valid = true;
  const f = setup({ details: () => { valid = false; return { Id: '123', Name: 'Ris', Unit: '500 g', Price: 20, IsAvailable: true }; } });
  f.meals.assertRecipeSources = () => { if (!valid) throw new Error('En gemt opskrift er ændret eller fjernet.'); };
  const draft = await f.shopping.create(f.plan.id);
  await assert.rejects(f.shopping.propose(draft.id, { expectedRevision: 1 }), /opskrift/);
  assert.equal(f.state.nemligProposals.length, 0); assert.equal(f.writes().length, 0);
  f.calls.length = 0;
  await assert.rejects(f.shopping.create(f.plan.id), /opskrift/);
  assert.equal(f.calls.length, 0);
});
