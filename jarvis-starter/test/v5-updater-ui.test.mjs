import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/system-health.js', import.meta.url), 'utf8');
const presentation = vm.runInNewContext(`${source}\nJarvisHealth.updatePresentation;`);
const sha = 'a'.repeat(40), newerSha = 'b'.repeat(40);
const release = { version: 'v5.0.0', sha, testedSha: sha, packageVersion: '5.0.0', schemaVersion: 1,
  readableFrom: 0, testedAt: '2026-11-05T12:00:00.000Z' };
const snapshot = (extra = {}) => ({ configured: true, currentVersion: 'v4.9.1',
  available: { version: release.version, sha }, staged: release, approved: null,
  publicationUnknown: false, storage: { ready: true, revision: 3, lastError: null },
  checkOperation: null, stageOperation: null, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('A1/R04 updater publication uncertainty cannot appear as an approved release or enable mutations', () => {
  const result = presentation(snapshot({ approved: release, publicationUnknown: true, storage: { ready: false } }));
  assert.match(result.text, /ukendt/i); assert.doesNotMatch(result.text, /Godkendt: v5/);
  assert.equal(result.canCheck, false); assert.equal(result.canStage, false); assert.equal(result.canApprove, false);
});

test('A1 updater controls fail closed before a truthful storage snapshot, during work, and on missing configuration', () => {
  for (const value of [null, snapshot({ storage: undefined }), snapshot({ storage: { ready: false } }),
    snapshot({ configured: false }), snapshot({ checkOperation: { status: 'running' } }),
    snapshot({ stageOperation: { status: 'running' } })]) {
    const result = presentation(value);
    assert.equal(result.canCheck, false); assert.equal(result.canStage, false); assert.equal(result.canApprove, false);
  }
});

test('R04 updater approval is displayed and enabled only for the exact tested, available SHA and package version', () => {
  const ready = presentation(snapshot());
  assert.equal(ready.canApprove, true); assert.match(ready.text, new RegExp(sha));
  const approved = presentation(snapshot({ approved: { ...release, approvedAt: '2026-11-05T12:05:00Z' } }));
  assert.equal(approved.canApprove, false); assert.match(approved.text, /Godkendt: v5\.0\.0/);
  for (const extra of [{ available: { version: 'v5.0.0', sha: newerSha } },
    { staged: { ...release, testedSha: newerSha } }, { staged: { ...release, packageVersion: '4.9.1' } },
    { staged: { ...release, schemaVersion: undefined } }, { stageOperation: { status: 'unknown' } }]) {
    const result = presentation(snapshot({ approved: release, ...extra }));
    assert.equal(result.canApprove, false); assert.doesNotMatch(result.text, /Godkendt: v5\.0\.0/);
  }
});

test('A1 a failed final journal checkpoint is not presented as actively running or safe to repeat', () => {
  const result = presentation(snapshot({ checkOperation: { status: 'running' }, busy: { check: false, stage: false },
    storage: { ready: true, lastError: { code: 'EIO' } } }));
  assert.match(result.text, /journalføring.*ikke afsluttet/i); assert.doesNotMatch(result.text, /Versionskontrol kører/);
  assert.equal(result.canCheck, false); assert.equal(result.canStage, false); assert.equal(result.canApprove, false);
});

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.textContent = ''; this.events = new Map();
    this.disabled = false; this.classes = new Set(); this.classList = { contains: name => this.classes.has(name),
      toggle: (name, value) => { if (value ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); } }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  async emit(name) { await Promise.all((this.events.get(name) || []).map(callback => callback({ target: this }))); }
}

function harness() {
  const ids = ['tab-home', 'tab-settings', 'workspace', 'system-health-details', 'home-system-health', 'home-system-alert',
    'update-status', 'update-check', 'update-stage', 'update-approve', 'system-refresh', 'logout'];
  const nodes = new Map(ids.map(id => [id, new Element()])); nodes.get('tab-home').classes.add('hidden');
  const document = new Element(); document.visibilityState = 'visible';
  document.getElementById = id => nodes.get(id); document.createElement = tag => new Element(tag);
  const health = { process: { uptimeSeconds: 0 }, storage: { ready: true }, discord: {}, backup: {}, host: {}, tasks: { failed: 0 } };
  const h = { nodes, document, calls: [], updates: snapshot(), request: async () => { throw new Error('Unexpected mutation'); },
    refreshFailure: false, healthResponse: null, confirmations: [] };
  h.context = vm.createContext({ document, token: 'synthetic-token', setInterval() {}, console,
    confirm: text => { h.confirmations.push(text); return true; }, selectTab() {},
    api: async (path, options = {}) => {
      const call = { path, method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }; h.calls.push(call);
      if (path === '/api/updates/action') return h.request(call);
      if (path === '/api/system-health') return h.healthResponse ? h.healthResponse.promise : health;
      if (path === '/api/updates') { if (h.refreshFailure) throw new Error('syntetisk statusfejl'); return h.updates; }
      throw new Error(`Unexpected read ${path}`);
    } });
  vm.runInContext(source, h.context);
  h.click = id => nodes.get(id).emit('click');
  h.refresh = () => h.click('system-refresh');
  h.status = () => nodes.get('update-status').textContent;
  h.mutations = () => h.calls.filter(call => call.method === 'POST');
  h.blocked = () => ['update-check', 'update-stage', 'update-approve'].every(id => nodes.get(id).disabled);
  return h;
}

test('R04 updater click captures the reviewed SHA, prevents duplicate sends, and preserves a confirmed outcome when refresh fails', async () => {
  const h = harness(), gate = deferred(); await h.refresh();
  h.request = () => gate.promise;
  const pending = h.click('update-approve');
  await h.click('update-approve'); await h.click('update-check');
  assert.equal(h.mutations().length, 1); assert.equal(h.blocked(), true);
  assert.deepEqual(h.mutations()[0].body, { action: 'approve', version: 'v5.0.0', expectedSha: sha, expectedTestedAt: release.testedAt });
  assert.match(h.confirmations[0], new RegExp(sha));
  h.refreshFailure = true;
  gate.resolve(snapshot({ approved: { ...release, approvedAt: '2026-11-05T12:05:00.000Z' } })); await pending;
  assert.match(h.status(), /Godkendt: v5\.0\.0/);
  assert.match(h.status(), /status.*ikke.*opdateres/i);
  assert.equal(h.nodes.get('update-approve').disabled, true); assert.equal(h.mutations().length, 1);
});

test('A1/R05 updater lost response remains unknown and cannot silently retry; exact local receipt can reconcile it', async () => {
  const h = harness(); await h.refresh();
  h.request = async () => { throw new Error('Syntetisk mistet svar'); };
  await h.click('update-approve');
  assert.match(h.status(), /ukendt/i); assert.equal(h.blocked(), true);
  await h.click('update-approve'); await h.click('update-stage'); assert.equal(h.mutations().length, 1);
  h.updates = snapshot({ approved: { ...release, approvedAt: '2026-11-05T12:05:00.000Z' } });
  await h.refresh(); assert.match(h.status(), /Godkendt: v5\.0\.0/); assert.doesNotMatch(h.status(), /udfald.*ukendt/i);
  assert.equal(h.mutations().length, 1);
});

test('A1/R05 failed approval with unknown publication overrides an apparent old approval and never retries', async () => {
  const h = harness(); await h.refresh();
  h.request = async () => { h.updates = snapshot({ approved: release, publicationUnknown: true, storage: { ready: false } });
    throw Object.assign(new Error('Gemningen kunne ikke bekræftes'), { status: 409 }); };
  await h.click('update-approve');
  assert.match(h.status(), /ukendt/i); assert.doesNotMatch(h.status(), /Godkendt: v5/); assert.equal(h.blocked(), true);
  await h.click('update-approve'); assert.equal(h.mutations().length, 1);
});

test('I5/R03 logout clears updater state and late responses cannot restore private version or approval details', async () => {
  const h = harness(), gate = deferred(); await h.refresh();
  h.request = () => gate.promise; const pending = h.click('update-approve');
  await h.click('logout'); h.context.token = ''; h.nodes.get('workspace').classes.add('hidden');
  gate.resolve(snapshot({ approved: release })); await pending;
  assert.equal(h.status(), ''); assert.equal(h.blocked(), true);
  assert.equal(h.nodes.get('system-health-details').children.length, 0); assert.equal(h.mutations().length, 1);
});

test('R04 staging captures the available revision instead of a different previously tested revision', async () => {
  const h = harness(); h.updates = snapshot({ available: { version: 'v5.1.0', sha: newerSha } }); await h.refresh();
  h.request = async call => { assert.deepEqual(call.body, { action: 'stage', version: 'v5.1.0', expectedSha: newerSha });
    return snapshot({ available: { version: 'v5.1.0', sha: newerSha }, staged: null,
      stageOperation: { id: 'fresh-stage', status: 'failed', version: 'v5.1.0', sha: newerSha }, error: 'Syntetisk isoleret testfejl' }); };
  await h.click('update-stage'); assert.equal(h.mutations().length, 1);
});

test('I5/R03 a new authenticated token cannot inherit a blocked request or delayed response from the previous session', async () => {
  const h = harness(), gate = deferred(); await h.refresh();
  h.request = () => gate.promise; const pending = h.click('update-approve');
  h.context.token = 'new-synthetic-token'; h.updates = snapshot({ currentVersion: 'v5.0.0', available: null, staged: null });
  await h.refresh(); assert.match(h.status(), /Installeret: v5\.0\.0/);
  assert.equal(h.nodes.get('update-check').disabled, false);
  gate.resolve(snapshot({ approved: release })); await pending;
  assert.match(h.status(), /Installeret: v5\.0\.0/); assert.doesNotMatch(h.status(), /Godkendt: v5/);
});

test('J1 entering settings during a coalesced home read loads updater status once without hidden-domain polling', async () => {
  const h = harness(), gate = deferred();
  h.nodes.get('tab-home').classes.delete('hidden'); h.nodes.get('tab-settings').classes.add('hidden');
  h.healthResponse = gate;
  const first = h.document.emit('jarvis:refreshed');
  assert.equal(h.calls.filter(call => call.path === '/api/updates').length, 0);
  h.nodes.get('tab-home').classes.add('hidden'); h.nodes.get('tab-settings').classes.delete('hidden');
  const second = h.document.emit('jarvis:view-changed');
  h.healthResponse = null;
  gate.resolve({ process: { uptimeSeconds: 0 }, storage: { ready: true }, discord: {}, backup: {}, host: {}, tasks: { failed: 0 } });
  await Promise.all([first, second]);
  assert.equal(h.calls.filter(call => call.path === '/api/updates').length, 1);
  assert.match(h.status(), /Installeret: v4\.9\.1/); assert.equal(h.nodes.get('update-approve').disabled, false);
  assert.equal(h.mutations().length, 0);
});
