import test from 'node:test';
import assert from 'node:assert/strict';
import { SonosAuth, sonosCredentialKey } from '../sonos-auth.mjs';
import { SmartHome } from '../smart-home.mjs';
const response = () => ({ ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86400, token_type: 'Bearer' }) });
function setup(overrides = {}) {
  let config = { sonosToken: 'old', sonosRefreshToken: 'refresh', sonosExpiresAt: 1, sonosHouseholdId: 'house' };
  let calls = 0;
  const auth = new SonosAuth({ clientId: 'id', clientSecret: 'secret', redirectUri: 'https://jarvis.example/api/smart-home/sonos/callback', now: () => 1000,
    getConfig: () => config, persist: async (tokens, expected) => { assert.equal(sonosCredentialKey(config), expected); config = { ...config, ...tokens }; },
    fetcher: async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); return response(); }, ...overrides });
  return { auth, calls: () => calls, get: () => config, set: value => { config = value; } };
}
const callback = login => ({ state: new URL(login.url).searchParams.get('state'), browser: login.cookie.split(';')[0].split('=')[1], code: 'code' });
test('Sonos login requires browser-bound single-use state', async () => {
  const f = setup(), login = f.auth.begin(), input = callback(login);
  assert.match(login.cookie, /HttpOnly; Secure; SameSite=Lax/);
  await assert.rejects(f.auth.exchange({ ...input, browser: 'b'.repeat(64) }), /valideres/);
  assert.equal(f.calls(), 0);
  await f.auth.exchange(input);
  assert.equal(f.get().sonosToken, 'new-access');
  await assert.rejects(f.auth.exchange(input));
  assert.equal(f.calls(), 1);
});
test('Sonos expired or denied login does not exchange code', async () => {
  for (const error of ['access_denied', null]) {
    const f = setup(), input = callback(f.auth.begin());
    if (!error) f.auth.now = () => 700000;
    await assert.rejects(f.auth.exchange({ ...input, error }));
    assert.equal(f.calls(), 0);
  }
});
test('Sonos refresh is single flight and fresh credentials are reused', async () => {
  const f = setup();
  const results = await Promise.all([f.auth.credentials(), f.auth.credentials(), f.auth.credentials()]);
  assert.equal(f.calls(), 1); assert.ok(results.every(c => c.sonosToken === 'new-access'));
  await f.auth.credentials(); assert.equal(f.calls(), 1);
  assert.equal(f.auth.status().automaticRefresh, true);
});
test('Sonos manual credentials never trigger refresh', async () => {
  const f = setup(); f.set({ sonosToken: 'manual' });
  assert.equal((await f.auth.credentials()).sonosToken, 'manual'); assert.equal(f.calls(), 0);
});
test('Sonos refuses stale refresh after credential removal and never publishes failed save', async () => {
  let finish;
  const f = setup({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.auth.credentials(); f.set({ sonosToken: '' }); finish(response());
  await assert.rejects(pending); assert.equal(f.get().sonosToken, '');
  const failed = setup({ persist: async () => { throw new Error('disk'); } });
  await assert.rejects(failed.auth.credentials(), /disk/); assert.equal(failed.get().sonosToken, 'old');
});
test('Sonos token endpoint errors never expose provider body or credentials', async () => {
  const f = setup({ fetcher: async () => ({ ok: false, status: 401, json: async () => ({ secret: 'sensitive' }) }) });
  await assert.rejects(f.auth.credentials(), error => error.status === 401 && !error.message.includes('sensitive'));
});
test('Sonos malformed token payload is not persisted', async () => {
  for (const data of [{}, { access_token: 'a', refresh_token: 'b', expires_in: -1, token_type: 'Bearer' }]) {
    const f = setup({ fetcher: async () => ({ ok: true, json: async () => data }) });
    await assert.rejects(f.auth.credentials(), /Ufuldstændigt/); assert.equal(f.get().sonosToken, 'old');
  }
});
test('Sonos action refreshes before sending once and supports real group IDs', async () => {
  const f = setup(); let actions = 0;
  const home = new SmartHome({ state: {}, save: async () => {}, authorizeSonos: () => f.auth.credentials(), fetcher: async (url, options) => {
    actions++; assert.match(url, /RINCON_123%3A0/); assert.equal(options.headers.Authorization, 'Bearer new-access');
    return { ok: false, status: 503 };
  } });
  await assert.rejects(home.sonos(f.get(), { groupId: 'RINCON_123:0', command: 'skip' }));
  assert.equal(actions, 1); assert.equal(f.calls(), 1);
});
test('Sonos invalid redirect cannot initiate login', () => {
  for (const redirectUri of ['http://jarvis.example/api/smart-home/sonos/callback', 'https://jarvis.example/wrong', 'https://user:pass@jarvis.example/api/smart-home/sonos/callback']) {
    const f = setup({ redirectUri }); assert.equal(f.auth.configured(), false); assert.throws(() => f.auth.begin());
  }
});
