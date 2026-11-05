import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const savedSource = source.slice(source.indexOf('function markDraftSaved('), source.indexOf('\nfunction showTextDraftReview('));
const saveSource = source.slice(source.indexOf('async function saveTextDraft('), source.indexOf('\nfor (const id of Object.keys(savedDrafts))'));
function fixture(api) {
  const nodes = new Map();
  const $ = id => { if (id.endsWith('-review-conflict')) return null;
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, classList: { remove() {} } }); return nodes.get(id); };
  const savedDrafts = { preferences: { dirty: true, value: 'Afsendt tekst', serverValue: 'Oprindelig tekst', latestServerValue: 'Oprindelig tekst' } };
  $('preferences').value = 'Afsendt tekst'; let persists = 0, reviews = 0, refreshes = 0;
  const context = vm.createContext({ $, savedDrafts, api, persistTextDrafts: () => persists++,
    showTextDraftReview: () => reviews++, refresh: async () => refreshes++ });
  vm.runInContext(`${savedSource}\n${saveSource}`, context);
  return { $, savedDrafts, save: () => context.saveTextDraft('preferences', '/api/preferences', 'text'),
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
