import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicStateWrite, loadVersionedState, restoreStateBackup, stateHash, readPrivateStateText } from '../state-schema.mjs';
import { recoverStateBundle } from '../state-bundle.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-v5-recovery-'));
  const path = join(directory, 'state.json');
  const raw = JSON.stringify({ preferences: 'Syntetisk manuel oplysning', manualExtra: { keep: true } });
  await writeFile(path, raw, { mode: 0o600 });
  return { directory, path, raw, backup: `${path}.v4.9.1-before-v5.backup` };
}

test('L2 original backup file and parent are synced before the first live migration publication', async () => {
  const f = await fixture(); const operations = [];
  await loadVersionedState(f.path, { backupOptions: {
    openFile: async (...args) => {
      const handle = await open(...args);
      return { writeFile: async (...input) => { operations.push('backup-write'); return handle.writeFile(...input); },
        sync: async () => { operations.push('backup-fsync'); return handle.sync(); }, close: () => handle.close() };
    }, syncDirectory: async () => { operations.push('backup-parent-fsync'); },
  }, publish: async (path, contents) => {
    operations.push('publish-migration');
    assert.equal(await readFile(f.backup, 'utf8'), f.raw);
    return atomicStateWrite(path, contents);
  } });
  assert.deepEqual(operations, ['backup-write', 'backup-fsync', 'backup-parent-fsync', 'publish-migration']);
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).schemaVersion, 1);
});

test('L2 backup file fsync failure leaves legacy bytes live and can resume without replacing the original', async () => {
  const f = await fixture(); let publications = 0;
  const failure = new Error('Syntetisk backup-fsync-fejl');
  await assert.rejects(loadVersionedState(f.path, { backupOptions: {
    openFile: async (...args) => {
      const handle = await open(...args);
      return { writeFile: (...input) => handle.writeFile(...input), sync: async () => { throw failure; }, close: () => handle.close() };
    },
  }, publish: async () => { publications++; } }), error => error === failure);
  assert.equal(publications, 0);
  assert.equal(await readFile(f.path, 'utf8'), f.raw);
  assert.equal(await readFile(f.backup, 'utf8'), f.raw);
  await loadVersionedState(f.path);
  assert.equal(await readFile(f.backup, 'utf8'), f.raw);
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).schemaVersion, 1);
});

test('L2 backup directory durability failure is not mistaken for a completed migration', async () => {
  const f = await fixture(); let publications = 0;
  await assert.rejects(loadVersionedState(f.path, { backupOptions: { syncDirectory: async () => { throw Object.assign(new Error('Syntetisk EIO'), { code: 'EIO' }); } },
    publish: async () => { publications++; } }), /EIO/);
  assert.equal(publications, 0); assert.equal(await readFile(f.path, 'utf8'), f.raw);
  await loadVersionedState(f.path);
  assert.equal(await readFile(f.backup, 'utf8'), f.raw);
});

test('L2 a newer manual state during backup preparation is not overwritten by migration', async () => {
  const f = await fixture(); const newer = JSON.stringify({ preferences: 'Nyere manuel rettelse' });
  await assert.rejects(loadVersionedState(f.path, { backupOptions: { syncDirectory: async () => { await writeFile(f.path, newer); } } }), /ændret under/);
  assert.equal(await readFile(f.path, 'utf8'), newer);
  assert.equal(await readFile(f.backup, 'utf8'), f.raw);
});

test('L2 state and migration backup symlinks fail closed without modifying their targets', async () => {
  const f = await fixture(); const linkedState = join(f.directory, 'linked-state.json');
  await symlink(f.path, linkedState);
  await assert.rejects(loadVersionedState(linkedState), /link/);
  await symlink(f.path, f.backup);
  await assert.rejects(loadVersionedState(f.path), /link/);
  assert.equal(await readFile(f.path, 'utf8'), f.raw);
});

test('L3 restore rechecks the approved current hash after reading backup and does not erase later user edits', async () => {
  const f = await fixture(); const newer = '{"schemaVersion":1,"edit":"Efter godkendelsen"}';
  await writeFile(f.backup, '{"schemaVersion":1,"edit":"Gammel backup"}');
  await assert.rejects(restoreStateBackup({ path: f.path, backupPath: f.backup, expectedCurrentHash: stateHash(f.raw) }, {
    read: async path => {
      const text = await readPrivateStateText(path);
      if (path === f.backup) await writeFile(f.path, newer);
      return text;
    },
  }), /ændret under/);
  assert.equal(await readFile(f.path, 'utf8'), newer);
});

test('L3 a newer data schema is never rewritten by this older restore helper', async () => {
  const f = await fixture(); const newer = '{"schemaVersion":2,"edit":"Nyere app"}';
  await writeFile(f.path, newer); await writeFile(f.backup, f.raw);
  await assert.rejects(restoreStateBackup({ path: f.path, backupPath: f.backup, expectedCurrentHash: stateHash(newer) }), /nyere skema/);
  assert.equal(await readFile(f.path, 'utf8'), newer);
});

test('A1/L2 a valid-hash transaction journal with a future state schema is not replayed by older code', async () => {
  const f = await fixture(); const settings = join(f.directory, 'private-settings.json');
  await writeFile(settings, '{"synthetic":"old"}');
  const files = [
    { name: 'private-settings.json', before: '{"synthetic":"old"}', after: '{"synthetic":"new"}' },
    { name: 'state.json', before: f.raw, after: '{"schemaVersion":2,"edit":"Nyere app"}' },
  ].map(file => ({ ...file, beforeHash: stateHash(file.before), afterHash: stateHash(file.after) }));
  await writeFile(join(f.directory, 'pending-state-transaction.json'), JSON.stringify({ version: 1, id: 'future-schema', files }));
  await assert.rejects(recoverStateBundle(f.directory), /nyere skema/);
  assert.equal(await readFile(f.path, 'utf8'), f.raw);
  assert.equal(await readFile(settings, 'utf8'), '{"synthetic":"old"}');
});

test('A1/L3 transaction replay rechecks each file and preserves an intervening manual state', async () => {
  const f = await fixture(); const settings = join(f.directory, 'private-settings.json');
  await writeFile(settings, '{"synthetic":"old"}');
  const newer = '{"schemaVersion":1,"edit":"Nyere manuel state"}';
  const files = [
    { name: 'private-settings.json', before: '{"synthetic":"old"}', after: '{"synthetic":"new"}' },
    { name: 'state.json', before: f.raw, after: '{"schemaVersion":1,"edit":"Planlagt"}' },
  ].map(file => ({ ...file, beforeHash: stateHash(file.before), afterHash: stateHash(file.after) }));
  await writeFile(join(f.directory, 'pending-state-transaction.json'), JSON.stringify({ version: 1, id: 'intervening', files }));
  await assert.rejects(recoverStateBundle(f.directory, { write: async (path, content) => {
    await atomicStateWrite(path, content);
    if (path === settings) await writeFile(f.path, newer);
  } }), /ændret under/);
  assert.equal(await readFile(f.path, 'utf8'), newer);
  assert.ok(await readFile(join(f.directory, 'pending-state-transaction.json'), 'utf8'), 'retain journal for manual reconciliation');
});
