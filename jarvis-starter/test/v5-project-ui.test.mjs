import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/v5-projects.js', import.meta.url), 'utf8');
const ProjectUi = vm.runInNewContext(`${source}\nJarvisProjects;`, { Date });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const record = (overrides = {}) => ({ id: 'synthetic-one', title: 'Syntetisk projekt', slug: 'syntetisk',
  description: 'Ingen model, installation eller ekstern aktivitet i disse tests.', revision: 2, contentHash: 'hash-2',
  pendingPackages: [], operation: { id: 'operation-2', kind: 'develop', status: 'completed' }, ...overrides });
const proposal = (overrides = {}) => ({ id: 'synthetic-proposal', file: 'persona.md', request: 'Syntetisk anmodning',
  summary: 'Syntetisk ændring', status: 'pending', ...overrides });

// Executable DOM contract double, not real browser evidence. Removing a focused
// subtree deliberately blurs it; keyed polling cannot pass by restoring value
// after having destroyed the actual input node and its selection.
class Element {
  constructor(document, tag) {
    Object.assign(this, { ownerDocument: document, tagName: tag.toUpperCase(), children: [], parentNode: null,
      dataset: {}, attributes: {}, events: new Map(), className: '', id: '', _text: '', _value: '', hidden: false,
      disabled: false, selected: false, open: false });
    this.classList = { contains: value => this.className.split(/\s+/).includes(value),
      toggle: (value, force) => { const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force ?? !values.has(value)) values.add(value); else values.delete(value); this.className = [...values].join(' '); } };
  }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value || '' : this._value; }
  set value(value) { if (this.tagName === 'SELECT') this.options.forEach(option => { option.selected = option.value === value; }); else this._value = String(value ?? ''); }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  append(...nodes) { for (const node of nodes) { if (node.parentNode) node.remove(); this.children.push(node); node.parentNode = this; } }
  remove() { if (!this.parentNode) return;
    if (this.contains(this.ownerDocument.activeElement)) { this.ownerDocument.focusDetachments++; this.ownerDocument.activeElement = this.ownerDocument.body; }
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, listener) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(listener); }
  async emit(name) { for (const listener of this.events.get(name) || []) await listener({ target: this, preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
}

function harness({ saved = new Map(), authenticated = true, storageBlocked = false } = {}) {
  const document = { activeElement: null, focusDetachments: 0 };
  document.createElement = tag => new Element(document, tag); document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => { const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean); return walk(document.body) || null; };
  for (const id of ['projects', 'code-proposals', 'archived-projects', 'logout']) { const root = document.createElement(id === 'logout' ? 'button' : 'div'); root.id = id; document.body.append(root); }
  const addForm = (id, fields, buttonId) => {
    const form = document.createElement('form'); form.id = id; document.body.append(form);
    for (const [name, tag] of fields) { const field = document.createElement(tag); field.id = name; form.append(field);
      if (tag === 'select') for (const value of ['persona.md', 'public/styles.css']) { const option = document.createElement('option'); option.value = value; field.append(option); } }
    const submit = document.createElement('button'); submit.id = buttonId; form.append(submit);
  };
  addForm('project-form', [['project-title', 'input'], ['project-description', 'textarea']], 'project-create');
  addForm('code-form', [['code-file', 'select'], ['code-request', 'textarea']], 'code-submit');
  document.getElementById('code-file').value = 'persona.md';
  const h = { document, saved, calls: [], projects: [], proposals: [], archived: [], confirmations: [], authenticated,
    request: async () => { throw new Error('Unexpected synthetic API call'); } };
  const ui = ProjectUi.attach({ document,
    storage: { getItem: key => saved.get(key) || null, setItem: (key, value) => { if (storageBlocked) throw new Error('Blocked'); saved.set(key, value); }, removeItem: key => saved.delete(key) },
    isAuthenticated: () => h.authenticated,
    api: async (path, options = {}) => { const request = { path, method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }; h.calls.push(request); return h.request(request); },
    confirm: message => { h.confirmations.push(message); return true; },
    refreshProjects: async () => { if (h.refreshFailure) throw new Error('Syntetisk læsefejl'); ui.renderProjects(h.projects); ui.renderArchived(h.archived); },
    refreshCode: async () => { if (h.refreshFailure) throw new Error('Syntetisk læsefejl'); ui.renderCode(h.proposals); },
  });
  h.ui = ui; h.field = id => document.getElementById(id);
  h.card = id => h.field('projects').children.find(item => item.dataset.projectId === (id || 'synthetic-one'));
  h.code = () => h.field('code-proposals').children[0];
  h.button = (root, name) => root.querySelectorAll('button').find(item => item.textContent === name);
  h.render = projects => { h.projects = projects; ui.renderProjects(projects); };
  h.renderCode = proposals => { h.proposals = proposals; ui.renderCode(proposals); };
  h.fill = async (field, value) => { field.value = value; await field.emit('input'); };
  return h;
}

test('R03/K5 project polling preserves exact draft nodes, focus, selection and expanded logs/files', async () => {
  const h = harness(), initial = record({ lastTest: { status: 'passed', revision: 2, contentHash: 'hash-2', reports: [{ image: 'synthetic', output: 'Only fixture' }] } });
  h.render([initial]); const card = h.card(), input = card.querySelector('textarea');
  await h.fill(input, 'Min ufærdige rettelse'); input.focus(); input.selectionStart = 3; input.selectionEnd = 9;
  card.querySelector('.project-test-log').open = true;
  h.request = async () => ({ project: { ...initial, sourceContentHash: 'hash-2', files: [{ path: 'app.js', content: 'const synthetic = true;' }] } });
  await h.button(card, 'Se projektfiler').emit('click');
  const file = card.querySelector('.project-source-files').querySelector('details'); file.open = true;
  h.render([record({ id: 'neighbour' }), initial]); h.render([initial]);
  assert.equal(h.card(), card); assert.equal(card.querySelector('textarea'), input); assert.equal(input.value, 'Min ufærdige rettelse');
  assert.equal(h.document.activeElement, input); assert.equal(h.document.focusDetachments, 0);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 9]);
  assert.equal(file.open, true); assert.equal(card.querySelector('.project-test-log').open, true);
  assert.deepEqual(h.calls.map(call => call.method), ['GET']);
});

test('J6/R03 changed revision retains old basis and requires actual file review before rebasing the draft', async () => {
  const h = harness(); h.render([record()]); const card = h.card(), input = card.querySelector('textarea');
  await h.fill(input, 'Bevar min lokale tekst');
  const newer = record({ revision: 3, contentHash: 'hash-3' }); h.render([newer]);
  const build = h.button(card, 'Videreudvikl'), review = h.button(card, 'Brug gennemgået revision og bevar kladde');
  assert.equal(build.disabled, true); assert.match(card.querySelector('.project-draft-status').textContent, /revision 2/);
  await build.emit('click'); await review.emit('click'); assert.equal(h.calls.length, 0); assert.equal(build.disabled, true);
  h.request = async () => ({ project: { ...newer, sourceContentHash: 'hash-3', files: [] } });
  await h.button(card, 'Se projektfiler').emit('click'); await review.emit('click');
  assert.equal(input.value, 'Bevar min lokale tekst'); assert.equal(build.disabled, false); assert.equal(h.calls.length, 1);
  const saved = JSON.parse(h.saved.get('jarvis:v5:project-drafts')).projects['synthetic-one'];
  assert.deepEqual(saved.basis, { revision: 3, contentHash: 'hash-3' }); assert.match(card.querySelector('.project-result').textContent, /Ingen udvikling/);
});

test('J6 a changed manual file hash at the same revision conflicts instead of silently rebasing', async () => {
  const h = harness(); h.render([record()]); const card = h.card(); await h.fill(card.querySelector('textarea'), 'Gammel kladde');
  h.request = async () => ({ project: { ...record(), sourceContentHash: 'manual-newer-hash', files: [] } });
  await h.button(card, 'Se projektfiler').emit('click');
  assert.equal(h.button(card, 'Videreudvikl').disabled, true);
  assert.match(card.querySelector('.project-draft-status').textContent, /grundlag er ændret/);
  h.render([record()]); assert.equal(h.button(card, 'Videreudvikl').disabled, true, 'polling cannot replace freshly observed file evidence with old metadata');
  await h.button(card, 'Brug gennemgået revision og bevar kladde').emit('click');
  h.request = async request => { assert.deepEqual(request.body, { expectedRevision: 2, expectedContentHash: 'manual-newer-hash', request: 'Gammel kladde' });
    return { project: record({ revision: 3, contentHash: 'hash-3' }), changedFiles: [], test: { status: 'unavailable', revision: 3 } }; };
  h.projects = [record({ revision: 3, contentHash: 'hash-3' })]; await h.button(card, 'Videreudvikl').emit('click');
});

test('K5 restored drafts retain their basis even if another form is edited before project data loads', async () => {
  const h = harness(); h.render([record()]); await h.fill(h.card().querySelector('textarea'), 'Gendannet kladde');
  const second = harness({ saved: h.saved }); await second.fill(second.field('project-title'), 'Ny formular');
  const third = harness({ saved: h.saved }); third.render([record({ revision: 9, contentHash: 'hash-9' })]);
  assert.equal(third.card().querySelector('textarea').value, 'Gendannet kladde');
  assert.match(third.card().querySelector('.project-draft-status').textContent, /revision 2/);
  assert.equal(third.field('project-title').value, 'Ny formular'); assert.equal(third.calls.length, 0);
});

test('R03/K5 typing during development preserves the newer draft and its original review basis', async () => {
  const h = harness(), gate = deferred(); h.render([record()]); const card = h.card(), input = card.querySelector('textarea');
  await h.fill(input, 'Anmodning sendt'); h.request = async request => { assert.equal(request.body.expectedRevision, 2); return gate.promise; };
  const pending = h.button(card, 'Videreudvikl').emit('click'); await h.fill(input, 'Ny tekst mens anmodningen kører');
  h.projects = [record({ revision: 3, contentHash: 'hash-3' })]; gate.resolve({ project: h.projects[0], changedFiles: ['app.js'], test: { status: 'unavailable', revision: 3 } }); await pending;
  assert.equal(input.value, 'Ny tekst mens anmodningen kører'); assert.match(card.querySelector('.project-draft-status').textContent, /revision 2/);
  assert.equal(h.button(card, 'Videreudvikl').disabled, true); assert.equal(h.calls.length, 1);
  assert.match(card.querySelector('.project-result').textContent, /1 filer skrevet/);
});

test('R05 confirmed development result survives a later refresh failure and clears only its submitted draft', async () => {
  const h = harness(); h.render([record()]); const card = h.card(); await h.fill(card.querySelector('textarea'), 'Denne tekst sendes');
  h.request = async () => { h.refreshFailure = true; return { project: record({ revision: 3, contentHash: 'hash-3' }), changedFiles: ['app.js'], test: { status: 'passed', revision: 3, contentHash: 'hash-3' } }; };
  await h.button(card, 'Videreudvikl').emit('click');
  assert.equal(card.querySelector('textarea').value, '');
  assert.match(card.querySelector('.project-result').textContent, /1 filer skrevet.*Oversigten kunne ikke opdateres/);
  const second = harness({ saved: h.saved }); second.render([record({ revision: 3, contentHash: 'hash-3' })]);
  assert.match(second.card().querySelector('.project-result').textContent, /1 filer skrevet/);
});

test('A4/J6 a server partial or unknown outcome blocks all project mutations after a 4xx response and reload', async () => {
  const h = harness(); h.render([record({ lastRollbackableRevision: 2, pendingPackages: ['zod@3.2.1'] })]); const card = h.card();
  await h.fill(card.querySelector('textarea'), 'Gem denne kladde');
  h.request = async () => { h.projects = [record({ operation: { id: 'changed', kind: 'develop', status: 'unknown' }, lastRollbackableRevision: 2, pendingPackages: ['zod@3.2.1'] })]; throw Object.assign(new Error('Delvist udfald'), { status: 400 }); };
  await h.button(card, 'Videreudvikl').emit('click');
  for (const label of ['Videreudvikl', 'Test isoleret', 'Fortryd seneste kodeændring', 'Godkend npm-installation', 'Arkivér projekt']) {
    assert.equal(h.button(card, label).disabled, true); await h.button(card, label).emit('click');
  }
  assert.equal(h.calls.length, 1); assert.match(card.querySelector('.project-operation-status').textContent, /Ukendt udfald/);
  const second = harness({ saved: h.saved }); second.render(h.projects);
  assert.equal(second.card().querySelector('textarea').value, 'Gem denne kladde'); assert.equal(second.button(second.card(), 'Videreudvikl').disabled, true);
  assert.equal(second.calls.length, 0);
});

test('A4 unknown transport outcome remains locked through polling/reload until matching evidence and explicit owner review', async () => {
  const h = harness(); h.render([record()]); await h.fill(h.card().querySelector('textarea'), 'Anmodning med ukendt udfald');
  h.request = async () => { throw new Error('Transport afbrudt'); }; await h.button(h.card(), 'Videreudvikl').emit('click');
  h.render([record()]); assert.equal(h.button(h.card(), 'Videreudvikl').disabled, true);
  const second = harness({ saved: h.saved }); second.render([record()]);
  await second.button(second.card(), 'Hent seneste projektstatus').emit('click'); assert.equal(second.button(second.card(), 'Videreudvikl').disabled, true);
  second.projects = [record({ operation: { id: 'new-known-result', kind: 'develop', status: 'failed', revision: 3, beforeHash: 'hash-2' } })];
  await second.button(second.card(), 'Hent seneste projektstatus').emit('click');
  assert.equal(second.button(second.card(), 'Videreudvikl').disabled, true, 'a read alone cannot resolve the transport outcome');
  const resolve = second.button(second.card(), 'Bekræft gennemgået handlingsudfald'); assert.equal(resolve.disabled, true);
  await resolve.emit('click'); assert.equal(second.button(second.card(), 'Videreudvikl').disabled, true);
  second.request = async () => ({ project: { ...second.projects[0], sourceContentHash: 'hash-2', files: [] } });
  await second.button(second.card(), 'Se projektfiler').emit('click'); await resolve.emit('click');
  assert.equal(second.button(second.card(), 'Videreudvikl').disabled, false); assert.equal(second.calls.length, 1);
  assert.match(second.card().querySelector('.project-result').textContent, /Ingen handling er gentaget/);
});

test('A4 unrelated operation kind, revision, content or package set cannot resolve an interrupted request', () => {
  const original = { kind: 'develop', basis: { revision: 2, contentHash: 'hash-2' }, operationId: 'operation-2' };
  const terminal = { id: 'new-terminal', kind: 'develop', status: 'completed', revision: 3, beforeHash: 'hash-2' };
  const match = operation => ProjectUi.matchingOutcome({ attempt: original, current: record({ operation }) });
  assert.equal(match(terminal).id, 'new-terminal');
  for (const changed of [{ kind: 'archive' }, { revision: 4 }, { beforeHash: 'unrelated' }, { status: 'unknown' }, { id: 'operation-2' }])
    assert.equal(match({ ...terminal, ...changed }), null);
  assert.equal(ProjectUi.matchingOutcome({ attempt: { ...original, basis: { revision: 2 } }, current: record({ operation: terminal }) }), null);
  const attempt = { kind: 'install', basis: original.basis, operationId: 'old-install', approvedPackages: ['zod@3.2.1'] };
  const packageInstallAttempt = { id: 'new-install', revision: 2, contentHash: 'hash-2', packages: ['zod@3.2.1'], status: 'completed' };
  assert.equal(ProjectUi.matchingOutcome({ attempt, current: record({ packageInstallAttempt }) }).id, 'new-install');
  for (const changed of [{ revision: 3 }, { packages: ['zod@4.0.0'] }, { contentHash: 'different' }, { status: 'unknown' }])
    assert.equal(ProjectUi.matchingOutcome({ attempt, current: record({ packageInstallAttempt: { ...packageInstallAttempt, ...changed } }) }), null);
});

test('R06 package approval displays and sends the exact versioned set, while prior attempts block retries', async () => {
  const h = harness(), packages = ['@scope/name@1.2.3', 'zod@3.2.1']; h.render([record({ pendingPackages: packages })]);
  assert.match(h.card().querySelector('.project-warning').textContent, /@scope\/name@1\.2\.3, zod@3\.2\.1/);
  h.request = async request => { assert.deepEqual(request.body, { expectedRevision: 2, expectedContentHash: 'hash-2', packages });
    h.projects = [record({ packageInstallAttempt: { id: 'install-one', revision: 2, status: 'completed', packages } })]; return { project: h.projects[0] }; };
  await h.button(h.card(), 'Godkend npm-installation').emit('click'); assert.equal(h.calls.length, 1);
  assert.match(h.confirmations[0], /revision 2/);
  h.render([record({ pendingPackages: packages, packageInstallAttempt: { id: 'install-one', revision: 2, status: 'unknown', packages } })]);
  for (const label of ['Videreudvikl', 'Godkend npm-installation', 'Arkivér projekt']) assert.equal(h.button(h.card(), label).disabled, true);
});

test('K5 test labels distinguish unavailable, stale, skipped and unknown without inventing a Docker cause', () => {
  const unavailable = ProjectUi.testDescription(record({ lastTest: { status: 'unavailable', revision: 2, reason: 'PROJECT_SNAPSHOT_INCOMPLETE', summary: 'Filudsnittet er ufuldstændigt' } }));
  assert.match(unavailable.text, /Ikke tilgængelig.*ufuldstændigt/); assert.doesNotMatch(unavailable.text, /Docker/);
  const stale = ProjectUi.testDescription(record({ lastTest: { status: 'passed', revision: 1, contentHash: 'old' } }));
  assert.equal(stale.status, 'stale'); assert.match(stale.text, /gælder ikke det aktuelle/);
  assert.match(ProjectUi.testDescription(record({ lastTest: { status: 'skipped', revision: 2 } })).text, /Ikke udført/);
  assert.match(ProjectUi.testDescription(record()).text, /Ingen registreret test/);
});

test('K5 code proposal running/unknown states are not falsely labelled rejected and cannot expose write controls', async () => {
  const h = harness();
  for (const status of ['applying', 'rollingback', 'unknown', 'unrecognized']) {
    h.renderCode([proposal({ status })]); const card = h.code();
    assert.doesNotMatch(card.querySelector('h3').textContent, /Afvist/);
    for (const name of ['Godkend og installér', 'Afvis', 'Fortryd installation']) {
      assert.equal(h.button(card, name).hidden, true); await h.button(card, name).emit('click');
    }
  }
  assert.equal(h.calls.length, 0);
});

test('J6 code preview stays expanded through polling and is required before applying the exact proposal', async () => {
  const h = harness(); h.renderCode([proposal()]); const card = h.code(), approve = h.button(card, 'Godkend og installér');
  assert.equal(approve.disabled, true); await approve.emit('click'); assert.equal(h.calls.length, 0);
  h.request = async request => request.method === 'GET' ? { proposal: proposal({ original: 'old', content: 'new' }) }
    : { proposal: proposal({ status: 'applied' }) };
  await h.button(card, 'Gennemse filændring').emit('click'); const preview = card.querySelector('.code-preview');
  h.renderCode([proposal()]); assert.equal(h.code(), card); assert.equal(preview.open, true); assert.equal(approve.disabled, false);
  h.proposals = [proposal({ status: 'applied' })]; await approve.emit('click');
  assert.deepEqual(h.calls[1], { path: '/api/code/synthetic-proposal/action', method: 'POST', body: { action: 'apply' } });
  assert.match(card.querySelector('.code-result').textContent, /anvendt lokalt.*ingen release/);
  h.renderCode([proposal({ status: 'applied' })]); assert.equal(preview.open, true);
});

test('A4 unknown code action survives reload without silently re-enabling approval', async () => {
  const h = harness(); h.renderCode([proposal()]);
  h.request = async request => { if (request.method === 'GET') return { proposal: proposal({ original: 'old', content: 'new' }) }; throw new Error('Forbindelsen afbrudt'); };
  await h.button(h.code(), 'Gennemse filændring').emit('click'); await h.button(h.code(), 'Godkend og installér').emit('click');
  const second = harness({ saved: h.saved }); second.renderCode([proposal()]);
  assert.equal(second.button(second.code(), 'Afvis').disabled, true);
  await second.button(second.code(), 'Afvis').emit('click'); assert.equal(second.calls.length, 0);
  assert.match(second.code().querySelector('.code-result').textContent, /Udfaldet er ikke bekræftet/);
});

test('R03 creation and code request forms preserve new text typed during each in-flight request', async () => {
  for (const kind of ['project', 'code']) {
    const h = harness(), gate = deferred();
    const id = kind === 'project' ? 'project-description' : 'code-request';
    await h.fill(h.field('project-title'), 'Kun syntetisk oprettelse'); await h.fill(h.field(id), 'Sendt tekst');
    h.request = async () => gate.promise;
    const waiting = h.field(`${kind}-form`).emit('submit'); await h.fill(h.field(id), 'Ny tekst efter afsendelse');
    gate.resolve({}); await waiting;
    assert.equal(h.field(id).value, 'Ny tekst efter afsendelse'); assert.equal(h.calls.length, 1);
    const next = harness({ saved: h.saved }); assert.equal(next.field(id).value, 'Ny tekst efter afsendelse'); assert.equal(next.calls.length, 0);
  }
});

test('K5 logout clears private project/form DOM and storage and a delayed response cannot put it back', async () => {
  const h = harness(), gate = deferred(); h.render([record()]); await h.fill(h.card().querySelector('textarea'), 'Privat syntetisk tekst');
  await h.fill(h.field('code-request'), 'Privat kodekladde'); h.request = async () => gate.promise;
  const waiting = h.button(h.card(), 'Videreudvikl').emit('click');
  await h.field('logout').emit('click'); h.authenticated = false;
  gate.resolve({ project: record({ revision: 3 }), changedFiles: [] }); await waiting;
  assert.equal(h.field('projects').children.length, 0); assert.equal(h.field('code-request').value, '');
  assert.equal(h.saved.has('jarvis:v5:project-drafts'), false);
  const unauthenticated = harness({ saved: new Map([['jarvis:v5:project-drafts', '{"version":1}']]), authenticated: false });
  assert.equal(unauthenticated.saved.has('jarvis:v5:project-drafts'), false); assert.equal(unauthenticated.calls.length, 0);
});

test('K5 storage failure is visible and removed projects keep drafts readable without writes', async () => {
  const h = harness({ storageBlocked: true }); h.render([record()]); await h.fill(h.card().querySelector('textarea'), 'Kopiér denne kladde');
  assert.match(h.card().querySelector('.project-draft-status').textContent, /Browseren kan ikke sikre/);
  h.render([]); assert.equal(h.card().querySelector('textarea').value, 'Kopiér denne kladde');
  assert.match(h.card().querySelector('.project-draft-status').textContent, /ikke længere på den aktive liste/);
  assert.equal(h.button(h.card(), 'Videreudvikl').disabled, true); assert.equal(h.calls.length, 0);
});

test('J6 revision conflicts preserve the request and show persistent rejection, without replaying it', async () => {
  const h = harness(); h.render([record()]); await h.fill(h.card().querySelector('textarea'), 'Fasthold min rettelse');
  h.request = async request => { assert.equal(request.body.expectedRevision, 2); h.projects = [record({ revision: 3, contentHash: 'hash-3' })];
    throw Object.assign(new Error('Projektet er ændret. Gennemgå revisionen.'), { status: 409 }); };
  await h.button(h.card(), 'Videreudvikl').emit('click');
  h.render(h.projects); assert.equal(h.card().querySelector('textarea').value, 'Fasthold min rettelse');
  assert.match(h.card().querySelector('.project-result').textContent, /Projektet er ændret/);
  assert.equal(h.button(h.card(), 'Videreudvikl').disabled, true); assert.equal(h.calls.length, 1);
});
