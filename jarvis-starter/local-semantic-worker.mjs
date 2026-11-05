import { performance } from 'node:perf_hooks';
import { isAbsolute } from 'node:path';
import { LOCAL_SEMANTIC_MODEL as MODEL, verifyLocalSemanticModel } from './semantic-model-manifest.mjs';

// The inference worker never downloads assets, sends texts to an API or executes
// custom code from a model repository. The explicit preparation script is separate.
globalThis.fetch = async () => { throw new Error('Netværk er deaktiveret for lokal semantisk søgning.'); };
globalThis.WebSocket = class { constructor() { throw new Error('Netværk er deaktiveret for lokal semantisk søgning.'); } };
const send = message => {
  if (process.connected) process.send({ ...message, rssBytes: process.memoryUsage().rss }, error => { if (error) process.exit(1); });
};
process.once('disconnect', () => process.exit(0));
// Private IPC, not a command-line path or an inherited environment variable.
if (!process.send) throw new Error('Lokal modelproces kræver en privat IPC-forbindelse.');
const initialization = await new Promise(resolve => process.once('message', resolve));

try {
  if (initialization?.type !== 'initialize' || typeof initialization.directory !== 'string' || !isAbsolute(initialization.directory))
    throw Object.assign(new Error('Ugyldig lokal modelsti.'), { code: 'SEMANTIC_MODEL_UNAVAILABLE' });
  const verified = await verifyLocalSemanticModel(initialization.directory);
  const { env, pipeline } = await import('./local-semantic-runtime/loader.mjs');
  if (env.version !== MODEL.runtimeVersion) throw Object.assign(new Error('Forkert modelruntime.'), { code: 'SEMANTIC_RUNTIME_VERSION' });
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.useFSCache = false;
  const extractor = await pipeline('feature-extraction', verified.directory, {
    device: 'cpu', dtype: MODEL.dtype, local_files_only: true,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: 'sequential' },
  });
  send({ type: 'ready', model: MODEL.id, revision: MODEL.revision,
    runtimeVersion: env.version, manifestSha256: verified.manifestSha256, modelBytes: verified.bytes });
  let running = false;
  process.on('message', async message => {
    const { id, texts, kind } = message || {};
    if (running || !Number.isSafeInteger(id) || !Array.isArray(texts) || !texts.length || texts.length > 16 ||
        !['query', 'passage'].includes(kind) || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 4000)) {
      send({ type: 'error', id, code: 'SEMANTIC_INVALID_REQUEST' });
      return;
    }
    running = true;
    const start = performance.now();
    try {
      const output = await extractor(texts.map(text => `${kind}: ${text}`), { pooling: MODEL.pooling, normalize: true });
      const vectors = output.tolist();
      if (vectors.length !== texts.length || vectors.some(row => row.length !== MODEL.dimensions || row.some(x => !Number.isFinite(x))))
        throw new Error('Modellen leverede en ugyldig vektor.');
      send({ type: 'result', id, vectors, inferenceMs: performance.now() - start });
    } catch {
      // Do not expose provider error strings, which could contain input text.
      send({ type: 'error', id, code: 'SEMANTIC_INFERENCE_FAILED' });
    } finally { running = false; }
  });
} catch (error) {
  const allowedCodes = ['SEMANTIC_MODEL_UNAVAILABLE', 'SEMANTIC_MODEL_INTEGRITY', 'SEMANTIC_RUNTIME_VERSION'];
  send({ type: 'unavailable', code: allowedCodes.includes(error.code) ? error.code : 'SEMANTIC_RUNTIME_UNAVAILABLE' });
  process.disconnect();
}
