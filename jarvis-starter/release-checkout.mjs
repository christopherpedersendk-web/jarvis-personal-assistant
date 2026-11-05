import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

const unsafe = () => new Error('Usikker checkout-sti: staging, projektrod, metadata og testkilde skal være almindelige lokale filer/mapper uden symbolske links.');

async function checkedDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw unsafe();
}

// Check ancestors before creating any descendants: mkdir({recursive:true}) can
// otherwise create a release *through* a pre-existing parent symlink.
export async function prepareReleaseStaging(path) {
  const absolute = resolve(path); const root = parse(absolute).root;
  if (absolute === root) throw unsafe();
  let current = root;
  for (const segment of absolute.slice(root.length).split(sep)) {
    current = join(current, segment);
    try { await checkedDirectory(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
      await checkedDirectory(current);
    }
  }
  return absolute;
}

export async function checkedReleaseCheckout(staging, checkout, { scanTree = true } = {}) {
  const root = resolve(staging); const directory = resolve(checkout);
  if (dirname(directory) !== root || directory === root) throw unsafe();
  await checkedDirectory(root); await checkedDirectory(directory);
  const application = join(directory, 'jarvis-starter'); await checkedDirectory(application);
  const packagePath = join(application, 'package.json'); const metadata = await lstat(packagePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024 || await realpath(packagePath) !== packagePath) throw unsafe();
  if (scanTree) {
    let entries = 0;
    const walk = async (folder, depth = 0) => {
      if (depth > 32) throw new Error('Checkoutens testkilde er for dyb til sikker gennemgang.');
      await checkedDirectory(folder);
      for (const name of await readdir(folder)) {
        if (++entries > 20_000) throw new Error('Checkoutens testkilde har for mange filer til sikker gennemgang.');
        const path = join(folder, name); const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile() || await realpath(path) !== path) throw unsafe();
        if (info.isDirectory()) await walk(path, depth + 1);
      }
    };
    await walk(application);
  }
  return { directory, application, packagePath };
}

export async function readReleasePackage(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 128n * 1024n) throw unsafe();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw unsafe();
    const chunks = []; const buffer = Buffer.alloc(16 * 1024); let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > 128 * 1024) throw unsafe();
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await handle.stat({ bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || BigInt(size) !== after.size) throw unsafe();
    return Buffer.concat(chunks).toString('utf8');
  } finally { await handle.close(); }
}
