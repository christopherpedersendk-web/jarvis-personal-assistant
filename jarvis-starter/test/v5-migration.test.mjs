import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { STATE_SCHEMA_VERSION, loadVersionedState, atomicStateWrite,
  restoreStateBackup, schemaVersion, stateHash } from '../state-schema.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, stateFile: join(dir, 'state.json') };
}

test('the package release schema declaration matches the runtime migration contract', async () => {
  const packagePath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(manifest.jarvisSchemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(manifest.jarvisReadableSchemaFrom, 0);
});

test('synthetic v4.9.1 state migration keeps all fields, preserves exact backup, and is idempotent', async t => {
  const { stateFile } = await fixture(t);
  const legacy = { preferences: 'lokalt privat notat', mealPlans: [{ id: 'manual', revision: 7, locked: true }],
    memories: [{ id: 'historical' }], unknownLegacyField: { manual: true } };
  const raw = JSON.stringify(legacy);
  await writeFile(stateFile, raw, { mode: 0o600 });
  const first = await loadVersionedState(stateFile);
  assert.equal(first.schemaVersion, STATE_SCHEMA_VERSION);
  assert.deepEqual({ ...first, schemaVersion: undefined }, { ...legacy, schemaVersion: undefined });
  const backup = `${stateFile}.v4.9.1-before-v5.backup`;
  assert.equal(await readFile(backup, 'utf8'), raw);
  const after = await readFile(stateFile, 'utf8');
  assert.deepEqual(await loadVersionedState(stateFile), first);
  assert.equal(await readFile(stateFile, 'utf8'), after, 'repeat does not rewrite');
  assert.equal(await readFile(backup, 'utf8'), raw, 'original backup untouched');
});

test('interrupted migration resumes only when existing backup matches current source', async t => {
  const { stateFile } = await fixture(t);
  const legacy = JSON.stringify({ manual: 'A' });
  await writeFile(stateFile, legacy);
  const backup = `${stateFile}.v4.9.1-before-v5.backup`;
  await writeFile(backup, legacy, { flag: 'wx' });
  assert.equal((await loadVersionedState(stateFile)).manual, 'A');
  await writeFile(stateFile, JSON.stringify({ manual: 'B' }));
  await assert.rejects(loadVersionedState(stateFile), /migrationsbackup matcher ikke/);
  assert.equal(await readFile(backup, 'utf8'), legacy);
});

test('newer schema and malformed schema fail closed without publication', async t => {
  const { stateFile } = await fixture(t);
  for (const version of [STATE_SCHEMA_VERSION + 1, -1, 'tomorrow']) {
    const raw = JSON.stringify({ schemaVersion: version, newerEdit: 'preserve' });
    await writeFile(stateFile, raw);
    await assert.rejects(loadVersionedState(stateFile), /skema/);
    assert.equal(await readFile(stateFile, 'utf8'), raw);
  }
  assert.throws(() => schemaVersion([]), /JSON-objekt/);
});

test('atomic writes publish complete data and clean failed temporary files', async t => {
  const { dir, stateFile } = await fixture(t);
  await atomicStateWrite(stateFile, '{"revision":1}');
  assert.equal(await readFile(stateFile, 'utf8'), '{"revision":1}');
  await mkdir(join(dir, 'forbidden-target'));
  await assert.rejects(atomicStateWrite(join(dir, 'forbidden-target'), '{"revision":2}'));
  assert.equal((await readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
  assert.equal(await readFile(stateFile, 'utf8'), '{"revision":1}');
});

test('atomic rename failure leaves the previous state untouched and clears its temporary snapshot', async t => {
  const { dir, stateFile } = await fixture(t);
  await atomicStateWrite(stateFile, '{"revision":1}');
  const error = Object.assign(new Error('synthetic rename error'), { code: 'EIO' });
  await assert.rejects(atomicStateWrite(stateFile, '{"revision":2}', {
    renameFile: async () => { throw error; },
  }), received => received === error && received.statePublished !== true);
  assert.equal(await readFile(stateFile, 'utf8'), '{"revision":1}');
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
  await atomicStateWrite(stateFile, '{"revision":3}');
  assert.equal(await readFile(stateFile, 'utf8'), '{"revision":3}');
});

test('failed directory durability after rename is UNKNOWN, never mistaken for an unapplied write', async t => {
  const { stateFile } = await fixture(t);
  await atomicStateWrite(stateFile, '{"revision":1}');
  const error = Object.assign(new Error('synthetic directory sync error'), { code: 'EIO' });
  await assert.rejects(atomicStateWrite(stateFile, '{"revision":2}', {
    syncDirectory: async () => { throw error; },
  }), received => received.code === 'STATE_DURABILITY_UNKNOWN' && received.statePublished === true && received.cause === error);
  assert.equal(await readFile(stateFile, 'utf8'), '{"revision":2}', 'rename has already published data even if durability cannot be confirmed');
});

test('offline restore is bound to exact current hash and never silently overwrites newer edits', async t => {
  const { dir, stateFile } = await fixture(t);
  const backup = join(dir, 'safe.backup');
  const old = JSON.stringify({ schemaVersion: 1, version: 'old' });
  const current = JSON.stringify({ schemaVersion: 1, version: 'with newer edits' });
  await writeFile(backup, old);
  await writeFile(stateFile, current);
  await assert.rejects(restoreStateBackup({ path: stateFile, backupPath: backup,
    expectedCurrentHash: stateHash(old) }), /ændret/);
  assert.equal(await readFile(stateFile, 'utf8'), current);
  const result = await restoreStateBackup({ path: stateFile, backupPath: backup,
    expectedCurrentHash: stateHash(current) });
  assert.equal(result.restoredHash, stateHash(old));
  assert.equal(await readFile(stateFile, 'utf8'), old);
});
