import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { isAbsolute } from 'node:path';
import { LOCAL_SEMANTIC_MODEL, LOCAL_SEMANTIC_MANIFEST_SHA256 } from './semantic-model-manifest.mjs';

const failure = (code, message = 'Lokal semantisk søgning er midlertidigt utilgængelig.') => Object.assign(new Error(message), { code });
const abortError = () => failure('SEMANTIC_CANCELLED', 'Semantisk søgning blev afbrudt.');

/** Explicit local-only capability. Construction does not start work or networking. */
export class LocalSemanticProvider {
  constructor({ directory, maxPending = 4, requestTimeoutMs = 10_000, startupTimeoutMs = 60_000, workerFactory } = {}) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) throw failure('SEMANTIC_MODEL_UNAVAILABLE', 'Vælg en lokal modelmappe først.');
    this.directory = directory;
    this.maxPending = Math.max(1, Math.min(16, Number(maxPending) || 4));
    this.requestTimeoutMs = Math.max(50, Math.min(60_000, Number(requestTimeoutMs) || 10_000));
    this.startupTimeoutMs = Math.max(50, Math.min(60_000, Number(startupTimeoutMs) || 60_000));
    this.workerFactory = workerFactory || (() => new Worker(new URL('./local-semantic-worker.mjs', import.meta.url), {
      workerData: { directory }, resourceLimits: { maxOldGenerationSizeMb: 512 }, execArgv: [],
      stdout: true, stderr: true,
      // The local encoder does not need inherited integration credentials.
      env: {},
    }));
    this.queue = []; this.active = null; this.worker = null; this.readyPromise = null;
    this.sequence = 0; this.closed = false; this.state = 'not-started'; this.failureCode = null;
    this.metrics = { requests: 0, embeddedTexts: 0, completed: 0, failed: 0, cancelled: 0,
      totalQueueMs: 0, totalInferenceMs: 0, maxQueueMs: 0, maxInferenceMs: 0 };
  }

  async prepare() {
    if (this.closed) throw failure('SEMANTIC_CLOSED');
    if (this.readyPromise) return this.readyPromise;
    this.state = 'loading'; this.failureCode = null;
    this.readyPromise = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      let worker;
      try { worker = this.worker = this.workerFactory(); }
      catch { this.failWorker(failure('SEMANTIC_WORKER_FAILED')); return; }
      const startup = setTimeout(() => this.failWorker(failure('SEMANTIC_STARTUP_TIMEOUT')), this.startupTimeoutMs);
      worker.on('message', message => {
        if (worker !== this.worker) return;
        if (message?.type === 'ready') {
          clearTimeout(startup); this.state = 'ready'; this.rejectReady = null;
          resolve(this.stats()); this.drain();
        } else if (message?.type === 'unavailable') {
          clearTimeout(startup); this.failWorker(failure(message.code || 'SEMANTIC_RUNTIME_UNAVAILABLE'));
        } else if (message?.id === this.active?.id) {
          const row = this.active;
          if (message.type === 'result') {
            const valid = Array.isArray(message.vectors) && message.vectors.length === row.texts.length &&
              message.vectors.every(vector => Array.isArray(vector) && vector.length === LOCAL_SEMANTIC_MODEL.dimensions && vector.every(Number.isFinite));
            if (!valid) { this.failWorker(failure('SEMANTIC_INVALID_VECTOR')); return; }
            const ms = Math.max(0, Number(message.inferenceMs) || 0);
            this.metrics.totalInferenceMs += ms; this.metrics.maxInferenceMs = Math.max(this.metrics.maxInferenceMs, ms);
            this.metrics.completed++; this.metrics.embeddedTexts += row.texts.length;
            this.finish(row, null, message.vectors);
          } else {
            this.metrics.failed++; this.finish(row, failure('SEMANTIC_INFERENCE_FAILED'));
          }
          this.drain();
        }
      });
      worker.on('error', () => { clearTimeout(startup); if (worker === this.worker) this.failWorker(failure('SEMANTIC_WORKER_FAILED')); });
      worker.on('exit', () => { clearTimeout(startup); if (worker === this.worker) this.failWorker(failure('SEMANTIC_WORKER_STOPPED')); });
      // Consume diagnostic streams without logging potentially sensitive text.
      worker.stdout?.resume(); worker.stderr?.resume();
    });
    this.readyPromise.catch(() => { if (!this.worker) this.readyPromise = null; });
    return this.readyPromise;
  }

  embedBatch(texts, { kind = 'passage', signal } = {}) {
    if (this.closed) return Promise.reject(failure('SEMANTIC_CLOSED'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!['query', 'passage'].includes(kind) || !Array.isArray(texts) || !texts.length || texts.length > 16 ||
        texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 4000)) return Promise.reject(failure('SEMANTIC_INVALID_REQUEST'));
    if (this.queue.length >= this.maxPending) return Promise.reject(failure('SEMANTIC_QUEUE_FULL', 'Semantikkøen er fuld; lokal ordsøgning bruges.'));
    this.metrics.requests++;
    const result = new Promise((resolve, reject) => {
      const row = { id: ++this.sequence, texts: [...texts], kind, signal, resolve, reject, queuedAt: performance.now(), timer: null };
      row.onAbort = () => {
        this.metrics.cancelled++;
        if (this.active === row) {
          // Cancellation of an executing read can safely discard its worker.
          this.failWorker(abortError());
        } else {
          this.queue = this.queue.filter(item => item !== row); this.finish(row, abortError());
        }
      };
      signal?.addEventListener('abort', row.onAbort, { once: true });
      this.queue.push(row);
    });
    this.prepare().then(() => this.drain(), () => {});
    return result;
  }

  async embed(text, options = {}) { return (await this.embedBatch([text], options))[0]; }

  drain() {
    if (this.active || this.state !== 'ready' || !this.queue.length || !this.worker) return;
    const row = this.active = this.queue.shift();
    const queueMs = performance.now() - row.queuedAt;
    this.metrics.totalQueueMs += queueMs; this.metrics.maxQueueMs = Math.max(this.metrics.maxQueueMs, queueMs);
    row.timer = setTimeout(() => this.failWorker(failure('SEMANTIC_INFERENCE_TIMEOUT')), this.requestTimeoutMs);
    this.worker.postMessage({ id: row.id, texts: row.texts, kind: row.kind });
  }

  finish(row, error, vectors) {
    clearTimeout(row.timer); row.signal?.removeEventListener('abort', row.onAbort);
    if (this.active === row) this.active = null;
    row.texts = [];
    if (error) row.reject(error); else row.resolve(vectors);
  }

  failWorker(error) {
    const worker = this.worker; this.worker = null;
    this.state = this.closed ? 'closed' : 'unavailable'; this.failureCode = error.code || 'SEMANTIC_UNAVAILABLE';
    this.rejectReady?.(error); this.rejectReady = null; this.readyPromise = null;
    if (this.active) this.finish(this.active, error);
    for (const row of this.queue.splice(0)) this.finish(row, error);
    return worker?.terminate().catch(() => {});
  }

  stats() {
    return { status: this.state, provider: 'local', model: LOCAL_SEMANTIC_MODEL.id,
      modelRevision: LOCAL_SEMANTIC_MODEL.revision, runtimeVersion: LOCAL_SEMANTIC_MODEL.runtimeVersion,
      manifestSha256: LOCAL_SEMANTIC_MANIFEST_SHA256, network: 'disabled',
      running: Boolean(this.active), queued: this.queue.length, failureCode: this.failureCode, ...this.metrics };
  }

  async close() { this.closed = true; await this.failWorker(failure('SEMANTIC_CLOSED')); }
}
