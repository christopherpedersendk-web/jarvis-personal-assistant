import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeControlledTool } from '../controlled-tool.mjs';
import { ActionJournal } from '../action-journal.mjs';
import { ProviderControl } from '../provider-control.mjs';
import { DurableState } from '../durable-state.mjs';

for (const channel of ['text', 'discord', 'voice']) for (const resume of [false, true]) {
  test(`${channel}: stop during journal admission blocks execution even with resume=${resume}`, async () => {
    const store = new DurableState({ initial: { actionJournal: [] }, write: async () => {} });
    await store.initialize();
    const control = new ProviderControl({ state: store.state, save: () => store.save(), transact: (...a) => store.transact(...a) });
    let entered, release;
    const ready = new Promise(r => entered = r), gate = new Promise(r => release = r);
    let first = true;
    const journal = new ActionJournal({ state: store.state, save: () => store.save(), transact: async (...a) => {
      const result = await store.transact(...a);
      if (first) { first = false; entered(); await gate; }
      return result;
    } });
    let executions = 0;
    const pending = invokeControlledTool({ control, journal, mutatingTools: new Set(['write']),
      call: { name: 'write', call_id: 'same-action' }, args: {}, channel, handler: async () => { executions++; return {}; } });
    const rejected = assert.rejects(pending, { code: 'ASSISTANT_STOPPED', noActionTaken: true });
    await ready; await control.stop(true); if (resume) await control.stop(false);
    release(); await rejected;
    assert.equal(executions, 0);
    assert.equal(store.state.actionJournal[0].status, 'failed');
    assert.equal(store.state.actionJournal[0].note, 'Ingen handling udført.');
    await assert.rejects(invokeControlledTool({ control, journal, mutatingTools: new Set(['write']),
      call: { name: 'write', call_id: 'same-action' }, args: {}, channel, handler: async () => executions++ }));
    assert.equal(executions, 0);
  });
}

for (const channel of ['text', 'discord', 'voice']) test(`${channel}: stop/resume discards an in-flight read result`, async () => {
  const store = new DurableState({ initial: {}, write: async () => {} });
  await store.initialize();
  const control = new ProviderControl({ state: store.state, save: () => store.save(), transact: (...a) => store.transact(...a) });
  let release;
  const gate = new Promise(r => release = r);
  const pending = invokeControlledTool({ control, mutatingTools: new Set(), call: { name: 'read' }, args: {}, channel,
    handler: async () => { await gate; return { text: 'old result' }; } });
  const rejected = assert.rejects(pending, { code: 'ASSISTANT_STOPPED' });
  await control.stop(true); await control.stop(false); release(); await rejected;
});
