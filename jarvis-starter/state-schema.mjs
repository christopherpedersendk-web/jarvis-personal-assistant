import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Versionér data uafhængigt af appens v5.0.0-version. v4.9.1 havde intet felt.
export const STATE_SCHEMA_VERSION = 1;

export function schemaVersion(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('Tilstandsfilen indeholder ikke et gyldigt JSON-objekt.');
  const version = state.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0)
    throw new Error('Tilstandsfilen har et ugyldigt skemanummer.');
  if (version > STATE_SCHEMA_VERSION)
    throw new Error(`Tilstandsfilen bruger nyere skema ${version}; denne app understøtter kun ${STATE_SCHEMA_VERSION}. Stop og vælg kompatibel version.`);
  return version;
}

export const stateHash = contents => createHash('sha256').update(contents).digest('hex');

async function syncParentDirectory(path) {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Write a private JSON snapshot without publishing a partial file. */
export async function atomicStateWrite(path, contents, { renameFile = rename, syncDirectory = syncParentDirectory } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  let published = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await renameFile(temporary, path);
    published = true;
    try { await syncDirectory(path); }
    catch (error) {
      // Some filesystems do not support fsync on directories; the file itself
      // has already been atomically published and synced.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (published) {
      // Rename succeeded: disk now has the new JSON, but directory durability
      // could not be confirmed. Rolling back memory would diverge from disk.
      const uncertain = new Error('Tilstanden er publiceret, men diskens varighed kunne ikke bekræftes. Udfaldet er ukendt; genstart og kontrollér lageret før nye skrivninger.', { cause: error });
      uncertain.code = 'STATE_DURABILITY_UNKNOWN';
      uncertain.statePublished = true;
      throw uncertain;
    }
    throw error;
  }
}

/** One-time reversible migration from pre-versioned v4.9.1 state.
 * A previous backup must match the exact content being migrated; otherwise
 * never overwrite it or continue with uncertain provenance.
 */
export async function loadVersionedState(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const state = JSON.parse(raw);
  const version = schemaVersion(state);
  if (version === STATE_SCHEMA_VERSION) return state;
  const backup = `${path}.v4.9.1-before-v5.backup`;
  try { await writeFile(backup, raw, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = await readFile(backup, 'utf8');
    if (stateHash(prior) !== stateHash(raw))
      throw new Error('Eksisterende migrationsbackup matcher ikke den aktuelle gamle tilstand; manuel gennemgang nødvendig.');
  }
  const migrated = { ...state, schemaVersion: STATE_SCHEMA_VERSION };
  await atomicStateWrite(path, JSON.stringify(migrated, null, 2));
  return migrated;
}

/** Offline restore. The caller must compare and explicitly specify the exact
 * current state hash, preventing an old backup from silently replacing edits.
 */
export async function restoreStateBackup({ path, backupPath, expectedCurrentHash }) {
  if (!/^[0-9a-f]{64}$/.test(expectedCurrentHash || ''))
    throw new Error('Gendannelse kræver den præcise SHA-256 for aktuel tilstand.');
  const current = await readFile(path, 'utf8');
  if (stateHash(current) !== expectedCurrentHash)
    throw new Error('Tilstanden er ændret siden godkendt gendannelse; ingen filer er overskrevet.');
  const backup = await readFile(backupPath, 'utf8');
  schemaVersion(JSON.parse(backup));
  await atomicStateWrite(path, backup);
  return { restoredHash: stateHash(backup), previousHash: expectedCurrentHash };
}
