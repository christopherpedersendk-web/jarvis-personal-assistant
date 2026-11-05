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
  const reads = [];
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
    refreshShoppingDrafts: () => new Promise(resolve => pending.push(resolve)),
    refreshNemlig: () => { reads.push('/api/nemlig/status'); return new Promise(resolve => pending.push(resolve)); },
    showHousehold: () => { renders.push(dateInput.value); makeTarget(`[data-household-date="${dateInput.value}"]`); },
    mealData: { household: { configured: true, adults: 2, children: [] } }, selectTab() {},
  });
  vm.runInContext(source.slice(0, bootEnd) + '\nglobalThis.openSource = focusRecordedSource;', context);
  return { open: context.openSource, pending, route, renders, reads, selected, targets, makeTarget, document, status, dateInput, window };
}

test('R11 unknown basket outcome source opens exactly its local proposal, never refreshing or writing the basket', async () => {
  const f = fixture('nemlig-proposal:chosen');
  const other = f.makeTarget('[data-record-key="nemlig-proposal:other"]');
  const exact = f.makeTarget('[data-record-key="nemlig-proposal:chosen"]');
  const opening = f.open('nemlig-proposal:chosen'); f.pending.shift()(); await opening;
  assert.equal(exact.scrolled, 1); assert.equal(other.scrolled, 0);
  assert.deepEqual(f.reads, ['/api/nemlig/status']); assert.equal(f.dateInput.value, '');
});

test('R11 missing or malformed basket proposal source never silently substitutes another proposal', async () => {
  const f = fixture('nemlig-proposal:missing');
  const other = f.makeTarget('[data-record-key="nemlig-proposal:other"]');
  const opening = f.open('nemlig-proposal:missing'); f.pending.shift()(); await opening;
  assert.match(f.status.textContent, /kan ikke åbnes/); assert.equal(other.scrolled, 0);
  f.route('nemlig-proposal:other:extra'); await f.open('nemlig-proposal:other:extra');
  assert.equal(other.scrolled, 0); assert.deepEqual(f.reads, ['/api/nemlig/status']);
});

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

test('R11 note source awaits actual memory reconciliation and cannot select a stale card', async () => {
  const f = fixture('memory:chosen');
  let finish;
  f.document.addEventListener('jarvis:memories-changed', event => event.detail.waitUntil(new Promise(resolve => { finish = resolve; })));
  const opening = f.open('memory:chosen'); assert.deepEqual([...f.selected], []);
  f.makeTarget('[data-memory-id="chosen"]'); finish(); await opening;
  assert.deepEqual([...f.selected], ['[data-memory-id="chosen"]']);
});

test('R11/E1 a dated meal source opens that exact date, not the first day or parent plan', async () => {
  const f = fixture('meal-plan:chosen:2026-12-21');
  const parent = f.makeTarget('[data-record-key="plan:chosen"]');
  const other = f.makeTarget('[data-record-key="plan:chosen"] [data-meal-date="2026-12-20"]');
  const correct = f.makeTarget('[data-record-key="plan:chosen"] [data-meal-date="2026-12-21"]');
  const opening = f.open('meal-plan:chosen:2026-12-21');
  assert.deepEqual([...f.selected], []); f.pending.shift()(); await opening;
  assert.equal(parent.scrolled, 0); assert.equal(other.scrolled, 0); assert.equal(correct.scrolled, 1);
});

test('R11/E1 an invalid meal date is rejected before any refresh or guessed source', async () => {
  const f = fixture('meal-plan:chosen:2026-02-30');
  await f.open('meal-plan:chosen:2026-02-30');
  assert.equal(f.pending.length, 0); assert.deepEqual([...f.selected], []);
  assert.match(f.status.textContent, /ugyldig dato/);
});

test('R11/G3 a price observation awaits the exact shopping draft line without changing a product', async () => {
  const f = fixture('shopping-draft:chosen:line-two');
  const wrong = f.makeTarget('[data-record-key="shopping-draft:chosen"] [data-shopping-line-id="line-one"]');
  const correct = f.makeTarget('[data-record-key="shopping-draft:chosen"] [data-shopping-line-id="line-two"]');
  const opening = f.open('shopping-draft:chosen:line-two');
  assert.deepEqual([...f.selected], []); f.pending.shift()(); await opening;
  assert.equal(wrong.scrolled, 0); assert.equal(correct.scrolled, 1);
  assert.deepEqual(f.renders, [], 'price source navigation does not rebuild attendance or meals');
});

test('R11 a missing price source line cannot fall back to a different product or draft', async () => {
  const f = fixture('shopping-draft:chosen:missing');
  const wrong = f.makeTarget('[data-record-key="shopping-draft:chosen"] [data-shopping-line-id="first"]');
  const opening = f.open('shopping-draft:chosen:missing'); f.pending.shift()(); await opening;
  assert.equal(wrong.scrolled, 0); assert.deepEqual([...f.selected], []);
  assert.match(f.status.textContent, /kan ikke åbnes/);
});

test('R11 memory source tells the shared editor the exact ID, including read-only archived history', async () => {
  const f = fixture('memory:archived-exact'); let received;
  f.document.addEventListener('jarvis:memories-changed', event => {
    received = event.detail.sourceId; f.makeTarget('[data-memory-id="archived-exact"]');
    event.detail.waitUntil(Promise.resolve());
  });
  await f.open('memory:archived-exact'); assert.equal(received, 'memory:archived-exact');
  assert.deepEqual([...f.selected], ['[data-memory-id="archived-exact"]']);
});

test('R11 claim source exposes its exact ID so hidden planning domains need not be fetched', async () => {
  const f = fixture('claim:exact'); let received;
  f.document.addEventListener('jarvis:v5-sources-changed', event => { received = event.detail.sourceId;
    f.makeTarget('[data-claim-id="exact"]'); event.detail.waitUntil(Promise.resolve()); });
  await f.open('claim:exact'); assert.equal(received, 'claim:exact');
  assert.deepEqual([...f.selected], ['[data-claim-id="exact"]']);
});

const calendarSource = (date = '2026-11-05', event = 'event:exact') =>
  `google-calendar:primary:${date}:${encodeURIComponent(event)}:${encodeURIComponent('2026-11-05T12:00:00.000Z')}`;

test('R11 exact calendar navigation binds calendar, event, date and cache version without a provider read', async () => {
  const id = calendarSource(), f = fixture(id); let received, ready;
  f.window.openRecordedCalendarSource = (key, { isCurrent }) => {
    received = key; assert.equal(isCurrent(), true);
    return new Promise(resolve => { ready = resolve; });
  };
  const wrong = f.makeTarget(`[data-calendar-source-id="${calendarSource('2026-11-05', 'other')}"]`);
  const right = f.makeTarget(`[data-calendar-source-id="${id}"]`);
  const pending = f.open(id); assert.equal(received, id); assert.equal(right.scrolled, 0);
  ready(true); await pending; assert.equal(right.scrolled, 1); assert.equal(wrong.scrolled, 0);
  assert.equal(f.pending.length, 0, 'does not refresh meals, calendar upstream or retailer data');
});

test('R11 missing calendar version cannot select a retained stale DOM card', async () => {
  const id = calendarSource(), f = fixture(id); f.window.openRecordedCalendarSource = async () => false;
  const stale = f.makeTarget(`[data-calendar-source-id="${id}"]`); await f.open(id);
  assert.equal(stale.scrolled, 0); assert.match(f.status.textContent, /ikke længere.*cache/);
});

test('R11 malformed calendar sources are rejected before even a local read', async () => {
  for (const id of [calendarSource('2026-02-30'), 'google-calendar:primary:2026-11-05:missing-version',
    'google-calendar:%invalid:2026-11-05:event:2026-11-05T12%3A00%3A00Z', calendarSource('2026-11-05', '')]) {
    const f = fixture(id); let calls = 0; f.window.openRecordedCalendarSource = async () => { calls++; return true; };
    await f.open(id); assert.equal(calls, 0); assert.equal(f.selected.size, 0); assert.match(f.status.textContent, /Kalenderkilden mangler/);
  }
});

test('R11 navigation away cancels the pending calendar source guard and highlight', async () => {
  const id = calendarSource(), f = fixture(id); let ready, guard;
  f.window.openRecordedCalendarSource = (key, { isCurrent }) => { guard = isCurrent; return new Promise(resolve => { ready = resolve; }); };
  const pending = f.open(id); f.route(null); f.document.dispatchEvent({ type: 'jarvis:source-route', detail: { id: null } });
  assert.equal(guard(), false); f.makeTarget(`[data-calendar-source-id="${id}"]`); ready(true); await pending;
  assert.equal(f.selected.size, 0);
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
  assert.equal(called.length, 1);
  assert.deepEqual({ view: called[0].view, replace: called[0].replace, sourceId: called[0].sourceId },
    { view: 'meals', replace: true, sourceId: 'household:2026-12-20' });
  assert.equal(called[0].preserveDestination, false, 'an old alias may resolve to the exact source domain');
  assert.equal(called[0].attention, false);
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
