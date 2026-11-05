import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { OrganizerCore } from '../organizer-core.mjs';

const source = await readFile(new URL('../public/organizer.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const error = (message, status = 400) => Object.assign(new Error(message), { status });

// This executable DOM contract double deliberately blurs on detachment. It is
// not Chromium/WebKit, visual, physical-device or accessibility evidence.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = [];
    this.parentNode = null; this.events = new Map(); this.dataset = {}; this.attributes = {};
    this.id = ''; this.className = ''; this._text = ''; this._value = ''; this.type = tag === 'input' ? 'text' : '';
    this.checked = false; this.selected = false; this.hidden = false; this.disabled = false; this.open = false;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on ?? !names.has(name)) names.add(name); else names.delete(name); this.className = [...names].join(' '); },
      add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false),
    };
  }
  get value() { return this.tagName === 'SELECT' ? this.children.find(option => option.selected)?._value || '' : this._value; }
  set value(value) {
    if (this.tagName === 'SELECT') for (const option of this.children) option.selected = option.value === String(value);
    else this._value = String(value ?? '');
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (node === anchor) return;
    if (node.parentNode) node.remove();
    if (anchor && anchor.parentNode !== this) throw new Error('Invalid insertion anchor');
    this.children.splice(anchor ? this.children.indexOf(anchor) : this.children.length, 0, node); node.parentNode = this;
    if (this.tagName === 'SELECT' && !this.children.some(option => option.selected)) this.children[0].selected = true;
  }
  remove() {
    if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attr) {
        const [, key, value] = attr, actual = key.startsWith('data-')
          ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] : this.attributes[key] ?? this[key];
        return value === undefined ? actual !== undefined : String(actual) === value;
      }
      return this.tagName.toLowerCase() === part;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, action) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(action); }
  async emit(type, target = this) {
    for (const action of this.events.get(type) || []) await action({ target, currentTarget: this, preventDefault() {} });
    if (['input', 'change'].includes(type) && this.parentNode) await this.parentNode.emit(type, target);
  }
  focus() { this.ownerDocument.activeElement = this; }
}

async function fixture({ state = null, saved = new Map(), authenticated = true, storageBlocked = false, view = 'knowledge', beforeRead = null } = {}) {
  if (!state) {
    state = { organizer: [] };
    const seed = new OrganizerCore({ state, save: async () => {}, now: () => new Date('2026-11-05T08:00:00Z') });
    const collection = await seed.create({ title: 'Syntetiske noter', type: 'notes' });
    await seed.addItem(collection.id, { text: 'Første note', notes: 'Gemte oplysninger', date: '2026-12-20', annual: true });
  }
  const core = new OrganizerCore({ state, save: async () => {}, now: () => new Date('2026-11-05T09:00:00Z') });
  const document = { activeElement: null, focusDetachments: 0, visibilityState: 'visible', events: new Map() };
  document.createElement = tag => new Element(document, tag);
  document.createTextNode = text => { const node = document.createElement('text'); node.textContent = text; return node; };
  document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => {
    const visit = element => element.id === id ? element : element.children.map(visit).find(Boolean);
    return visit(document.body) || null;
  };
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  document.addEventListener = (type, action) => { if (!document.events.has(type)) document.events.set(type, []); document.events.get(type).push(action); };
  document.emit = async (type, detail = {}) => { for (const action of document.events.get(type) || []) await action({ detail }); await tick(); };
  const routed = [];
  document.dispatchEvent = event => { if (event.type === 'jarvis:source-route') routed.push(event.detail.id);
    for (const action of document.events.get(event.type) || []) action(event); };
  const element = (tag, id, parent = document.body) => { const node = document.createElement(tag); node.id = id; parent.append(node); return node; };
  const home = element('section', 'tab-home'), knowledge = element('section', 'tab-knowledge'), plan = element('section', 'tab-plan');
  for (const [key, section] of [['home', home], ['knowledge', knowledge], ['plan', plan]]) section.classList.toggle('hidden', key !== view);
  element('div', 'home-feed', home); element('div', 'home-intelligence', home);
  const create = element('form', 'collection-form', knowledge);
  element('input', 'collection-title', create);
  const type = element('select', 'collection-type', create);
  for (const kind of ['dates', 'gifts', 'shopping', 'notes', 'list']) { const option = document.createElement('option'); option.value = kind; type.append(option); }
  const createSubmit = element('button', 'create-submit', create); createSubmit.type = 'submit';
  const search = element('form', 'organizer-search', knowledge);
  element('input', 'organizer-query', search); const searchSubmit = element('button', 'search-submit', search); searchSubmit.type = 'submit';
  element('div', 'organizer-search-results', knowledge); element('div', 'collection-list', knowledge); element('button', 'logout');
  let token = authenticated ? 'synthetic-owner-token-not-for-drafts' : '', fail = null, holdWrite = null, holdRead = beforeRead, confirmResult = true;
  const calls = [], confirmations = [], selected = [], intervals = [], windowEvents = new Map();
  const api = async (path, options = {}) => {
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body });
    if (fail) { const problem = fail(path, method, body); if (problem) throw problem; }
    if (method !== 'GET' && holdWrite) { const pending = holdWrite; holdWrite = null; await pending; }
    if (path === '/api/dashboard') return { suggestions: [], upcoming: [], unseen: [], awaiting: [], next: [], projects: [], recentDigests: [],
      agenda: { today: [], week: [], insights: [] } };
    if (path === '/api/organizer' && method === 'GET') {
      const snapshot = structuredClone({ collections: core.list() });
      if (holdRead) { const pending = holdRead; holdRead = null; await pending; }
      return snapshot;
    }
    try {
      if (path === '/api/organizer' && method === 'POST') return structuredClone({ collection: await core.create(body) });
      if (path === '/api/organizer/search') return structuredClone({ matches: core.search(body.query) });
      const [, , , collectionId, action, itemId] = path.split('/');
      if (action === 'items' && !itemId) return structuredClone({ item: await core.addItem(collectionId, body) });
      if (itemId && method === 'PATCH') return structuredClone({ item: await core.updateItem(collectionId, itemId, body) });
      if (itemId && method === 'DELETE') return structuredClone(await core.removeItem(collectionId, itemId, body));
      if (method === 'PUT') return structuredClone({ collection: await core.rename(collectionId, body.title, body) });
      if (method === 'DELETE') return structuredClone({ collection: await core.archive(collectionId, body) });
    } catch (problem) { problem.status = 400; throw problem; }
    throw new Error('Unexpected request ' + method + ' ' + path);
  };
  const confirm = message => { confirmations.push(message); return confirmResult; };
  const context = vm.createContext({ document, console, Date, JSON, Object, Promise, setInterval: fn => intervals.push(fn),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: () => token }, sessionStorage: { getItem: key => saved.get(key) || null,
      setItem: (key, value) => { if (storageBlocked) throw new Error('blocked storage'); saved.set(key, value); }, removeItem: key => saved.delete(key) },
    window: { addEventListener: (type, action) => windowEvents.set(type, action) }, confirm, prompt: () => null, toast() {},
    selectTab: (tab, options) => selected.push({ tab, ...options }), api });
  vm.runInContext(source, context);
  await document.emit('DOMContentLoaded'); await tick();
  const byId = id => document.getElementById(id), button = (root, label) => root.querySelectorAll('button').find(node => node.textContent === label);
  return { document, core, state, saved, calls, byId, button, selected, routed, confirmations, intervals, windowEvents,
    collections: () => core.list(), writes: () => calls.filter(call => call.method !== 'GET' && call.path !== '/api/organizer/search'),
    card: id => document.querySelector('[data-collection-id="' + id + '"]'),
    row: (collectionId, itemId) => document.querySelector('[data-organizer-item-id="' + collectionId + ':' + itemId + '"]'),
    fields: form => Object.fromEntries(['text', 'notes', 'date', 'annual', 'title'].map(name => [name, form.querySelector('[name="' + name + '"]')])),
    refresh: () => context.refreshOrganizer(), autoRefresh: () => document.emit('jarvis:refreshed'),
    async type(field, value) { field.value = value; await field.emit('input'); },
    async check(field, checked) { field.checked = checked; await field.emit('change'); },
    async changeView(next) { for (const key of ['home', 'knowledge', 'plan']) byId('tab-' + key).classList.toggle('hidden', key !== next);
      await document.emit('jarvis:view-changed', { view: next }); },
    setFailure: fn => { fail = fn; }, setToken: value => { token = value; }, setConfirm: value => { confirmResult = value; },
    holdWrite() { let resolve; holdWrite = new Promise(done => { resolve = done; }); return resolve; },
    holdRead() { let resolve; holdRead = new Promise(done => { resolve = done; }); return resolve; },
  };
}
const first = h => { const collection = h.collections()[0], item = collection.items[0];
  return { collection, item, card: h.card(collection.id), row: h.row(collection.id, item.id) }; };
const editor = row => row.querySelector('[data-organizer-role="item-editor"]');
const add = card => card.querySelector('[data-organizer-role="add"]');
const rename = card => card.querySelector('[data-organizer-role="rename"]');
const draft = h => JSON.parse(h.saved.get('jarvis:v5:organizer-drafts'));

test('R03 unchanged organizer polling preserves exact editor nodes, focus, selection, open state and all local drafts', async () => {
  const h = await fixture(), { collection, item, card, row } = first(h), form = editor(row), fields = h.fields(form);
  row.querySelector('details').open = true;
  await h.type(fields.text, 'Min ugemte note'); await h.type(h.fields(add(card)).notes, 'Nyt punkt skrives senere');
  await h.type(h.byId('collection-title'), 'Ny lokal liste');
  fields.text.focus(); fields.text.selectionStart = 2; fields.text.selectionEnd = 8;
  await h.autoRefresh(); await h.refresh();
  assert.equal(h.row(collection.id, item.id), row); assert.equal(editor(row), form);
  assert.equal(h.document.activeElement, fields.text); assert.equal(h.document.focusDetachments, 0);
  assert.deepEqual([fields.text.selectionStart, fields.text.selectionEnd], [2, 8]);
  assert.equal(fields.text.value, 'Min ugemte note'); assert.equal(row.querySelector('details').open, true);
  assert.equal(h.fields(add(card)).notes.value, 'Nyt punkt skrives senere'); assert.equal(h.byId('collection-title').value, 'Ny lokal liste');
  assert.equal(draft(h).items[collection.id + ':' + item.id].base.updatedAt, item.updatedAt);
  assert.equal(h.writes().length, 0);
});

test('R03 importing another collection or item does not detach a focused existing editor or erase a manual addition', async () => {
  const h = await fixture(), { collection, item, row, card } = first(h), fields = h.fields(editor(row));
  await h.type(fields.notes, 'Lokal redigering'); fields.notes.focus();
  await h.type(h.fields(add(card)).text, 'Min manuelle tilføjelse');
  const other = await h.core.create({ title: 'Importeret samling', type: 'list' });
  const imported = await h.core.addItem(collection.id, { text: 'Importeret punkt' });
  await h.refresh();
  assert.equal(h.row(collection.id, item.id), row); assert.ok(h.card(other.id)); assert.ok(h.row(collection.id, imported.id));
  assert.equal(h.document.activeElement, fields.notes); assert.equal(h.document.focusDetachments, 0);
  assert.equal(h.fields(add(card)).text.value, 'Min manuelle tilføjelse');
  assert.equal(h.writes().length, 0);
});

test('R03 a changed server item retains the captured version and draft until explicit reload, with no stale write', async () => {
  const h = await fixture(), { collection, item, row } = first(h), form = editor(row), fields = h.fields(form), initial = item.updatedAt;
  await h.type(fields.notes, 'Min oprindelige kladde');
  await h.core.updateItem(collection.id, item.id, { notes: 'Gemning fra anden enhed', updatedAt: initial });
  await h.refresh();
  assert.equal(fields.notes.value, 'Min oprindelige kladde');
  assert.equal(draft(h).items[collection.id + ':' + item.id].base.updatedAt, initial);
  assert.match(form.textContent, /Ændret et andet sted/);
  assert.equal(form.querySelector('[type="submit"]').disabled, true);
  await form.emit('submit'); assert.equal(h.writes().length, 0);
  h.setConfirm(false); await h.button(row, 'Hent nyeste punkt og kassér kladde').emit('click');
  assert.equal(fields.notes.value, 'Min oprindelige kladde');
  h.setConfirm(true); await h.button(row, 'Hent nyeste punkt og kassér kladde').emit('click');
  assert.equal(fields.notes.value, 'Gemning fra anden enhed'); assert.equal(form.querySelector('[type="submit"]').disabled, false);
  const reviewed = item.updatedAt;
  await h.type(fields.notes, 'Gennemgået rettelse'); await form.emit('submit');
  assert.equal(h.writes()[0].body.updatedAt, reviewed);
  assert.equal(item.notes, 'Gennemgået rettelse');
});

test('R03 reload restores item/add/rename/create/search drafts, retaining the original optimistic item version', async () => {
  const h = await fixture(), { collection, item, card, row } = first(h), initial = item.updatedAt;
  await h.type(h.fields(editor(row)).text, 'Genindlæst note');
  await h.type(h.fields(add(card)).text, 'Genindlæst nyt punkt'); await h.type(h.fields(rename(card)).title, 'Genindlæst navn');
  await h.type(h.byId('collection-title'), 'Ny samling under skrivning'); await h.type(h.byId('organizer-query'), 'Mit søgeord');
  await h.core.updateItem(collection.id, item.id, { notes: 'Anden enhed under reload', updatedAt: initial });
  const reload = await fixture({ state: h.state, saved: h.saved }), newCard = reload.card(collection.id), newRow = reload.row(collection.id, item.id);
  assert.equal(reload.fields(editor(newRow)).text.value, 'Genindlæst note');
  assert.equal(reload.fields(add(newCard)).text.value, 'Genindlæst nyt punkt');
  assert.equal(reload.fields(rename(newCard)).title.value, 'Genindlæst navn');
  assert.equal(reload.byId('collection-title').value, 'Ny samling under skrivning'); assert.equal(reload.byId('organizer-query').value, 'Mit søgeord');
  assert.equal(draft(reload).items[collection.id + ':' + item.id].base.updatedAt, initial);
  assert.match(newRow.textContent, /Ændret et andet sted/); assert.equal(reload.writes().length, 0);
});

test('R03/K5 failed writes retain fields and persistent error through polling and later user typing', async () => {
  const h = await fixture(), { item, row } = first(h), form = editor(row), fields = h.fields(form);
  await h.type(fields.text, 'Må ikke tabes');
  h.setFailure((_path, method) => method === 'PATCH' ? error('Diskfejl i syntetisk prøve') : null);
  await form.emit('submit'); assert.equal(item.text, 'Første note'); assert.equal(fields.text.value, 'Må ikke tabes');
  assert.match(form.textContent, /Ikke gemt: Diskfejl/);
  await h.refresh(); await h.type(fields.notes, 'Endnu en lokal ændring');
  assert.match(form.textContent, /Ikke gemt: Diskfejl/);
  assert.equal(h.fields(form).notes.value, 'Endnu en lokal ændring');
  h.setFailure(null); await form.emit('submit'); assert.equal(item.text, 'Må ikke tabes'); assert.equal(item.notes, 'Endnu en lokal ændring');
});

test('R03/K5 typing during a successful item write survives, but the next explicit write uses the acknowledged new revision', async () => {
  const h = await fixture(), { collection, item, row } = first(h), form = editor(row), fields = h.fields(form), initial = item.updatedAt;
  await h.type(fields.notes, 'Første gemning');
  const release = h.holdWrite(), saving = form.emit('submit'); await tick();
  await h.type(fields.notes, 'Ny kladde mens gemningen kører'); fields.notes.focus();
  await form.emit('submit'); assert.equal(h.writes().length, 1, 'double submit must not issue a second write');
  release(); await saving;
  assert.equal(item.notes, 'Første gemning'); assert.equal(fields.notes.value, 'Ny kladde mens gemningen kører');
  assert.equal(h.document.activeElement, fields.notes); assert.equal(h.document.focusDetachments, 0);
  const acknowledged = item.updatedAt; assert.notEqual(acknowledged, initial);
  assert.match(form.textContent, /Nye ændringer i formularen er endnu ikke gemt/);
  assert.equal(draft(h).items[collection.id + ':' + item.id].base.updatedAt, acknowledged);
  await form.emit('submit');
  assert.equal(h.writes()[1].body.updatedAt, acknowledged); assert.equal(item.notes, 'Ny kladde mens gemningen kører');
});

test('R03 create/add success clears only the submitted draft, never the next draft typed in flight', async () => {
  const h = await fixture(), { collection, card } = first(h), form = add(card), fields = h.fields(form);
  await h.type(fields.text, 'Punkt der sendes');
  const release = h.holdWrite(), pending = form.emit('submit'); await tick(); await h.type(fields.text, 'Næste punkt'); release(); await pending;
  assert.equal(collection.items.filter(item => item.text === 'Punkt der sendes').length, 1);
  assert.equal(fields.text.value, 'Næste punkt');
  await h.type(h.byId('collection-title'), 'Liste der sendes');
  const releaseCreate = h.holdWrite(), creating = h.byId('collection-form').emit('submit'); await tick();
  await h.type(h.byId('collection-title'), 'Næste liste'); releaseCreate(); await creating;
  assert.equal(h.collections().filter(item => item.title === 'Liste der sendes').length, 1);
  assert.equal(h.byId('collection-title').value, 'Næste liste');
  assert.equal(h.writes().length, 2);
});

test('R03/K5 a successful mutation followed by refresh failure remains acknowledged and is not resent', async () => {
  const h = await fixture(), { row, item } = first(h), form = editor(row), fields = h.fields(form);
  await h.type(fields.text, 'Faktisk gemt'); h.setFailure((_path, method) => method === 'GET' ? error('Læsning midlertidigt nede', 503) : null);
  await form.emit('submit');
  assert.equal(item.text, 'Faktisk gemt'); assert.equal(fields.text.value, 'Faktisk gemt');
  assert.match(form.textContent, /Punktet er gemt/);
  assert.match(h.byId('organizer-status').textContent, /Ændringen er gemt, men oversigten/);
  assert.equal(h.writes().length, 1);
});

test('R03/K5 unknown add outcome blocks retries until an explicit reviewed decision; polling causes no repeats', async () => {
  const h = await fixture(), { card } = first(h), form = add(card), fields = h.fields(form);
  await h.type(fields.text, 'Uafklaret tilføjelse'); h.setFailure((_path, method) => method === 'POST' ? new Error('Forbindelsen afbrudt') : null);
  await form.emit('submit'); await h.refresh(); await form.emit('submit');
  assert.equal(h.writes().length, 1); assert.equal(form.querySelector('[type="submit"]').disabled, true);
  assert.match(form.textContent, /udfald er ikke bekræftet/);
  const reload = await fixture({ state: h.state, saved: h.saved }), reloaded = add(reload.card(h.collections()[0].id));
  await reloaded.emit('submit'); assert.equal(reload.writes().length, 0); assert.equal(reloaded.querySelector('[type="submit"]').disabled, true);
  await reload.button(reloaded, 'Kontrollér resultat før nyt forsøg').emit('click');
  assert.match(reload.confirmations.at(-1), /ikke allerede er gemt/);
  assert.equal(reloaded.querySelector('[type="submit"]').disabled, false);
  await reloaded.emit('submit'); assert.equal(reload.writes().length, 1);
});

test('R03 an obsolete GET started before a save cannot replace acknowledged data or its new local draft', async () => {
  const h = await fixture(), { row, item } = first(h), form = editor(row), fields = h.fields(form);
  const releaseRead = h.holdRead(), reading = h.refresh(); await tick();
  await h.type(fields.notes, 'Nyt gemt grundlag');
  const saving = form.emit('submit'); await tick(); await h.type(fields.notes, 'Ny kladde efter send');
  releaseRead(); await reading; await saving;
  assert.equal(item.notes, 'Nyt gemt grundlag'); assert.equal(fields.notes.value, 'Ny kladde efter send');
  assert.doesNotMatch(form.textContent, /Ændret et andet sted/);
  assert.equal(h.writes().length, 1);
});

test('R03 a GET started during a pending write cannot create a false conflict after acknowledgement', async () => {
  const h = await fixture(), { row, item } = first(h), form = editor(row), fields = h.fields(form);
  await h.type(fields.notes, 'Ny gemning med samtidig læsning');
  const releaseWrite = h.holdWrite(), saving = form.emit('submit'); await tick();
  const releaseRead = h.holdRead(), reading = h.refresh(); await tick();
  releaseWrite(); await tick();
  await h.type(fields.notes, 'Næste kladde efter kvittering'); releaseRead(); await reading; await saving;
  assert.equal(item.notes, 'Ny gemning med samtidig læsning'); assert.equal(fields.notes.value, 'Næste kladde efter kvittering');
  assert.doesNotMatch(form.textContent, /Ændret et andet sted/);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
});

test('R03 externally removed item and archived collection retain visible local drafts through reload without recreating records', async () => {
  const h = await fixture(), { collection, item, row, card } = first(h);
  await h.type(h.fields(editor(row)).notes, 'Min note før ekstern sletning');
  await h.type(h.fields(add(card)).text, 'Min tilføjelse før arkivering');
  await h.core.removeItem(collection.id, item.id, { updatedAt: item.updatedAt }); await h.core.archive(collection.id);
  await h.refresh();
  assert.equal(h.row(collection.id, item.id), row); assert.match(card.textContent, /ikke længere i den aktive oversigt/);
  await editor(row).emit('submit'); await add(card).emit('submit'); assert.equal(h.writes().length, 0);
  const reload = await fixture({ state: h.state, saved: h.saved }), localCard = reload.card(collection.id), localRow = reload.row(collection.id, item.id);
  assert.ok(localCard); assert.ok(localRow);
  assert.equal(reload.fields(editor(localRow)).notes.value, 'Min note før ekstern sletning');
  assert.equal(reload.fields(add(localCard)).text.value, 'Min tilføjelse før arkivering');
  assert.equal(reload.writes().length, 0);
});

test('R03 collection rename preserves its captured basis while a concurrent append survives; explicit reload clears only name draft', async () => {
  const h = await fixture(), { collection, card } = first(h), form = rename(card), title = h.fields(form).title;
  const initial = collection.updatedAt; await h.type(title, 'Mit listenavn');
  await h.type(h.fields(add(card)).text, 'Min tilføjelseskladde');
  await h.core.addItem(collection.id, { text: 'Punkt fra anden enhed' }); await h.refresh();
  assert.equal(draft(h).collections[collection.id].rename.base.updatedAt, initial);
  assert.equal(title.value, 'Mit listenavn'); assert.equal(form.querySelector('[type="submit"]').disabled, true);
  await h.button(card, 'Hent nyeste listenavn og kassér navnekladde').emit('click');
  assert.equal(title.value, collection.title); assert.equal(h.fields(add(card)).text.value, 'Min tilføjelseskladde');
  const reviewed = collection.updatedAt; await h.type(title, 'Gennemgået listenavn'); await form.emit('submit');
  assert.equal(h.writes()[0].body.updatedAt, reviewed); assert.equal(collection.title, 'Gennemgået listenavn');
  assert.ok(collection.items.some(item => item.text === 'Punkt fra anden enhed'));
});

test('R03 checking an item uses its captured revision, retains edit draft and never resends on refresh', async () => {
  const h = await fixture(), { collection, item, row } = first(h), fields = h.fields(editor(row)), initial = item.updatedAt;
  await h.type(fields.notes, 'Ugemt beskrivelse');
  const checkbox = row.querySelector('.collection-item-main').querySelector('input');
  await h.check(checkbox, true); await h.refresh();
  assert.equal(item.done, true); assert.equal(fields.notes.value, 'Ugemt beskrivelse');
  assert.equal(h.writes()[0].body.updatedAt, initial); assert.equal(h.writes().length, 1);
  assert.equal(draft(h).items[collection.id + ':' + item.id].base.updatedAt, item.updatedAt);
});

test('R11 exact source attributes and source search link survive a concurrent dirty editor', async () => {
  const h = await fixture(), { collection, item, row } = first(h);
  await h.type(h.fields(editor(row)).notes, 'Bevar mens jeg åbner kilden');
  await h.type(h.byId('organizer-query'), 'Første note'); await h.byId('organizer-search').emit('submit');
  await h.button(h.byId('organizer-search-results'), 'Åbn præcist punkt').emit('click'); await h.refresh();
  assert.deepEqual(h.selected, [{ tab: 'knowledge', sourceId: 'organizer:' + collection.id + ':' + item.id }]);
  assert.deepEqual(h.routed, ['organizer:' + collection.id + ':' + item.id], 'URL change must also invoke the exact source coordinator');
  assert.equal(h.row(collection.id, item.id), row); assert.equal(h.fields(editor(row)).notes.value, 'Bevar mens jeg åbner kilden');
  assert.equal(h.writes().length, 0);
});

test('J1 hidden organizer/dashboard do not poll; visible changes and forced source reads remain available', async () => {
  const h = await fixture({ view: 'plan' });
  assert.equal(h.calls.length, 0); await h.autoRefresh(); for (const fn of h.intervals) fn(); await tick(); assert.equal(h.calls.length, 0);
  await h.changeView('knowledge'); assert.deepEqual(h.calls.map(call => call.path), ['/api/organizer']);
  await h.changeView('home'); assert.equal(h.calls.at(-1).path, '/api/dashboard');
  await h.autoRefresh(); assert.equal(h.calls.filter(call => call.path === '/api/organizer').length, 1);
  await h.refresh(); assert.equal(h.calls.at(-1).path, '/api/organizer', 'explicit source open bypasses visibility only, not auth');
  h.document.visibilityState = 'hidden'; const before = h.calls.length;
  await h.autoRefresh(); for (const fn of h.intervals) fn(); await tick(); assert.equal(h.calls.length, before);
});

test('I5/R03 draft storage omits auth token and secret-shaped text and warns when reload cannot be safe', async () => {
  const h = await fixture(), { row } = first(h), fields = h.fields(editor(row));
  await h.type(fields.notes, 'password=synthetic-secret-do-not-persist');
  const text = h.saved.get('jarvis:v5:organizer-drafts');
  assert.equal(text.includes('synthetic-owner-token'), false); assert.equal(text.includes('synthetic-secret'), false);
  assert.match(h.byId('organizer-draft-status').textContent, /ligner en adgangskode/);
  const event = { prevented: false, preventDefault() { this.prevented = true; } }; h.windowEvents.get('beforeunload')(event);
  assert.equal(event.prevented, true);
  await h.type(fields.notes, 'Almindelig lokal note');
  assert.equal(h.byId('organizer-draft-status').textContent, ''); assert.match(h.saved.get('jarvis:v5:organizer-drafts'), /Almindelig lokal note/);
});

test('R03 blocked session storage has persistent warning and beforeunload protection rather than pretending a saved draft', async () => {
  const h = await fixture({ storageBlocked: true }), { row } = first(h);
  await h.type(h.fields(editor(row)).notes, 'Kan kun bevares i den åbne fane'); await h.refresh();
  assert.match(h.byId('organizer-draft-status').textContent, /kan ikke gemmes lokalt/);
  const event = { prevented: false, preventDefault() { this.prevented = true; } }; h.windowEvents.get('beforeunload')(event);
  assert.equal(event.prevented, true); assert.equal(h.fields(editor(row)).notes.value, 'Kan kun bevares i den åbne fane');
});

test('I5/R03 logout clears local drafts and ignores an in-flight GET and write response', async () => {
  const h = await fixture(), { row } = first(h), form = editor(row);
  await h.type(h.fields(form).notes, 'Ugemt privat tekst');
  const release = h.holdWrite(), saving = form.emit('submit'); await tick();
  h.setToken(''); await h.byId('logout').emit('click'); release(); await saving;
  assert.equal(h.byId('collection-list').children.length, 0); assert.equal(h.byId('collection-title').value, '');
  assert.equal(h.saved.has('jarvis:v5:organizer-drafts'), false);
  const count = h.calls.length; await h.autoRefresh(); await h.refresh(); assert.equal(h.calls.length, count);
  const other = await fixture(), unblock = other.holdRead(), reading = other.refresh(); await tick();
  other.setToken(''); await other.byId('logout').emit('click'); unblock(); await reading;
  assert.equal(other.byId('collection-list').children.length, 0); assert.equal(other.saved.has('jarvis:v5:organizer-drafts'), false);
});

test('I5 signed-out startup does not restore or fetch organizer data', async () => {
  const h = await fixture(), { row } = first(h); await h.type(h.fields(editor(row)).notes, 'Tidligere kladde');
  const signedOut = await fixture({ saved: h.saved, authenticated: false });
  assert.equal(signedOut.calls.length, 0); assert.equal(signedOut.byId('collection-list').children.length, 0);
  assert.equal(signedOut.saved.has('jarvis:v5:organizer-drafts'), false);
});
