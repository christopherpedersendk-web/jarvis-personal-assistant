import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

// Public, immutable model data, not executable model code. Provenance:
// https://huggingface.co/Xenova/multilingual-e5-small/tree/0b7ea4d6ad2e9d527e013a65b805a4b4df72f648
// Pooling/prefix contract: https://huggingface.co/intfloat/multilingual-e5-small
// Runtime API checked against the official huggingface/transformers.js 3.8.1 tag.
export const LOCAL_SEMANTIC_MODEL = Object.freeze({
  id: 'Xenova/multilingual-e5-small',
  revision: '0b7ea4d6ad2e9d527e013a65b805a4b4df72f648',
  runtime: '@huggingface/transformers', runtimeVersion: '3.8.1',
  dimensions: 384, dtype: 'q8', pooling: 'mean', maxTokens: 512,
  files: Object.freeze([
    Object.freeze({ path: 'config.json', bytes: 658,
      sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' }),
    Object.freeze({ path: 'tokenizer_config.json', bytes: 443,
      sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' }),
    Object.freeze({ path: 'tokenizer.json', bytes: 17082730,
      sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' }),
    Object.freeze({ path: 'onnx/model_quantized.onnx', bytes: 118308185,
      sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' }),
  ]),
});

export const LOCAL_SEMANTIC_MANIFEST_SHA256 = createHash('sha256')
  .update(JSON.stringify(LOCAL_SEMANTIC_MODEL)).digest('hex');

function modelError(message, code = 'SEMANTIC_MODEL_UNAVAILABLE') {
  return Object.assign(new Error(message), { code });
}

export async function verifyLocalSemanticModel(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw modelError('Den lokale sprogmodel kræver en absolut mappesti.');
  }
  const root = await realpath(directory).catch(() => { throw modelError('Den lokale sprogmodel er ikke installeret.'); });
  if (!(await lstat(directory)).isDirectory()) throw modelError('Modelmappen skal være en almindelig mappe, ikke et link.');
  let bytes = 0;
  for (const file of LOCAL_SEMANTIC_MODEL.files) {
    const path = join(root, file.path);
    const resolved = await realpath(path).catch(() => { throw modelError(`Modelfilen ${file.path} mangler.`); });
    const inside = relative(root, resolved);
    const metadata = await lstat(path);
    if (!inside || inside.startsWith(`..${sep}`) || isAbsolute(inside) || !metadata.isFile() || metadata.isSymbolicLink() || resolved !== path) {
      throw modelError('Modeldata må ikke pege uden for den godkendte modelmappe.', 'SEMANTIC_MODEL_INTEGRITY');
    }
    if (metadata.size !== file.bytes) throw modelError(`Modelfilen ${file.path} har forkert størrelse.`, 'SEMANTIC_MODEL_INTEGRITY');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256) throw modelError(`Modelfilen ${file.path} har forkert indholdshash.`, 'SEMANTIC_MODEL_INTEGRITY');
    bytes += metadata.size;
  }
  return { directory: root, bytes, model: LOCAL_SEMANTIC_MODEL.id,
    revision: LOCAL_SEMANTIC_MODEL.revision, manifestSha256: LOCAL_SEMANTIC_MANIFEST_SHA256 };
}
