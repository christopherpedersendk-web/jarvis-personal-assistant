import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RecipeMemory } from '../recipe-memory.mjs';
import { PersonalKnowledge } from '../personal-knowledge.mjs';

// Contract tests for the async route coordinator. This is intentionally a small
// DOM double, not evidence of real browser focus, layout or accessibility.
const source = await readFile(new URL('../public/intelligence.js', import.meta.url), 'utf8');
const bootEnd = source.indexOf('\nfunction knowledgeElement(');
assert.ok(bootEnd > 0);

function fixture(initialSource = null) {
  const selected = new Set();
  const targets = new Map();
  const events = new Map();
  const pending = [];
  const renders = [];
  const dateInput = { value: '' };
  const status = { textContent: '', classList: { toggle() {} } };
  const root = { querySelector: () => status };
  const window = { location: { href: 'https://synthetic.invalid/?view=meals' } };
  const route = id => { const url = new URL(window.location.href);
    if (id) url.searchParams.set('source', id); else url.searchParams.delete('source'); window.location.href = url.href; };
  route(initialSource);
  const makeTarget = selector => {
    const target = { scrolled: 0,
      classList: { add: () => selected.add(selector), remove: () => selected.delete(selector) },
      scrollIntoView: () => { target.scrolled++; } };
    targets.set(selector, target); return target;
  };
  const document = {
    getElementById: id => id === 'meal-family-start' ? dateInput : id.startsWith('tab-') ? root : null,
    querySelector: selector => targets.get(selector) || null,
    querySelectorAll: selector => selector === '.source-target' ? [...selected].map(id => targets.get(id)) : [],
    addEventListener: (type, listener) => { if (!events.has(type)) events.set(type, []); events.get(type).push(listener); },
    dispatchEvent: event => { for (const listener of events.get(event.type) || []) listener(event); },
  };
  const context = vm.createContext({ document, window, URL, Date, Promise,
    CSS: { escape: value => value }, setTimeout: action => { action(); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    refreshMeals: () => new Promise(resolve => pending.push(resolve)),
    showHousehold: () => { renders.push(dateInput.value); makeTarget(`[data-household-date="${dateInput.value}"]`); },
    mealData: { household: { configured: true, adults: 2, children: [] } }, selectTab() {},
  });
  vm.runInContext(source.slice(0, bootEnd) + '\nglobalThis.openSource = focusRecordedSource;', context);
  return { open: context.openSource, pending, route, renders, selected, targets, makeTarget, document, status, dateInput };
}

test('R11 exact household date renders after its awaited refresh without a synthetic button click', async () => {
  const f = fixture('household:2026-12-20');
  const result = f.open('household:2026-12-20');
  assert.equal(f.dateInput.value, '2026-12-20'); assert.deepEqual(f.renders, []);
  f.pending.shift()(); await result;
  assert.deepEqual(f.renders, ['2026-12-20']);
  assert.deepEqual([...f.selected], ['[data-household-date="2026-12-20"]']);
});

test('R11 a slower previous date cannot replace or highlight the newer source route', async () => {
  const f = fixture('household:2026-12-20');
  const older = f.open('household:2026-12-20');
  f.route('household-day:2026-12-21');
  const newer = f.open('household-day:2026-12-21');
  f.pending[1](); await newer;
  f.pending[0](); await older;
  assert.deepEqual(f.renders, ['2026-12-21']);
  assert.deepEqual([...f.selected], ['[data-household-date="2026-12-21"]']);
});

test('R11 back/navigation away cancels a pending source highlight and date render', async () => {
  const f = fixture('household-rhythm:2026-12-21');
  const opening = f.open('household-rhythm:2026-12-21');
  f.route(null);
  f.document.dispatchEvent({ type: 'jarvis:source-route', detail: { id: null } });
  f.pending.shift()(); await opening;
  assert.deepEqual(f.renders, []); assert.deepEqual([...f.selected], []);
});

test('R11 invalid source date does not open a guessed neighbouring day', async () => {
  const f = fixture('household:2026-02-30');
  await f.open('household:2026-02-30');
  assert.equal(f.pending.length, 0); assert.equal(f.dateInput.value, '');
  assert.match(f.status.textContent, /ugyldig dato/); assert.deepEqual([...f.selected], []);
});

test('R11 exact recipe source highlights only the requested card after refresh', async () => {
  const f = fixture('recipe:chosen');
  const wrong = f.makeTarget('[data-record-key="recipe:first"]');
  const correct = f.makeTarget('[data-record-key="recipe:chosen"]');
  const opening = f.open('recipe:chosen'); f.pending.shift()(); await opening;
  assert.equal(wrong.scrolled, 0); assert.equal(correct.scrolled, 1);
  assert.deepEqual([...f.selected], ['[data-record-key="recipe:chosen"]']);
});

test('R11 copied source URL is preserved by application initialization', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const begin = app.indexOf('\ninitializeDashboard();');
  const end = app.indexOf('\nwindow.addEventListener(\'popstate\'', begin);
  assert.ok(begin > 0 && end > begin);
  const called = [];
  vm.runInNewContext(app.slice(begin, end), {
    initializeDashboard() {}, URL,
    window: { location: { href: 'https://synthetic.invalid/?view=meals&source=household%3A2026-12-20' } },
    sessionStorage: { getItem: () => 'home' }, selectTab: (view, options) => called.push({ view, ...options }),
  });
  assert.deepEqual(called, [{ view: 'meals', replace: true, sourceId: 'household:2026-12-20' }]);
});

test('B3/R09 voice household lookup uses the fixed read-only route and encodes the requested date', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const begin = app.indexOf("} else if (call.name === 'get_household_day') {");
  assert.ok(begin > 0);
  const body = app.slice(begin + "} else if (call.name === 'get_household_day') {".length, app.indexOf('} else if', begin + 2));
  const requests = [];
  const operation = vm.runInNewContext(`(async () => { let output; ${body}; return output; })`, {
    args: { date: '2026-12-20/../../not-a-write' }, encodeURIComponent,
    api: async (...arguments_) => { requests.push(arguments_); return { recorded: { recorded: false }, effective: { known: false } }; },
  });
  const result = await operation();
  assert.deepEqual(requests, [['/api/knowledge/household/2026-12-20%2F..%2F..%2Fnot-a-write']]);
  assert.equal(result.recorded.recorded, false); assert.equal(result.effective.known, false);
});

test('F3/R11 recipe source fixture requires explicit review before retrieval, while a separate local draft changes no facts', async () => {
  const state = {}; let externalReads = 0;
  const recipes = new RecipeMemory({ state, extractor: null, fetchResource: async () => { externalReads++; throw new Error('No external reads in this fixture'); } });
  const knowledge = new PersonalKnowledge({ state });
  const title = 'Syntetisk risret kildekontrakt';
  const received = await recipes.capture({ text: `${title}\n200 g ris\nKog risene.`, source: { channel: 'web' } });
  assert.equal(received.confirmed, false);
  assert.equal(knowledge.search(title, { types: ['recipe'] }).some(match => match.id === `recipe:${received.id}`), false);
  const reviewed = await recipes.update(received.id, { expectedRevision: received.revision, title,
    diet: 'vegan', minutes: 20, servings: 2, ingredients: [{ name: 'ris', quantity: 200, unit: 'g' }], confirmed: true });
  const localDraft = { record: structuredClone(reviewed), fields: { title: 'Ugemt rettelse', ingredients: [{ name: 'Ny vare', quantity: '' }] } };
  const matches = knowledge.search(title, { types: ['recipe'] });
  assert.equal(matches[0].id, `recipe:${received.id}`); assert.equal(matches[0].source.revision, reviewed.revision);
  assert.equal(recipes.get(received.id).title, title); assert.equal(recipes.get(received.id).confirmed, true);
  assert.equal(localDraft.fields.ingredients[0].quantity, ''); assert.equal(externalReads, 0);
});
