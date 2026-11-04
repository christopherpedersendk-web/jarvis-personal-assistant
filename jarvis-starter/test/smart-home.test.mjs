import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartHome } from '../smart-home.mjs';

test('Smart Home persists bounded events and labels simulated tests', async () => {
  const state = {};
  let saved = 0;
  const home = new SmartHome({ state, save: async () => { saved++; } });
  await home.event({ source: 'test', kind: 'doorbell', label: 'Test dør' });
  assert.equal(home.snapshot().events[0].label, 'Test dør');
  assert.equal(home.snapshot().google.configured, false);
  assert.equal(saved, 1);
  await assert.rejects(home.event({ source: 'unknown', kind: 'doorbell', label: 'x' }));
  for (let i = 0; i < 105; i++) await home.event({ source: 'manual', kind: 'other', label: String(i) });
  assert.equal(state.homeEvents.length, 100);
});

test('Sonos commands require a token and a validated group', async () => {
  const home = new SmartHome({ state: {}, save: async () => {} });
  await assert.rejects(home.sonos({}, { command: 'play', groupId: 'abc' }), /ikke forbundet/);
  await assert.rejects(home.sonos({ sonosToken: 'test' }, { command: 'play', groupId: '../escape' }), /gruppe-ID/);
  await assert.rejects(home.sonos({ sonosToken: 'test' }, { command: 'unlock', groupId: 'abc' }), /Ukendt/);
  assert.deepEqual(await home.sonosGroups({}), { groups: [], message: 'Angiv et gyldigt Sonos-token og household-ID under Indstillinger.' });
});
