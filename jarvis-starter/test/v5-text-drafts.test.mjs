import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const bootstrapSource = source.slice(source.indexOf('const savedDrafts ='), source.indexOf('\nfunction canonicalView('));
const savedSource = source.slice(source.indexOf('function markDraftSaved('), source.indexOf('\nfunction showTextDraftReview('));
const saveSource = source.slice(source.indexOf('async function saveTextDraft('), source.indexOf('\nfor (const id of Object.keys(savedDrafts))'));
const storageKey = 'jarvis:v5:unsaved-text';
function fixture(api, { initialDraft = true, saved = null, owner = 'synthetic-owner-session' } = {}) {
  const nodes = new Map(), storage = new Map(saved === null ? [] : [[storageKey, JSON.stringify(saved)]]);
  const $ = id => { if (id.endsWith('-review-conflict')) return null;
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, classList: { remove() {} } }); return nodes.get(id); };
  let persists = 0, reviews = 0, refreshes = 0;
  const context = vm.createContext({ $, token: owner, api,
    sessionStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { persists++; storage.set(key, value); }, removeItem: key => storage.delete(key) },
    showTextDraftReview: () => reviews++, refresh: async () => refreshes++ });
  vm.runInContext(`${bootstrapSource}\n${savedSource}\n${saveSource}`, context);
  const savedDrafts = vm.runInContext('savedDrafts', context);
  if (initialDraft) {
    Object.assign(savedDrafts.preferences, { dirty: true, value: 'Afsendt tekst', serverValue: 'Oprindelig tekst', latestServerValue: 'Oprindelig tekst' });
    $('preferences').value = 'Afsendt tekst';
  }
  return { $, savedDrafts, storage, persist: () => context.persistTextDrafts(),
    save: () => context.saveTextDraft('preferences', '/api/preferences', 'text'),
    setOwner: value => { context.token = value; }, logout: () => { context.token = ''; context.clearTextDrafts(); },
    counts: () => ({ persists, reviews, refreshes }) };
}

test('R03 typed text during an in-flight save stays dirty and keeps the exact newly saved baseline', async () => {
  let release; const calls = []; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(async (path, options) => { calls.push(JSON.parse(options.body)); await pending; });
  const first = f.save(); await f.save();
  f.$('preferences').value = 'Ny tekst under gemning'; release(); await first;
  assert.deepEqual(calls, [{ text: 'Afsendt tekst', expectedText: 'Oprindelig tekst' }]);
  assert.equal(f.savedDrafts.preferences.dirty, true);
  assert.equal(f.savedDrafts.preferences.serverValue, 'Afsendt tekst');
  assert.equal(f.$('preferences').value, 'Ny tekst under gemning');
  assert.match(f.$('preferences-draft-status').textContent, /nyere ændringer.*ugemt/);
});

test('R03 a known same-field conflict requires a reviewed basis and makes no write', async () => {
  let writes = 0; const f = fixture(async () => { writes++; });
  f.savedDrafts.preferences.latestServerValue = 'Anden gemt tekst';
  await f.save(); assert.equal(writes, 0); assert.equal(f.counts().reviews, 1);
  assert.equal(f.$('preferences').value, 'Afsendt tekst');
});

test('R03 a server-detected optimistic conflict is persistent and fetches the current basis without clearing the draft', async () => {
  const f = fixture(async () => { throw Object.assign(new Error('Nyere tekst'), { status: 409 }); });
  await f.save(); assert.equal(f.counts().refreshes, 1);
  assert.equal(f.savedDrafts.preferences.dirty, true); assert.equal(f.$('preferences').value, 'Afsendt tekst');
  assert.match(f.$('preferences-draft-status').textContent, /Gemning fejlede/);
  assert.equal(f.$('save-preferences').disabled, false);
});


test('GUI-T11 text recovery excludes secret-like content and secret-like server bases without discarding a safe sibling draft', () => {
  const f = fixture(async () => {});
  for (const secret of ['api_key: sk-syntheticKey1234567890', 'Authorization: Bearer private-value',
    'https://person:private@example.invalid/config', 'synthetic-owner-session']) {
    Object.assign(f.savedDrafts.preferences, { dirty: true, value: secret, serverValue: 'Safe base' });
    Object.assign(f.savedDrafts.playbook, { dirty: true, value: 'Almindelige instruktioner', serverValue: 'Gammelt grundlag' });
    f.$('preferences').value = secret;
    f.persist();
    const recovered = JSON.parse(f.storage.get(storageKey));
    assert.equal(recovered.preferences, undefined);
    assert.equal(recovered.playbook.text, 'Almindelige instruktioner');
    assert.equal(f.$('preferences').value, secret, 'the in-memory field remains available to its owner');
  }
  Object.assign(f.savedDrafts.preferences, { dirty: true, value: 'Renset kladde', serverValue: 'password: old-private-value' });
  f.persist();
  assert.equal(JSON.parse(f.storage.get(storageKey)).preferences, undefined, 'a secret basis is not persisted indirectly');
});

test('GUI-T11 reload rejects an older secret-bearing draft and recovers a safe draft with its exact basis', async () => {
  const calls = [];
  const f = fixture(async (_path, options) => calls.push(JSON.parse(options.body)), { initialDraft: false, saved: {
    preferences: { text: 'Gendannet tekst', serverValue: 'Gendannet grundlag' },
    playbook: { text: 'api_key: sk-syntheticKey1234567890', serverValue: 'Tidligere instruktioner' },
  } });
  assert.equal(f.$('preferences').value, 'Gendannet tekst');
  assert.equal(f.$('playbook').value, '');
  assert.equal(JSON.parse(f.storage.get(storageKey)).playbook, undefined);
  await f.save();
  assert.deepEqual(calls, [{ text: 'Gendannet tekst', expectedText: 'Gendannet grundlag' }]);
});

for (const outcome of ['success', 'conflict']) test(`GUI-T11 logout clears both text editors and ignores a late ${outcome} from the prior session`, async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(async () => { await pending; if (outcome === 'conflict') throw Object.assign(new Error('Tidligere session'), { status: 409 }); });
  Object.assign(f.savedDrafts.playbook, { dirty: true, value: 'Privat arbejdsinstruktion', serverValue: 'Gammel instruks' });
  f.$('playbook').value = 'Privat arbejdsinstruktion';
  f.persist(); const saving = f.save();
  f.logout();
  assert.equal(f.storage.has(storageKey), false);
  for (const id of ['preferences', 'playbook']) {
    assert.equal(f.$(id).value, ''); assert.equal(f.$(`${id}-draft-status`).textContent, '');
    assert.equal(f.savedDrafts[id].dirty, false); assert.equal(f.savedDrafts[id].serverValue, null);
  }
  f.setOwner('new-synthetic-session');
  Object.assign(f.savedDrafts.preferences, { dirty: true, value: 'Ny session', serverValue: 'Nyt grundlag' });
  f.$('preferences').value = 'Ny session'; f.$('preferences-draft-status').textContent = 'Ny kladde';
  release(); await saving;
  assert.equal(f.$('preferences').value, 'Ny session');
  assert.equal(f.savedDrafts.preferences.serverValue, 'Nyt grundlag');
  assert.equal(f.$('preferences-draft-status').textContent, 'Ny kladde');
  assert.equal(f.counts().refreshes, 0, 'an old conflict cannot refresh a new session');
  assert.equal(f.storage.has(storageKey), false, 'a late response cannot recreate the signed-out browser draft');
});

test('GUI-T11 changing the authenticated owner also invalidates an in-flight text save, and signed-out submission does not write', async () => {
  let release, writes = 0;
  const f = fixture(async () => { writes++; await new Promise(resolve => { release = resolve; }); });
  const saving = f.save(); f.setOwner('second-synthetic-owner');
  f.$('preferences-draft-status').textContent = 'Anden session'; release(); await saving;
  assert.equal(f.$('preferences-draft-status').textContent, 'Anden session');
  assert.equal(f.savedDrafts.preferences.serverValue, 'Oprindelig tekst');
  f.logout(); await f.save(); assert.equal(writes, 1);
});
