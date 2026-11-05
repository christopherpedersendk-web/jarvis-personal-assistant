import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_SEMANTIC_MODEL as MODEL, verifyLocalSemanticModel } from '../semantic-model-manifest.mjs';

/** Run explicitly in isolated CI, or as a reviewed administrator preparation step.
 * The application never imports this downloader. No accounts or input texts are sent.
 */
export async function prepareLocalSemanticModel(directory, { allowPublicDownload = false, fetchFile = fetch } = {}) {
  if (!allowPublicDownload) throw new Error('Hentning af offentlige modeldata kræver --accept-public-download.');
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Angiv en absolut destinationsmappe.');
  let existing;
  try { existing = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) return verifyLocalSemanticModel(directory); // never overwrite existing/modified model data
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(directory), '.jarvis-semantic-download-'));
  await mkdir(join(staging, 'onnx'), { mode: 0o700 });
  try {
    for (const asset of MODEL.files) {
      const url = `https://huggingface.co/${MODEL.id}/resolve/${MODEL.revision}/${asset.path}`;
      const response = await fetchFile(url, { signal: AbortSignal.timeout(60_000), credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok || !response.body) throw new Error(`Hentning af ${asset.path} fejlede (HTTP ${response.status}).`);
      const hash = createHash('sha256');
      let bytes = 0;
      const handle = await open(join(staging, asset.path), 'wx', 0o600);
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > asset.bytes) throw new Error(`Modelfilen ${asset.path} overskrider den godkendte størrelse.`);
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error(`Indholdshash/størrelse for ${asset.path} stemmer ikke med den fastlåste model.`);
        await handle.sync();
      } finally { await handle.close(); }
    }
    const checked = await verifyLocalSemanticModel(staging);
    // A racing existing destination causes rename to fail; no existing model is removed.
    await rename(staging, directory);
    return { ...checked, directory };
  } catch (error) {
    // Keep the specifically named staging folder for diagnosis; never recursively
    // delete a caller-selected path or reuse partly downloaded data as a model.
    throw new Error(`Modelhentningen er ikke publiceret. Midlertidige filer: ${staging}. ${error.message}`, { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[process.argv.indexOf('--directory') + 1];
  if (!process.argv.includes('--directory') || !directory) {
    console.error('Brug: node scripts/prepare-local-semantic-model.mjs --directory /absolut/modelmappe --accept-public-download');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await prepareLocalSemanticModel(directory, { allowPublicDownload: process.argv.includes('--accept-public-download') }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
