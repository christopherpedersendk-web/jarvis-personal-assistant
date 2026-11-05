import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MealPlanner } from '../meal-planner.mjs';

// Small DOM contract double, not browser-emulation evidence. In particular,
// removing/moving a focused subtree deliberately blurs it just as appendChild
// through a fragment would in a browser. Real Chromium/WebKit are a separate gate.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.parentNode = null;
    this.children = []; this.dataset = {}; this.attributes = {}; this.events = new Map();
    this.className = ''; this.id = ''; this._value = ''; this._text = ''; this.checked = false;
    this.disabled = false; this.hidden = false; this.open = false;
    this.classList = { contains: value => this.className.split(/\s+/).includes(value),
      toggle: (value, active) => { const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (active ?? !values.has(value)) values.add(value); else values.delete(value); this.className = [...values].join(' '); } };
  }
  get value() { return this._value; }
  set value(value) { this._value = value == null ? '' : String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get childNodes() { return this.children; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (node.parentNode) node.remove();
    if (anchor && anchor.parentNode !== this) throw new Error('Invalid insertion anchor');
    this.children.splice(anchor ? this.children.indexOf(anchor) : this.children.length, 0, node); node.parentNode = this;
  }
  remove() {
    if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      const data = /^\[data-([\w-]+)\]$/.exec(part);
      if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
      return this.tagName.toLowerCase() === part;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, action) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(action); }
  async emit(name) { for (const action of this.events.get(name) || []) await action({ target: this, preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
}

const source = await readFile(new URL('../public/meals.js', import.meta.url), 'utf8');
const bootStart = source.indexOf('\nlet calendarSelectionDirty = false;');
assert.ok(bootStart > 0, 'UI helpers must precede browser bootstrap');
const plain = value => JSON.parse(JSON.stringify(value));
function ui({ saved = new Map(), authenticated = true, storageBlocked = false, sourceId = null } = {}) {
  const document = { focusDetachments: 0, activeElement: null };
  document.createElement = tag => new Element(document, tag);
  document.body = document.createElement('body'); document.activeElement = document.body;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.getElementById = id => {
    const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(document.body) || null;
  };
  let calls = 0;
  const context = vm.createContext({ document, Intl, Date, URL, console, structuredClone,
    window: { location: { href: 'https://synthetic.invalid/?view=meals' + (sourceId ? '&source=' + encodeURIComponent(sourceId) : '') } },
    localStorage: { getItem: () => authenticated ? 'synthetic-owner-token-not-for-storage' : null },
    sessionStorage: { getItem: key => saved.get(key) || null,
      setItem: (key, value) => { if (storageBlocked) throw new Error('storage denied'); saved.set(key, value); }, removeItem: key => saved.delete(key) },
    api: async () => { calls++; throw new Error('No requests are allowed in this UI contract fixture'); }, toast() {} });
  vm.runInContext(source.slice(0, bootStart) + `\nglobalThis.contract = {
    sync: mealSyncCards, node: mealNode, register: mealRegisterDraft, persist: mealPersistDrafts, clear: mealClearDraft,
    markDirty: key => mealDirty.add(key), dirty: key => mealDirty.has(key), storageReady: () => mealDraftStorageAvailable,
    ingredients: mealIngredientEditor, children: mealChildrenEditor, rhythm: mealBuildRhythmEditor, dish: mealDishEditor,
    portions: mealPortionsText, ageText: mealAgeText, setRecipes: value => { mealData.recipes = value; },
    renderRecipes: showRecipes,
  };`, context);
  return { ...context.contract, document, saved, calls: () => calls };
}

function simpleCard(harness, record, key) {
  const card = harness.node('article'); const input = harness.node('input'); input.value = record.title;
  const status = harness.node('p'); status.dataset.editStatus = ''; card.append(input, status);
  harness.register(key, record, () => ({ title: input.value }), fields => { input.value = fields.title; }, status);
  return card;
}

test('R03/K5 polling preserves the exact input node, focus and selection while imports add neighbouring records', () => {
  const h = ui(); const root = h.node('div'); h.document.body.append(root);
  const records = [{ id: 'one', revision: 1, title: 'Gemte data' }, { id: 'two', revision: 1, title: 'Anden post' }];
  let renders = 0;
  const render = (record, key) => { renders++; return simpleCard(h, record, key); };
  h.sync(root, records, 'recipe', render, 'Tom');
  const card = root.children[0]; const input = card.querySelector('input'); input.value = 'Ugemt rettelse';
  input.selectionStart = 3; input.selectionEnd = 8; input.focus(); h.markDirty('recipe:one');
  h.sync(root, [{ id: 'import', revision: 1, title: 'Ny import' }, { ...records[0], revision: 2 }, records[1]], 'recipe', render, 'Tom');
  h.sync(root, [{ id: 'import', revision: 1, title: 'Ny import' }, { ...records[0], revision: 2 }, records[1]], 'recipe', render, 'Tom');
  assert.equal(h.document.activeElement, input); assert.equal(h.document.focusDetachments, 0);
  assert.equal(card.querySelector('input'), input); assert.equal(input.value, 'Ugemt rettelse');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 8]);
  assert.match(card.querySelector('[data-edit-status]').textContent, /ændret et andet sted/);
  assert.equal(renders, 3, 'unchanged neighbouring records are not rerendered either');
  assert.equal(h.calls(), 0);
});

test('K5 reload restores dirty values against the old revision, and only explicit discard adopts the new revision', () => {
  const first = ui(); const root = first.node('div'); first.document.body.append(root);
  first.sync(root, [{ id: 'one', revision: 4, title: 'Oprindelig' }], 'recipe', (r, k) => simpleCard(first, r, k), 'Tom');
  root.querySelector('input').value = 'Min ugemte rettelse'; first.markDirty('recipe:one'); first.persist();
  const serialized = first.saved.get('jarvis:v5:meal-drafts');
  assert.equal(JSON.parse(serialized).drafts['recipe:one'].record.revision, 4);
  assert.equal(serialized.includes('synthetic-owner-token'), false);
  const second = ui({ saved: first.saved }); const nextRoot = second.node('div'); second.document.body.append(nextRoot);
  const newer = [{ id: 'one', revision: 5, title: 'Nye serverdata' }];
  second.sync(nextRoot, newer, 'recipe', (r, k) => simpleCard(second, r, k), 'Tom');
  assert.equal(nextRoot.querySelector('input').value, 'Min ugemte rettelse');
  assert.equal(nextRoot.children[0].dataset.revision, '4'); assert.equal(second.dirty('recipe:one'), true);
  assert.match(nextRoot.querySelector('[data-edit-status]').textContent, /ændret et andet sted/);
  assert.equal(second.calls(), 0, 'restoring a draft must not save or approve anything');
  second.clear('recipe:one'); second.sync(nextRoot, newer, 'recipe', (r, k) => simpleCard(second, r, k), 'Tom');
  assert.equal(nextRoot.querySelector('input').value, 'Nye serverdata');
  assert.equal(nextRoot.children[0].dataset.revision, '5'); assert.equal(second.saved.has('jarvis:v5:meal-drafts'), false);
});

test('K5 a removed source keeps its unsaved draft inspectable after reload without treating it as a new source', () => {
  const saved = new Map([['jarvis:v5:meal-drafts', JSON.stringify({ version: 1, drafts: {
    'recipe:removed': { record: { id: 'removed', revision: 2, title: 'Original' }, fields: { title: 'Min kladde' } },
  } })]]);
  const h = ui({ saved }); const root = h.node('div'); h.document.body.append(root);
  h.sync(root, [], 'recipe', (r, k) => simpleCard(h, r, k), 'Tom');
  assert.equal(root.querySelector('input').value, 'Min kladde');
  assert.match(root.querySelector('[data-edit-status]').textContent, /Kilden findes ikke/);
  assert.equal(root.children[0].dataset.revision, '2'); assert.equal(h.calls(), 0);
});

test('K3/K5 incomplete added ingredient rows survive structured draft round-trip without coercion or auto-save', () => {
  const h = ui(); const editor = h.ingredients([{ name: 'Ris', quantity: 500, unit: 'g' }]);
  const raw = [{ name: 'Ris', quantity: '500', unit: 'g' }, { name: 'Ufærdig vare', quantity: '', unit: 'stk' }];
  editor.restore(raw); assert.deepEqual(plain(editor.snapshot()), raw); assert.throws(() => editor.read(), /Udfyld/);
  h.register('plan:synthetic', { id: 'synthetic', revision: 8 }, () => ({ items: editor.snapshot() }), () => {}, null);
  h.markDirty('plan:synthetic'); h.persist();
  const reloaded = ui({ saved: h.saved }); const recovered = reloaded.ingredients([]);
  reloaded.register('plan:synthetic', { id: 'synthetic', revision: 8 }, () => ({ items: recovered.snapshot() }), fields => recovered.restore(fields.items), null);
  assert.deepEqual(plain(recovered.snapshot()), raw); assert.throws(() => recovered.read(), /Udfyld/);
  assert.equal(reloaded.calls(), 0);
});

test('K5 changing meal portions never destroys an incomplete manual ingredient row', async () => {
  const planner = new MealPlanner({ state: {}, now: () => new Date('2026-11-05T12:00:00Z') });
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 1 });
  const h = ui(); h.setRecipes(planner.recipes()); const editor = h.dish(plan.dishes[0], () => {});
  const inputs = editor.element.querySelector('.meal-ingredient-editor').querySelectorAll('input');
  inputs[0].value = 'Manuel uafsluttet vare'; inputs[1].value = ''; await inputs[1].emit('input');
  const servings = editor.element.querySelector('.meal-dish-fields').querySelector('input'); servings.value = '5'; await servings.emit('input');
  assert.equal(editor.snapshot().ingredients[0].name, 'Manuel uafsluttet vare'); assert.equal(editor.snapshot().ingredients[0].quantity, '');
  assert.throws(() => editor.collect(), /Udfyld/);
});

test('D2 age freshness changes only when age is edited or explicitly checked, never on portion edits', async () => {
  const h = ui(); const editor = h.children([{ age: 4, portion: 0.5, ageRecordedAt: '2020-01-01' }]);
  assert.match(editor.element.textContent, /Over ét år gammel/);
  const [age, portion] = editor.element.querySelectorAll('input'); portion.value = '0.75'; await portion.emit('input');
  assert.equal(editor.read()[0].ageRecordedAt, '2020-01-01');
  age.value = '5'; await age.emit('input');
  assert.notEqual(editor.read()[0].ageRecordedAt, '2020-01-01');
  assert.equal(editor.read()[0].age, 5);
  assert.match(h.ageText(null), /dato er ukendt/);
});

test('D2 displayed adult, child and guest portion arithmetic agrees with the domain calculation', async () => {
  const planner = new MealPlanner({ state: {} });
  await planner.setHousehold({ adults: 2, adultPortion: 1.25, children: [{ age: 9, portion: 0.75 }] });
  await planner.setDay('2026-11-05', { guests: { adults: 1, adultPortion: 1.5, children: [{ age: 4, portion: 0.5 }] } });
  const day = planner.attendanceFor('2026-11-05');
  const text = ui().portions(day.adults, day.children, day.adultPortion, day.guests);
  assert.equal(day.servings, 5.25); assert.match(text, /^5,25 portioner/);
  assert.match(text, /voksne gæster à 1,5/); assert.match(text, /gæstebørn à 0,5/);
});

test('K5 private-session recovery requires authentication and blocked session storage stays visibly unsaved', () => {
  const saved = new Map([['jarvis:v5:meal-drafts', JSON.stringify({ version: 1, drafts: {
    'recipe:one': { record: { id: 'one', revision: 1 }, fields: { title: 'Privat syntetisk kladde' } },
  } })]]);
  ui({ saved, authenticated: false }); assert.equal(saved.has('jarvis:v5:meal-drafts'), false);
  const blocked = ui({ storageBlocked: true }); const status = blocked.node('p'); const input = blocked.node('input'); input.value = 'Ugemt';
  blocked.register('recipe:one', { id: 'one', revision: 1 }, () => ({ title: input.value }), () => {}, status);
  blocked.markDirty('recipe:one'); blocked.persist();
  assert.equal(blocked.storageReady(), false); assert.equal(input.value, 'Ugemt');
  assert.match(status.textContent, /Browseren kan ikke sikre/); assert.equal(blocked.calls(), 0);
});

test('R11 exact older recipe is retained beyond the bounded first thirty overview records', () => {
  const h = ui({ sourceId: 'recipe:older' }); const root = h.node('div'); root.id = 'meal-recipes'; h.document.body.append(root);
  const recipe = (id, revision = 1) => ({ id, revision, title: id, status: 'inbox', processingStatus: 'review_required', ingredients: [] });
  h.renderRecipes([...Array.from({ length: 35 }, (_, index) => recipe(`new-${index}`)), recipe('older')]);
  assert.equal(root.children.length, 30);
  assert.equal(root.children[0].dataset.recordKey, 'recipe:older');
  assert.equal(h.calls(), 0, 'source rendering is not an extraction, save or approval');
});

test('F1/K5 explicit resume cannot overwrite an incomplete dirty recipe draft', async () => {
  const h = ui(); const root = h.node('div'); root.id = 'meal-recipes'; h.document.body.append(root);
  h.renderRecipes([{ id: 'interrupted', revision: 3, title: 'Gemt kilde', status: 'inbox', confirmed: false,
    processingStatus: 'error', ingredients: [], extraction: { messages: ['Syntetisk afbrudt udtræk'] } }]);
  const card = root.children[0]; const title = card.querySelector('input'); title.value = 'Min ugemte rettelse';
  h.markDirty('recipe:interrupted');
  const resume = card.querySelectorAll('button').find(button => button.textContent === 'Genoptag udtræk');
  assert.ok(resume); await resume.emit('click');
  assert.equal(h.calls(), 0); assert.equal(title.value, 'Min ugemte rettelse');
  assert.match(card.querySelector('[data-edit-status]').textContent, /lokale rettelser er bevaret/);
});
