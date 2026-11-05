import { createHash } from 'node:crypto';

function vector(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new Error('Embedding skal være en numerisk vektor.');
  const result = Array.from(value);
  if (!result.length || result.length > 4096 || result.some(number => typeof number !== 'number' || !Number.isFinite(number)))
    throw new Error('Embedding indeholder ugyldige værdier.');
  return result;
}

function similarity(a, b) {
  if (a.length !== b.length) throw new Error('Embeddingdimensioner stemmer ikke.');
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return x && y ? Math.max(0, Math.min(1, dot / Math.sqrt(x * y))) : 0;
}

const digest = value => createHash('sha256').update(value).digest('hex');
const aborted = () => Object.assign(new Error('Semantisk søgning blev afbrudt.'), { code: 'SEMANTIC_CANCELLED' });

/**
 * Revision-aware, bounded, in-memory embeddings cache. Only an explicitly chosen
 * embedding implementation is called. Personal texts/vectors are never persisted.
 * Newer source revisions win even if an older inference finishes afterwards.
 */
export class IncrementalSemanticIndex {
  constructor({ embed, embedBatch, external = false, allowExternal = false, batchSize = 8, maxPending = 4 } = {}) {
    if (typeof embed !== 'function' && typeof embedBatch !== 'function') throw new Error('Der er ikke valgt en embeddingmodel.');
    if (external && !allowExternal) throw new Error('Ekstern indeksering kræver et eksplicit tilvalg.');
    this.embed = embed;
    this.embedBatch = embedBatch;
    this.external = external;
    this.batchSize = Math.max(1, Math.min(16, Number(batchSize) || 8));
    this.maxPending = Math.max(1, Math.min(16, Number(maxPending) || 4));
    this.cache = new Map(); this.wanted = new Map(); this.queue = []; this.running = false;
    this.counts = { embeddedDocuments: 0, embeddedQueries: 0 };
  }

  score(query, documents, { signal } = {}) {
    if (!Array.isArray(documents) || documents.length > 2000 || typeof query !== 'string' || !query.trim() || query.length > 240)
      return Promise.reject(new Error('Ugyldige semantiske søgeinput.'));
    if (signal?.aborted) return Promise.reject(aborted());
    const ids = new Set();
    const snapshot = [];
    for (const doc of documents) {
      if (typeof doc?.id !== 'string' || !doc.id || doc.id.length > 240 || ids.has(doc.id) ||
          typeof doc.text !== 'string' || !doc.text.trim() || doc.text.length > 4000)
        return Promise.reject(new Error('Ugyldigt indekseringsdokument.'));
      ids.add(doc.id);
      snapshot.push({ id: doc.id, text: doc.text, key: `${doc.revision || 0}:${digest(doc.text)}` });
    }
    // Prune immediately, not after an awaited inference. In-flight older work
    // may finish but cannot repopulate a removed/revised document in the cache.
    this.wanted = new Map(snapshot.map(doc => [doc.id, doc.key]));
    for (const [id, cached] of this.cache) if (this.wanted.get(id) !== cached.key) this.cache.delete(id);
    if (!snapshot.length) return Promise.resolve({});
    if (this.queue.length >= this.maxPending) return Promise.reject(Object.assign(new Error('Semantikkøen er fuld.'), { code: 'SEMANTIC_QUEUE_FULL' }));
    const result = new Promise((resolve, reject) => {
      const row = { query, snapshot, signal, resolve, reject, started: false };
      row.onAbort = () => {
        if (row.started) return; // the running provider receives the same signal
        this.queue = this.queue.filter(item => item !== row);
        row.snapshot = []; reject(aborted());
      };
      signal?.addEventListener('abort', row.onAbort, { once: true });
      this.queue.push(row);
    });
    void this.drain();
    return result;
  }

  async embeddings(texts, kind, signal) {
    if (signal?.aborted) throw aborted();
    const raw = this.embedBatch ? await this.embedBatch(texts, { kind, signal })
      : await Promise.all(texts.map(text => this.embed(text, { kind, signal })));
    if (signal?.aborted) throw aborted();
    if (!Array.isArray(raw) || raw.length !== texts.length) throw new Error('Modellen returnerede et forkert antal embeddings.');
    return raw.map(vector);
  }

  async run(row) {
    const local = new Map();
    for (let offset = 0; offset < row.snapshot.length; offset += this.batchSize) {
      if (row.signal?.aborted) throw aborted();
      const batch = row.snapshot.slice(offset, offset + this.batchSize).filter(doc => this.wanted.get(doc.id) === doc.key);
      const missing = batch.filter(doc => this.cache.get(doc.id)?.key !== doc.key);
      if (missing.length) {
        const values = await this.embeddings(missing.map(doc => doc.text), 'passage', row.signal);
        this.counts.embeddedDocuments += missing.length;
        for (let index = 0; index < missing.length; index++) {
          const doc = missing[index];
          if (this.wanted.get(doc.id) === doc.key) this.cache.set(doc.id, { key: doc.key, embedding: values[index] });
        }
      }
      for (const doc of batch) {
        const entry = this.cache.get(doc.id);
        if (entry?.key === doc.key) local.set(doc.id, entry);
      }
    }
    if (!local.size) return {};
    const queryVector = (await this.embeddings([row.query], 'query', row.signal))[0];
    this.counts.embeddedQueries++;
    return Object.fromEntries([...local].filter(([id, entry]) => this.wanted.get(id) === entry.key)
      .map(([id, entry]) => [id, similarity(queryVector, entry.embedding)]));
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const row = this.queue.shift(); row.started = true;
        try { row.resolve(await this.run(row)); }
        catch (error) { row.reject(error); }
        finally { row.signal?.removeEventListener('abort', row.onAbort); row.snapshot = []; }
      }
    } finally { this.running = false; }
  }

  stats() { return { cachedDocuments: this.cache.size, provider: this.external ? 'external-opt-in' : 'local',
    running: this.running, queued: this.queue.length, ...this.counts }; }
}
