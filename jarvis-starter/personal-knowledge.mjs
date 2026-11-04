// Lokal, kildebevidst retrieval over JARVIS' allerede gemte personlige data.
// Ingen embeddings, netværkskald eller lagring af et sekundært indeks som standard.

const STOP = new Set('jeg mig min mine mit du din dine dit det den der de er var har havde kan skal vil hvad hvem hvor hvornår hvordan og eller af fra for med som til på om i at en et også lige noget nogle hos'.split(' '));

function terms(value) {
  return [...new Set(String(value || '').toLocaleLowerCase('da-DK').match(/[\p{L}\p{N}]{2,}/gu) || [])]
    .filter(word => !STOP.has(word)).slice(0, 35);
}

function checkedSearch(query, limit) {
  if (typeof query !== 'string' || !query.trim() || query.length > 240) throw new Error('Søgningen skal være 1–240 tegn.');
  return Math.max(1, Math.min(20, Number(limit) || 6));
}

function makeDocument(id, type, label, text, source, updatedAt = '') {
  return { id, type, label: String(label).slice(0, 100), text: String(text).slice(0, 1600),
    source, updatedAt: typeof updatedAt === 'string' ? updatedAt.slice(0, 30) : '' };
}

export function indexPersonalKnowledge(state) {
  const documents = [];
  for (const memory of (state.memories || []).filter(item => !item.archived).slice(0, 200)) {
    if (!memory.id || typeof memory.text !== 'string') continue;
    documents.push(makeDocument(`memory:${memory.id}`, 'memory', 'Hukommelse', memory.text,
      { kind: 'memory', id: memory.id }, memory.updatedAt || memory.createdAt));
  }
  for (const collection of (state.organizer || []).filter(item => !item.archived).slice(0, 80)) {
    for (const item of (collection.items || []).slice(0, 200)) {
      if (!item.id || typeof item.text !== 'string') continue;
      documents.push(makeDocument(`organizer:${collection.id}:${item.id}`, 'organizer', collection.title,
        `${item.text}${item.notes ? ` · ${item.notes}` : ''}${item.date ? ` · Dato ${item.date}${item.annual ? ' (årligt)' : ''}` : ''}${item.done ? ' · Afkrydset' : ''}`,
        { kind: 'organizer', collectionId: collection.id, itemId: item.id }, item.updatedAt));
    }
  }
  for (const task of (state.tasks || []).filter(item => !item.archived).slice(0, 150)) {
    if (!task.id || !task.title) continue;
    documents.push(makeDocument(`task:${task.id}`, 'task', 'Opgave',
      `${task.title} · Status: ${task.status || 'ukendt'} · ${task.prompt || ''}`,
      { kind: 'task', id: task.id }, task.updatedAt || task.createdAt));
  }
  for (const project of (state.projects || []).filter(item => !item.archived).slice(0, 100)) {
    if (!project.id || !project.title) continue;
    documents.push(makeDocument(`project:${project.id}`, 'project', 'Projekt',
      `${project.title} · ${project.description || ''} · Revision ${project.revision || 'ukendt'}`,
      { kind: 'project', id: project.id }, project.updatedAt || project.createdAt));
  }
  // Samtalehistorik, logfiler, .env og eksterne dokumenter bliver ikke indekseret.
  return documents;
}

function lexicalResults(query, documents) {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  const documentTerms = documents.map(doc => terms(`${doc.label} ${doc.text}`));
  const frequencies = new Map(queryTerms.map(term => [term, documentTerms.filter(list => list.includes(term)).length]));
  const averageLength = Math.max(1, documentTerms.reduce((sum, list) => sum + list.length, 0) / Math.max(1, documents.length));
  const loweredQuery = String(query).trim().toLocaleLowerCase('da-DK');
  return documents.map((doc, index) => {
    const words = documentTerms[index];
    let score = 0;
    for (const term of queryTerms) {
      const hits = words.filter(word => word === term).length;
      const close = hits ? 0 : words.some(word => word.startsWith(term) || term.startsWith(word) && word.length >= 4) ? 0.35 : 0;
      const count = hits || close;
      if (!count) continue;
      const idf = Math.log(1 + (documents.length - (frequencies.get(term) || 0) + 0.5) / ((frequencies.get(term) || 0) + 0.5));
      score += idf * (count * 2.2 / (count + 1.2 * (0.25 + 0.75 * words.length / averageLength)));
    }
    if (loweredQuery.length >= 3 && `${doc.label} ${doc.text}`.toLocaleLowerCase('da-DK').includes(loweredQuery)) score += 3;
    if (queryTerms.some(term => doc.label.toLocaleLowerCase('da-DK').includes(term))) score += 0.5;
    return { ...doc, score: Number(score.toFixed(3)) };
  }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export class PersonalKnowledge {
  constructor({ state, semanticScorer = null }) {
    this.state = state;
    this.semanticScorer = semanticScorer;
  }

  search(query, { limit = 6, types } = {}) {
    const boundedLimit = checkedSearch(query, limit);
    const documents = indexPersonalKnowledge(this.state).filter(doc => !types || types.includes(doc.type));
    return lexicalResults(query, documents).slice(0, boundedLimit);
  }

  // Et fremtidigt embeddings-adapter kan levere scores for de SAMME godkendte dokument-ID'er.
  // Adapteren må ikke tilføje dokumenter, og fraværet af adapter er aldrig en fejl.
  async searchHybrid(query, options = {}) {
    const boundedLimit = checkedSearch(query, options.limit);
    const documents = indexPersonalKnowledge(this.state).filter(doc => !options.types || options.types.includes(doc.type));
    const lexical = lexicalResults(query, documents);
    if (!this.semanticScorer) return lexical.slice(0, boundedLimit);
    const semantic = await this.semanticScorer(query, documents.map(({ id, text }) => ({ id, text })));
    if (!semantic || typeof semantic !== 'object') return lexical.slice(0, boundedLimit);
    const byId = new Map(lexical.map(doc => [doc.id, doc.score]));
    const best = documents.map(doc => {
      const boundedSemantic = Math.max(0, Math.min(1, Number(semantic[doc.id]) || 0));
      return { ...doc, score: Number(((byId.get(doc.id) || 0) + boundedSemantic * 2).toFixed(3)) };
    }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return best.slice(0, boundedLimit);
  }

  context(query) {
    return this.search(query, { limit: 6 })
      .map(doc => `[${doc.id} · ${doc.label}${doc.updatedAt ? ` · opdateret ${doc.updatedAt}` : ''}] ${doc.text}`)
      .join('\n').slice(0, 5200);
  }
}
