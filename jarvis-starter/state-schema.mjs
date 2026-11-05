import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink, mkdir, lstat } from 'node:fs/promises';
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

export async function readPrivateStateText(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Tilstandsfilen skal være en almindelig privat fil, ikke et link eller en mappe.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev) throw new Error('Tilstandsfilen blev ændret under åbning.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

/** The original must be durable BEFORE its live v4 bytes are replaced. If an
 * interrupted write left a partial backup, fail closed and preserve both files.
 */
export async function durableExclusiveBackup(path, contents, { openFile = open, syncDirectory = syncParentDirectory } = {}) {
  let handle;
  try {
    try {
      handle = await openFile(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      await handle.writeFile(contents, 'utf8');
    } catch (error) {
      if (error.code !== 'EEXIST' || handle) throw error;
      const prior = await readPrivateStateText(path);
      if (stateHash(prior) !== stateHash(contents)) throw new Error('Eksisterende migrationsbackup matcher ikke den aktuelle gamle tilstand; manuel gennemgang nødvendig.');
      handle = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if (stateHash(await handle.readFile('utf8')) !== stateHash(contents)) throw new Error('Migrationsbackup blev ændret før synkronisering.');
    }
    await handle.sync();
  } finally { await handle?.close(); }
  try { await syncDirectory(path); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
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
export async function loadVersionedState(path, { backupOptions, publish = atomicStateWrite } = {}) {
  let raw;
  try { raw = await readPrivateStateText(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const state = JSON.parse(raw);
  const version = schemaVersion(state);
  if (version === STATE_SCHEMA_VERSION) return state;
  const backup = `${path}.v4.9.1-before-v5.backup`;
  await durableExclusiveBackup(backup, raw, backupOptions);
  if (stateHash(await readPrivateStateText(path)) !== stateHash(raw))
    throw new Error('Den gamle tilstand er ændret under forberedelse af migration. Ingen nyere ændringer overskrevet.');
  const migrated = { ...state, schemaVersion: STATE_SCHEMA_VERSION };
  await publish(path, JSON.stringify(migrated, null, 2));
  return migrated;
}

/** Offline restore. The caller must compare and explicitly specify the exact
 * current state hash, preventing an old backup from silently replacing edits.
 */
export async function restoreStateBackup({ path, backupPath, expectedCurrentHash }, { read = readPrivateStateText, publish = atomicStateWrite } = {}) {
  if (!/^[0-9a-f]{64}$/.test(expectedCurrentHash || ''))
    throw new Error('Gendannelse kræver den præcise SHA-256 for aktuel tilstand.');
  const current = await read(path);
  if (stateHash(current) !== expectedCurrentHash)
    throw new Error('Tilstanden er ændret siden godkendt gendannelse; ingen filer er overskrevet.');
  schemaVersion(JSON.parse(current));
  const backup = await read(backupPath);
  schemaVersion(JSON.parse(backup));
  // The service must be stopped. This last recheck closes preparation races;
  // it is not a filesystem compare-and-swap against arbitrary external writers.
  if (stateHash(await read(path)) !== expectedCurrentHash)
    throw new Error('Tilstanden er ændret under forberedelse af gendannelse; ingen filer er overskrevet.');
  await publish(path, backup);
  return { restoredHash: stateHash(backup), previousHash: expectedCurrentHash };
}
