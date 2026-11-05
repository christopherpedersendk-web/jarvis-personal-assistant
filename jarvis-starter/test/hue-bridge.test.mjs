import test from 'node:test';
import assert from 'node:assert/strict';
import { HueBridge, validBridgeIp } from '../hue-bridge.mjs';

const id = 'f0aa5d4e-4b3e-4bc7-a8f6-0fd7e9e350bd';
test('Hue Bridge only accepts private IPv4 destinations', () => {
  for (const ip of ['192.168.1.2', '10.3.2.1', '172.16.0.4', '172.31.255.254']) assert.equal(validBridgeIp(ip), true);
  for (const ip of ['127.0.0.1','169.254.1.1','8.8.8.8','0.0.0.0','example.com','::1','172.32.0.1']) assert.equal(validBridgeIp(ip), false);
});

test('Hue pairing requires the physical link button and pins certificate fingerprint', async () => {
  const hue = new HueBridge({ request: async () => ({ data: [{ success: { username: 'secret-app-key' } }], fingerprint: 'AA:BB' }) });
  assert.deepEqual(await hue.pair('192.168.1.2'), { bridgeIp: '192.168.1.2', applicationKey: 'secret-app-key', certificateFingerprint: 'AA:BB' });
  const noButton = new HueBridge({ request: async () => ({ data: [{ error: { type: 101 } }], fingerprint: 'AA:BB' }) });
  await assert.rejects(noButton.pair('192.168.1.2'), /fysiske knap/);
});

test('Hue device controls only accept known resource types, UUIDs, and brightness', async () => {
  const calls = [];
  const hue = new HueBridge({ request: async (_config, method, path, body) => { calls.push({ method, path, body }); return { data: { data: [] } }; } });
  await assert.rejects(hue.control({}, { kind: 'door_lock', id, on: true }), /Kun lys/);
  await assert.rejects(hue.control({}, { kind: 'light', id: '../oops', on: true }), /Hue-ID/);
  await assert.rejects(hue.control({}, { kind: 'light', id, brightness: 0 }), /Lysstyrke/);
  const paired = { bridgeIp: '192.168.1.2', applicationKey: 'synthetic-test-key', certificateFingerprint: 'AA:BB' };
  await assert.rejects(hue.control({}, { kind: 'grouped_light', id, on: false, brightness: 30 }), /ikke parret/);
  await hue.control(paired, { kind: 'grouped_light', id, on: false, brightness: 30 });
  assert.deepEqual(calls.at(-1), { method: 'PUT', path: `/clip/v2/resource/grouped_light/${id}`, body: { on: { on: false }, dimming: { brightness: 30 } } });
  await assert.rejects(hue.scene({}, id), /ikke parret/);
  await hue.scene(paired, id);
  assert.deepEqual(calls.at(-1).body, { recall: { action: 'active' } });
});
