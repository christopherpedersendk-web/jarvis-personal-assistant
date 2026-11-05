import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildCommandCenter } from '../organizer-core.mjs';

const source = (await readFile(new URL('../public/organizer.js', import.meta.url), 'utf8'))
  .split('// Existing lists are deliberately')[0];
const planHelpers = (await readFile(new URL('../public/v5-plan.js', import.meta.url), 'utf8'))
  .split('// The single structured-memory editor')[0];
const NOW = '2026-11-05T09:00:00.000Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const date = '2026-11-05';
const event = (id = 'one', changes = {}) => ({ id, title: `Syntetisk aftale ${id}`,
  start: '2026-11-05T11:00:00+01:00', end: '2026-11-05T12:00:00+01:00', allDay: false, ...changes });
const snapshot = (events = [event()], changes = {}) => ({ calendarId: 'synthetic:calendar@group.test',
  cacheState: 'ready', ready: true, fetchedAt: '2026-11-05T08:59:00.000Z', expiresAt: '2026-11-05T09:04:00.000Z',
  coverage: { start: '2026-11-05T00:00:00+01:00', end: '2026-11-06T00:00:00+01:00', complete: true },
  events, ...changes });
const sourceId = (cache, id = 'one', day = date) => `google-calendar:${encodeURIComponent(cache.calendarId)}:${day}:${encodeURIComponent(id)}:${encodeURIComponent(cache.fetchedAt)}`;
const task = (id, changes = {}) => ({ id, revision: 2, title: `Personlig opgave ${id}`, status: 'pending',
  durationMinutes: 30, deadline: '2026-11-05T12:00:00Z', ...changes });
const legacyAgenda = () => ({
  today: [{ id: 'date-one', title: 'Gammel dagsdato bevaret', detail: 'Registreret dato', tab: 'organizer' }],
  week: [{ id: 'week-one', title: 'Gammel ugeoversigt bevaret', detail: 'Kilde fra liste', tab: 'organizer' }],
  insights: [{ id: 'partial', title: 'Delvis Nemlig-overførsel skal gennemgås', detail: 'Ingen automatisk gentagelse', priority: 'high', tab: 'meals' },
    { id: 'approval', title: 'Afventer ejerens godkendelse', detail: 'Intet startet', priority: 'high', tab: 'secretary' }],
});
const data = (changes = {}, cache = snapshot()) => ({
  ...buildCommandCenter({ state: { personalTasks: ['a', 'b', 'c', 'd', 'e'].map(id => task(id)),
    mealHousehold: { configured: true, revision: 8, adults: 2, children: [], days: {} },
    mealPlans: [{ id: 'dinner', revision: 3, status: 'draft', dishes: [{ date, title: 'Syntetisk risret', servings: 2, minutes: 20 }] }],
    ...changes }, organizer: { upcoming: () => [] }, now: new Date(NOW), calendarSnapshot: cache }),
  agenda: legacyAgenda(), recentDigests: [],
});

// Executable DOM contracts, not a browser, rendered accessibility or physical
// device check. Detaching a focused node deliberately loses focus in this double.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.events = new Map(); this.dataset = {}; this.attributes = {}; this.style = {};
    this.id = ''; this.className = ''; this._text = ''; this.hidden = false; this.open = false;
    this.classList = { contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => { const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled ?? !names.has(name)) names.add(name); else names.delete(name); this.className = [...names].join(' '); },
      add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false) };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get isConnected() { return this.ownerDocument.body.contains(this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = this.ownerDocument.createTextNode(node); this.insertBefore(node, null); } }
  prepend(...nodes) { for (const node of nodes.reverse()) this.insertBefore(node, this.firstElementChild); }
  insertBefore(node, anchor) {
    if (node === anchor) return;
    if (node.parentNode) node.remove();
    if (anchor && anchor.parentNode !== this) throw new Error('Invalid insertion anchor');
    this.children.splice(anchor ? this.children.indexOf(anchor) : this.children.length, 0, node); node.parentNode = this;
  }
  remove() {
    if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = String(value); }
  getAttribute(key) { return this.attributes[key] ?? this[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('#')) return this.id === part.slice(1);
      if (part.startsWith('.')) return part.slice(1).split('.').every(name => this.classList.contains(name));
      const attr = /^(?:([a-z-]+))?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attr) {
        const [, tag, key, value] = attr, actual = key.startsWith('data-')
          ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] : this.attributes[key] ?? this[key];
        return (!tag || this.tagName.toLowerCase() === tag) && (value === undefined ? actual !== undefined : String(actual) === value);
      }
      return this.tagName.toLowerCase() === part;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, action) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(action); }
  async emit(type, changes = {}) { for (const action of this.events.get(type) || []) await action({ type, target: this, currentTarget: this,
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() {}, ...changes }); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
}

function fixture({ cache = snapshot(), token: initialToken = 'synthetic-owner', response = null } = {}) {
  const document = { activeElement: null, focusDetachments: 0, events: new Map() };
  document.createElement = tag => new Element(document, tag);
  document.createTextNode = text => { const node = document.createElement('text'); node.textContent = text; return node; };
  document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => id === document.body.id ? document.body : document.body.querySelector('#' + id);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  const emitted = [];
  document.addEventListener = (name, callback) => { if (!document.events.has(name)) document.events.set(name, []); document.events.get(name).push(callback); };
  document.dispatchEvent = event => { emitted.push(event); for (const callback of document.events.get(event.type) || []) callback(event); return true; };
  const element = (tag, id, parent = document.body) => { const node = document.createElement(tag); node.id = id; parent.append(node); return node; };
  const home = element('section', 'tab-home');
  element('div', 'home-intelligence', home);
  const details = element('details', 'home-more-details', home); element('summary', 'home-more-summary', details).textContent = 'Flere detaljer og historik';
  element('div', 'home-feed', details); element('div', 'home-legacy-agenda', details); element('section', 'home-calendar-source', details);
  element('div', 'collection-list');
  let token = initialToken;
  const calls = [], selected = [], routed = [];
  const api = async (path, options = {}) => { calls.push({ path, method: options.method || 'GET' });
    assert.equal(options.method || 'GET', 'GET', 'Today/source navigation must never perform a write');
    const url = new URL(path, 'https://synthetic.invalid');
    assert.equal(url.pathname, '/api/google/calendar/cache', 'source navigation must only read the existing local cache');
    assert.equal(url.searchParams.get('days'), '1');
    return response ? response(path, calls.length) : structuredClone(cache);
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return Date.parse(NOW); } }
  const window = { addEventListener() {}, location: { href: 'https://synthetic.invalid/?view=home' },
    openKnowledgeSource: async (...args) => { routed.push(args); return true; } };
  const context = vm.createContext({ document, window, api, Date: FixedDate, URL, Intl, JSON, Object, Promise, Map, Set,
    structuredClone, encodeURIComponent, decodeURIComponent, console, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => key === 'jarvisAccessToken' ? token : null },
    selectTab: (tab, options) => { selected.push({ tab, ...(options || {}) }); }, organizerSession: 0 });
  vm.runInContext(planHelpers + '\n' + source + '\n globalThis.todayContract = {' +
    'renderPersonalAgenda, renderCommandCenter, clear: typeof clearTodayViews === "function" ? clearTodayViews : null };', context);
  const contract = context.todayContract;
  return { document, window, calls, selected, routed, emitted, context, cache,
    byId: id => document.getElementById(id), section: kind => document.querySelector('[data-today-section="' + kind + '"]'),
    render: dashboard => contract.renderPersonalAgenda(dashboard.agenda, dashboard.recentDigests, dashboard.todayOverview),
    renderDashboard: dashboard => contract.renderCommandCenter(dashboard),
    open: async (id, options = {}) => { assert.equal(typeof window.openRecordedCalendarSource, 'function', 'exact cached-calendar source opener must exist');
      return window.openRecordedCalendarSource(id, { isCurrent: () => true, ...options }); },
    clear: () => { assert.equal(typeof contract.clear, 'function', 'logout must clear Today views'); contract.clear(); },
    setToken: value => { token = value; },
  };
}

test('K2 Today renders exactly three compact sections and keeps all priority overflow and old critical insights', () => {
  const h = fixture(), dashboard = data(); h.render(dashboard);
  assert.deepEqual(h.byId('home-intelligence').children.filter(node => node.dataset.todaySection).map(node => node.dataset.todaySection),
    ['priorities', 'household', 'calendar']);
  const priorities = h.section('priorities'), entries = priorities.querySelectorAll('[data-agenda-key]');
  assert.equal(entries.length, 8, 'five personal tasks plus the retained day entry and both critical insights');
  assert.equal(priorities.querySelectorAll('[data-agenda-source-id]').length, 5);
  assert.equal(entries.filter(node => !node.closest('details')).length, 3);
  const overflow = priorities.querySelector('details'); assert.ok(overflow); assert.equal(overflow.open, false);
  assert.equal(overflow.querySelectorAll('[data-agenda-key]').length, 5);
  assert.equal(h.byId('home-more-details').open, false);
  const legacy = h.byId('home-legacy-agenda'); assert.ok(h.byId('home-more-details').contains(legacy));
  for (const group of Object.values(dashboard.agenda)) for (const item of group) assert.ok(legacy.textContent.includes(item.title), item.title);
  assert.match(h.section('household').textContent, /Syntetisk risret/);
  assert.match(h.section('household').textContent, /ikke.*spist|beviser ikke/i);
  assert.equal(h.calls.length, 0);
});

test('K2/R11 source links use exact source IDs, URL/back-forward destinations and visible revisions', async () => {
  const h = fixture(), dashboard = data(); h.render(dashboard);
  const source = dashboard.todayOverview.priorities[0], link = h.document.querySelector('[data-agenda-source-id="' + source.sourceId + '"]');
  assert.ok(link); assert.equal(link.tagName, 'A');
  const url = new URL(link.href, 'https://synthetic.invalid');
  assert.equal(url.searchParams.get('source'), source.sourceId); assert.equal(url.searchParams.get('view'), 'plan');
  assert.match(link.textContent, /revision 2/i);
  await link.emit('click');
  assert.equal(h.selected.at(-1)?.tab, 'plan');
  const navigation = JSON.stringify({ selected: h.selected, routed: h.routed, emitted: h.emitted });
  assert.ok(navigation.includes(source.sourceId), 'source identity must reach the source coordinator, not only its tab');
  assert.equal(h.calls.length, 0);
});

test('K2/R11 modified source clicks retain the real URL without replacing native new-tab navigation', async () => {
  const h = fixture(); h.render(data());
  const link = h.section('priorities').querySelector('[data-agenda-source-id]');
  assert.ok(link?.href.includes('source='));
  let prevented = false;
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])
    await link.emit('click', { ...modifiers, preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(h.selected.length, 0); assert.equal(h.emitted.length, 0);
});

test('K2/R03 unchanged polling retains card/link identity, keyboard focus and expanded overflow', () => {
  const h = fixture(), dashboard = data(); h.render(dashboard);
  const cards = ['priorities', 'household', 'calendar'].map(kind => h.section(kind));
  assert.ok(cards.every(Boolean), 'all Today cards exist');
  const link = cards[0].querySelector('[data-agenda-source-id]'), overflow = cards[0].querySelector('details');
  overflow.open = true; link.focus();
  h.render(structuredClone(dashboard));
  cards.forEach((card, index) => assert.equal(h.section(['priorities', 'household', 'calendar'][index]), card));
  assert.equal(h.section('priorities').querySelector('[data-agenda-source-id]'), link);
  assert.equal(h.document.activeElement, link); assert.equal(h.document.focusDetachments, 0); assert.equal(overflow.open, true);
});

test('K2/G1 only the dashboard labels a retained shopping choice as needing review; original agenda remains unchanged', () => {
  const h = fixture(), dashboard = data();
  dashboard.todayOverview.shoppingReviewPlanIds = ['dinner'];
  dashboard.agenda.insights.push({ id: 'meal:dinner:shopping', title: 'Indkøbslisten er klar til varevalg',
    detail: 'Tidligere beregnede linjer', priority: 'normal', source: { kind: 'meal-plan', id: 'dinner', revision: 3 }, tab: 'meals' });
  const before = structuredClone(dashboard.agenda); h.render(dashboard);
  for (const parent of [h.section('priorities'), h.byId('home-legacy-agenda')]) {
    const row = parent.querySelector('[data-agenda-key="meal:dinner:shopping"]');
    assert.ok(row); assert.match(row.textContent, /Indkøbslisten kræver gennemgang/);
    assert.doesNotMatch(row.textContent, /klar til varevalg/);
    assert.equal(row.querySelector('.agenda-priority').classList.contains('high'), true);
    assert.equal(new URL(row.href, 'https://synthetic.invalid').searchParams.get('source'), 'meal-plan:dinner');
  }
  assert.deepEqual(dashboard.agenda, before); assert.equal(h.calls.length, 0);
});

test('R03 focused legacy details survive polling and visibly defer their refresh until focus leaves', () => {
  const h = fixture(), before = data();
  before.briefing = { taskTitle: 'Syntetisk rapport', at: NOW, result: 'Tidligere rapportversion' };
  h.renderDashboard(before);
  const feed = h.byId('home-feed'), first = feed.firstElementChild, details = first.querySelector('details');
  details.open = true; const focused = details.querySelector('summary'); focused.focus();
  const changed = structuredClone(before); changed.briefing.result = 'Ny rapportversion efter polling';
  h.renderDashboard(changed);
  assert.equal(feed.firstElementChild, first); assert.equal(h.document.activeElement, focused);
  assert.equal(h.document.focusDetachments, 0); assert.equal(details.open, true);
  assert.match(feed.textContent, /Tidligere rapportversion/); assert.doesNotMatch(feed.textContent, /Ny rapportversion efter polling/);
  assert.match(feed.textContent, /Detaljerne opdateres, når fokus er flyttet/);
  h.document.body.focus(); h.renderDashboard(changed);
  assert.match(feed.textContent, /Ny rapportversion efter polling/);
  assert.equal(h.calls.length, 0);
});

test('K2 unknown household/calendar stay unknown without inferred attendance, hidden upstream reads or writes', () => {
  const h = fixture(), dashboard = data({ mealHousehold: undefined, mealPlans: [], personalTasks: [] }, null); h.renderDashboard(dashboard);
  assert.ok(h.section('household')); assert.ok(h.section('calendar'));
  assert.match(h.section('household').textContent, /ikke oplyst|ukendt/i);
  assert.match(h.section('calendar').textContent, /ukendt|ikke læst/i);
  assert.doesNotMatch(h.section('household').textContent, /0 voksne.*0 børn/);
  assert.doesNotMatch(h.section('calendar').textContent, /hele dagen er fri/);
  assert.equal(h.section('calendar').querySelectorAll('[data-agenda-source-id]').length, 0,
    'an absent calendar observation has no invented source link');
  assert.equal(h.calls.length, 0);
});

test('R11 cached-calendar source opens only its exact calendar/event/date/fetched observation through a local GET', async () => {
  const cache = snapshot([event('one'), event('two', { title: 'Må ikke vises i den valgte kilde' })]), h = fixture({ cache }), id = sourceId(cache);
  assert.equal(await h.open(id), true);
  assert.equal(h.calls.length, 1);
  const request = new URL(h.calls[0].path, 'https://synthetic.invalid'); assert.equal(request.searchParams.get('startDate'), date);
  const detail = h.byId('home-calendar-source'); assert.equal(detail.dataset.calendarSourceId, id);
  assert.match(detail.textContent, /Syntetisk aftale one/); assert.doesNotMatch(detail.textContent, /Må ikke vises/);
  assert.ok(detail.textContent.includes(cache.calendarId));
  assert.ok(detail.textContent.includes(cache.fetchedAt), 'the exact read observation is visibly identified');
  assert.equal(h.byId('home-more-details').open, true);
});

for (const [name, mutate, requestedDate = date] of [
  ['calendar ID changed', cache => { cache.calendarId = 'other-calendar'; }],
  ['cache read version changed', cache => { cache.fetchedAt = '2026-11-05T09:00:00.000Z'; }],
  ['event disappeared', cache => { cache.events = []; }],
  ['duplicate event ID', cache => { cache.events.push(event()); }],
  ['duplicate event ID even when only one overlaps', cache => { cache.events.push(event('one', { start: '2026-11-06T11:00:00+01:00', end: '2026-11-06T12:00:00+01:00' })); }],
  ['requested date does not overlap event', () => {}, '2026-11-06'],
  ['event cancelled', cache => { cache.events[0].status = 'cancelled'; }],
  ['invalid event date', cache => { cache.events[0].start = '2026-02-30T11:00:00+01:00'; }],
  ['invalid event end date', cache => { cache.events[0].end = '2027-02-30T12:00:00+01:00'; }],
  ['event end without explicit offset', cache => { cache.events[0].end = '2026-11-05T12:00:00'; }],
]) test('R11 cached-calendar source rejects ' + name + ' without displaying a different record', async () => {
  const original = snapshot(), cache = structuredClone(original); mutate(cache);
  const h = fixture({ cache }); assert.equal(await h.open(sourceId(original, 'one', requestedDate)), false);
  const detail = h.byId('home-calendar-source'); assert.equal(detail.dataset.calendarSourceId, undefined);
  assert.match(detail.textContent, /Kilden er utilgængelig/i); assert.doesNotMatch(detail.textContent, /Syntetisk aftale/);
  assert.ok(detail.querySelector('[role="status"]'));
});

test('R11 an exact stale observation can be inspected but visibly remains stale, not current capacity', async () => {
  const cache = snapshot([event()], { ready: false, cacheState: 'stale', expiresAt: '2026-11-05T08:00:00Z' }), h = fixture({ cache });
  assert.equal(await h.open(sourceId(cache)), true);
  assert.match(h.byId('home-calendar-source').textContent, /forældet|ældre|ikke aktuel/i);
  assert.equal(h.calls.length, 1);
});

test('R11 unavailable local cache gives an understandable persistent error and no wrong source identity', async () => {
  const h = fixture({ response: async () => { throw new Error('Syntetisk cachefejl'); } });
  assert.equal(await h.open(sourceId(snapshot())), false);
  const detail = h.byId('home-calendar-source'); assert.equal(detail.dataset.calendarSourceId, undefined);
  assert.match(detail.textContent, /Kilden er utilgængelig/i);
});

test('I/K2 missing authentication or stale navigation is rejected before reading private calendar cache', async () => {
  const h = fixture({ token: '' }); assert.equal(await h.open(sourceId(snapshot())), false); assert.equal(h.calls.length, 0);
  const next = fixture(); assert.equal(await next.open(sourceId(snapshot()), { isCurrent: () => false }), false); assert.equal(next.calls.length, 0);
});

test('R11 malformed calendar source IDs and nonexistent civil dates fail before a private cache read', async () => {
  const h = fixture(), valid = sourceId(snapshot());
  for (const id of ['', 'google-calendar:%broken:2026-11-05:one:date', valid + ':extra',
    valid.replace(':2026-11-05:', ':2026-02-30:'), valid.replace(':2026-11-05:', ':2026-13-01:')])
    assert.equal(await h.open(id), false);
  assert.equal(h.calls.length, 0);
});

test('I/R03 logout clears private Today/detail DOM and prevents a delayed response from repopulating it', async () => {
  const gate = deferred(), cache = snapshot(), h = fixture({ response: async () => gate.promise });
  h.render(data()); const pending = h.open(sourceId(cache)); await tick();
  assert.equal(h.calls.length, 1); h.setToken(''); h.clear(); gate.resolve(cache);
  assert.equal(await pending, false);
  assert.equal(h.byId('home-intelligence').textContent, ''); assert.equal(h.byId('home-legacy-agenda')?.textContent || '', '');
  assert.equal(h.byId('home-calendar-source')?.textContent || '', '');
  assert.equal(h.byId('home-calendar-source')?.dataset.calendarSourceId, undefined);
});

test('I/R11 an authentication-token change discards an in-flight source response', async () => {
  const gate = deferred(), cache = snapshot(), h = fixture({ response: async () => gate.promise });
  const pending = h.open(sourceId(cache)); await tick(); h.setToken('different-synthetic-owner'); gate.resolve(cache);
  assert.equal(await pending, false);
  assert.equal(h.byId('home-calendar-source').dataset.calendarSourceId, undefined);
  assert.doesNotMatch(h.byId('home-calendar-source').textContent, /Syntetisk aftale one/);
});

test('I/R03 clearing Today advances its generation even if the same token is later retained', async () => {
  const gate = deferred(), cache = snapshot(), h = fixture({ response: async () => gate.promise });
  const pending = h.open(sourceId(cache)); await tick(); h.clear(); gate.resolve(cache);
  assert.equal(await pending, false);
  assert.equal(h.byId('home-calendar-source')?.dataset.calendarSourceId, undefined);
  assert.equal(h.byId('home-calendar-source')?.textContent || '', '');
});

test('R11 a newer source request wins; a late earlier cache response cannot replace it', async () => {
  const gate = deferred(), cache = snapshot([event('one'), event('two')]);
  const h = fixture({ response: async (_path, count) => count === 1 ? gate.promise : structuredClone(cache) });
  const earlier = h.open(sourceId(cache, 'one')); await tick();
  assert.equal(await h.open(sourceId(cache, 'two')), true); gate.resolve(cache); assert.equal(await earlier, false);
  assert.equal(h.byId('home-calendar-source').dataset.calendarSourceId, sourceId(cache, 'two'));
  assert.match(h.byId('home-calendar-source').textContent, /Syntetisk aftale two/);
  assert.doesNotMatch(h.byId('home-calendar-source').textContent, /Syntetisk aftale one/);
});

test('R11 navigation-generation guard is checked again after the asynchronous cache read', async () => {
  const gate = deferred(), cache = snapshot(), h = fixture({ response: async () => gate.promise }); let current = true;
  const pending = h.open(sourceId(cache), { isCurrent: () => current }); await tick(); current = false; gate.resolve(cache);
  assert.equal(await pending, false); assert.equal(h.byId('home-calendar-source').dataset.calendarSourceId, undefined);
  assert.doesNotMatch(h.byId('home-calendar-source').textContent, /Syntetisk aftale one/);
});

test('R11 all-day source dates use exclusive end and timed source dates use Copenhagen rather than UTC', async () => {
  const allDay = snapshot([event('one', { allDay: true, start: '2026-11-04', end: '2026-11-06' })]);
  const h = fixture({ cache: allDay }); assert.equal(await h.open(sourceId(allDay)), true);
  assert.equal(await h.open(sourceId(allDay, 'one', '2026-11-06')), false);
  const night = snapshot([event('one', { start: '2026-11-04T23:30:00Z', end: '2026-11-05T00:30:00Z' })]);
  const next = fixture({ cache: night }); assert.equal(await next.open(sourceId(night)), true);
  assert.equal(await next.open(sourceId(night, 'one', '2026-11-04')), false);
});

test('R11 encoded calendar and event identifiers are decoded once without confusing source separators', async () => {
  const id = 'synthetic:ø/α%25', cache = snapshot([event(id)]), h = fixture({ cache });
  const exact = sourceId(cache, id);
  assert.equal(exact.split(':').length, 5);
  assert.equal(await h.open(exact), true);
  assert.equal(h.byId('home-calendar-source').dataset.calendarSourceId, exact);
  assert.ok(h.byId('home-calendar-source').textContent.includes(id));
});
