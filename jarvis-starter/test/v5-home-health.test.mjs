import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartHome } from '../smart-home.mjs';
import { HueBridge } from '../hue-bridge.mjs';
import { integrationCatalog } from '../integration-catalog.mjs';

test('I1 Sonos status separates configuration, verified connection, stale observation and expired login', async () => {
  let now = new Date('2026-11-05T10:00:00Z'); let status = 200; let calls = 0;
  const home = new SmartHome({ state: {}, save: async () => {}, now: () => now,
    fetcher: async () => { calls++; return { ok: status === 200, status, json: async () => ({ groups: [{ id: 'synthetic', name: 'Syntetisk rum' }] }) }; } });
  const config = { sonosToken: 'not-a-real-token', sonosHouseholdId: 'synthetic' };
  assert.equal(home.snapshot({}).sonos.connectionState, 'not_configured');
  assert.equal(home.snapshot(config).sonos.connectionState, 'not_verified');
  assert.equal(calls, 0, 'reading status never contacts a provider');
  await home.sonosGroups(config);
  assert.equal(home.snapshot(config).sonos.connected, true);
  assert.equal(home.snapshot(config).sonos.lastCheckedAt, now.toISOString());
  now = new Date('2026-11-05T10:05:00Z');
  assert.equal(home.snapshot(config).sonos.connectionState, 'stale');
  assert.equal(home.snapshot(config).sonos.connected, false);
  status = 401;
  await assert.rejects(home.sonosGroups(config), /401/);
  assert.equal(home.snapshot(config).sonos.connectionState, 'expired_login');
  assert.equal(integrationCatalog({ sonosStatus: home.snapshot(config).sonos }).find(item => item.id === 'sonos').status, 'expired');
  assert.equal(home.snapshot({ ...config, sonosToken: 'new-not-a-real-token' }).sonos.connectionState, 'not_verified');
  assert.equal(JSON.stringify(home.snapshot(config)).includes(config.sonosToken), false);
});

test('I1 Hue status binds to actual reads and the paired configuration, never a configured-only false success', async () => {
  let failure = false; let calls = 0;
  const hue = new HueBridge({ request: async () => { calls++; if (failure) throw new Error('synthetic offline'); return { data: { data: [] } }; } });
  const config = { bridgeIp: '192.168.1.2', applicationKey: 'synthetic-key', certificateFingerprint: 'AA:BB' };
  assert.equal(hue.status(config).connectionState, 'not_verified');
  assert.equal(calls, 0);
  await hue.resources(config);
  assert.equal(hue.status(config).connectionState, 'connected');
  assert.equal(calls, 5);
  assert.equal(hue.status({ ...config, bridgeIp: '192.168.1.3' }).connectionState, 'not_verified');
  failure = true;
  await assert.rejects(hue.resources(config), /offline/);
  const catalog = integrationCatalog({ hueStatus: hue.status(config) }).find(item => item.id === 'hue');
  assert.equal(catalog.status, 'unavailable'); assert.ok(catalog.lastCheckedAt); assert.ok(catalog.lastError);
  assert.equal(JSON.stringify(catalog).includes('synthetic-key'), false);
});

test('I1 merely checking Home status never enables Nest, Sonos OAuth or a new recurring connection', () => {
  const home = new SmartHome({ state: {}, save: async () => {}, fetcher: () => { throw new Error('must not fetch'); } });
  const result = home.snapshot({ sonosToken: 'configured-synthetic-token' });
  assert.equal(result.google.configured, false);
  assert.match(result.google.status, /ikke understøttet/);
  assert.match(result.sonos.tokenExpires, /ikke implementeret/);
  for (const id of ['nest', 'google-tasks', 'home-assistant']) {
    const integration = integrationCatalog().find(item => item.id === id);
    assert.equal(integration.implementation, 'planned'); assert.equal(integration.status, 'not_configured');
  }
});
