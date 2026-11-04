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

/**
 * Revision-aware embeddings cache. An embedding implementation must be selected
 * explicitly; by default JARVIS continues to use its local lexical search.
 * Documents passed here have already passed active-source and privacy filtering.
 */
export class IncrementalSemanticIndex {
  constructor({ embed, external = false, allowExternal = false } = {}) {
    if (typeof embed !== 'function') throw new Error('Der er ikke valgt en embeddingmodel.');
    if (external && !allowExternal) throw new Error('Ekstern indeksering kræver et eksplicit tilvalg.');
    this.embed = embed;
    this.external = external;
    this.cache = new Map();
  }

  async score(query, documents) {
    if (!Array.isArray(documents) || documents.length > 2000 || typeof query !== 'string' || query.length > 240)
      throw new Error('Ugyldige semantiske søgeinput.');
    const available = new Set(documents.map(item => item.id));
    // Remove archived, expired and otherwise filtered documents immediately.
    for (const id of this.cache.keys()) if (!available.has(id)) this.cache.delete(id);
    for (const doc of documents) {
      if (typeof doc.id !== 'string' || typeof doc.text !== 'string' || doc.text.length > 4000)
        throw new Error('Ugyldigt indekseringsdokument.');
      const key = `${doc.revision || 0}:${digest(doc.text)}`;
      if (this.cache.get(doc.id)?.key === key) continue;
      const embedding = vector(await this.embed(doc.text));
      this.cache.set(doc.id, { key, embedding });
    }
    const queryVector = vector(await this.embed(query));
    return Object.fromEntries(documents.map(doc => [doc.id, similarity(queryVector, this.cache.get(doc.id).embedding)]));
  }

  stats() { return { cachedDocuments: this.cache.size, provider: this.external ? 'external-opt-in' : 'local' }; }
}
