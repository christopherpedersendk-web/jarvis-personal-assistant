// Lokal, kildebevidst retrieval over JARVIS' allerede gemte personlige data.
// Ingen embeddings, netværkskald eller lagring af et sekundært indeks som standard.
import { activePersonalMemory } from './secretary-core.mjs';

const STOP = new Set('jeg mig min mine mit du din dine dit det den der de er var har havde kan skal vil hvad hvem hvor hvornår hvordan og eller af fra for med som til på om i at en et også lige noget nogle hos'.split(' '));

function terms(value, max = 600) {
  return (String(value || '').normalize('NFKC').toLocaleLowerCase('da-DK').match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter(word => !STOP.has(word)).slice(0, max);
}

function checkedSearch(query, limit) {
  if (typeof query !== 'string' || !query.trim() || query.length > 240) throw new Error('Søgningen skal være 1–240 tegn.');
  return Math.max(1, Math.min(20, Number(limit) || 6));
}

function makeDocument(id, type, label, text, source, updatedAt = '') {
  return { id, type, label: String(label).slice(0, 100), text: String(text).slice(0, 1600),
    source, updatedAt: typeof updatedAt === 'string' ? updatedAt.slice(0, 30) : '' };
}

function childSummary(children) {
  const list = Array.isArray(children) ? children : [];
  return `${list.length} børn${list.length ? ` (aldre: ${list.map(x => Number.isInteger(x.age) ? x.age : 'ikke oplyst').join(', ')})` : ''}`;
}

function checkedTypes(types) {
  if (types === undefined) return null;
  if (!Array.isArray(types) || types.length > 10 || types.some(x => !['memory', 'organizer', 'task', 'project', 'meal-profile', 'meal-plan', 'household', 'recipe'].includes(x))) {
    throw new Error('Ugyldige personlige kildetyper.');
  }
  return types;
}

export function indexPersonalKnowledge(state, { now = new Date() } = {}) {
  const documents = [];
  for (const memory of (state.memories || []).filter(item => activePersonalMemory(item, now)).slice(0, 200)) {
    if (!memory.id || typeof memory.text !== 'string') continue;
    documents.push({ ...makeDocument(`memory:${memory.id}`, 'memory', 'Hukommelse', memory.text,
      { kind: 'memory', id: memory.id, revision: memory.revision || 1, category: memory.category || 'fact',
        provenance: memory.source ? { kind: memory.source.kind, channel: memory.source.channel } : { kind: 'legacy', channel: 'legacy' } },
      memory.updatedAt || memory.createdAt), confirmation: 'user-confirmed', expiresAt: memory.expiresAt || null });
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
  if (state.mealProfile?.source === 'user-entered') {
    const profile = state.mealProfile;
    documents.push(makeDocument('meal-profile:current', 'meal-profile', 'Madpræferencer',
      `${state.mealHousehold?.configured ? 'Fremmøde styres i husstandskalenderen' : `Standardportionsantal ${profile.householdSize}; ikke bekræftet fremmøde pr. dag`} · Kost ${profile.diet} · Budget ${profile.budgetDkk ?? 'ikke angivet'} DKK · Undgå: ${(profile.avoid || []).join(', ') || 'intet angivet'} · Lager: ${(profile.pantry || []).map(x => `${x.name} ${x.quantity} ${x.unit}`).join(', ') || 'ikke angivet'}`,
      { kind: 'meal-profile' }, profile.updatedAt));
  }
  const household = state.mealHousehold;
  if (household?.configured === true && Number.isInteger(household.adults)) {
    documents.push({ ...makeDocument('household:default', 'household', 'Husstandens standard',
      `${household.adults} voksne · ${childSummary(household.children)}. Dette er brugerens standard; konkrete datoer kan have andet fremmøde. Børneportioner er redigerbare planlægningsskøn.`,
      { kind: 'household', revision: household.revision || 1 }, household.updatedAt), confirmation: 'user-confirmed' });
  }
  for (const [date, day] of Object.entries(household?.days || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-90)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || !Number.isInteger(day.adults) || !Array.isArray(day.children)) continue;
    documents.push({ ...makeDocument(`household:${date}`, 'household', 'Husstand på dato',
      `${date}: ${day.adults} voksne · ${childSummary(day.children)} · Tema: ${day.theme || 'everyday'}${day.skip ? ' · Spiser ikke hjemme' : ''}. Registreret af brugeren, ikke udledt af kalenderaftaler.`,
      { kind: 'household-day', date, revision: household.revision || 1 }, household.updatedAt), confirmation: 'user-confirmed' });
  }
  for (const recipe of (state.recipes || []).filter(x => x && !x.archived && x.status === 'confirmed' && x.confirmed !== false).slice(0, 200)) {
    if (!recipe.id || typeof recipe.title !== 'string' || !Array.isArray(recipe.ingredients)) continue;
    documents.push({ ...makeDocument(`recipe:${recipe.id}`, 'recipe', 'Gemt opskrift',
      `${recipe.title} · Kost: ${recipe.diet} · ${recipe.minutes ?? '?'} minutter · ${recipe.servings ?? '?'} portioner · Temaer: ${(recipe.themes || []).join(', ')} · Ingredienser: ${recipe.ingredients.map(x => `${x.name} ${x.quantity} ${x.unit}`).join('; ')}`,
      { kind: 'recipe', id: recipe.id, revision: recipe.revision || 1, channel: recipe.source?.channel || 'manual' }, recipe.updatedAt || recipe.createdAt),
      confirmation: 'user-reviewed' });
  }
  const currentRecipes = new Map((state.recipes || []).filter(x => x && !x.archived && x.status === 'confirmed' && x.confirmed !== false).map(x => [x.id, x]));
  for (const plan of (state.mealPlans || []).filter(x => x && !x.archived && !x.recipeStale).slice(0, 12)) {
    if (!plan.id || !Array.isArray(plan.dishes)) continue;
    // A retained plan snapshot must not resurrect a forgotten recipe, even if
    // invalidation was interrupted before its recipeStale flag was persisted.
    if (plan.dishes.some(dish => (dish.sourceRefs || []).some(ref => ref.kind === 'recipe' &&
        (!currentRecipes.has(ref.id) || ref.revision && ref.revision !== (currentRecipes.get(ref.id).revision || 1))))) continue;
    documents.push(makeDocument(`meal-plan:${plan.id}`, 'meal-plan', 'Madplan',
      `${plan.startDate} · Status: ${plan.status || 'draft'}${plan.needsReview || plan.householdStale || plan.profileStale ? ' · Skal gennemgås igen' : ''} · ${plan.dishes.map(x => `${x.date}: ${x.skip ? 'Spiser ude / springes over' : x.title}${x.theme ? ` (${x.theme})` : ''}`).join('; ')}`,
      { kind: 'meal-plan', id: plan.id, revision: plan.revision || 1 }, plan.updatedAt || plan.createdAt));
  }
  // Samtalehistorik, logfiler, .env, kalenderdetaljer, rå websider og
  // ubekræftede opskrifter bliver ikke indekseret. Intet sekundært indeks
  // betyder at en rettelse/arkivering virker allerede ved næste søgning.
  return documents;
}

function lexicalResults(query, documents) {
  const queryTerms = [...new Set(terms(query, 80))].slice(0, 35);
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
  }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score ||
    Number(Boolean(b.confirmation)) - Number(Boolean(a.confirmation)) ||
    (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
}

export class PersonalKnowledge {
  constructor({ state, semanticScorer = null, now = () => new Date() }) {
    this.state = state;
    this.semanticScorer = semanticScorer;
    this.now = now;
  }

  search(query, { limit = 6, types } = {}) {
    const boundedLimit = checkedSearch(query, limit);
    const allowedTypes = checkedTypes(types);
    const documents = indexPersonalKnowledge(this.state, { now: this.now() }).filter(doc => !allowedTypes || allowedTypes.includes(doc.type));
    return lexicalResults(query, documents).slice(0, boundedLimit);
  }

  // Et fremtidigt embeddings-adapter kan levere scores for de SAMME godkendte dokument-ID'er.
  // Adapteren må ikke tilføje dokumenter, og fraværet af adapter er aldrig en fejl.
  async searchHybrid(query, options = {}) {
    const boundedLimit = checkedSearch(query, options.limit);
    const allowedTypes = checkedTypes(options.types);
    const documents = indexPersonalKnowledge(this.state, { now: this.now() }).filter(doc => !allowedTypes || allowedTypes.includes(doc.type));
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
      .map(doc => `[${doc.id} · ${doc.label}${doc.source.revision ? ` · revision ${doc.source.revision}` : ''}${doc.updatedAt ? ` · opdateret ${doc.updatedAt}` : ''}] ${doc.text}`)
      .join('\n').slice(0, 5200);
  }
}
