import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Element } from './helpers/dom-contract.mjs';
import { TaskEngine } from '../task-engine.mjs';
import { reviewMonitorAnswer } from '../monitor-observation.mjs';

const [jobSource, watchSource] = await Promise.all([
  readFile(new URL('../public/job-policy.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/gui-watches.js', import.meta.url), 'utf8'),
]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Behavioural DOM contract only. The CI browser matrix separately checks CSS,
// actual focus, viewport behaviour and the served script/route integration.
async function fixture({ customApi } = {}) {
  const document = { activeElement: null, focusDetachments: 0 };
  document.createElement = tag => new Element(document, tag);
  document.body = document.createElement('body'); document.activeElement = document.body;
  const ids = new Map();
  document.getElementById = id => ids.get(id) || null;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  const make = (tag, id, parent = document.body) => { const item = document.createElement(tag); item.id = id; ids.set(id, item); parent.append(item); return item; };
  const plan = make('section', 'tab-plan'), watches = make('section', 'tab-watches');
  const taskHost = make('div', 'tasks-editor-host', plan), watchHost = make('div', 'watches-editor-host', watches);
  const shell = make('details', 'task-editor-shell', taskHost), form = make('form', 'task-form', shell);
  make('div', 'tasks', plan); make('span', 'usage', plan); make('button', 'logout');
  make('div', 'watches-list', watches); make('p', 'watches-status', watches); make('button', 'watches-new', watches);
  for (const value of ['active', 'paused', 'all']) { const button = make('button', `filter-${value}`, watches); button.dataset.watchFilter = value; }
  const context = vm.createContext({ Intl, Date, URL, document, addEventListener() {} });
  vm.runInContext(`${jobSource}\n${watchSource}\nglobalThis.Jobs = JarvisJobs; globalThis.Watches = JarvisWatches;`, context);
  const selects = new Set(['task-category', 'task-skill', 'task-when', 'task-repeat', 'task-time-zone', 'task-missed-mode', 'task-deduplicate']);
  for (const id of Object.keys(context.Jobs.defaults)) make(selects.has(id) ? 'select' : 'input', id, form);
  for (const id of ['task-draft-status', 'task-policy-preview', 'task-skill-status', 'daily-wrap', 'later-wrap']) make('div', id, form);
  for (const id of ['task-submit', 'task-new-draft', 'task-reload', 'task-copy-draft']) make('button', id, form);
  let owner = 'synthetic-owner-session', executionCount = 0, route = 'plan', routeOptions = {}, editor, monitor;
  const requests = [], state = {}, storage = new Map();
  const engine = new TaskEngine({ state, save: async () => {}, now: () => new Date('2026-11-05T10:00:00Z'),
    runTask: async () => { executionCount++; return 'Syntetisk læseresultat'; } });
  const navigate = (view, options = {}) => { route = view; routeOptions = options; plan.classList.toggle('hidden', view !== 'plan'); watches.classList.toggle('hidden', view !== 'watches'); };
  const render = () => { const tasks = engine.list(); editor.render(tasks, engine.currentUsage(), { filter: task => task.category !== 'monitor' }); monitor.render(tasks); };
  const api = async (path, options = {}) => {
    requests.push({ path, ...options });
    if (customApi) await customApi(path, options);
    const data = options.body ? JSON.parse(options.body) : {};
    if (path === '/api/skills') return { skills: [] };
    if (path === '/api/tasks' && options.method === 'POST') return { task: await engine.create(data) };
    const action = path.match(/^\/api\/tasks\/([^/]+)\/action$/);
    if (action) return { task: await engine.action(action[1], data.action, { expectedRevision: data.expectedRevision }) };
    const update = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (update && options.method === 'PATCH') return { task: await engine.update(update[1], data) };
    throw new Error(`Unexpected isolated route ${path}`);
  };
  editor = context.Jobs.attach({ document, api, getToken: () => owner, refresh: async () => render(), navigateSkill() {}, confirm: () => true,
    onOpen: ({ category }) => { const target = category === 'monitor' ? watchHost : taskHost;
      if (shell.parentNode !== target) target.append(shell); navigate(category === 'monitor' ? 'watches' : 'plan'); },
    storage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  monitor = context.Watches.attach({ document, editor, navigate, getToken: () => owner });
  const row = id => ids.get('watches-list').children.find(item => item.dataset.watchId === id);
  return { document, ids, engine, editor, monitor, render, requests, row, storage, route: () => route, routeOptions: () => routeOptions,
    executions: () => executionCount,
    set: async (id, value) => { ids.get(id).value = value; await ids.get(id).emit('input'); },
    logout: async () => { owner = ''; await ids.get('logout').emit('click'); },
  };
}
const input = { title: 'Syntetisk overvågning', prompt: 'Læs kun den syntetiske kilde.', category: 'monitor', activation: 'paused', intervalMinutes: 60 };

test('GUI-T01/T11 monitor editing reuses the original form and exact job rather than cloning data', async () => {
  const f = await fixture();
  const monitored = await f.engine.create(input);
  const research = await f.engine.create({ ...input, category: 'research', title: 'Syntetisk research' });
  f.render();
  assert.equal(f.ids.get('tasks').children.filter(item => item.dataset.taskId).length, 1);
  assert.equal(f.ids.get('tasks').children[0].dataset.taskId, research.id);
  assert.equal(f.document.querySelectorAll('[data-task-id]').filter(item => item.dataset.taskId === monitored.id).length, 1);
  const originalForm = f.ids.get('task-form'), originalTitle = f.ids.get('task-title');
  await f.row(monitored.id).querySelector('[data-task-action="edit"]').emit('click');
  assert.equal(f.ids.get('task-editor-shell').parentNode, f.ids.get('watches-editor-host'));
  assert.equal(f.ids.get('task-editor-shell').open, true);
  assert.equal(f.route(), 'watches');
  await f.set('task-title', 'Ugemt monitorændring');
  f.editor.show(); f.render();
  assert.equal(f.ids.get('task-form'), originalForm);
  assert.equal(f.ids.get('task-title'), originalTitle);
  assert.equal(f.ids.get('task-title').value, 'Ugemt monitorændring');
  await f.editor.save({ preventDefault() {} });
  assert.equal(f.engine.list().find(task => task.id === monitored.id).title, 'Ugemt monitorændring');
  assert.equal(f.engine.list().find(task => task.id === monitored.id).revision, 2);
  assert.equal(f.engine.list().find(task => task.id === monitored.id).status, 'paused');
  assert.equal(f.engine.list().length, 2);
  assert.equal(f.executions(), 0);
});

test('GUI-T07 creating a monitor saves a paused job and never starts reading as a hidden side effect', async () => {
  const f = await fixture(); f.render();
  await f.ids.get('watches-new').emit('click');
  assert.equal(f.ids.get('task-category').value, 'monitor');
  assert.equal(f.ids.get('task-title').value, '');
  assert.equal(f.route(), 'watches');
  assert.equal(f.requests.some(request => request.method === 'POST'), false);
  await f.set('task-title', 'Min overvågning'); await f.set('task-prompt', 'Læs den angivne testkilde.');
  await f.editor.save({ preventDefault() {} });
  await f.engine.tick();
  const task = f.engine.list()[0];
  assert.equal(task.category, 'monitor'); assert.equal(task.status, 'paused'); assert.equal(f.executions(), 0);
  assert.ok(f.row(task.id));
  assert.equal(f.ids.get('tasks').children.some(item => item.dataset.taskId === task.id), false);
});

test('GUI-T07 pause and resume use the displayed revision and retain criteria and history', async () => {
  const f = await fixture();
  const task = await f.engine.create({ ...input, activation: 'scheduled' });
  task.runs.push({ id: 'synthetic-run', at: '2026-11-05T08:00:00Z', status: 'failed', result: 'Syntetisk kildefejl' });
  const originalRuns = JSON.stringify(task.runs), originalPrompt = task.prompt;
  f.render();
  await f.row(task.id).querySelector('[data-task-action="pause"]').emit('click');
  assert.equal(f.row(task.id).dataset.watchOperation, 'paused');
  assert.equal(f.engine.list()[0].status, 'paused');
  await f.row(task.id).querySelector('[data-task-action="resume"]').emit('click');
  assert.equal(f.row(task.id).dataset.watchOperation, 'scheduled');
  assert.equal(f.engine.list()[0].prompt, originalPrompt);
  assert.equal(JSON.stringify(f.engine.list()[0].runs), originalRuns);
  const calls = f.requests.filter(request => request.path.endsWith('/action')).map(request => JSON.parse(request.body));
  assert.deepEqual(calls.map(call => call.action), ['pause', 'resume']);
  assert.ok(calls.every(call => Number.isInteger(call.expectedRevision)));
  assert.equal(f.executions(), 0);
});

test('GUI-T11 a focused stale monitoring action cannot activate an unreviewed revision', async () => {
  const f = await fixture(); const task = await f.engine.create(input); f.render();
  const row = f.row(task.id), resume = row.querySelector('[data-task-action="resume"]'); resume.focus();
  await f.engine.update(task.id, { expectedRevision: 1, prompt: 'Ny instruktion fra en anden klient.' });
  f.render();
  assert.equal(f.row(task.id), row); assert.equal(f.document.activeElement, resume);
  assert.match(row.querySelector('[data-watch-stale]').textContent, /viste revision/);
  await resume.emit('click');
  assert.match(row.querySelector('[data-job-action-status]').textContent, /ændret siden/);
  assert.equal(f.engine.list()[0].status, 'paused');
  assert.equal(f.executions(), 0);
});

test('GUI-T11 an outstanding monitor action cannot repopulate private DOM after logout', async () => {
  const gate = deferred();
  const f = await fixture({ customApi: async path => { if (path.endsWith('/action')) await gate.promise; } });
  const task = await f.engine.create(input); f.render();
  const action = f.row(task.id).querySelector('[data-task-action="resume"]').emit('click');
  await tick(); await f.logout(); gate.resolve(); await action;
  assert.equal(f.ids.get('watches-list').children.length, 0);
  assert.equal(f.ids.get('tasks').children.length, 0);
  assert.equal(f.ids.get('task-title').value, '');
  assert.equal(f.storage.size, 0);
});


test('GUI-T01 monitor source navigation clears a mismatching filter and preserves the original task source in the route', async () => {
  const f = await fixture();
  const monitored = await f.engine.create(input); f.render();
  await f.ids.get('filter-active').emit('click');
  assert.equal(f.row(monitored.id), undefined);
  assert.equal(f.monitor.open(monitored.id), true);
  assert.equal(f.route(), 'watches');
  assert.equal(f.routeOptions().sourceId, `task:${monitored.id}`);
  assert.equal(f.routeOptions().preserveDestination, true);
  assert.ok(f.row(monitored.id));
  assert.equal(f.ids.get('filter-all').attributes['aria-pressed'], 'true');
});

test('GUI-T07 a changed source basis stays unknown while its current reported value is visible without a verification claim', () => {
  const sample = { subject: 'Syntetisk produkt', variant: 'Blå', unit: 'DKK', value: 100, source: 'https://first.example.invalid/product' };
  const answer = reviewMonitorAnswer(JSON.stringify({ summary: 'Syntetisk kildeændring', observation: { ...sample, source: 'https://second.example.invalid/product' } }), sample);
  const Watches = vm.runInNewContext(`${watchSource}\nJarvisWatches;`, { Intl, Date, URL });
  const view = Watches.presentation({ ...input, status: 'scheduled', runs: [{ at: '2026-11-05T10:00:00Z', status: 'unknown',
    observation: { ...answer.observation, observedAt: '2026-11-05T10:00:00Z' } }] }, Date.parse('2026-11-05T10:10:00Z'));
  assert.equal(view.observation.status, 'unknown');
  assert.equal(view.source, 'https://second.example.invalid/product');
  assert.match(view.value, /100/); assert.match(view.checkLabel, /ændring endnu ikke afgjort/);
  assert.doesNotMatch(view.checkLabel, /verificeret|bekræftet|uændret/i);
});
