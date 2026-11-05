import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { TaskEngine } from '../task-engine.mjs';

const source = await readFile(new URL('../public/job-policy.js', import.meta.url), 'utf8');
const jobs = vm.runInNewContext(`${source}\nJarvisJobs;`, { Intl, Date });
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('H2 job editor emits paused, read-only, precisely versioned policies without starting work', () => {
  const data = plain(jobs.payload({ 'task-title': 'Test', 'task-prompt': 'Læs syntetisk kilde', 'task-repeat': 'daily',
    'task-daily-time': '08:15', 'task-time-zone': 'America/New_York', 'task-skill': 'daily-briefing@1.2.3',
    'task-parameters': '{"emne":"brætspil","budgetDKK":300}', 'task-retry-count': '0', 'task-missed-mode': 'pause' }));
  assert.equal(data.activation, 'paused');
  assert.equal(data.dailyTime, '08:15');
  assert.equal(data.intervalMinutes, 0);
  assert.equal(data.timeZone, 'America/New_York');
  assert.deepEqual(data.permissions, ['web.search']);
  assert.equal(data.skillId, 'daily-briefing');
  assert.equal(data.skillVersion, '1.2.3');
  assert.deepEqual(data.parameters, { emne: 'brætspil', budgetDKK: 300 });
  assert.equal(data.retryPolicy.maxRetries, 0);
  assert.equal(data.missedRunPolicy.mode, 'pause');
  assert.equal(data.deliveryPolicy.channel, 'inbox');
  assert.match(jobs.policyLines(data).join(' '), /ikke et kronebudget/);
});

test('H2 job editor never infers browser time zone and rejects impossible or ambiguous local starts', () => {
  const input = { 'task-title': 'Test', 'task-prompt': 'Syntetisk', 'task-when': 'later' };
  assert.equal(jobs.payload({ ...input, 'task-run-at': '2026-10-25T02:30+02:00' }).runAt, '2026-10-25T00:30:00.000Z');
  assert.equal(jobs.payload({ ...input, 'task-run-at': '2026-10-25T02:30+01:00' }).runAt, '2026-10-25T01:30:00.000Z');
  for (const invalid of ['2026-10-25T02:30', '2026-02-30T12:00Z', '2026-11-05T24:00Z'])
    assert.throws(() => jobs.payload({ ...input, 'task-run-at': invalid }), /entydigt tidspunkt/);
  for (const invalid of [ { 'task-parameters': '{"nested":{"write":true}}' }, { 'task-retry-count': '4' },
    { 'task-budget-runs': '0' }, { 'task-time-zone': 'Not/AZone' }, { 'task-quiet-start': '07:00' },
    { 'task-skill': 'daily-briefing@latest' } ]) assert.throws(() => jobs.payload({ ...input, ...invalid }));
});

test('H2 job statuses distinguish retries, permanent failures, unknown and partial outcomes', () => {
  assert.match(jobs.statusLabel({ status: 'scheduled', retryAttempt: 1, retryPolicy: { maxRetries: 2 } }), /Genforsøg.*1\/2/);
  assert.match(jobs.statusLabel({ status: 'paused', lastErrorKind: 'permanent' }), /Permanent fejl/);
  assert.match(jobs.statusLabel({ status: 'interrupted', lastRunStatus: 'unknown' }), /Uafklaret/);
  assert.match(jobs.statusLabel({ status: 'partially_completed' }), /Delvist/);
  assert.match(jobs.statusLabel({ status: 'queued' }), /Venter/);
});

// Small behavioural DOM double. It deliberately blurs detached focused nodes;
// this is not claimed as real-browser accessibility or physical-device evidence.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.dataset = {}; this.events = new Map(); this.className = ''; this.attributes = {}; this.id = ''; this._text = ''; this.value = '';
    this.classList = { contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, on) => { const set = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on ?? !set.has(name)) set.add(name); else set.delete(name); this.className = [...set].join(' '); },
      add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false) };
  }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child, next) { child.remove(); this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child); child.parentNode = this; }
  remove() { if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.detachments++; this.ownerDocument.activeElement = null; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...children); }
  contains(child) { return this === child || this.children.some(item => item.contains(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  matches(selector) {
    if (selector === 'details') return this.tagName === 'DETAILS';
    const match = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return this.dataset[key] !== undefined && (match[2] === undefined || this.dataset[key] === match[2]);
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  async emit(name) { for (const handler of this.events.get(name) || []) await handler({ preventDefault() {}, target: this, button: 0 });
    if (['input', 'change'].includes(name) && this.parentNode) await this.parentNode.emit(name); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

async function ui({ storage = new Map(), customApi, confirm = () => true } = {}) {
  const document = { activeElement: null, detachments: 0 };
  document.createElement = tag => new Element(document, tag);
  document.body = document.createElement('body');
  const nodes = new Map();
  document.getElementById = id => nodes.get(id);
  const make = (tag, id, parent = document.body) => { const item = document.createElement(tag); item.id = id; parent.append(item); nodes.set(id, item); return item; };
  const plan = make('div', 'tab-plan');
  const form = make('form', 'task-form', plan);
  const selects = ['task-category', 'task-skill', 'task-when', 'task-repeat', 'task-time-zone', 'task-missed-mode', 'task-deduplicate'];
  for (const id of Object.keys(jobs.defaults)) make(selects.includes(id) ? 'select' : 'input', id, form);
  for (const id of ['task-draft-status', 'task-policy-preview', 'task-skill-status', 'daily-wrap', 'later-wrap']) make('div', id, form);
  for (const id of ['task-submit', 'task-new-draft', 'task-reload', 'task-copy-draft']) make('button', id, form);
  make('div', 'tasks', plan); make('span', 'usage', plan); make('button', 'logout');
  let owner = 'synthetic-owner-session', executions = 0, controls;
  const state = {}, requests = [];
  const engine = new TaskEngine({ state, save: async () => {}, now: () => new Date('2026-11-05T10:00:00Z'), runTask: async () => { executions++; return 'Read'; } });
  const call = async (path, options = {}) => {
    requests.push({ path, ...options });
    if (customApi) { const result = await customApi(path, options); if (result !== undefined) return result; }
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/api/skills') return { skills: [{ name: 'daily-briefing', version: '1.0.0' }] };
    if (path === '/api/tasks' && options.method === 'POST') return { task: await engine.create(body) };
    const action = path.match(/^\/api\/tasks\/([^/]+)\/action$/);
    if (action) return { task: await engine.action(action[1], body.action, { expectedRevision: body.expectedRevision }) };
    const task = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (task) return { task: await engine.update(task[1], body) };
    throw new Error(`Unexpected test route: ${path}`);
  };
  const context = vm.createContext({ Intl, Date, document, addEventListener() {} });
  vm.runInContext(`${source}\nglobalThis.jobs = JarvisJobs;`, context);
  controls = context.jobs.attach({ document, api: call, getToken: () => owner,
    refresh: async () => controls.render(engine.list(), engine.currentUsage()), navigateSkill() {}, confirm,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  return { document, fields: nodes, controls, requests, engine, state, storage, executions: () => executions,
    set: async (id, value) => { nodes.get(id).value = value; await nodes.get(id).emit('input'); },
    save: () => controls.save({ preventDefault() {} }), render: () => controls.render(engine.list(), engine.currentUsage()),
    logout: async () => { owner = ''; await nodes.get('logout').emit('click'); } };
}

test('H2 create through the real controller posts only a paused job; later edits PATCH the original revision', async () => {
  const f = await ui();
  assert.equal(f.requests.length, 0, 'no hidden initial API calls');
  await f.set('task-title', 'Ny pauset kladde'); await f.set('task-prompt', 'Kun syntetisk research');
  await f.save();
  const creation = f.requests.find(request => request.method === 'POST');
  assert.equal(JSON.parse(creation.body).activation, 'paused');
  assert.equal(f.engine.list()[0].status, 'paused');
  await f.engine.tick(); assert.equal(f.executions(), 0);
  f.controls.edit(f.engine.list()[0]);
  await f.set('task-title', 'Revideret kladde');
  await f.save();
  const update = f.requests.find(request => request.method === 'PATCH');
  assert.equal(JSON.parse(update.body).expectedRevision, 1);
  assert.equal(JSON.parse(update.body).activation, 'paused');
  assert.equal(f.engine.list()[0].revision, 2);
  assert.equal(f.engine.list()[0].status, 'paused');
  assert.equal(f.requests.some(request => request.path.endsWith('/action')), false);
});

test('R03 job form drafts survive polling, focused-card updates, conflicts and reload', async () => {
  const f = await ui();
  const task = await f.engine.create({ title: 'Gemt', prompt: 'Syntetisk kilde', activation: 'paused' });
  f.render(); f.controls.edit(task);
  await f.set('task-title', 'Min uafsluttede titel');
  f.fields.get('task-title').focus();
  await f.engine.update(task.id, { expectedRevision: 1, title: 'Anden brugerændring' });
  f.render();
  assert.equal(f.fields.get('task-title').value, 'Min uafsluttede titel');
  assert.equal(f.document.activeElement, f.fields.get('task-title'));
  assert.match(f.fields.get('task-draft-status').textContent, /ændret et andet sted/);
  assert.equal(f.fields.get('task-submit').disabled, true);
  const before = f.requests.filter(request => request.method === 'PATCH').length;
  await f.save();
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, before);
  const reloaded = await ui({ storage: f.storage });
  assert.equal(reloaded.fields.get('task-title').value, 'Min uafsluttede titel');
  assert.match(reloaded.fields.get('task-draft-status').textContent, /gendannet/);
});

test('R03 saving a job never clears edits typed while its durable response is pending', async () => {
  const gate = deferred();
  let submitted = false;
  const f = await ui({ customApi: async (path, options) => {
    if (path === '/api/tasks' && options.method === 'POST') { submitted = true; await gate.promise; }
  } });
  await f.set('task-title', 'Indsendt titel'); await f.set('task-prompt', 'Indsendt instruktion');
  const saving = f.save(); await tick(); assert.equal(submitted, true);
  await f.set('task-prompt', 'Nyere indtastning under gemning'); f.fields.get('task-prompt').focus();
  gate.resolve(); await saving;
  assert.equal(f.engine.list()[0].prompt, 'Indsendt instruktion');
  assert.equal(f.fields.get('task-prompt').value, 'Nyere indtastning under gemning');
  assert.equal(f.document.activeElement, f.fields.get('task-prompt'));
  assert.match(f.fields.get('task-draft-status').textContent, /Ugemt kladde/);
  assert.match([...f.storage.values()][0], /Nyere indtastning/);
});

test('R03 job save failures and declined template replacement preserve the local draft', async () => {
  const f = await ui({ confirm: () => false, customApi: async (_path, options) => {
    if (options.method === 'POST') throw new Error('synthetic disk failure');
  } });
  await f.set('task-title', 'Min kladde'); await f.set('task-prompt', 'Bevar denne tekst');
  await f.save();
  assert.match(f.fields.get('task-draft-status').textContent, /Ikke gemt.*synthetic disk failure.*bevaret/);
  assert.equal(f.controls.template({ 'task-title': 'Skabelon' }), false);
  assert.equal(f.fields.get('task-title').value, 'Min kladde');
  assert.equal(f.fields.get('task-prompt').value, 'Bevar denne tekst');
});

test('H2 a focused stale card keeps its exact reviewed revision; activation of a newer policy is rejected', async () => {
  const f = await ui();
  const task = await f.engine.create({ title: 'Gemt', prompt: 'Syntetisk', activation: 'paused' });
  f.render();
  const card = f.fields.get('tasks').children[0], run = card.querySelector('[data-task-action="run"]');
  run.focus();
  await f.engine.update(task.id, { expectedRevision: 1, title: 'Ny politik' });
  f.render();
  assert.equal(f.fields.get('tasks').children[0], card);
  assert.equal(f.document.activeElement, run);
  assert.equal(f.document.detachments, 0);
  assert.match(card.querySelector('[data-job-stale]').textContent, /viste revision/);
  await run.emit('click');
  assert.match(card.querySelector('[data-job-action-status]').textContent, /ændret siden/);
  assert.equal(f.engine.list()[0].status, 'paused');
  assert.equal(f.executions(), 0);
});

test('I5 job drafts exclude recognized secrets and logout clears private draft text', async () => {
  const f = await ui();
  await f.set('task-title', 'Privat kladde'); await f.set('task-prompt', 'Husk syntetisk research');
  assert.ok(f.storage.size);
  await f.set('task-prompt', 'api_key=sk-abcdefghijklmnop12345');
  assert.equal(f.storage.size, 0);
  assert.equal(f.fields.get('task-submit').disabled, true);
  await f.save();
  assert.equal(f.requests.some(request => request.method === 'POST'), false);
  await f.logout();
  assert.equal(f.fields.get('task-prompt').value, '');
  assert.equal(f.fields.get('task-title').value, '');
  assert.equal(f.storage.size, 0);
});
