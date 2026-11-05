import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PersonalTasks } from '../personal-tasks.mjs';
import { FollowUpCases } from '../follow-up-cases.mjs';
import { planPersonalTasks } from '../capacity-planner.mjs';

const source = await readFile(new URL('../public/v5-plan.js', import.meta.url), 'utf8');
const pure = vm.runInNewContext(`${source}\nJarvisPlan;`, { Intl, Date });
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (title = 'Gennemgå forsikringer') => ({ title, purpose: 'Vælg relevant dækning ud fra egne behov.', durationMinutes: 30 });

test('C3/K Copenhagen input does not silently use the browser time zone', () => {
  assert.equal(pure.toInstant('2026-11-05T09:15'), '2026-11-05T08:15:00.000Z');
  assert.equal(pure.toInstant('2026-07-05T09:15'), '2026-07-05T07:15:00.000Z');
  assert.equal(pure.fromInstant('2026-11-05T08:15:12.350Z'), '2026-11-05T09:15:12.350');
  assert.equal(pure.toInstant('2026-11-05T09:15:12.350'), '2026-11-05T08:15:12.350Z');
  assert.equal(pure.toInstant(''), null);
});

test('C3/K DST missing and repeated civil times require a real, explicit instant', () => {
  assert.throws(() => pure.toInstant('2026-03-29T02:30'), /findes ikke.*sommertid/);
  assert.throws(() => pure.toInstant('2026-10-25T02:30'), /forekommer to gange/);
  assert.equal(pure.toInstant('2026-10-25T02:30', 'earlier'), '2026-10-25T00:30:00.000Z');
  assert.equal(pure.toInstant('2026-10-25T02:30', 'later'), '2026-10-25T01:30:00.000Z');
  assert.equal(pure.fromInstant('2026-10-25T00:30:00Z'), pure.fromInstant('2026-10-25T01:30:00Z'));
});

test('C3/K date input rejects impossible civil dates instead of rolling into the next month', () => {
  for (const value of ['2026-02-29T12:00', '2026-02-30T12:00', '2026-13-01T12:00', '2026-00-01T12:00',
    '2026-11-05T24:00', '2026-11-05T10:60', '2026-11-05T10:10:60', 'næste torsdag', '2026-11-05T10:00Z'])
    assert.throws(() => pure.toInstant(value), /gyldig|findes ikke/);
  assert.equal(pure.toInstant('2028-02-29T12:00'), '2028-02-29T11:00:00.000Z');
});

// A contract double, not Chromium/WebKit evidence. Detaching a focused subtree
// deliberately blurs it, so replacing cards during a poll cannot pass silently.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.parentNode = null;
    this.children = []; this.events = new Map(); this.dataset = {}; this.attributes = {}; this.style = {};
    this.id = ''; this.className = ''; this._text = ''; this._value = ''; this.defaultValue = '';
    this.type = tag === 'input' ? 'text' : ''; this.checked = false; this.defaultChecked = false;
    this.selected = false; this.disabled = false; this.hidden = false; this.multiple = false;
    this.classList = { contains: value => this.className.split(/\s+/).includes(value),
      toggle: (value, on) => { const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on ?? !classes.has(value)) classes.add(value); else classes.delete(value); this.className = [...classes].join(' '); },
      add: value => this.classList.toggle(value, true), remove: value => this.classList.toggle(value, false) };
  }
  get value() { return this.tagName === 'SELECT' ? this.selectedOptions[0]?.value || '' : this._value; }
  set value(value) { if (this.tagName === 'SELECT') { for (const option of this.options) option.selected = option.value === String(value); }
    else this._value = String(value ?? ''); }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get selectedOptions() { return this.options.filter(option => option.selected); }
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
    if (this.tagName === 'SELECT' && !this.multiple && !this.options.some(option => option.selected)) this.options[0].selected = true;
  }
  remove() {
    if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim(); if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attr) {
        const [, key, value] = attr;
        const actual = key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())]
          : this.attributes[key] ?? this[key];
        return value === undefined ? actual !== undefined : String(actual) === value;
      }
      return this.tagName.toLowerCase() === part;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, action) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(action); }
  async emit(name, target = this) {
    for (const action of this.events.get(name) || []) await action({ currentTarget: this, target, preventDefault() {} });
    if (['input', 'change'].includes(name) && this.parentNode) await this.parentNode.emit(name, target);
  }
  focus() { this.ownerDocument.activeElement = this; }
  reset() { for (const input of this.querySelectorAll('input,textarea,select')) {
    if (input.tagName === 'SELECT') { for (const item of input.options) item.selected = false;
      if (!input.multiple && input.options.length) input.options[0].selected = true; }
    else input.value = input.defaultValue;
    input.checked = input.defaultChecked;
  } }
}

async function ui({ state = {}, saved = new Map(), authenticated = true, storageBlocked = false, view = 'plan' } = {}) {
  const tasks = new PersonalTasks({ state });
  const cases = new FollowUpCases({ state });
  const document = { focusDetachments: 0, activeElement: null, events: new Map() };
  document.createElement = tag => new Element(document, tag);
  document.createTextNode = text => { const element = document.createElement('text'); element.textContent = text; return element; };
  document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => {
    const visit = element => element.id === id ? element : element.children.map(visit).find(Boolean);
    return visit(document.body) || null;
  };
  document.addEventListener = (name, action) => { if (!document.events.has(name)) document.events.set(name, []); document.events.get(name).push(action); };
  document.emit = async (name, detail = {}) => { for (const action of document.events.get(name) || []) await action({ detail }); };
  const element = (tag, id, parent = document.body) => { const result = document.createElement(tag); result.id = id; parent.append(result); return result; };
  const plan = element('div', 'tab-plan'); element('header', 'intro', plan);
  const knowledge = element('div', 'tab-knowledge'), home = element('div', 'tab-home');
  for (const [key, root] of [['plan', plan], ['knowledge', knowledge], ['home', home]]) root.classList.toggle('hidden', key !== view);
  const form = (id, controls, statusId, listId, parent = plan) => {
    const section = element('section', `${id}-section`, parent), root = element('form', id, section);
    for (const [id, type, value = ''] of controls) { const field = element(type === 'textarea' || type === 'select' ? type : 'input', id, root);
      if (field.tagName === 'INPUT') field.type = type; field.value = value; field.defaultValue = value; }
    const submit = element('button', `${id}-submit`, root); submit.type = 'submit';
    element('p', statusId, section); element('div', listId, section); return root;
  };
  form('personal-task-form', [['personal-task-title', 'text'], ['personal-task-purpose', 'textarea'],
    ['personal-task-duration', 'number', '30'], ['personal-task-deadline', 'datetime-local']], 'personal-task-status', 'personal-task-list');
  form('capacity-form', [['capacity-start', 'datetime-local'], ['capacity-end', 'datetime-local'],
    ['capacity-reviewed', 'checkbox']], 'capacity-status', 'capacity-results');
  form('follow-up-form', [['follow-up-awaiting', 'text'], ['follow-up-check', 'datetime-local'],
    ['follow-up-stop', 'text']], 'follow-up-status', 'follow-up-list');
  form('personal-claim-form', [['claim-subject', 'text'], ['claim-value', 'textarea'], ['claim-category', 'select']], 'claim-status', 'claim-list', knowledge);
  element('button', 'logout');
  let token = authenticated ? 'synthetic-token-never-stored-in-draft' : null, failure = null, hold = null, readHold = null;
  const calls = [], windowEvents = new Map();
  const api = async (path, options = {}) => {
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });
    if (failure) { const error = failure(path, method, body); if (error) throw error; }
    if (method === 'GET' && readHold) { const pending = readHold; readHold = null; await pending; }
    if (method !== 'GET' && hold) { const pending = hold; hold = null; await pending; }
    if (path === '/api/personal-tasks' && method === 'GET') return { tasks: tasks.list({ includeArchived: true }) };
    if (path === '/api/personal-tasks' && method === 'POST') return { task: await tasks.create(body) };
    if (path.startsWith('/api/personal-tasks/')) { const [, , , id, action] = path.split('/');
      if (method === 'PATCH') return { task: await tasks.update(id, body) };
      return { task: await tasks[action](id, body.expectedRevision) };
    }
    if (path === '/api/follow-ups' && method === 'GET') return { cases: cases.list({ includeClosed: true }) };
    if (path === '/api/follow-ups' && method === 'POST') return { case: await cases.create(body) };
    if (path.startsWith('/api/follow-ups/')) return { case: await cases.update(path.split('/').at(-1), body.expectedRevision, body.action, body) };
    if (path === '/api/personal-claims') return { claims: [], conflicts: [] };
    if (path === '/api/planning/simulate') return { plan: planPersonalTasks({ ...body, tasks: tasks.toPlanningTasks() }), basis: 'Syntetisk manuelt gennemgået kapacitet' };
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  const context = vm.createContext({ document, Intl, Date, console,
    localStorage: { getItem: () => token }, sessionStorage: { getItem: key => saved.get(key) || null,
      setItem: (key, value) => { if (storageBlocked) throw new Error('storage blocked'); saved.set(key, value); },
      removeItem: key => saved.delete(key) },
    window: { confirm: () => true, addEventListener: (name, action) => windowEvents.set(name, action) }, api });
  vm.runInContext(source, context); await tick();
  const byId = id => document.getElementById(id);
  return { document, byId, saved, tasks, cases, calls, state, windowEvents,
    refresh: () => document.emit('jarvis:refreshed'), setFailure: action => { failure = action; },
    async changeView(next) { for (const name of ['plan', 'knowledge', 'home']) byId(`tab-${name}`).classList.toggle('hidden', name !== next);
      await document.emit('jarvis:view-changed', { view: next }); },
    setToken: value => { token = value; }, writes: () => calls.filter(call => call.method !== 'GET'),
    async type(id, value) { const field = byId(id); field.value = value; await field.emit('input'); },
    async check(id, checked = true) { const field = byId(id); field.checked = checked; await field.emit('change'); },
    button(root, text) { return root.querySelectorAll('button').find(control => control.textContent === text); },
    holdWrite() { let resolve; hold = new Promise(done => { resolve = done; }); return resolve; },
    holdRead() { let resolve; readHold = new Promise(done => { resolve = done; }); return resolve; },
  };
}

test('K3/C2 dynamic planning fields are labelled and do not create jobs or external actions at startup', async () => {
  const h = await ui();
  for (const id of ['personal-task-outcome', 'personal-task-uncertainty', 'personal-task-planned', 'personal-task-locked',
    'personal-task-dependencies', 'capacity-buffer', 'capacity-manual-review', 'follow-observation-status', 'plan-repeated-time']) {
    assert.ok(h.byId(id)); assert.ok(h.document.body.querySelectorAll('label').some(label => label.htmlFor === id), `missing label ${id}`);
  }
  assert.deepEqual(h.writes(), []);
  assert.equal(h.byId('personal-task-state').disabled, true);
});

test('J1 planning polls only visible tasks/follow-ups or claims, never all hidden domains', async () => {
  const h = await ui({ view: 'home' });
  assert.equal(h.calls.length, 0); await h.refresh(); assert.equal(h.calls.length, 0);
  await h.changeView('plan');
  assert.deepEqual(h.calls.map(call => call.path), ['/api/personal-tasks', '/api/follow-ups']);
  await h.changeView('knowledge'); assert.equal(h.calls.at(-1).path, '/api/personal-claims');
  const before = h.calls.length; await h.refresh();
  assert.deepEqual(h.calls.slice(before).map(call => call.path), ['/api/personal-claims']);
  h.document.visibilityState = 'hidden'; const hidden = h.calls.length;
  await h.refresh(); assert.equal(h.calls.length, hidden);
  assert.equal(h.writes().length, 0);
});

test('R11/J1 exact source request forces only its read and coalesces an identical in-flight lookup', async () => {
  const h = await ui({ view: 'home' }), release = h.holdRead(), waits = [];
  const detail = { sourceId: 'claim:synthetic-target', waitUntil: promise => waits.push(promise) };
  await h.document.emit('jarvis:v5-sources-changed', detail);
  await h.document.emit('jarvis:v5-sources-changed', detail);
  assert.deepEqual(h.calls.map(call => call.path), ['/api/personal-claims']);
  assert.equal(waits.length, 2); release(); await Promise.all(waits);
  const taskWaits = [];
  await h.document.emit('jarvis:v5-sources-changed', { sourceId: 'personal-task:synthetic-task', waitUntil: promise => taskWaits.push(promise) });
  await Promise.all(taskWaits);
  assert.equal(h.calls.at(-1).path, '/api/personal-tasks');
  assert.equal(h.calls.some(call => call.path === '/api/follow-ups'), false);
  assert.equal(h.writes().length, 0);
});

test('R03/K5 task drafts survive polls and reload without changing their source revision', async () => {
  const state = {}, tasks = new PersonalTasks({ state }), task = await tasks.create(input());
  const first = await ui({ state });
  await first.button(first.byId('personal-task-list'), 'Redigér opgave').emit('click');
  await first.type('personal-task-title', 'Min ugemte titel');
  const title = first.byId('personal-task-title'); title.focus(); title.selectionStart = 3; title.selectionEnd = 8;
  await tasks.update(task.id, { expectedRevision: 1, purpose: 'Ny ekstern begrundelse.' });
  await first.refresh();
  assert.equal(first.document.activeElement, title); assert.equal(title.value, 'Min ugemte titel');
  assert.deepEqual([title.selectionStart, title.selectionEnd], [3, 8]);
  assert.match(first.byId('personal-task-form').textContent, /Ændret et andet sted/);
  const saved = JSON.parse(first.saved.get('jarvis:v5:plan-drafts'));
  assert.equal(saved.task.edit.revision, 1);
  assert.equal(first.saved.get('jarvis:v5:plan-drafts').includes('synthetic-token'), false);
  const second = await ui({ state, saved: first.saved });
  assert.equal(second.byId('personal-task-title').value, 'Min ugemte titel');
  await second.byId('personal-task-form').emit('submit');
  assert.equal(second.writes().at(-1).body.expectedRevision, 1);
  assert.match(second.byId('personal-task-status').textContent, /ikke bekræftet/);
  assert.equal(second.byId('personal-task-title').value, 'Min ugemte titel');
  assert.equal(tasks.list()[0].title, task.title);
  await second.button(second.byId('personal-task-form'), 'Hent nyeste opgave og kassér kladde').emit('click');
  assert.equal(second.byId('personal-task-title').value, task.title);
  assert.equal(JSON.parse(second.saved.get('jarvis:v5:plan-drafts')).task.edit.revision, 2);
});

test('R03/K5 keyed polling retains a focused card while neighbouring tasks are imported', async () => {
  const state = {}, tasks = new PersonalTasks({ state }), one = await tasks.create(input('Oprindelig opgave'));
  const h = await ui({ state }); const target = h.byId('personal-task-list'), card = target.firstElementChild;
  const action = h.button(card, 'Redigér opgave'); action.focus();
  await tasks.create(input('Importeret opgave')); await tasks.update(one.id, { expectedRevision: 1, title: 'Ændret andet sted' });
  await h.refresh(); await h.refresh();
  assert.equal(h.document.activeElement, action); assert.equal(h.document.focusDetachments, 0);
  assert.equal(target.firstElementChild, card); assert.match(card.textContent, /Ændret et andet sted/);
  assert.equal(target.children.length, 2);
  h.byId('personal-task-title').focus(); await h.refresh();
  assert.notEqual(target.firstElementChild, card); assert.match(target.firstElementChild.textContent, /Ændret andet sted/);
});

test('C2/K3 task editor saves structured dependencies, uncertainty and local lock with exact revision', async () => {
  const state = {}, tasks = new PersonalTasks({ state });
  const before = await tasks.create(input('Forudsætning')), task = await tasks.create(input('Efterfølger'));
  const h = await ui({ state }); const card = [...h.byId('personal-task-list').children].find(card => card.dataset.personalTaskId === task.id);
  await h.button(card, 'Redigér opgave').emit('click');
  await h.type('personal-task-planned', '2026-11-06T11:00'); await h.check('personal-task-locked');
  await h.type('personal-task-uncertainty', '15'); await h.type('personal-task-outcome', 'Et gennemgået notat.');
  h.byId('personal-task-dependencies').options.find(option => option.value === before.id).selected = true;
  await h.byId('personal-task-dependencies').emit('change');
  await h.byId('personal-task-form').emit('submit');
  const updated = tasks.list().find(item => item.id === task.id);
  assert.equal(updated.revision, 2); assert.equal(updated.plannedStart, '2026-11-06T10:00:00.000Z');
  assert.equal(updated.lockedStart, updated.plannedStart); assert.equal(updated.durationUncertaintyMinutes, 15);
  assert.deepEqual(updated.dependencies, [before.id]); assert.equal(updated.expectedOutcome, 'Et gennemgået notat.');
  assert.deepEqual(h.writes().map(call => [call.method, call.path]), [['PATCH', `/api/personal-tasks/${task.id}`]]);
  assert.match(h.byId('personal-task-status').textContent, /gemt lokalt/);
});

test('C3/K5 editing an unchanged saved repeated hour preserves its original offset and seconds', async () => {
  const state = {}, tasks = new PersonalTasks({ state });
  const task = await tasks.create({ ...input(), plannedStart: '2026-10-25T01:30:12.350Z', lockedStart: '2026-10-25T01:30:12.350Z' });
  const h = await ui({ state }); await h.button(h.byId('personal-task-list'), 'Redigér opgave').emit('click');
  await h.type('personal-task-purpose', 'Rettet formål, uændret tidspunkt.'); await h.byId('personal-task-form').emit('submit');
  assert.equal(tasks.list()[0].lockedStart, task.lockedStart);
  assert.equal(h.byId('plan-repeated-time').value, 'reject');
});

test('R03/K5 incomplete structured window rows survive reload without invented times or save', async () => {
  const first = await ui();
  const editor = first.byId('personal-task-form').querySelector('fieldset');
  await first.button(editor, 'Tilføj tidsvindue').emit('click');
  const fields = editor.querySelectorAll('input'); fields[0].value = '2026-11-06T09:00'; await fields[0].emit('input');
  const second = await ui({ saved: first.saved });
  const recovered = second.byId('personal-task-form').querySelector('fieldset').querySelectorAll('input');
  assert.equal(recovered.length, 2); assert.equal(recovered[0].value, '2026-11-06T09:00'); assert.equal(recovered[1].value, '');
  assert.deepEqual(second.writes(), []);
  await second.type('personal-task-title', 'Kladde'); await second.type('personal-task-purpose', 'Skal kunne færdiggøres senere.');
  await second.byId('personal-task-form').emit('submit'); assert.deepEqual(second.writes(), []);
  assert.match(second.byId('personal-task-status').textContent, /begge tider/);
});

test('C3/C4 simulation requires explicit coverage, stays read-only, and submits prior choices for selective replan', async () => {
  const state = {}, tasks = new PersonalTasks({ state }); await tasks.create(input());
  const h = await ui({ state });
  await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00');
  await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().at(-1).body.calendarCoverage.status, 'unknown');
  assert.equal(h.byId('capacity-results').querySelectorAll('[data-proposed-task-id]').length, 0);
  await h.check('capacity-manual-review'); await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().at(-1).body.calendarCoverage.status, 'ready');
  assert.equal(h.writes().at(-1).body.workWindows[0].start, '2026-11-06T08:00:00.000Z');
  assert.equal(tasks.list()[0].plannedStart, null);
  assert.equal(h.byId('capacity-results').querySelectorAll('[data-proposed-task-id]').length, 1);
  await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().at(-1).body.previousProposals.length, 1);
  assert.match(h.byId('capacity-results').textContent, /Tidligere valg bevaret/);
  assert.ok(h.writes().every(call => call.path === '/api/planning/simulate'));
});

test('C2/C4 saving a reviewed placement is one local revision-bound update, not a calendar write', async () => {
  const state = {}, tasks = new PersonalTasks({ state }), task = await tasks.create(input());
  const h = await ui({ state });
  await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00'); await h.check('capacity-manual-review');
  await h.byId('capacity-form').emit('submit');
  await h.button(h.byId('capacity-results'), 'Gem og lås placering').emit('click');
  assert.deepEqual(h.writes().map(call => call.path), ['/api/planning/simulate', `/api/personal-tasks/${task.id}`]);
  assert.equal(h.writes().at(-1).body.expectedRevision, 1);
  assert.equal(tasks.list()[0].lockedStart, '2026-11-06T08:00:00.000Z');
  assert.equal(h.button(h.byId('capacity-results'), 'Gem og lås placering'), undefined);
  assert.match(h.byId('capacity-status').textContent, /Ingen kalenderaftale/);
});

test('C4 a stale plan cannot overwrite a newer task revision', async () => {
  const state = {}, tasks = new PersonalTasks({ state }), task = await tasks.create(input());
  const h = await ui({ state });
  await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00'); await h.check('capacity-manual-review');
  await h.byId('capacity-form').emit('submit'); await tasks.update(task.id, { expectedRevision: 1, purpose: 'Nyt grundlag.' });
  await h.button(h.byId('capacity-results'), 'Gem placering lokalt').emit('click');
  assert.equal(tasks.list()[0].plannedStart, null); assert.match(h.byId('capacity-status').textContent, /ændret/);
});

test('C3/K5 a reloaded capacity draft does not silently reassert an old manual review', async () => {
  const first = await ui(); await first.type('capacity-start', '2026-11-06T09:00'); await first.type('capacity-end', '2026-11-06T12:00');
  await first.check('capacity-manual-review'); const second = await ui({ saved: first.saved });
  assert.equal(second.byId('capacity-start').value, '2026-11-06T09:00'); assert.equal(second.byId('capacity-manual-review').checked, false);
  assert.deepEqual(second.writes(), []); assert.match(second.byId('capacity-status').textContent, /Gennemgå kapaciteten igen/);
});

test('C3/C4 changed time windows revoke manual coverage and disable previously reviewed placements', async () => {
  const state = {}, tasks = new PersonalTasks({ state }); await tasks.create(input());
  const h = await ui({ state }); await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00');
  await h.check('capacity-manual-review'); await h.byId('capacity-form').emit('submit');
  const oldAction = h.button(h.byId('capacity-results'), 'Gem placering lokalt');
  await h.type('capacity-end', '2026-11-06T15:00');
  assert.equal(h.byId('capacity-manual-review').checked, false); assert.equal(oldAction.disabled, true);
  await oldAction.emit('click'); // Even a manually invoked stale callback cannot bypass the revision of the review.
  assert.equal(tasks.list()[0].plannedStart, null); assert.equal(h.writes().length, 1);
  assert.match(h.byId('capacity-status').textContent, /forældet/);
  await h.byId('capacity-form').emit('submit'); assert.equal(h.writes().at(-1).body.calendarCoverage.status, 'unknown');
  await h.check('capacity-manual-review'); await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().at(-1).body.previousProposals.length, 1, 'a temporary unknown state does not forget prior choices');
  assert.match(h.byId('capacity-results').textContent, /Tidligere valg bevaret/);
});

test('C3/C4 changing capacity while simulation is pending produces an explicitly stale, unsaveable result', async () => {
  const state = {}, tasks = new PersonalTasks({ state }); await tasks.create(input());
  const h = await ui({ state }); await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00');
  await h.check('capacity-manual-review'); const release = h.holdWrite(), pending = h.byId('capacity-form').emit('submit');
  await tick(); await h.type('capacity-end', '2026-11-06T15:00'); release(); await pending;
  assert.match(h.byId('capacity-status').textContent, /ændret under beregningen/);
  assert.equal(h.button(h.byId('capacity-results'), 'Gem placering lokalt').disabled, true);
  assert.equal(tasks.list()[0].plannedStart, null);
});

test('C3 manual busy periods are neither ignored nor sent alongside a Google-source review', async () => {
  const state = {}, tasks = new PersonalTasks({ state }); await tasks.create(input());
  const h = await ui({ state }); await h.type('capacity-start', '2026-11-06T09:00'); await h.type('capacity-end', '2026-11-06T12:00');
  const busy = h.byId('capacity-form').querySelectorAll('fieldset')[1];
  await h.button(busy, 'Tilføj tidsvindue').emit('click');
  const fields = busy.querySelectorAll('input'); fields[0].value = '2026-11-06T09:00'; fields[1].value = '2026-11-06T10:00';
  await fields[1].emit('input'); await h.check('capacity-reviewed'); await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().length, 0); assert.match(h.byId('capacity-status').textContent, /ignoreres lydløst/);
  await h.check('capacity-manual-review'); await h.byId('capacity-form').emit('submit');
  assert.equal(h.writes().at(-1).body.useCalendar, false);
  assert.equal(h.writes().at(-1).body.calendarEvents.length, 1);
  assert.match(h.byId('capacity-results').textContent, /10\.00|10:00/);
});

test('C5 follow-up can be postponed, observed as unknown, and cancelled without external work', async () => {
  const state = {}, cases = new FollowUpCases({ state });
  const record = await cases.create({ awaiting: 'Svar fra et dokument jeg følger', nextCheckAt: '2026-11-06T09:00:00Z',
    stopCondition: 'Når svaret er registreret.', source: { kind: 'user', id: 'manual' } });
  const h = await ui({ state });
  await h.button(h.byId('follow-up-list'), 'Udskyd / registrér observation').emit('click');
  assert.equal(h.byId('follow-up-awaiting').readOnly, true);
  await h.type('follow-up-check', '2026-11-07T10:00'); await h.byId('follow-up-form').emit('submit');
  assert.equal(cases.list()[0].nextCheckAt, '2026-11-07T09:00:00.000Z');
  assert.equal(h.writes().at(-1).body.action, 'snooze');
  await h.button(h.byId('follow-up-list'), 'Udskyd / registrér observation').emit('click');
  await h.type('follow-observation-status', 'unknown'); await h.type('follow-observation-source', 'Eget forsøg på at læse kilden');
  await h.type('follow-observation-value', 'Kilden var utilgængelig.'); await h.byId('follow-up-form').emit('submit');
  assert.equal(cases.list()[0].observations[0].status, 'unknown'); assert.equal(h.writes().at(-1).body.expectedRevision, 2);
  await h.button(h.byId('follow-up-list'), 'Annullér sag').emit('click');
  assert.equal(cases.list({ includeClosed: true })[0].status, 'cancelled');
  assert.equal(cases.list({ includeClosed: true })[0].observations.length, 1);
  assert.ok(h.writes().every(call => call.path === `/api/follow-ups/${record.id}`));
});

test('R03/C5 follow-up draft retains its old revision and unknown observation after another update', async () => {
  const state = {}, cases = new FollowUpCases({ state });
  const record = await cases.create({ awaiting: 'Afvent kilde', nextCheckAt: '2026-11-06T09:00:00Z', stopCondition: 'Ved svar', source: { kind: 'user', id: 'manual' } });
  const first = await ui({ state }); await first.button(first.byId('follow-up-list'), 'Udskyd / registrér observation').emit('click');
  await first.type('follow-observation-status', 'unknown'); await first.type('follow-observation-source', 'Kilden kunne ikke læses');
  await cases.update(record.id, 1, 'snooze', { nextCheckAt: '2026-11-08T09:00:00Z' });
  const second = await ui({ state, saved: first.saved });
  assert.match(second.byId('follow-up-form').textContent, /Ændret et andet sted/);
  assert.equal(second.byId('follow-observation-status').value, 'unknown');
  await second.byId('follow-up-form').emit('submit');
  assert.equal(second.writes().at(-1).body.expectedRevision, 1); assert.equal(cases.list()[0].observations.length, 0);
});

test('R03/K5 edits typed while a save is pending are not cleared by its successful response', async () => {
  const h = await ui(); await h.type('personal-task-title', 'Første titel'); await h.type('personal-task-purpose', 'Første begrundelse.');
  const release = h.holdWrite(), pending = h.byId('personal-task-form').emit('submit'); await tick();
  await h.type('personal-task-title', 'Ny titel under gemning'); release(); await pending;
  assert.equal(h.tasks.list()[0].title, 'Første titel'); assert.equal(h.byId('personal-task-title').value, 'Ny titel under gemning');
  const saved = JSON.parse(h.saved.get('jarvis:v5:plan-drafts')); assert.equal(saved.task.edit.revision, 1); assert.equal(saved.task.dirty, true);
  await h.byId('personal-task-form').emit('submit'); assert.equal(h.tasks.list().length, 1); assert.equal(h.tasks.list()[0].title, 'Ny titel under gemning');
});

test('A/K save success followed by a failed refresh is not falsely reported as failed persistence', async () => {
  const h = await ui(); await h.type('personal-task-title', 'Gem trods læsefejl'); await h.type('personal-task-purpose', 'Bevar ærlig status.');
  h.setFailure((path, method) => path === '/api/personal-tasks' && method === 'GET' ? new Error('syntetisk læsefejl') : null);
  await h.byId('personal-task-form').emit('submit'); assert.equal(h.tasks.list().length, 1);
  assert.match(h.byId('personal-task-status').textContent, /er gemt, men oversigten/);
  assert.equal(h.writes().length, 1);
});

test('R03/K5 blocked storage warns before losing an unsaved draft; logout clears it without writes', async () => {
  const h = await ui({ storageBlocked: true }); await h.type('personal-task-title', 'Ugemt lokal tekst');
  assert.match(h.byId('personal-task-form').textContent, /afviser kladdelagring/);
  let warned = false; const event = { preventDefault: () => { warned = true; } };
  h.windowEvents.get('beforeunload')(event); assert.equal(warned, true);
  h.setToken(null); await h.byId('logout').emit('click');
  assert.equal(h.byId('personal-task-title').value, ''); assert.equal(h.saved.has('jarvis:v5:plan-drafts'), false);
  assert.deepEqual(h.writes(), []);
});

test('I/K a signed-out load does not restore another session draft or initiate reads', async () => {
  const saved = new Map([['jarvis:v5:plan-drafts', JSON.stringify({ version: 1, task: { dirty: true,
    fields: { 'personal-task-title': { value: 'Privat syntetisk kladde' } } } })]]);
  const h = await ui({ saved, authenticated: false });
  assert.equal(h.byId('personal-task-title').value, ''); assert.equal(saved.has('jarvis:v5:plan-drafts'), false); assert.deepEqual(h.calls, []);
});
