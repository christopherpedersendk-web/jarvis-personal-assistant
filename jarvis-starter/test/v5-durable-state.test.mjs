import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableState } from '../durable-state.mjs';
import { atomicStateWrite, stateHash } from '../state-schema.mjs';
import { writeStateBundle, recoverStateBundle } from '../state-bundle.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('A1: readers never see an uncommitted draft; failed writer and queue recover', async () => {
  let disk; let fail = false; const entered = deferred(); const release = deferred();
  const store = new DurableState({ initial: { items: [], settings: {} }, write: async value => {
    if (fail) { entered.resolve(); await release.promise; throw new Error('disk failure'); }
    disk = value;
  } });
  await store.initialize();
  fail = true;
  const failed = store.transact(['items'], async () => { store.state.items.push('not saved'); await store.save(); });
  await entered.promise;
  assert.deepEqual(store.state.items, []);
  assert.deepEqual(JSON.parse(disk).items, []);
  release.resolve(); await assert.rejects(failed, /disk failure/);
  fail = false;
  await Promise.all(['one', 'two'].map(value => store.transact(['items'], async () => {
    store.state.items.push(value); await store.save();
  })));
  assert.deepEqual(store.state.items, ['one', 'two']);
  assert.deepEqual(JSON.parse(disk).items, ['one', 'two']);
  assert.equal(store.state.stateRevision, 2);
});

test('A1: out-of-transaction changes are rejected and true no-op does not write', async () => {
  let writes = 0;
  const store = new DurableState({ initial: { items: [], settings: {} }, write: async () => { writes++; } });
  await store.initialize();
  assert.throws(() => store.state.items.push('ghost'), TypeError);
  assert.throws(() => { store.state.items = []; }, /transaktion/);
  assert.throws(() => store.save(), /transaktion/);
  await assert.rejects(store.transact(['items'], () => { store.state.items.push('unsaved'); }), /gemning/);
  await store.transact(['items'], () => store.save());
  assert.equal(writes, 1);
  assert.deepEqual(store.state.items, []);
});

test('A1: nested domain changes commit together without deadlock or partial success', async () => {
  let writes = 0;
  const store = new DurableState({ initial: { a: [], b: [] }, write: async () => { writes++; } });
  await store.initialize();
  await store.transact(['a'], async () => {
    store.state.a.push(1);
    await store.transact(['b'], async () => { store.state.b.push(2); await store.save(); });
  });
  assert.equal(writes, 2);
  assert.deepEqual({ ...store.state }, { a: [1], b: [2], stateRevision: 1 });
});

test('A1: known publication with uncertain durability stays visible and blocks later mutations', async () => {
  let initialized = false;
  const store = new DurableState({ initial: { items: [] }, write: async () => {
    if (initialized) throw Object.assign(new Error('unknown sync'), { statePublished: true });
  } });
  await store.initialize(); initialized = true;
  await assert.rejects(store.transact(['items'], async () => { store.state.items.push(1); await store.save(); }), /unknown sync/);
  assert.deepEqual(store.state.items, [1]);
  let called = false;
  await assert.rejects(store.transact([], () => { called = true; }), /ukendt/);
  assert.equal(called, false); assert.equal(store.snapshot().ready, false);
});

async function bundleFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-bundle-'));
  await atomicStateWrite(join(directory, 'state.json'), '{"schemaVersion":1,"settings":{"limit":5}}');
  await atomicStateWrite(join(directory, 'private-settings.json'), '{"token":"synthetic-old"}');
  return directory;
}

test('R02/A1: two-file failure restores the exact earlier public/private pair', async () => {
  const directory = await bundleFixture();
  const before = await Promise.all(['state.json', 'private-settings.json'].map(name => readFile(join(directory, name), 'utf8')));
  await assert.rejects(writeStateBundle(directory, '{"schemaVersion":1,"settings":{"limit":8}}', [
    { name: 'private-settings.json', contents: '{"token":"synthetic-new"}' },
  ], { write: async (path, contents) => {
    if (path.endsWith('/state.json')) throw new Error('injected state rename');
    return atomicStateWrite(path, contents);
  } }), /injected state rename/);
  assert.deepEqual(await Promise.all(['state.json', 'private-settings.json'].map(name => readFile(join(directory, name), 'utf8'))), before);
  assert.equal((await readdir(directory)).includes('pending-state-transaction.json'), false);
  await writeStateBundle(directory, '{"schemaVersion":1,"settings":{"limit":8}}', [
    { name: 'private-settings.json', contents: '{"token":"synthetic-new"}' },
  ]);
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.limit, 8);
  assert.equal(JSON.parse(await readFile(join(directory, 'private-settings.json'), 'utf8')).token, 'synthetic-new');
});

test('A1/L3: interrupted pair recovers once; never overwrite a newer manual state', async () => {
  const directory = await bundleFixture();
  const files = [];
  for (const [name, after] of [['private-settings.json', '{"token":"synthetic-new"}'], ['state.json', '{"schemaVersion":1,"settings":{"limit":9}}']]) {
    const before = await readFile(join(directory, name), 'utf8');
    files.push({ name, before, after, beforeHash: stateHash(before), afterHash: stateHash(after) });
  }
  const journal = JSON.stringify({ version: 1, id: 'synthetic-interruption', files });
  await atomicStateWrite(join(directory, 'pending-state-transaction.json'), journal);
  assert.equal((await stat(join(directory, 'pending-state-transaction.json'))).mode & 0o777, 0o600);
  await atomicStateWrite(join(directory, 'private-settings.json'), files[0].after);
  assert.equal((await recoverStateBundle(directory)).recovered, true);
  assert.deepEqual(await recoverStateBundle(directory), { recovered: false });
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), files[1].after);
  await atomicStateWrite(join(directory, 'pending-state-transaction.json'), journal);
  await writeFile(join(directory, 'state.json'), '{"schemaVersion":1,"newerUserEdit":true}');
  await assert.rejects(recoverStateBundle(directory), /Ingen data overskrevet/);
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).newerUserEdit, true);
});

test('A1: private journal publication uncertainty never masquerades as committed state', async () => {
  const directory = await bundleFixture();
  await assert.rejects(writeStateBundle(directory, '{"schemaVersion":1}', [
    { name: 'private-settings.json', contents: '{"token":"synthetic-new"}' },
  ], { write: async (path, contents) => {
    await atomicStateWrite(path, contents);
    if (path.endsWith('/pending-state-transaction.json')) throw Object.assign(new Error('fsync'), { statePublished: true });
  } }), error => error.code === 'STATE_TRANSACTION_UNKNOWN' && !error.statePublished);
  assert.equal(JSON.parse(await readFile(join(directory, 'private-settings.json'), 'utf8')).token, 'synthetic-old');
  assert.equal((await recoverStateBundle(directory)).recovered, true);
});
