import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NemligShopping, decodeNemligResponse, nemligClientInfo } from '../nemlig-connector.mjs';
import { IntegrationHealth } from '../integration-health.mjs';
import { integrationCatalog } from '../integration-catalog.mjs';

function fixture() {
  let now = new Date('2026-11-05T12:00:00Z'), result = { Lines: [] }, error;
  const calls = [], state = {};
  const shopping = new NemligShopping({ state, now: () => now, callTool: async (name, args) => {
    calls.push({ name, args }); if (error) throw error; return result;
  } });
  return { shopping, state, calls, result: value => { result = value; error = null; },
    fail: value => { error = value; }, time: value => { now = new Date(value); } };
}

test('I1 Nemlig configuration is unverified; status/polling never creates a probe or basket write', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    const status = f.shopping.status();
    assert.equal(status.configured, true); assert.equal(status.connectionState, 'not_verified');
    assert.equal(status.connected, false); assert.equal(status.lastCheckedAt, null);
    assert.equal(status.canPlaceOrder, false); assert.equal(status.approvalRequired, true);
    assert.equal(integrationCatalog({ nemligStatus: status }).find(item => item.id === 'nemlig').status, 'configured');
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.state.nemligProposals, []);
});

test('I1 a validated Nemlig read is timestamped, expires without polling, and resets to unverified after restart', async () => {
  const f = fixture(); await f.shopping.basket();
  assert.equal(f.shopping.status().connectionState, 'connected');
  assert.equal(f.shopping.status().lastCheckedAt, '2026-11-05T12:00:00.000Z');
  f.time('2026-11-05T12:05:00Z');
  assert.equal(f.shopping.status().connectionState, 'stale'); assert.equal(f.shopping.status().connected, false);
  const restarted = new NemligShopping({ state: structuredClone(f.state), callTool: async () => { throw new Error('no probe'); } });
  assert.equal(restarted.status().connectionState, 'not_verified'); assert.equal(f.calls.length, 1);
});

test('I1 known HTTP auth failure persists in Nemlig status/catalog without leaking source errors or retrying', async () => {
  const f = fixture(); await f.shopping.basket(); f.time('2026-11-05T12:01:00Z');
  f.fail(Object.assign(new Error('NEMLIG_PASS=synthetic-not-a-secret'), { status: 401 }));
  await assert.rejects(f.shopping.basket());
  const status = f.shopping.status(), catalog = integrationCatalog({ nemligStatus: status }).find(item => item.id === 'nemlig');
  assert.equal(status.connectionState, 'expired_login'); assert.equal(status.lastSuccessfulAt, '2026-11-05T12:00:00.000Z');
  assert.equal(catalog.status, 'expired'); assert.equal(catalog.lastCheckedAt, '2026-11-05T12:01:00.000Z');
  assert.doesNotMatch(JSON.stringify({ status, catalog }), /NEMLIG_PASS|synthetic-not-a-secret/);
  assert.equal(f.calls.length, 2);
  f.result({ Lines: [] }); await f.shopping.basket(); assert.equal(f.shopping.status().connectionState, 'connected');
});

test('I1 unknown MCP errors never become expired-login guesses; malformed data is not a verified connection', async () => {
  const f = fixture(); f.fail(new Error('upstream text says 401 but has no verified HTTP status'));
  await assert.rejects(f.shopping.basket()); assert.equal(f.shopping.status().connectionState, 'unavailable');
  f.result({ unrecognized: true }); await assert.rejects(f.shopping.basket());
  assert.equal(f.shopping.status().connectionState, 'unavailable'); assert.equal(f.shopping.status().lastSuccessfulAt, null);
  f.result({ unexpected: 'search-format' }); await assert.rejects(f.shopping.search('ris'));
  assert.equal(f.shopping.status().connectionState, 'unavailable'); assert.equal(f.calls.length, 3);
});

test('I1 unavailable product is a successful connection observation, not a service outage', async () => {
  const f = fixture(); f.result({ Id: '123', Name: 'Ris', IsAvailable: false });
  await assert.rejects(f.shopping.details('123'), /ikke tilgængelig/);
  assert.equal(f.shopping.status().connectionState, 'connected');
  assert.equal(f.shopping.status().lastError, ''); assert.equal(f.calls.length, 1);
  await assert.rejects(f.shopping.details('invalid-id'));
  assert.equal(f.shopping.status().connectionState, 'connected'); assert.equal(f.calls.length, 1);
});

test('I1 a slow earlier success cannot hide a newer known authentication failure', async () => {
  const health = new IntegrationHealth({ now: () => new Date('2026-11-05T12:00:00Z') });
  let release; const pending = health.check({ account: 'synthetic' }, () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(health.check({ account: 'synthetic' }, async () => { throw Object.assign(new Error('private'), { status: 403 }); }));
  release('late-success'); assert.equal(await pending, 'late-success');
  assert.equal(health.snapshot({ account: 'synthetic' }, true).connectionState, 'expired_login');
});

test('I1 MCP errors carry only explicit numeric auth metadata, never credentials or guessed error text', () => {
  for (const status of [401, 403]) assert.throws(() => decodeNemligResponse({ isError: true,
    structuredContent: { error: { status, token: 'private-not-real' } }, content: [{ type: 'text', text: 'private-not-real' }] }),
  error => error.status === status && !error.message.includes('private-not-real'));
  for (const structuredContent of [{ code: 401 }, { error: { status: '401' } }, { text: 'login 403' }, undefined])
    assert.throws(() => decodeNemligResponse({ isError: true, structuredContent }), error => error.status === undefined);
  assert.deepEqual(decodeNemligResponse({ structuredContent: { result: { Lines: [] } } }), { Lines: [] });
});

test('R04 the MCP client version comes from the actual application package, not a stale handover label', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(nemligClientInfo.version, manifest.version); assert.equal(Object.isFrozen(nemligClientInfo), true);
});

test('I1 changed or invalid local Nemlig configuration cannot inherit an older verified observation', async () => {
  const keys = ['NEMLIG_ENABLE_LIVE', 'NEMLIG_MCP_DIR', 'NEMLIG_MCP_UV', 'NEMLIG_USER', 'NEMLIG_PASS'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const shopping = new NemligShopping({ state: {} });
    assert.equal(shopping.status().connectionState, 'not_configured');
    Object.assign(process.env, { NEMLIG_ENABLE_LIVE: 'yes', NEMLIG_MCP_DIR: '/synthetic/never-started',
      NEMLIG_MCP_UV: '/synthetic/never-executed', NEMLIG_USER: 'synthetic-user', NEMLIG_PASS: 'synthetic-not-a-real-password' });
    assert.equal(shopping.status().connectionState, 'not_verified');
    await shopping.health.check(shopping.healthBasis(), async () => ({ Lines: [] }));
    assert.equal(shopping.status().connectionState, 'connected');
    assert.doesNotMatch(JSON.stringify(shopping.status()), /synthetic-user|synthetic-not-a-real-password/);
    process.env.NEMLIG_PASS = 'changed-synthetic'; assert.equal(shopping.status().connectionState, 'not_verified');
    process.env.NEMLIG_MCP_UV = 'relative-command'; assert.equal(shopping.status().connectionState, 'not_configured');
  } finally { for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } }
});

test('I1 configured-only Nemlig UI does not claim MCP availability, and every status shows the recorded time', async () => {
  const source = await readFile(new URL('../public/meals.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function refreshNemlig()'), source.indexOf('\nlet calendarSelectionDirty'));
  const nodes = new Map(), calls = []; let status, unavailable = false;
  const context = vm.createContext({ mealSessionGeneration: 1, mealSessionCurrent: () => true,
    mealApi: async path => { calls.push(path); if (unavailable) throw new Error('synthetic local-status failure'); return status; },
    mealEl: id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', querySelector: () => ({ disabled: false }) }); return nodes.get(id); },
    showNemligProposals() {}, Date });
  vm.runInContext(block + '\nglobalThis.refresh = refreshNemlig;', context);
  status = { configured: true, connectionState: 'not_verified' }; await context.refresh();
  assert.match(nodes.get('meal-nemlig-status').textContent, /ikke.*verificeret/i);
  assert.doesNotMatch(nodes.get('meal-nemlig-status').textContent, /MCP tilgængelig/);
  status = { configured: true, connectionState: 'expired_login', lastCheckedAt: '2026-11-05T12:00:00.000Z' }; await context.refresh();
  assert.match(nodes.get('meal-nemlig-status').textContent, /udløbet/i);
  assert.match(nodes.get('meal-nemlig-status').textContent, /Senest kontrolleret/);
  status = { configured: true, connectionState: 'unavailable', lastCheckedAt: '2026-11-05T12:01:00.000Z' }; await context.refresh();
  assert.match(nodes.get('meal-nemlig-status').textContent, /utilgængelig/i);
  assert.deepEqual(calls, Array(3).fill('/api/nemlig/status'), 'status rendering only reads local status');
  unavailable = true; await assert.rejects(context.refresh());
  assert.match(nodes.get('meal-nemlig-status').textContent, /status.*kunne ikke hentes/);
  assert.match(nodes.get('meal-nemlig-status').textContent, /ukendt/);
});
