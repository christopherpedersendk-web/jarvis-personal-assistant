import { readFile, lstat, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicStateWrite, stateHash } from './state-schema.mjs';

const JOURNAL = 'pending-state-transaction.json';
const ALLOWED = new Set(['state.json', 'private-settings.json']);
const hash = value => value === null ? null : stateHash(value);

async function readRegular(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Lagerfilen er ikke en almindelig privat fil.');
    return await readFile(path, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function removeJournal(directory) {
  await unlink(join(directory, JOURNAL));
  const handle = await open(directory, 'r');
  try { await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
  finally { await handle.close(); }
}

function checkedJournal(journal) {
  if (journal?.version !== 1 || !Array.isArray(journal.files) || journal.files.length !== 2 ||
      new Set(journal.files.map(file => file.name)).size !== 2) throw new Error('Ukendt lagringstransaktion; manuel lagerkontrol nødvendig.');
  for (const file of journal.files) {
    if (!ALLOWED.has(file.name) || !(file.before === null || typeof file.before === 'string') ||
        typeof file.after !== 'string' || hash(file.before) !== file.beforeHash || hash(file.after) !== file.afterHash)
      throw new Error('Lagringstransaktionens indhold matcher ikke kontrolsummerne.');
    JSON.parse(file.after);
    if (file.before !== null) JSON.parse(file.before);
  }
  return journal;
}

/** Recover only our exact prepared contents before serving any request.
 * Unexpected/newer bytes stop recovery; an old snapshot never overwrites them.
 * The private 0600 journal is data, never included in API exports or logs.
 */
export async function recoverStateBundle(directory, { write = atomicStateWrite } = {}) {
  const raw = await readRegular(join(directory, JOURNAL));
  if (raw === null) return { recovered: false };
  const journal = checkedJournal(JSON.parse(raw));
  const actual = await Promise.all(journal.files.map(file => readRegular(join(directory, file.name))));
  journal.files.forEach((file, index) => {
    if (![file.beforeHash, file.afterHash].includes(hash(actual[index])))
      throw new Error('Lageret er ændret efter en afbrudt transaktion. Ingen data overskrevet; manuel gennemgang kræves.');
  });
  for (const file of journal.files) await write(join(directory, file.name), file.after);
  await removeJournal(directory);
  return { recovered: true, id: journal.id };
}

/** A recoverable pair, not a claim that two renames are filesystem-atomic.
 * Known failures roll back only exact bytes we just published. Crash/unknown
 * durability leaves the private journal and stops subsequent writes.
 */
export async function writeStateBundle(directory, stateContents, additional = [], { write = atomicStateWrite } = {}) {
  if (additional.length === 0) return write(join(directory, 'state.json'), stateContents);
  if (additional.length !== 1 || additional[0].name !== 'private-settings.json') throw new Error('Ukendt konfigurationsfil.');
  const files = [{ name: 'private-settings.json', after: additional[0].contents }, { name: 'state.json', after: stateContents }];
  for (const file of files) {
    file.before = await readRegular(join(directory, file.name));
    file.beforeHash = hash(file.before); file.afterHash = hash(file.after);
  }
  if (await readRegular(join(directory, JOURNAL)) !== null) throw new Error('En tidligere lagringstransaktion kræver gendannelse først.');
  const journal = checkedJournal({ version: 1, id: randomUUID(), files });
  try { await write(join(directory, JOURNAL), JSON.stringify(journal)); }
  catch (error) {
    if (!error.statePublished) throw error;
    const unknown = new Error('Transaktionsjournalens varighed er ukendt. Genstart og kontrollér lageret.', { cause: error });
    unknown.code = 'STATE_TRANSACTION_UNKNOWN';
    throw unknown;
  }
  let allPublished = false;
  try {
    for (const file of files) await write(join(directory, file.name), file.after);
    allPublished = true;
    await removeJournal(directory);
  } catch (error) {
    if (!error.statePublished && !allPublished) {
      try {
        for (const file of [...files].reverse()) {
          const current = await readRegular(join(directory, file.name));
          if (hash(current) === file.beforeHash) continue;
          if (hash(current) !== file.afterHash) throw new Error('Filen er ændret under genopretning.');
          if (file.before === null) await unlink(join(directory, file.name));
          else await write(join(directory, file.name), file.before);
        }
        await removeJournal(directory);
        throw Object.assign(error, { bundleRolledBack: true });
      } catch (recovery) { if (recovery.bundleRolledBack) throw recovery; }
    }
    const unknown = new Error('Lagringens udfald er ukendt. Ingen nye ændringer tillades før genstart og lagerkontrol.', { cause: error });
    unknown.code = 'STATE_TRANSACTION_UNKNOWN';
    unknown.statePublished = allPublished;
    throw unknown;
  }
}
