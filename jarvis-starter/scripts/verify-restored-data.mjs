import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export async function dataManifest(root, prefix = '') {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Datamappen skal være en almindelig mappe.');
  const entries = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name, path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks kræver særskilt restore-review.');
    if (entry.isDirectory()) entries.push(...await dataManifest(path, name + '/'));
    else if (entry.isFile()) {
      const stat = await lstat(path);
      entries.push({ path: name, bytes: stat.size, mode: stat.mode & 0o777,
        sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    } else throw new Error('Uventet filtype i restore-grundlaget.');
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
/** Compare a QUIESCENT backup with a separately restored directory, read-only.
 * This is content verification, not proof of systemd config, decryption or a boot.
 */
export async function verifyRestoredData(source, restored, { required = ['state.json', 'private-settings.json'] } = {}) {
  source = resolve(source); restored = resolve(restored);
  if (source === restored || source.startsWith(restored + '/') || restored.startsWith(source + '/')) throw new Error('Brug adskilte backup- og restore-mapper.');
  const [before, after] = await Promise.all([dataManifest(source), dataManifest(restored)]);
  const problems = [];
  for (const path of required) if (!before.some(e => e.path === path) || !after.some(e => e.path === path)) problems.push({ path, reason: 'required-file-missing' });
  const b = new Map(after.map(e => [e.path, e]));
  for (const expected of before) {
    const actual = b.get(expected.path); b.delete(expected.path);
    if (!actual || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) problems.push({ path: expected.path, reason: 'content-mismatch' });
    if (actual && expected.path === 'private-settings.json' && (actual.mode & 0o077)) problems.push({ path: expected.path, reason: 'private-settings-permissions' });
    if (actual && (actual.mode & ~expected.mode)) problems.push({ path: expected.path, reason: 'permissions-widened' });
  }
  for (const path of b.keys()) problems.push({ path, reason: 'unexpected-restored-file' });
  return { at: new Date().toISOString(), ok: !problems.length, files: before.length, problems,
    scope: 'Quiescent directory content/permissions only; service boot and external projects require separate acceptance.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , source, restored] = process.argv;
    if (!source || !restored) throw new Error();
    const report = await verifyRestoredData(source, restored);
    console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
  } catch { console.error('Restore-kontrol afbrudt. Angiv to adskilte, læsbare mapper fra et konsistent backupgrundlag.'); process.exitCode = 1; }
}
