import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../public/chat-draft.js', import.meta.url), 'utf8');
const KEY = 'jarvis:v5:chat-draft';
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function fixture({ api = async () => ({}), refresh = async () => {}, storage = new Map(), unavailable = false, selectedContext = null } = {}) {
  const nodes = new Map(), added = [];
  const make = id => { const events = new Map(); const node = { id, value: '', textContent: '', disabled: false, hidden: false,
    setAttribute() {}, focus() { document.activeElement = node; }, after(...items) { added.push(...items); },
    addEventListener(type, fn) { events.set(type, [...(events.get(type) || []), fn]); },
    fire(type) { for (const fn of events.get(type) || []) fn({ preventDefault() {} }); } }; nodes.set(id, node); return node; };
  const documentEvents = new Map();
  const document = { getElementById: id => nodes.get(id) || make(id), createElement: tag => make(`generated-${tag}-${added.length}-${nodes.size}`),
    addEventListener(type, fn) { documentEvents.set(type, [...(documentEvents.get(type) || []), fn]); },
    dispatchEvent(event) { for (const fn of documentEvents.get(event.type) || []) fn(event); } };
  for (const id of ['message', 'message-form', 'send', 'logout']) make(id);
  let token = 'synthetic-owner'; const calls = [];
  const context = vm.createContext({ document, globalThis: {}, Object, JSON });
  vm.runInContext(code, context);
  const controller = context.globalThis.JarvisChat.attach({ document, getToken: () => token,
    getStorage: () => { if (unavailable) throw new Error('storage unavailable'); return { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }; },
    api: async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return api(path, options); }, refresh,
    getContext: () => selectedContext, setContext: value => { selectedContext = value; } });
  return { controller, calls, storage, field: nodes.get('message'), send: nodes.get('send'), status: added[0], review: added[1],
    type: text => { const node = nodes.get('message'); node.value = text; node.fire('input'); },
    logout: () => { nodes.get('logout').fire('click'); token = ''; }, login: value => { token = value; }, document,
    context: () => selectedContext,
    changeContext: value => { selectedContext = value; document.dispatchEvent({ type: 'jarvis:chat-context-change' }); } };
}

test('R03 chat retains newer typing during an in-flight message and ignores duplicate submits', async () => {
  const g = gate(), f = fixture({ api: () => g.promise }); f.type('Første besked');
  const sending = f.controller.submit(); await f.controller.submit(); f.type('Ny kladde under svar'); g.release({ answer: 'Syntetisk svar' }); await sending;
  assert.equal(f.calls.length, 1); assert.equal(f.field.value, 'Ny kladde under svar');
  assert.match(f.status.textContent, /nyere kladde er bevaret/); assert.equal(f.send.disabled, false);
  assert.equal(JSON.parse(f.storage.get(KEY)).text, f.field.value);
});

test('R03 successful message clears only its own unchanged draft and notifies truthfully when history refresh fails', async () => {
  const f = fixture({ refresh: async () => { throw new Error('read failed'); } }); f.type('Send mig'); await f.controller.submit();
  assert.equal(f.field.value, ''); assert.equal(f.storage.has(KEY), false);
  assert.match(f.status.textContent, /gennemført.*historikken kunne ikke opdateres/); assert.equal(f.review.hidden, true);
});

test('R05 lost response keeps a persistent unknown outcome and never blindly repeats model or tool actions', async () => {
  const storage = new Map(), f = fixture({ storage, api: async () => { throw new Error('synthetic connection loss'); } });
  f.type('En anmodning, der kan have haft virkning'); await f.controller.submit(); await f.controller.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.send.disabled, true); assert.equal(f.review.hidden, false);
  const reloaded = fixture({ storage });
  assert.equal(reloaded.field.value, f.field.value); assert.equal(reloaded.send.disabled, true);
  await reloaded.controller.submit(); assert.equal(reloaded.calls.length, 0);
  reloaded.review.fire('click'); assert.equal(reloaded.calls.length, 0, 'review is not a hidden retry');
  assert.equal(reloaded.send.disabled, false); assert.equal(reloaded.document.activeElement, reloaded.field);
});

test('R03 page reload during a pending request restores a draft but requires outcome review before sending', async () => {
  const g = gate(), storage = new Map(), f = fixture({ storage, api: () => g.promise });
  f.type('Ventende besked'); const sending = f.controller.submit();
  const reloaded = fixture({ storage }); assert.equal(reloaded.send.disabled, true); assert.equal(reloaded.field.value, 'Ventende besked');
  g.release({}); await sending;
});

test('R03 explicit logout clears the chat draft and ignores an old successful response or failure', async () => {
  for (const reject of [false, true]) {
    const g = gate(), f = fixture({ api: async () => { await g.promise; if (reject) throw new Error('old account'); return {}; } });
    f.type('Privat gammel kladde'); const sending = f.controller.submit(); f.logout(); f.login('new-synthetic-owner'); f.type('Ny ejers kladde');
    g.release(); await sending;
    assert.equal(f.field.value, 'Ny ejers kladde'); assert.match(f.status.textContent, /Uafsendt kladde/);
    assert.equal(f.review.hidden, true); assert.equal(f.send.disabled, false);
  }
});

test('I4 chat secret-shaped text is never put in browser storage, while pending outcome metadata survives', async () => {
  const g = gate(), f = fixture({ api: () => g.promise }); f.type('password=synthetic-secret-value');
  assert.equal(f.storage.has(KEY), false); assert.match(f.status.textContent, /kun i hukommelsen/);
  const sending = f.controller.submit();
  assert.equal(JSON.stringify([...f.storage.values()]).includes('synthetic-secret-value'), false);
  assert.equal(JSON.parse(f.storage.get(KEY)).pending, true);
  g.release({}); await sending;
});

test('R03 a storage failure is visible and leaves the in-memory chat draft usable', async () => {
  const f = fixture({ unavailable: true }); f.type('Manuel kladde');
  assert.match(f.status.textContent, /kunne ikke gemme kladden/); assert.equal(f.field.value, 'Manuel kladde');
  await f.controller.submit(); assert.equal(f.calls.length, 1);
});

test('R03 explicit pre-processing rejection preserves text without falsely claiming an unknown action occurred', async () => {
  const f = fixture({ api: async () => { throw Object.assign(new Error('synthetic validation'), { status: 400 }); } });
  f.type('Afvist besked'); await f.controller.submit();
  assert.equal(f.field.value, 'Afvist besked'); assert.match(f.status.textContent, /afvist før behandling/);
  assert.equal(f.review.hidden, true); assert.equal(f.send.disabled, false);
});

test('I4 voice task tools cannot choose activation even with injected additional arguments', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const begin = app.indexOf("if (call.name === 'create_research_task') {") + "if (call.name === 'create_research_task') {".length;
  const end = app.indexOf("} else if (call.name === 'list_research_tasks')", begin);
  const calls = [];
  const run = vm.runInNewContext(`(async () => { ${app.slice(begin, end)}; return output; })`, {
    args: { title: 'Syntetisk', prompt: 'Forslag', activation: 'scheduled' }, JSON,
    api: async (path, options) => { calls.push(JSON.parse(options.body)); return { task: { id: 'synthetic', status: 'paused' } }; }, refreshTasks: async () => {} });
  const output = await run(); assert.equal(calls[0].activation, 'paused'); assert.equal(output.status, 'paused');
  assert.match(output.note, /intet baggrundsarbejde er startet/);
});

test('GUI-T10 outgoing context is captured before a delayed response while newer typing survives', async () => {
  const g = gate(), selectedContext = { label: 'Noter og lister', sourceId: 'organizer:list:item' };
  const f = fixture({ selectedContext, api: () => g.promise });
  f.type('Gennemgå denne note'); const sending = f.controller.submit();
  f.changeContext({ label: 'Madplan', sourceId: 'meal-plan:different' });
  f.type('Ny usendt kladde'); g.release({ answer: 'Syntetisk svar' }); await sending;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, '/api/message');
  assert.deepEqual(Object.keys(f.calls[0].body), ['message'], 'reuse the existing API contract');
  assert.equal(f.calls[0].body.message,
    '[Brugervalgt kontekst: Noter og lister]\n[Kilde-ID: organizer:list:item]\n\nGennemgå denne note');
  assert.equal(f.field.value, 'Ny usendt kladde');
  assert.match(f.status.textContent, /nyere kladde er bevaret/);
});

test('GUI-T10 context removal keeps the draft and restored context never invents object identity', () => {
  const storage = new Map(), f = fixture({ storage, selectedContext: { label: 'Planlægning · Madplan', sourceId: null } });
  f.type('Min usendte besked');
  const reloaded = fixture({ storage });
  assert.equal(reloaded.field.value, 'Min usendte besked'); assert.equal(reloaded.context().sourceId, null);
  reloaded.changeContext(null);
  assert.equal(reloaded.field.value, 'Min usendte besked');
  assert.equal(JSON.parse(storage.get(KEY)).context, null);
});

test('GUI-T10 context and text respect the existing message length bound without dropping the draft', async () => {
  const f = fixture({ selectedContext: { label: 'En valgt kontekst', sourceId: 'memory:one' } });
  f.type('x'.repeat(4990)); await f.controller.submit();
  assert.equal(f.calls.length, 0); assert.equal(f.field.value.length, 4990);
  assert.match(f.status.textContent, /5\.000/);
});

test('GUI-T10 malformed or secret-shaped context is not composed into the request or persisted', async () => {
  for (const selectedContext of [{ label: 'Skjult\nanden kontekst', sourceId: 'memory:one' },
    { label: 'password=synthetic-sensitive', sourceId: 'memory:one' }]) {
    const f = fixture({ selectedContext }); f.type('Almindelig besked');
    assert.equal(JSON.parse(f.storage.get(KEY)).context, null);
    await f.controller.submit(); assert.equal(f.calls[0].body.message, 'Almindelig besked');
  }
});

test('confirmed no-actions API failure shows its cause and preserves a usable draft without automatic resend', async () => {
  const f = fixture({ api: async () => { throw Object.assign(new Error('OpenAI-kvoten er opbrugt.'), { status: 502, code: 'CHAT_QUOTA', outcome: 'no_actions' }); } });
  f.type('hej'); await f.controller.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.field.value, 'hej'); assert.equal(f.send.disabled, false);
  assert.equal(f.review.hidden, true); assert.match(f.status.textContent, /kvoten.*ikke.*udføre handlinger/);
});

test('a known diagnostic never unblocks an uncertain action, even with a normally safe HTTP rejection status', async () => {
  const f = fixture({ api: async () => { throw Object.assign(new Error('Modelsvar afvist.'), { status: 400, code: 'CHAT_API_REQUEST', outcome: 'unknown' }); } });
  f.type('Ændr listen'); await f.controller.submit(); await f.controller.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.field.value, 'Ændr listen'); assert.equal(f.send.disabled, true);
  assert.match(f.status.textContent, /Modelsvar afvist.*udfald er ikke bekræftet/);
});
