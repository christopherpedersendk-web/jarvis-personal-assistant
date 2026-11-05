import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Element as DomElement } from './helpers/dom-contract.mjs';
import { MealPlanner } from '../meal-planner.mjs';

// Executable DOM/data contracts only. Actual Chromium/WebKit and physical
// devices remain separate acceptance gates.
class Element extends DomElement {
  get childNodes() { return this.children; }
  get nextSibling() { return this.nextElementSibling; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  removeAttribute(key) { delete this.attributes[key]; }
  scrollIntoView() {}
}
const source = await readFile(new URL('../public/meals.js', import.meta.url), 'utf8');
const boot = source.indexOf('\nlet calendarSelectionDirty = false;');
assert.ok(boot > 0);
const plain = value => JSON.parse(JSON.stringify(value));
const button = (root, label) => root.querySelectorAll('button').find(node => node.textContent === label);
const listQuantity = card => card.querySelector('.meal-list-editor').querySelectorAll('input').find(input => input.type === 'number');
async function fixture({ state = {}, saved = new Map(), sourceId = null } = {}) {
  const planner = new MealPlanner({ state, now: () => new Date('2026-11-05T09:00:00Z') });
  if (!state.mealPlans.length) {
    await planner.setHousehold({ adults: 2, children: [] });
    await planner.createPlan({ startDate: '2026-11-05', days: 3 });
  }
  const document = { activeElement: null, focusDetachments: 0, routes: [] };
  document.createElement = tag => new Element(document, tag); document.body = document.createElement('body'); document.activeElement = document.body;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.getElementById = id => { const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean); return visit(document.body) || null; };
  document.dispatchEvent = event => document.routes.push(event);
  const root = document.createElement('div'); root.id = 'meal-plans'; document.body.append(root);
  const shoppingRoot = document.createElement('div'); shoppingRoot.id = 'meal-shopping-drafts'; document.body.append(shoppingRoot);
  const requests = [], toasts = [], navigations = []; let fail = null, hold = null, refreshError = null;
  const context = vm.createContext({ document, Date, Intl, URL, structuredClone, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    window: { location: { href: 'https://synthetic.invalid/?view=meals' + (sourceId ? '&source=' + encodeURIComponent(sourceId) : '') } },
    localStorage: { getItem: () => 'synthetic-not-stored-access-token' },
    sessionStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    selectTab: (...args) => navigations.push(args), toast: message => toasts.push(message),
    api: async (path, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined, method = options.method || 'GET';
      requests.push({ path, method, body }); if (hold) await hold; if (fail) throw fail;
      if (path === '/api/shopping-drafts' && method === 'GET') return { drafts: structuredClone(state.shoppingDrafts || []) };
      const match = /^\/api\/meals\/plans\/([^/]+)\/leftovers$/.exec(path);
      if (match && method === 'POST') return { plan: structuredClone(await planner.setPlannedLeftovers(match[1], body)) };
      const shopping = /^\/api\/meals\/plans\/([^/]+)\/shopping-list$/.exec(path);
      if (shopping && method === 'PUT') return { plan: structuredClone(await planner.editShoppingList(shopping[1], body)) };
      if (shopping && method === 'POST') return { plan: structuredClone(await planner.buildShoppingList(shopping[1], body)) };
      throw new Error('Unexpected request in synthetic fixture: ' + path);
    },
  });
  vm.runInContext(source.slice(0, boot) + `\nglobalThis.contract = {
    show: showMealPlans, editor: mealLeftoversEditor, price: mealPriceSummary, dish: mealDishEditor,
    showShopping: refreshShoppingDrafts,
    persist: mealPersistDrafts, setRecipes: value => { mealData.recipes = value; },
    invalidateSession: () => { mealSessionGeneration++; mealDirty.clear(); mealDraftControllers.clear(); mealRecoveredDrafts = {};
      sessionStorage.removeItem(mealDraftKey); document.getElementById('meal-plans').replaceChildren(); },
  };`, context);
  context.refreshMeals = async () => { if (refreshError) throw refreshError; context.contract.show(planner.plans()); };
  context.contract.setRecipes(planner.recipes()); context.contract.show(planner.plans());
  return { ...context.contract, document, root, shoppingRoot, state, planner, saved, requests, toasts, navigations,
    fail: error => { fail = error; }, hold: promise => { hold = promise; }, failRefresh: error => { refreshError = error; } };
}

test('E1/K3 leftover form uses structured named dates, portion and explicit time fields; adding/editing a row makes zero requests', async () => {
  const h = await fixture(), card = h.root.children[0], editor = card.querySelector('.meal-leftovers-editor');
  await button(editor, 'Tilføj planlagte rester').emit('click');
  const row = editor.querySelector('.meal-leftovers-row');
  assert.equal(row.querySelectorAll('select').length, 2); assert.equal(row.querySelectorAll('input').length, 2);
  const minutes = row.querySelector('[data-leftover-field="minutes"]');
  assert.equal(minutes.value, '', 'the app must not invent preparation/storage facts or a user time estimate');
  minutes.value = '12'; await minutes.emit('input');
  assert.equal(h.requests.length, 0); assert.equal(button(card, 'Opret indkøbsliste').disabled, true);
  assert.match(card.querySelector('[data-edit-status]').textContent, /Restefordelingen er ikke gemt/);
  assert.equal(button(card, 'Gem planlagte rester').disabled, false);
  assert.match(editor.textContent, /ikke.*tilberedt|ikke bevis/);
});

test('R03/E1 incomplete leftover inputs preserve focus, caret and exact old revision through poll and reload, with stale save rejected', async () => {
  const h = await fixture(), card = h.root.children[0], editor = card.querySelector('.meal-leftovers-editor');
  await button(editor, 'Tilføj planlagte rester').emit('click');
  const minutes = editor.querySelector('[data-leftover-field="minutes"]'); minutes.value = ''; minutes.focus();
  minutes.selectionStart = 0; minutes.selectionEnd = 0; await minutes.emit('input');
  const plan = h.state.mealPlans[0], revision = plan.revision;
  await h.planner.updatePlan(plan.id, { expectedRevision: revision, dishes: plan.dishes.map((dish, index) => ({ date: dish.date, ...(index === 2 ? { locked: true } : {}) })) });
  h.show(h.planner.plans());
  assert.equal(h.root.children[0], card); assert.equal(h.document.activeElement, minutes); assert.equal(h.document.focusDetachments, 0);
  assert.match(card.querySelector('[data-edit-status]').textContent, /ændret et andet sted/);
  h.persist(); const saved = JSON.parse(h.saved.get('jarvis:v5:meal-drafts'));
  assert.equal(saved.drafts['plan:' + plan.id].record.revision, revision);
  assert.equal(JSON.stringify(saved).includes('synthetic-not-stored-access-token'), false);
  const reloaded = await fixture({ state: h.state, saved: h.saved }), restored = reloaded.root.children[0];
  assert.equal(restored.dataset.revision, String(revision)); assert.equal(restored.querySelector('[data-leftover-field="minutes"]').value, '');
  assert.equal(reloaded.requests.length, 0);
  restored.querySelector('[data-leftover-field="minutes"]').value = '14';
  await button(restored, 'Gem planlagte rester').emit('click');
  assert.equal(reloaded.requests[0].body.expectedRevision, revision); assert.equal(reloaded.state.mealPlans[0].plannedLeftovers, undefined);
  assert.match(restored.querySelector('[data-edit-status]').textContent, /revision/);
  assert.equal(restored.querySelector('[data-leftover-field="minutes"]').value, '14');
});

test('E1 explicit save sends only the reviewed revision and structured links; linked editors retain lock but cannot change food underneath the link', async () => {
  const h = await fixture(), card = h.root.children[0], plan = h.state.mealPlans[0], revision = plan.revision;
  await button(card, 'Tilføj planlagte rester').emit('click');
  const minutes = card.querySelector('[data-leftover-field="minutes"]'); minutes.value = '15'; await minutes.emit('input');
  await button(card, 'Gem planlagte rester').emit('click');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'POST');
  assert.deepEqual(h.requests[0].body, { expectedRevision: revision,
    links: [{ fromDate: plan.dishes[0].date, toDate: plan.dishes[1].date, servings: plan.dishes[1].servings, minutes: 15 }] });
  const current = h.root.children[0], target = current.querySelectorAll('[data-meal-date]')[1];
  assert.ok(current.textContent.includes('Planlagte rester fra'));
  const fields = target.querySelectorAll('input,select,textarea');
  assert.equal(fields.filter(field => !field.disabled).length, 1, 'only the explicit lock may change while linked');
  assert.equal(fields.find(field => !field.disabled).type, 'checkbox');
  assert.equal(h.saved.has('jarvis:v5:meal-drafts'), false);
});

test('E1 removing a leftover row is a local draft until save, then both original manual meal selections return', async () => {
  const h = await fixture(), plan = h.state.mealPlans[0], original = structuredClone(plan.dishes);
  await h.planner.setPlannedLeftovers(plan.id, { expectedRevision: plan.revision,
    links: [{ fromDate: original[0].date, toDate: original[1].date, servings: original[1].servings, minutes: 11 }] });
  h.show(h.planner.plans()); const card = h.root.children[0];
  await button(card, 'Fjern fordeling').emit('click');
  assert.equal(h.requests.length, 0); assert.equal(plan.plannedLeftovers.length, 1);
  await button(card, 'Gem planlagte rester').emit('click');
  assert.deepEqual(h.requests[0].body.links, []); assert.deepEqual(plan.dishes, original); assert.equal(plan.status, 'draft');
});

test('A1/K5 an acknowledged leftover save followed by a failed refresh is reported saved, not failed or automatically retried', async () => {
  const h = await fixture(), card = h.root.children[0]; await button(card, 'Tilføj planlagte rester').emit('click');
  card.querySelector('[data-leftover-field="minutes"]').value = '9';
  h.failRefresh(new Error('Syntetisk læsefejl')); await button(card, 'Gem planlagte rester').emit('click');
  assert.equal(h.state.mealPlans[0].plannedLeftovers.length, 1); assert.equal(h.requests.length, 1);
  assert.match(card.querySelector('[data-edit-status]').textContent, /gemt.*visningen.*Syntetisk læsefejl/);
  assert.equal(button(card, 'Gem planlagte rester').disabled, true);
  await button(card, 'Gem planlagte rester').emit('click'); assert.equal(h.requests.length, 1);
});

test('R03/E1 in-flight save freezes meal/leftover fields so acknowledged work cannot erase new typing', async () => {
  const h = await fixture(), card = h.root.children[0]; await button(card, 'Tilføj planlagte rester').emit('click');
  card.querySelector('[data-leftover-field="minutes"]').value = '10';
  let release; h.hold(new Promise(resolve => { release = resolve; }));
  const pending = button(card, 'Gem planlagte rester').emit('click');
  assert.ok(card.querySelectorAll('input,select,textarea,button').every(field => field.disabled));
  release(); await pending; assert.equal(h.state.mealPlans[0].plannedLeftovers.length, 1);
});

test('R03/I5 an old-session leftover acknowledgement cannot clear the next session draft or render old data', async () => {
  const h = await fixture(), card = h.root.children[0]; await button(card, 'Tilføj planlagte rester').emit('click');
  card.querySelector('[data-leftover-field="minutes"]').value = '10';
  let release; h.hold(new Promise(resolve => { release = resolve; }));
  const pending = button(card, 'Gem planlagte rester').emit('click');
  h.invalidateSession(); h.show(h.planner.plans()); const newerCard = h.root.children[0];
  await button(newerCard, 'Tilføj planlagte rester').emit('click');
  const newer = newerCard.querySelector('[data-leftover-field="minutes"]'); newer.value = '19'; await newer.emit('input'); h.persist();
  const draft = h.saved.get('jarvis:v5:meal-drafts');
  release(); await pending;
  assert.equal(h.root.children[0], newerCard); assert.equal(newer.value, '19');
  assert.equal(h.saved.get('jarvis:v5:meal-drafts'), draft); assert.deepEqual(h.toasts, []);
  assert.equal(h.state.mealPlans[0].plannedLeftovers[0].minutes, 10, 'the server acknowledgement belongs only to the old operation');
  h.show(h.planner.plans()); assert.match(newerCard.querySelector('[data-edit-status]').textContent, /ændret et andet sted/);
});

test('E1/G4 the visible local price estimate distinguishes unknown and partial cost, budget lower bound, observation age and whole-basket value', async () => {
  const h = await fixture();
  const price = h.price({ pricingStale: true, priceEstimate: { status: 'partial-observed-estimate', estimatedProductsDkk: null,
    knownProductsDkk: 99, budgetTargetDkk: 30, budgetStatus: 'over', maxObservationAgeHours: 24,
    unknownIngredients: [{ name: 'safran', quantity: 1, unit: 'g' }],
    lines: [{ name: 'ris', quantity: 500, unit: 'g', packages: 1, packageQuantity: 500, unitPriceDkk: 99,
      estimatedProductsDkk: 99, surplusQuantity: 0, requiresProductReview: true,
      source: { id: 'synthetic-draft', lineId: 'synthetic-line', productId: '123', revision: 4, observedAt: '2026-11-05T08:00:00Z' } }],
    note: 'Ikke levering, pant, poser, hel kurv eller prisgaranti.' } });
  assert.match(price.textContent, /Samlet.*ukendt/); assert.match(price.textContent, /99,00/);
  assert.match(price.textContent, /over budget/); assert.match(price.textContent, /safran/); assert.match(price.textContent, /24 timer/);
  assert.match(price.textContent, /Ikke.*hel kurv/); assert.match(price.textContent, /2026-11-05T08:00:00Z/);
  assert.match(price.textContent, /varevalg.*ikke ændret/); assert.match(price.textContent, /ændret|forældet/);
  const link = price.querySelector('a'); assert.match(link.href, /shopping-draft%3Asynthetic-draft%3Asynthetic-line/);
  await link.emit('click'); assert.equal(h.requests.length, 0);
  assert.deepEqual(plain(h.navigations[0]), ['meals', { sourceId: 'shopping-draft:synthetic-draft:synthetic-line' }]);
});

test('E1 empty and stale price information never displays an invented price or a within-budget assertion', async () => {
  const h = await fixture();
  for (const estimate of [undefined, { status: 'stale-basis', estimatedProductsDkk: null, knownProductsDkk: 0, budgetStatus: 'unknown', lines: [], unknownIngredients: [] },
    { status: 'unknown-until-retailer-lookup', estimatedProductsDkk: null, knownProductsDkk: 0, budgetStatus: 'unknown', lines: [], unknownIngredients: [{ name: 'ukendt vare' }] }]) {
    const node = h.price({ priceEstimate: estimate }); assert.match(node.textContent, /ukendt|gennemgå/i);
    assert.doesNotMatch(node.textContent, /inden for budget|Samlet.*0,00/);
  }
});

test('R11 an exact older plan source remains renderable beyond the bounded five-plan overview', async () => {
  const initial = await fixture(), base = initial.state.mealPlans[0];
  initial.state.mealPlans = Array.from({ length: 8 }, (_, index) => ({ ...structuredClone(base), id: 'synthetic-plan-' + index }));
  const h = await fixture({ state: initial.state, sourceId: 'meal-plan:synthetic-plan-7:2026-11-05' });
  assert.equal(h.root.children.length, 5); assert.equal(h.root.children[0].dataset.recordKey, 'plan:synthetic-plan-7');
  assert.equal(h.root.children[0].querySelector('[data-meal-date="2026-11-05"]').dataset.mealDate, '2026-11-05');
  assert.equal(h.requests.length, 0, 'source rendering is not a plan write or a new external source read');
});

test('R11/G4 exact older shopping source exposes recorded alternatives without changing the manually selected product', async () => {
  const initial = await fixture();
  initial.state.shoppingDrafts = Array.from({ length: 10 }, (_, index) => ({ id: 'synthetic-draft-' + index, revision: 3, planRevision: 2,
    status: 'draft', estimatedProductsDkk: 25, items: [{ lineId: 'exact-line-' + index, ingredient: 'ris', neededQuantity: 500, unit: 'g',
      productId: '502', quantity: 1, needsReview: true,
      candidates: [{ Id: '501', Name: 'Ris', Price: 20, Unit: '500 g' }, { Id: '502', Name: 'Ris', Price: 25, Unit: '500 g' }],
      productObservations: { '501': { observedAt: '2026-11-05T07:00:00Z', available: true, availabilityKnown: true },
        '502': { observedAt: '2026-11-05T08:00:00Z', available: true, availabilityKnown: true } } }] }));
  const before = structuredClone(initial.state.shoppingDrafts);
  const h = await fixture({ state: initial.state, sourceId: 'shopping-draft:synthetic-draft-9:exact-line-9' });
  await h.showShopping();
  assert.equal(h.shoppingRoot.children.length, 8);
  const card = h.shoppingRoot.children[0], line = card.querySelector('[data-shopping-line-id="exact-line-9"]');
  assert.equal(card.dataset.recordKey, 'shopping-draft:synthetic-draft-9'); assert.ok(line);
  assert.equal(line.querySelector('select').value, '502', 'source navigation never simulates a different owner product choice');
  const observations = line.querySelector('.meal-product-observations');
  assert.match(observations.textContent, /Vare 501.*20,00.*07:00:00Z/);
  assert.match(observations.textContent, /Vare 502.*25,00.*08:00:00Z/);
  assert.deepEqual(h.state.shoppingDrafts, before);
  assert.deepEqual(h.requests.map(({ path, method }) => ({ path, method })), [{ path: '/api/shopping-drafts', method: 'GET' }]);
});

async function shoppingFixture({ changed = false, excluded = false } = {}) {
  const h = await fixture(), plan = h.state.mealPlans[0];
  await h.planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: plan.dishes.map((dish, index) => ({ date: dish.date,
    ...(index ? { skip: true } : { title: 'Syntetisk risret', diet: 'vegan', ingredients: [{ name: 'ris', quantity: 250, unit: 'g' }] }) })) });
  await h.planner.buildShoppingList(plan.id, { expectedRevision: plan.revision });
  await h.planner.editShoppingList(plan.id, { expectedRevision: plan.revision, items: [{ name: 'ris', quantity: excluded ? 0 : 1000, unit: 'g' }] });
  if (changed) {
    await h.planner.updatePlan(plan.id, { expectedRevision: plan.revision, dishes: plan.dishes.map((dish, index) => ({ date: dish.date, ...(!index ? { servings: 4 } : {}) })) });
    await h.planner.buildShoppingList(plan.id, { expectedRevision: plan.revision });
  }
  h.show(h.planner.plans()); return { ...h, plan, card: h.root.children[0] };
}

test('G1 UI shows absolute choice, new/old calculated need, source revision and blocked product lookup until explicit review', async () => {
  const h = await shoppingFixture({ changed: true }), review = h.card.querySelector('.meal-shopping-review');
  assert.match(review.textContent, /dit valg: 1000 g/); assert.match(review.textContent, /beregnet at tilføje: 500 g/);
  assert.match(review.textContent, /Oprindeligt beregnet behov: 250 g/); assert.match(review.textContent, /planrevision/);
  assert.match(review.textContent, /Grundlaget.*ændret/); assert.equal(button(h.card, 'Find varer på Nemlig').disabled, true);
  assert.equal(button(h.card, 'Gem rettelser til listen').disabled, false);
  assert.ok(review.querySelectorAll('a').some(link => link.href.includes(encodeURIComponent('meal-plan:' + h.plan.id + ':' + h.plan.dishes[0].date))));
  const revision = h.plan.revision;
  await button(h.card, 'Gem rettelser til listen').emit('click');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'PUT'); assert.equal(h.requests[0].body.expectedRevision, revision);
  assert.equal(h.plan.shoppingNeedsReview, false); assert.equal(h.plan.shoppingList[0].quantity, 1000);
  assert.equal(button(h.root.children[0], 'Find varer på Nemlig').disabled, false);
});

test('G1 explicit reset is a revision-bound local save of the chosen calculated amount, never a basket write', async () => {
  const h = await shoppingFixture({ changed: true }), revision = h.plan.revision;
  const reset = h.card.querySelector('[data-shopping-reset="ris|g"]');
  assert.equal(reset.disabled, false); await reset.emit('click');
  assert.deepEqual(h.requests.map(request => [request.method, request.path]), [['PUT', '/api/meals/plans/' + h.plan.id + '/shopping-list']]);
  assert.equal(h.requests[0].body.expectedRevision, revision); assert.deepEqual(h.requests[0].body.useComputed, [{ name: 'ris', unit: 'g' }]);
  assert.equal(h.plan.shoppingList[0].quantity, 500); assert.deepEqual(h.plan.manualShoppingOverrides, []);
  assert.equal(h.plan.shoppingNeedsReview, false);
});

test('R03/G1 incomplete quantity edits preserve focus, raw draft and old revision through poll/reload and cannot be discarded by reset', async () => {
  const h = await shoppingFixture({ changed: true }), input = listQuantity(h.card);
  const revision = h.plan.revision; input.value = ''; input.focus(); input.selectionStart = 0; input.selectionEnd = 0; await input.emit('input');
  assert.equal(h.card.querySelector('[data-shopping-reset="ris|g"]').disabled, true);
  await h.card.querySelector('[data-shopping-reset="ris|g"]').emit('click'); assert.equal(h.requests.length, 0);
  await h.planner.editShoppingList(h.plan.id, { expectedRevision: revision, items: [{ name: 'ris', quantity: 1100, unit: 'g' }] });
  h.show(h.planner.plans()); assert.equal(h.root.children[0], h.card); assert.equal(h.document.activeElement, input); assert.equal(input.value, '');
  assert.equal(h.document.focusDetachments, 0); h.persist();
  const reloaded = await fixture({ state: h.state, saved: h.saved }), card = reloaded.root.children[0];
  assert.equal(card.dataset.revision, String(revision)); assert.equal(listQuantity(card).value, '');
  const field = listQuantity(card); field.value = '900'; await field.emit('input');
  await button(card, 'Gem rettelser til listen').emit('click');
  assert.equal(reloaded.requests[0].body.expectedRevision, revision); assert.match(card.querySelector('[data-edit-status]').textContent, /revision/);
  assert.equal(field.value, '900'); assert.equal(h.plan.shoppingList[0].quantity, 1100);
});

test('G1 UI accepts explicit zero and honestly explains that an empty choice is not confirmed inventory', async () => {
  const h = await shoppingFixture(), input = listQuantity(h.card);
  input.value = '0'; await input.emit('input'); await button(h.card, 'Gem rettelser til listen').emit('click');
  assert.equal(h.requests[0].body.items[0].quantity, 0); assert.deepEqual(h.plan.shoppingList, []);
  const card = h.root.children[0]; assert.match(card.textContent, /Du har udeladt varer/); assert.match(card.textContent, /ikke dokumentation/);
  assert.match(card.querySelector('.meal-shopping-review').textContent, /eksplicit udeladt/);
  assert.match(card.querySelector('.meal-price-summary').textContent, /eksplicitte udeladelser/);
});

test('G1/A1 a successful list acknowledgement with a failed refresh remains saved and does not retry itself', async () => {
  const h = await shoppingFixture({ changed: true }); h.failRefresh(new Error('Syntetisk visningsfejl'));
  const save = button(h.card, 'Gem rettelser til listen'); await save.emit('click');
  assert.equal(h.plan.shoppingNeedsReview, false); assert.equal(save.disabled, true); assert.equal(h.requests.length, 1);
  assert.match(h.card.querySelector('[data-edit-status]').textContent, /Listen er gemt, men visningen/);
  await save.emit('click'); assert.equal(h.requests.length, 1);
});
