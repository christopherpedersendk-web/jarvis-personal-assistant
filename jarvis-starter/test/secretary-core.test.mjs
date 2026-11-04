import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretaryCore } from '../secretary-core.mjs';

test('stores shared memory and customizable playbook', async () => {
  const state = {};
  const secretary = new SecretaryCore({ state, save: async () => {} });
  assert.match(state.playbook, /Morgenrapport/);
  const memory = await secretary.remember('Jeg foretrækker vegetariske restauranter.');
  assert.match(secretary.memoryContext(), /vegetariske/);
  await secretary.savePlaybook('# Mine instruktioner');
  assert.equal(state.playbook, '# Mine instruktioner');
  await secretary.archiveMemory(memory.id);
  assert.equal(secretary.memoryContext(), '');
});

test('approval is recorded but never executes an external action', async () => {
  const state = {};
  const secretary = new SecretaryCore({ state, save: async () => {} });
  const action = await secretary.proposeAction({ kind: 'booking', title: 'Biograf', description: 'To billetter', url: 'https://example.com/book' });
  assert.equal(action.status, 'pending');
  const approved = await secretary.decideAction(action.id, 'approve');
  assert.equal(approved.status, 'approved_not_executed');
  await assert.rejects(secretary.decideAction(action.id, 'approve'), /allerede behandlet/);
  await assert.rejects(secretary.proposeAction({ kind: 'booking', title: 'X', description: 'Y', url: 'javascript:alert(1)' }), /HTTPS/);
});

test('records and marks task results as read', async () => {
  const state = {};
  const secretary = new SecretaryCore({ state, save: async () => {} });
  const item = await secretary.addInbox({ title: 'Morgenrapport', text: 'Tre nyheder' });
  assert.equal(item.read, false);
  await secretary.readInbox(item.id);
  assert.equal(state.inbox[0].read, true);
});
