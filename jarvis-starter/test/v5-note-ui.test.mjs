import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SecretaryCore } from '../secretary-core.mjs';
import { Element } from './helpers/dom-contract.mjs';

const source = await readFile(new URL('../public/memory-v49.js', import.meta.url), 'utf8');
const planning = await readFile(new URL('../public/v5-plan.js', import.meta.url), 'utf8');
const JarvisPlan = vm.runInNewContext(`${planning}\nJarvisPlan;`, { Intl, Date });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const createKey = 'jarvis:v5:memory-note-draft', editKey = 'jarvis:v5:memory-note-edits';

async function harness({ state = {}, saved = new Map(), authenticated = true, storageBlocked = false, failInitialRead = false } = {}) {
  const secretary = new SecretaryCore({ state });
  const document = { activeElement: null, focusDetachments: 0, events: new Map() };
  document.createElement = tag => new Element(document, tag); document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => { const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean); return walk(document.body) || null; };
  document.addEventListener = (name, listener) => { if (!document.events.has(name)) document.events.set(name, []); document.events.get(name).push(listener); };
  document.emit = async (name, detail = {}) => { for (const listener of document.events.get(name) || []) await listener({ detail }); };
  const add = (tag, id, parent = document.body) => { const node = document.createElement(tag); node.id = id; parent.append(node); return node; };
  const workspace = add('main', 'workspace'); if (!authenticated) workspace.classList.add('hidden');
  const knowledge = add('section', 'tab-knowledge', workspace); add('div', 'memory-workbench-content', knowledge);
  const mode = add('select', 'memory-editor-mode', knowledge);
  for (const value of ['note', 'claim']) { const option = add('option', '', mode); option.value = value; }
  add('form', 'personal-claim-form', knowledge); add('p', 'claim-status', knowledge); add('button', 'logout');
  const h = { document, state, secretary, saved, calls: [], confirmations: [], windowEvents: new Map(),
    owner: authenticated ? 'synthetic-owner-note' : null, failure: failInitialRead ? () => new Error('Syntetisk læsefejl') : null, hold: null };
  const context = vm.createContext({ document, Intl, Date, JarvisPlan,
    localStorage: { getItem: () => h.owner }, sessionStorage: { getItem: key => saved.get(key) || null,
      setItem: (key, value) => { if (storageBlocked) throw new Error('blocked'); saved.set(key, value); }, removeItem: key => saved.delete(key) },
    window: { confirm: message => { h.confirmations.push(message); return true; },
      addEventListener: (name, action) => h.windowEvents.set(name, action) }, toast() {},
    api: async (path, options = {}) => {
      const call = { path, method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }; h.calls.push(call);
      if (h.failure) { const error = h.failure(call); if (error) throw error; }
      if (call.method !== 'GET' && h.hold) { const gate = h.hold; h.hold = null; await gate.promise; }
      try {
        if (path === '/api/memories' && call.method === 'GET') return { memories: secretary.listMemories() };
        if (path === '/api/memories' && call.method === 'POST') return { memory: await secretary.remember(call.body.text, null, { category: call.body.category }) };
        const [, , , id, action] = path.split('/');
        if (call.method === 'PUT') return { memory: await secretary.updateMemory(id, call.body) };
        if (action === 'confirm') return { memory: await secretary.confirmMemory(id, call.body) };
        if (action === 'archive') return { memory: await secretary.archiveMemory(id, call.body.expectedRevision) };
        throw new Error('Unexpected API route');
      } catch (error) { error.status ||= 409; throw error; }
    } });
  vm.runInContext(source, context); await tick();
  Object.assign(h, { field: id => document.getElementById(id), refresh: () => document.emit('jarvis:memories-changed'),
    card: id => document.getElementById('memory-workbench-list').children.find(card => card.dataset.memoryId === id),
    button: (root, text) => root.querySelectorAll('button').find(button => button.textContent === text),
    writes: () => h.calls.filter(call => call.method !== 'GET'),
    async fill(input, value) { input.value = value; await input.emit(input.tagName === 'SELECT' ? 'change' : 'input'); } });
  return h;
}
async function fixture({ proposed = false, expiresAt = null } = {}) {
  const state = {}, secretary = new SecretaryCore({ state });
  const record = await secretary.remember('Syntetisk oprindelig note', null, { category: 'preference', confirmed: !proposed, expiresAt });
  return { state, record };
}

test('R03/K legacy note polling keeps card, draft, focus and selection while imports are added', async () => {
  const { state, record } = await fixture(), h = await harness({ state }), card = h.card(record.id), input = card.querySelector('textarea');
  card.querySelector('details').open = true; await h.fill(input, 'Min ufærdige lokale note'); input.focus(); input.selectionStart = 2; input.selectionEnd = 8;
  await h.secretary.remember('En syntetisk importeret nabo'); await h.refresh();
  assert.equal(h.card(record.id), card); assert.equal(card.querySelector('textarea'), input); assert.equal(h.document.activeElement, input);
  assert.equal(h.document.focusDetachments, 0); assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 8]);
  assert.equal(h.field('memory-workbench-list').children.length, 2); assert.equal(h.writes().length, 0);
});

test('R03/K note correction reload restores original revision and survives a temporarily unavailable read', async () => {
  const { state, record } = await fixture(), h = await harness({ state }); const input = h.card(record.id).querySelector('textarea');
  await h.fill(input, 'Gendan denne rettelse');
  await h.secretary.updateMemory(record.id, { expectedRevision: 1, text: 'Gemte data fra en anden fane' });
  const next = await harness({ state, saved: h.saved, failInitialRead: true });
  assert.equal(next.card(record.id).querySelector('textarea').value, 'Gendan denne rettelse');
  assert.equal(next.button(next.card(record.id), 'Gem rettelse').disabled, true);
  next.failure = null; await next.refresh();
  assert.match(next.card(record.id).textContent, /Ændret et andet sted.*revision 1/);
  assert.equal(JSON.parse(next.saved.get(editKey))[0].base.revision, 1);
  await next.button(next.card(record.id), 'Hent nyeste note og kassér kladde').emit('click');
  assert.equal(next.card(record.id).querySelector('textarea').value, 'Gemte data fra en anden fane');
  assert.equal(next.writes().length, 0);
});

test('R03 note edits typed during save remain in the same field as a draft against the acknowledged revision', async () => {
  const { state, record } = await fixture(), h = await harness({ state }), card = h.card(record.id), input = card.querySelector('textarea');
  await h.fill(input, 'Første rettelse'); input.focus();
  const gate = deferred(); h.hold = gate; const pending = card.querySelector('form').emit('submit');
  assert.equal(input.disabled, false); await h.fill(input, 'Ny tekst under gemning'); gate.resolve(); await pending;
  assert.equal(h.card(record.id), card); assert.equal(h.document.activeElement, input); assert.equal(input.value, 'Ny tekst under gemning');
  assert.equal(h.state.memories[0].text, 'Første rettelse'); assert.equal(h.writes()[0].body.expectedRevision, 1);
  assert.equal(JSON.parse(h.saved.get(editKey))[0].base.revision, 2);
  await card.querySelector('form').emit('submit'); assert.equal(h.writes()[1].body.expectedRevision, 2);
  assert.equal(h.state.memories[0].text, 'Ny tekst under gemning');
});

test('B/I note proposal edits never confirm it; only the explicit separate confirmation click does', async () => {
  const { state, record } = await fixture({ proposed: true }), h = await harness({ state }), card = h.card(record.id);
  await h.fill(card.querySelector('textarea'), 'Rettet syntetisk forslag'); await card.querySelector('form').emit('submit');
  assert.equal(h.state.memories[0].status, 'proposed'); assert.equal(h.writes().length, 1);
  const confirm = h.button(card, 'Bekræft hukommelsen'); confirm.focus(); await confirm.emit('click');
  assert.equal(h.writes()[1].body.expectedRevision, 2); assert.equal(h.state.memories[0].status, 'confirmed');
  assert.equal(confirm.hidden, true); assert.equal(h.document.activeElement, card);
});

test('A/K uncertain note update locks repetition across reload until explicit outcome review', async () => {
  const { state, record } = await fixture(), h = await harness({ state }), card = h.card(record.id);
  await h.fill(card.querySelector('textarea'), 'Uafklaret rettelse');
  h.failure = call => call.method === 'PUT' ? new Error('Transport afbrudt') : null; await card.querySelector('form').emit('submit');
  assert.equal(h.button(card, 'Gem rettelse').disabled, true); await card.querySelector('form').emit('submit'); assert.equal(h.writes().length, 1);
  const next = await harness({ state, saved: h.saved }), nextCard = next.card(record.id);
  assert.equal(next.button(nextCard, 'Gem rettelse').disabled, true); assert.match(nextCard.textContent, /ikke afklaret/);
  await next.button(nextCard, 'Kontrollér notens gemningsudfald').emit('click');
  assert.equal(next.button(nextCard, 'Gem rettelse').disabled, false); assert.equal(next.writes().length, 0);
  assert.equal(nextCard.querySelector('textarea').value, 'Uafklaret rettelse');
});

test('A/R03 new note typed during an in-flight creation is preserved and is never submitted automatically', async () => {
  const h = await harness(); await h.fill(h.field('memory-workbench-text'), 'Den sendte note');
  const gate = deferred(); h.hold = gate; const pending = h.field('memory-workbench-form').emit('submit');
  await h.fill(h.field('memory-workbench-text'), 'Den næste ugemte note'); gate.resolve(); await pending;
  assert.equal(h.state.memories[0].text, 'Den sendte note'); assert.equal(h.field('memory-workbench-text').value, 'Den næste ugemte note');
  assert.equal(h.writes().length, 1); assert.equal(JSON.parse(h.saved.get(createKey)).text, 'Den næste ugemte note');
});

test('A/K unknown note creation has a persistent review gate and no blind retry', async () => {
  const h = await harness(); await h.fill(h.field('memory-workbench-text'), 'Ukendt ny note');
  h.failure = call => call.method === 'POST' ? new Error('Intet svar') : null; await h.field('memory-workbench-form').emit('submit');
  const next = await harness({ state: h.state, saved: h.saved });
  assert.equal(next.button(next.field('memory-workbench-form'), 'Gem i min hukommelse').disabled, true);
  assert.equal(next.field('memory-workbench-text').value, 'Ukendt ny note'); await next.field('memory-workbench-form').emit('submit');
  assert.equal(next.writes().length, 0);
  await next.button(next.field('memory-workbench-form'), 'Kontrollér ny notes gemningsudfald').emit('click');
  assert.equal(next.button(next.field('memory-workbench-form'), 'Gem i min hukommelse').disabled, false);
});

test('I/R03 logout clears note fields, correction DOM and tab storage; late acknowledgments cannot revive them', async () => {
  const { state, record } = await fixture(), h = await harness({ state }), card = h.card(record.id);
  await h.fill(card.querySelector('textarea'), 'Skal ikke vises efter logout'); await h.fill(h.field('memory-workbench-text'), 'Ny privat kladde');
  const gate = deferred(); h.hold = gate; const pending = card.querySelector('form').emit('submit');
  h.owner = null; await h.field('logout').emit('click'); gate.resolve(); await pending;
  assert.equal(h.field('memory-workbench-text').value, ''); assert.equal(h.field('memory-workbench-list').children.length, 0);
  assert.equal(h.saved.has(createKey), false); assert.equal(h.saved.has(editKey), false); assert.equal(h.field('memory-workbench-status').textContent, '');
});

test('I/K signed-out loads never restore note drafts and secret-like text is kept out of tab storage', async () => {
  const saved = new Map([[createKey, JSON.stringify({ text: 'Gammel privat kladde', category: 'fact' })]]);
  const signedOut = await harness({ saved, authenticated: false }); assert.equal(signedOut.field('memory-workbench-text').value, ''); assert.equal(signedOut.calls.length, 0);
  const { state, record } = await fixture(), h = await harness({ state });
  await h.fill(h.field('memory-workbench-text'), 'password: syntetiskhemmelighed');
  assert.equal(h.saved.has(createKey), false); assert.match(h.field('memory-workbench-status').textContent, /ikke i browserlageret/);
  await h.fill(h.card(record.id).querySelector('textarea'), 'token: syntetiskhemmelighed');
  assert.equal(h.saved.has(editKey), false);
  let warned = false; h.windowEvents.get('beforeunload')({ preventDefault() { warned = true; } }); assert.equal(warned, true);
});

test('B/K note expiry uses Copenhagen and rejects nonexistent or ambiguous edited times without a write', async () => {
  const { state, record } = await fixture({ expiresAt: '2099-01-01T09:00:00Z' }), h = await harness({ state }), card = h.card(record.id);
  const expiry = card.querySelectorAll('input').find(input => input.type === 'datetime-local');
  assert.equal(expiry.value, '2099-01-01T10:00');
  for (const value of ['2026-03-29T02:30', '2026-10-25T02:30']) {
    await h.fill(expiry, value); await card.querySelector('form').emit('submit');
    assert.equal(h.writes().length, 0); assert.match(card.textContent, /findes ikke|forekommer to gange/);
  }
  const fold = card.querySelectorAll('select')[1]; await h.fill(fold, 'later'); await card.querySelector('form').emit('submit');
  assert.equal(h.writes()[0].body.expiresAt, '2026-10-25T01:30:00.000Z');
});

test('R03 archived or missing notes retain a local correction until explicit discard', async () => {
  const { state, record } = await fixture(), h = await harness({ state }), card = h.card(record.id);
  await h.fill(card.querySelector('textarea'), 'Kopiér denne lokale rettelse'); await h.secretary.archiveMemory(record.id, 1); await h.refresh();
  assert.equal(h.card(record.id), card); assert.match(card.textContent, /arkiveret eller utilgængelig/);
  assert.equal(h.button(card, 'Gem rettelse').disabled, true);
  await h.button(card, 'Hent nyeste note og kassér kladde').emit('click');
  assert.equal(h.card(record.id), undefined); assert.equal(h.saved.has(editKey), false);
});
