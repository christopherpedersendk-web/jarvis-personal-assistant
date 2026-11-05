import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { SettingsReview } from '../settings-review.mjs';
import { redactSecrets } from '../privacy.mjs';

const source = await readFile(new URL('../public/settings-drafts.js', import.meta.url), 'utf8');
const pure = vm.runInNewContext(`${source}\nJarvisSettings;`, { URL });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

class Field {
  constructor() { this.value = ''; this.checked = false; this.events = new Map(); this.textContent = ''; this.disabled = false; this.dataset = {}; }
  classList = { toggle() {} };
  addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(handler); }
  async emit(name) { for (const handler of this.events.get(name) || []) await handler({ preventDefault() {} }); }
}

function fixture({ storage = new Map(), beforeGet = async () => {}, beforePost = async () => {}, confirm = () => true,
  storageBlocked = false, server = null } = {}) {
  const nodes = new Map();
  const document = { activeElement: null, getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Field()); return nodes.get(id); } };
  const state = server || { nonce: 'synthetic-nonce-1', system: { maxRunsPerDay: 10, remindersEnabled: true,
    discordAlertsEnabled: false, httpsUrl: 'https://synthetic.invalid', pushUser: 'old-synthetic-user-key', pushToken: 'old-synthetic-push-token' },
  discord: { enabled: false, userId: '123456789012345678', guildId: '', token: 'old-synthetic-discord-token' },
  proactive: { dailyEnabled: false, weeklyEnabled: false, discordEnabled: false, dailyTime: '07:30', weeklyTime: '18:00', quietStart: '22:00', quietEnd: '07:00' }, revisions: {} };
  for (const [kind, config] of Object.entries(pure.definitions)) for (const name of Object.keys(config.fields)) state.revisions[`${kind}:${name}`] ||= 1;
  // Exercise the actual server HMAC and ordinary response redaction contract,
  // not a weaker plaintext/identity-based approximation.
  const review = () => new SettingsReview(createHash('sha256').update(state.nonce).digest());
  const scope = kind => kind === 'system' ? 'settings' : kind;
  const basis = kind => redactSecrets(review().basis(scope(kind), state[kind]));
  const snapshot = kind => kind === 'system' ? { maxRunsPerDay: state.system.maxRunsPerDay, remindersEnabled: state.system.remindersEnabled,
    discordAlertsEnabled: state.system.discordAlertsEnabled, httpsUrl: state.system.httpsUrl, pushConfigured: Boolean(state.system.pushToken && state.system.pushUser),
    hasPushToken: Boolean(state.system.pushToken), hasPushUser: Boolean(state.system.pushUser), npmInstallEnabled: false, basis: basis(kind) }
    : kind === 'discord' ? { enabled: state.discord.enabled, userId: state.discord.userId, guildId: state.discord.guildId, hasToken: Boolean(state.discord.token),
      status: 'disabled', dedupeStatus: 'inactive', basis: basis(kind) } : { ...state.proactive, basis: basis(kind) };
  let token = 'synthetic-owner-token';
  const requests = [], context = vm.createContext({ URL, document, addEventListener() {} });
  vm.runInContext(`${source}\nglobalThis.settings = JarvisSettings;`, context);
  const api = async (path, options = {}) => {
    const kind = path === '/api/settings' ? 'system' : path.startsWith('/api/proactive') ? 'proactive' : 'discord';
    requests.push({ path, ...options });
    if (!options.method) { const value = snapshot(kind); await beforeGet(kind); return kind === 'proactive' ? { settings: value, agenda: {}, history: [] } : value; }
    const body = JSON.parse(options.body);
    await beforePost(kind, body);
    assert.deepEqual(Object.keys(body.patch).sort(), Object.keys(body.expectedBasis).sort());
    const checked = review().patch(scope(kind), state[kind], body);
    for (const [field, value] of Object.entries(checked)) {
      if (state[kind][field] !== value) state.revisions[`${kind}:${field}`]++;
      state[kind][field] = value;
    }
    return { ok: true, settings: snapshot(kind) };
  };
  const ui = context.settings.attach({ document, api, getToken: () => token, confirm,
    storage: { getItem: key => { if (storageBlocked) throw new Error('Blocked'); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw new Error('Blocked'); storage.set(key, value); }, removeItem: key => storage.delete(key) } });
  return { ui, nodes, document, state, requests, storage,
    change: async (id, value, checkbox = false) => { const field = document.getElementById(id); field[checkbox ? 'checked' : 'value'] = value; await field.emit('input'); },
    outside: (kind, field, value) => { state[kind][field] = value; state.revisions[`${kind}:${field}`]++; },
    save: kind => (kind === 'discord' ? ui.saveDiscord : kind === 'proactive' ? ui.saveProactive : ui.saveSystem)({ preventDefault() {} }),
    logout: async () => { token = ''; await document.getElementById('logout').emit('click'); },
    login: value => { token = value; } };
}

test('R02/R03 settings preserve typed drafts and post only edited fields with matching per-field basis', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0, 'no API call before a visible settings refresh');
  await f.ui.refresh();
  await f.change('max-runs', '7');
  f.document.activeElement = f.nodes.get('max-runs');
  f.outside('system', 'httpsUrl', 'https://another-synthetic.invalid');
  await f.ui.refresh();
  assert.equal(f.nodes.get('max-runs').value, '7');
  assert.equal(f.document.activeElement, f.nodes.get('max-runs'));
  assert.equal(f.nodes.get('https-url').value, 'https://another-synthetic.invalid');
  await f.save('system');
  const writes = f.requests.filter(item => item.method === 'POST');
  assert.equal(writes.length, 1);
  const sent = JSON.parse(writes[0].body);
  assert.deepEqual(sent.patch, { maxRunsPerDay: 7 });
  assert.deepEqual(Object.keys(sent.expectedBasis), ['maxRunsPerDay']);
  assert.equal(f.state.system.httpsUrl, 'https://another-synthetic.invalid');
  assert.equal(f.state.system.pushToken, 'old-synthetic-push-token');
  assert.equal(f.state.system.discordAlertsEnabled, false);
});

test('GUI-T11 saving one settings category leaves other categories and secret drafts untouched', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('max-runs', '7'); await f.change('https-url', 'https://unsaved-gui.invalid');
  await f.change('push-token', 'synthetic-unsent-push-value');
  f.nodes.get('settings-form').dataset.scopeFields = 'maxRunsPerDay';
  await f.save('system');
  const writes = f.requests.filter(item => item.method === 'POST');
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].body).patch, { maxRunsPerDay: 7 });
  assert.equal(f.state.system.httpsUrl, 'https://synthetic.invalid');
  assert.equal(f.state.system.pushToken, 'old-synthetic-push-token');
  assert.equal(f.nodes.get('https-url').value, 'https://unsaved-gui.invalid');
  assert.equal(f.nodes.get('push-token').value, 'synthetic-unsent-push-value');
  assert.equal(JSON.stringify([...f.storage.values()]).includes('synthetic-unsent-push-value'), false);
  f.nodes.get('settings-form').dataset.scopeFields = 'httpsUrl';
  await f.save('system');
  assert.deepEqual(JSON.parse(f.requests.filter(item => item.method === 'POST')[1].body).patch,
    { httpsUrl: 'https://unsaved-gui.invalid' });
  assert.equal(f.nodes.get('push-token').value, 'synthetic-unsent-push-value');
});

test('GUI-T11 discarding one settings category keeps unrelated unsaved values and their basis', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('max-runs', '7'); await f.change('https-url', 'https://keep-gui-draft.invalid');
  f.nodes.get('settings-form').dataset.scopeFields = 'maxRunsPerDay';
  await f.nodes.get('settings-reload').emit('click');
  assert.equal(f.nodes.get('max-runs').value, '10');
  assert.equal(f.nodes.get('https-url').value, 'https://keep-gui-draft.invalid');
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 0);
  f.nodes.get('settings-form').dataset.scopeFields = 'httpsUrl';
  await f.save('system');
  assert.deepEqual(JSON.parse(f.requests.find(item => item.method === 'POST').body).patch,
    { httpsUrl: 'https://keep-gui-draft.invalid' });
});

test('GUI-T11 a conflict in another category cannot be silently saved or discarded by the active category', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('https-url', 'https://local-gui-draft.invalid');
  f.outside('system', 'httpsUrl', 'https://remote-gui-change.invalid'); await f.ui.refresh();
  await f.change('max-runs', '8'); f.nodes.get('settings-form').dataset.scopeFields = 'maxRunsPerDay';
  await f.save('system');
  assert.deepEqual(JSON.parse(f.requests.find(item => item.method === 'POST').body).patch, { maxRunsPerDay: 8 });
  assert.equal(f.nodes.get('https-url').value, 'https://local-gui-draft.invalid');
  assert.equal(f.state.system.httpsUrl, 'https://remote-gui-change.invalid');
  f.nodes.get('settings-form').dataset.scopeFields = 'httpsUrl'; await f.save('system');
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
  assert.match(f.nodes.get('settings-draft-status').textContent, /ændret et andet sted/);
});

test('R02 settings same-field conflict never overwrites the draft or uses a new basis without review', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('max-runs', '7'); f.outside('system', 'maxRunsPerDay', 8);
  await f.ui.refresh();
  assert.equal(f.nodes.get('max-runs').value, '7');
  assert.match(f.nodes.get('settings-draft-status').textContent, /Ændret et andet sted/);
  assert.equal(f.nodes.get('settings-submit').disabled, true);
  await f.save('system');
  assert.equal(f.requests.some(item => item.method === 'POST'), false);
  assert.equal(f.state.system.maxRunsPerDay, 8);
  await f.nodes.get('settings-reload').emit('click');
  assert.equal(f.nodes.get('max-runs').value, '8');
  assert.equal(f.nodes.get('settings-submit').disabled, false);
});

test('R03 first settings response preserves input typed while loading without guessing its basis', async () => {
  const loading = deferred();
  const f = fixture({ beforeGet: async kind => { if (kind === 'system') await loading.promise; } });
  const reading = f.ui.refresh();
  await f.change('max-runs', '6');
  assert.equal(f.nodes.get('settings-submit').disabled, true);
  loading.resolve(); await reading;
  assert.equal(f.nodes.get('max-runs').value, '6');
  await f.save('system');
  assert.equal(f.state.system.maxRunsPerDay, 6);
});

test('R03 focused untouched settings defer server changes until blur, not field replacement', async () => {
  const f = fixture(); await f.ui.refresh();
  const field = f.nodes.get('https-url'); f.document.activeElement = field;
  f.outside('system', 'httpsUrl', 'https://changed-synthetic.invalid'); await f.ui.refresh();
  assert.equal(field.value, 'https://synthetic.invalid');
  assert.equal(f.document.activeElement, field);
  assert.match(f.nodes.get('settings-draft-status').textContent, /fokuseret felt/);
  f.document.activeElement = null; await field.emit('blur');
  assert.equal(field.value, 'https://changed-synthetic.invalid');
  assert.equal(f.requests.some(item => item.method === 'POST'), false);
});

test('R03 typing during a settings save, including reverting to the old value, remains an unsaved draft', async () => {
  const saving = deferred(); let captured = false;
  const f = fixture({ beforePost: async () => { captured = true; await saving.promise; } });
  await f.ui.refresh(); await f.change('max-runs', '7');
  const pending = f.save('system'); await tick(); assert.equal(captured, true);
  await f.change('max-runs', '10');
  saving.resolve(); await pending;
  assert.equal(f.state.system.maxRunsPerDay, 7);
  assert.equal(f.nodes.get('max-runs').value, '10', 'returning to the original value is still a new edit after the submitted snapshot');
  assert.match([...f.storage.values()].join(' '), /"maxRunsPerDay":"10"/);
  assert.equal(f.nodes.get('settings-submit').disabled, false);
});

test('I5 settings secret input never persists and newer secret typing is not cleared by an earlier save', async () => {
  const saving = deferred();
  const f = fixture({ beforePost: async () => saving.promise });
  await f.ui.refresh();
  await f.change('push-token', 'new-synthetic-private-token');
  await f.change('max-runs', '6');
  const stored = [...f.storage.values()].join(' ');
  assert.equal(stored.includes('private-token'), false);
  assert.equal(stored.includes('pushToken'), false);
  const pending = f.save('system'); await tick();
  await f.change('push-token', 'even-newer-synthetic-token');
  saving.resolve(); await pending;
  assert.equal(f.state.system.pushToken, 'new-synthetic-private-token');
  assert.equal(f.nodes.get('push-token').value, 'even-newer-synthetic-token');
  assert.equal([...f.storage.values()].join(' ').includes('synthetic-token'), false);
  assert.match(f.nodes.get('settings-draft-status').textContent, /kun i hukommelsen/);
});

test('R03 settings failed save keeps drafts, sanitizes errors and never automatically retries or enables Discord', async () => {
  const secret = 'private-synthetic-bot-token';
  const f = fixture({ beforePost: async () => { throw new Error(`synthetic ENOSPC ${secret}`); } });
  await f.ui.refresh(); await f.change('discord-token', secret);
  await f.change('discord-user-id', '987654321012345678');
  await f.save('discord');
  assert.equal(f.nodes.get('discord-token').value, secret);
  assert.equal(f.nodes.get('discord-user-id').value, '987654321012345678');
  const error = f.nodes.get('discord-draft-status').textContent;
  assert.match(error, /synthetic ENOSPC.*bevaret/);
  assert.equal(error.includes(secret), false);
  await f.ui.refresh();
  assert.match(f.nodes.get('discord-draft-status').textContent, /Gemning kunne ikke bekræftes/);
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
  assert.equal(f.state.discord.enabled, false);
});

test('R03 old settings GET responses cannot overwrite acknowledged save state', async () => {
  let hold = false;
  const reading = deferred();
  const f = fixture({ beforeGet: async kind => { if (hold && kind === 'system') await reading.promise; } });
  await f.ui.refresh(); hold = true;
  const staleRead = f.ui.refresh();
  await f.change('max-runs', '7'); await f.save('system');
  reading.resolve(); await staleRead;
  assert.equal(f.nodes.get('max-runs').value, '7');
  assert.equal(f.state.system.maxRunsPerDay, 7);
});

test('R03 settings reload restores only ordinary drafts and a server restart requires fresh basis review', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('https-url', 'https://my-draft.invalid'); await f.change('push-user', 'new-sensitive-user-key');
  const recovered = fixture({ storage: f.storage, server: f.state });
  assert.equal(recovered.nodes.get('https-url').value, 'https://my-draft.invalid');
  assert.equal(recovered.nodes.get('push-user').value, '');
  assert.equal(recovered.nodes.get('settings-submit').disabled, true);
  recovered.state.nonce = 'synthetic-restarted-nonce';
  await recovered.ui.refresh();
  assert.equal(recovered.nodes.get('https-url').value, 'https://my-draft.invalid');
  assert.match(recovered.nodes.get('settings-draft-status').textContent, /Ændret et andet sted/);
  assert.equal(recovered.nodes.get('settings-submit').disabled, true);
});

test('I5 logout clears settings secrets and drafts; an old save cannot repopulate them after sign-out', async () => {
  const saving = deferred();
  const f = fixture({ beforePost: async () => saving.promise });
  await f.ui.refresh(); await f.change('push-user', 'new-sensitive-user-key'); await f.change('max-runs', '7');
  const pending = f.save('system'); await tick();
  await f.logout();
  saving.resolve(); await pending;
  assert.equal(f.nodes.get('push-user').value, '');
  assert.equal(f.nodes.get('max-runs').value, '');
  assert.equal(f.storage.size, 0);
  assert.equal(f.nodes.get('settings-submit').disabled, true);
});

test('I5 settings reject credential-bearing URLs and ordinary fields never save recognized secrets', async () => {
  assert.throws(() => pure.validate('httpsUrl', 'https://owner:password@synthetic.invalid', 'text'), /uden brugernavn/);
  const f = fixture(); await f.ui.refresh();
  await f.change('https-url', 'https://owner:private-secret@synthetic.invalid');
  assert.equal([...f.storage.values()].join(' ').includes('private-secret'), false);
  await f.save('system');
  assert.equal(f.requests.some(item => item.method === 'POST'), false);
});

test('H2/R03 proactive policy edits preserve focus and only post the reviewed changed clock, without enabling activity', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('proactive-daily-time', '08:15');
  f.document.activeElement = f.nodes.get('proactive-daily-time');
  f.outside('proactive', 'weeklyTime', '19:00'); await f.ui.refresh();
  assert.equal(f.nodes.get('proactive-daily-time').value, '08:15');
  assert.equal(f.nodes.get('proactive-weekly-time').value, '19:00');
  assert.equal(f.document.activeElement, f.nodes.get('proactive-daily-time'));
  await f.save('proactive');
  const sent = f.requests.filter(item => item.method === 'POST');
  assert.equal(sent.length, 1); assert.equal(sent[0].path, '/api/proactive/settings');
  const input = JSON.parse(sent[0].body); assert.deepEqual(input.patch, { dailyTime: '08:15' });
  assert.deepEqual(Object.keys(input.expectedBasis), ['dailyTime']);
  assert.equal(f.state.proactive.dailyEnabled, false); assert.equal(f.state.proactive.weeklyEnabled, false);
  assert.equal(f.state.proactive.discordEnabled, false);
  assert.equal(f.state.proactive.weeklyTime, '19:00');
});

test('H2/R03 proactive same-field conflict preserves the draft and prevents a stale full-policy overwrite', async () => {
  const f = fixture(); await f.ui.refresh();
  await f.change('proactive-daily-time', '08:15'); f.outside('proactive', 'dailyTime', '09:00');
  await f.ui.refresh(); assert.equal(f.nodes.get('proactive-daily-time').value, '08:15');
  assert.match(f.nodes.get('proactive-draft-status').textContent, /Ændret et andet sted/);
  assert.equal(f.nodes.get('proactive-submit').disabled, true);
  await f.save('proactive'); assert.equal(f.requests.some(item => item.method === 'POST'), false);
  assert.equal(f.state.proactive.dailyTime, '09:00');
});

test('H2/R03 proactive changes typed during save survive, and a local activation choice never sends itself', async () => {
  const hold = deferred(), f = fixture({ beforePost: async () => hold.promise });
  await f.ui.refresh(); await f.change('proactive-daily-time', '08:15');
  const pending = f.save('proactive'); await tick();
  await f.change('proactive-daily-time', '10:15'); await f.change('proactive-daily', true, true);
  hold.resolve(); await pending; await f.ui.refresh();
  assert.equal(f.state.proactive.dailyTime, '08:15'); assert.equal(f.state.proactive.dailyEnabled, false);
  assert.equal(f.nodes.get('proactive-daily-time').value, '10:15'); assert.equal(f.nodes.get('proactive-daily').checked, true);
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
  const restored = fixture({ storage: f.storage, server: f.state }); await restored.ui.refresh();
  assert.equal(restored.nodes.get('proactive-daily-time').value, '10:15');
  assert.equal(restored.nodes.get('proactive-daily').checked, true);
  assert.equal(restored.requests.some(item => item.method === 'POST'), false);
});
