import { lstat, readdir, mkdir, copyFile, chmod, realpath } from 'node:fs/promises';
import { resolve, dirname, join, sep } from 'node:path';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyRestoredData } from './verify-restored-data.mjs';

// Offline only: the operator must stop the service and every other writer.
// An existing destination is never overwritten, including a failed snapshot.
export async function offlineSnapshot(source, destination, { quiescent = false, required } = {}) {
  if (!quiescent) throw new Error('Stop alle skrivere og bekræft quiescent før kopiering.');
  source = resolve(source); destination = resolve(destination);
  for (const path of [source, dirname(destination)]) {
    if (await realpath(path) !== path) throw new Error('Symlink i mappestien er ikke tilladt.');
  }
  if (source === destination || source.startsWith(destination + sep) || destination.startsWith(source + sep))
    throw new Error('Kilde og mål skal være adskilte mapper.');
  async function inspect(path) {
    const st = await lstat(path);
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error('Kun almindelige filer og mapper er tilladt.');
    if (st.isDirectory()) for (const name of await readdir(path)) await inspect(join(path, name));
  }
  await inspect(source);
  if (!(await lstat(source)).isDirectory()) throw new Error('Kilden skal være en mappe.');
  await mkdir(destination, { mode: 0o700 });
  async function copy(from, to) {
    for (const name of await readdir(from)) {
      const a = join(from, name), b = join(to, name), st = await lstat(a);
      if (st.isSymbolicLink()) throw new Error('Kilden ændrede sig; kopiering afbrudt.');
      if (st.isDirectory()) { await mkdir(b, { mode: 0o700 }); await copy(a, b); }
      else if (st.isFile()) { await copyFile(a, b, constants.COPYFILE_EXCL); await chmod(b, st.mode & 0o700); }
      else throw new Error('Uventet filtype.');
    }
  }
  await copy(source, destination);
  const result = await verifyRestoredData(source, destination, { required });
  if (!result.ok) throw new Error('Snapshot matcher ikke kilden. Bevar begge mapper til gennemgang.');
  return { ...result, scope: 'Offline directory copy; quiescence is operator asserted. External projects/configuration must be copied separately. No service boot performed.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , source, destination, flag] = process.argv;
    if (!source || !destination || flag !== '--service-stopped') throw new Error('Angiv kilde, nyt mål og --service-stopped.');
    console.log(JSON.stringify(await offlineSnapshot(source, destination, { quiescent: true }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
