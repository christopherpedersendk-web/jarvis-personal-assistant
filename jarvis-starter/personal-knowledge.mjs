// Lokal, kildebevidst retrieval over JARVIS' allerede gemte personlige data.
// Ingen modeldownload, ekstern indeksering eller diskbaseret sekundært indeks.
// En eksplicit valgt lokal model kan supplere den altid tilgængelige ordsøgning.
import { activePersonalMemory } from './secretary-core.mjs';
import { currentClaim, claimConflicts } from './personal-claims.mjs';
import { containsSecret } from './privacy.mjs';
import { resolveHouseholdAttendance } from './meal-planner.mjs';

// Function words are not identifying evidence. Keep negation/boundary words
// such as ikke, aldrig, ingen, uden and kun: removing them can reverse meaning.
const STOP = new Set(('jeg mig min mine mit du din dine dit det den der de er var har havde kan skal vil hvad hvem hvor hvornår hvordan ' +
  'hvilken hvilket hvilke bør må kunne ville skulle være været blive bliver blev meget mest mere mindre lidt få får fået ved ' +
  'dem han hun vi vores jer jeres sig sin sine sit denne dette disse så end helst gerne og eller af fra for med som til på om i at en et også lige noget nogle hos').split(' '));

export const HYBRID_RETRIEVAL_STRATEGY = 'semantic-primary-exact-lexical-4-to-1-v1';

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
  return `${list.length} børn${list.length ? ` (${list.map(x => `${Number.isInteger(x.age) ? `${x.age} år` : 'alder ikke oplyst'}${x.ageRecordedAt ? ` registreret ${x.ageRecordedAt}` : ''}; portionsfaktor ${x.portion ?? 'ikke oplyst'}`).join(', ')})` : ''}`;
}

function attendanceSummary(attendance) {
  const guests = attendance.guests || { adults: 0, children: [] };
  return `${attendance.adults} voksne × ${attendance.adultPortion ?? 1} · ${childSummary(attendance.children)}` +
    `${guests.adults || guests.children.length ? ` · Gæster: ${guests.adults} voksne × ${guests.adultPortion ?? 1} og ${childSummary(guests.children)}` : ''}` +
    `${attendance.occasion === 'holiday' ? ' · Ferie' : attendance.occasion === 'absence' ? ' · Fravær' : ''}`;
}

function checkedTypes(types) {
  if (types === undefined) return null;
  if (!Array.isArray(types) || types.length > 12 || types.some(x => !['memory', 'organizer', 'task', 'personal-task', 'follow-up', 'project', 'meal-profile', 'meal-plan', 'household', 'recipe'].includes(x))) {
    throw new Error('Ugyldige personlige kildetyper.');
  }
  return types;
}

function checkedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dato skal være ÅÅÅÅ-MM-DD.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Ugyldig dato.');
  return value;
}

/** Structured records are authoritative for dates; text retrieval is not an attendance lookup. */
export function getRecordedHouseholdDay(state, date) {
  const key = checkedDate(date);
  const household = state.mealHousehold;
  const day = household?.days?.[key];
  if (!day || !Number.isInteger(day.adults) || !Array.isArray(day.children)) {
    return { date: key, recorded: false, source: null,
      note: 'Fremmøde er ikke registreret for denne dato. Husstandens standard er ikke bevis for dagens fremmøde.' };
  }
  const attendance = resolveHouseholdAttendance(household, key);
  return { date: key, recorded: true, adults: attendance.adults, children: structuredClone(attendance.children),
    adultPortion: attendance.adultPortion, guests: structuredClone(attendance.guests),
    occasion: attendance.occasion, servings: attendance.servings, skip: attendance.skip, theme: attendance.theme,
    meaning: 'Brugerregistreret planlægningsgrundlag; ikke bevis for faktisk tilstedeværelse eller spiste måltider.',
    source: { kind: 'household-day', date: key, revision: household.revision || 1 } };
}

/** Effective explicit planning basis; kept separate from the exact-date API. */
export function getEffectiveHouseholdDay(state, date) {
  const key = checkedDate(date);
  const attendance = resolveHouseholdAttendance(state.mealHousehold, key);
  const known = attendance.householdConfirmed;
  return { date: key, known, ...structuredClone(attendance),
    authority: known ? attendance.attendanceSource : null,
    source: known ? { kind: attendance.attendanceSource === 'day-override' ? 'household-day'
      : attendance.attendanceSource === 'recurring-rhythm' ? 'household-rhythm' : 'household',
      date: key, revision: state.mealHousehold.revision || 1 } : null,
    meaning: known ? 'Eksplicit registreret planlægningsgrundlag, ikke observeret tilstedeværelse. Dato undtager rytme, som undtager standard.'
      : 'Husstanden er ikke oplyst. Ingen fremmødeantagelse ud fra kalenderen.' };
}

function relevantHouseholdDates(days, now, max = 90) {
  const current = Date.parse(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(now)}T12:00:00Z`);
  return Object.entries(days || {}).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    // Favor nearby dates, particularly upcoming dates. A long future calendar
    // cannot push today/tomorrow out of the bounded model context.
    .sort(([a], [b]) => {
      const diffA = Math.abs(Date.parse(`${a}T12:00:00Z`) - current);
      const diffB = Math.abs(Date.parse(`${b}T12:00:00Z`) - current);
      return diffA - diffB || a.localeCompare(b);
    }).slice(0, max);
}

export function indexPersonalKnowledge(state, { now = new Date() } = {}) {
  const documents = [];
  const conflicting = new Set(claimConflicts(state, now).map(item => item.subject));
  for (const claim of (state.personalClaims || []).filter(item => currentClaim(item, now) && !conflicting.has(item.subject)).slice(0, 200)) {
    if (!claim.id || typeof claim.value !== 'string') continue;
    documents.push({ ...makeDocument(`claim:${claim.id}`, 'memory', 'Bekræftet oplysning',
      `${claim.subject}: ${claim.value}`, { kind: 'claim', id: claim.id, revision: claim.revision,
        category: claim.category, provenance: claim.source }, claim.updatedAt),
      confirmation: 'user-confirmed', expiresAt: claim.expiresAt || null });
  }
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
  for (const task of (state.personalTasks || []).filter(item => item.status !== 'archived').slice(0, 200)) {
    if (!task.id || !task.title) continue;
    documents.push(makeDocument(`personal-task:${task.id}`, 'personal-task', 'Personlig opgave',
      `${task.title} · Formål: ${task.purpose || ''} · Status: ${task.status} · Varighed: ${task.durationMinutes} minutter · Frist: ${task.deadline || 'ikke angivet'}`,
      { kind: 'personal-task', id: task.id, revision: task.revision, provenance: task.source }, task.updatedAt));
  }
  for (const follow of (state.followUpCases || []).filter(item => item.status === 'open').slice(0, 200)) {
    if (!follow.id || !follow.awaiting) continue;
    documents.push(makeDocument(`follow-up:${follow.id}`, 'follow-up', 'Åben opfølgning',
      `${follow.awaiting} · Næste kontrol: ${follow.nextCheckAt || 'ikke planlagt'} · Stopbetingelse: ${follow.stopCondition}`,
      { kind: 'follow-up', id: follow.id, revision: follow.revision, provenance: follow.source }, follow.updatedAt));
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
      `${attendanceSummary(household)}. Dette er brugerens standard; konkrete datoer kan have andet planlagt fremmøde. Portionsfaktorer er brugerens redigerbare planlægningsskøn, ikke forbrug.`,
      { kind: 'household', revision: household.revision || 1 }, household.updatedAt), confirmation: 'user-confirmed' });
  }
  for (const [date, day] of relevantHouseholdDates(household?.days, now)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || !Number.isInteger(day.adults) || !Array.isArray(day.children)) continue;
    documents.push({ ...makeDocument(`household:${date}`, 'household', 'Husstand på dato',
      `${date}: ${attendanceSummary(day)} · Tema: ${day.theme || 'everyday'}${day.skip ? ' · Spiser ikke hjemme' : ''}. Registreret af brugeren, ikke udledt af kalenderaftaler eller observeret forbrug.`,
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
  // ubekræftede opskrifter bliver ikke indekseret. Kilder genvalideres også
  // efter asynkron søgning, så en rettelse/arkivering gælder med det samme.
  // Legacy records were not all created through today's validation. Exclude the
  // whole source (including labels/provenance) before either ranking path; never
  // silently rewrite stored material or embed a redacted-but-misleading fragment.
  return documents.filter(document => !containsSecret(JSON.stringify(document)));
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
    const bodyWords = new Set(terms(doc.text));
    const exactTerms = queryTerms.filter(term => bodyWords.has(term));
    // An incidental hit on one word in a long natural-language question must
    // not receive the same fusion vote as a complete, distinctive exact match.
    const completeExactMatch = exactTerms.length === queryTerms.length;
    const rareLimit = Math.max(1, Math.ceil(documents.length / (queryTerms.length === 1 ? 20 : 5)));
    const distinctive = exactTerms.some(term => term.length >= 4 && (frequencies.get(term) || 0) <= rareLimit);
    let score = 0;
    for (const term of queryTerms) {
      const hits = words.filter(word => word === term).length;
      const close = hits ? 0 : term.length >= 4 && words.some(word => word.length >= 4 &&
        (word.startsWith(term) || term.startsWith(word))) ? 0.35 : 0;
      const count = hits || close;
      if (!count) continue;
      const idf = Math.log(1 + (documents.length - (frequencies.get(term) || 0) + 0.5) / ((frequencies.get(term) || 0) + 0.5));
      score += idf * (count * 2.2 / (count + 1.2 * (0.25 + 0.75 * words.length / averageLength)));
    }
    if (loweredQuery.length >= 3 && `${doc.label} ${doc.text}`.toLocaleLowerCase('da-DK').includes(loweredQuery)) score += 3;
    if (queryTerms.some(term => doc.label.toLocaleLowerCase('da-DK').includes(term))) score += 0.5;
    return { ...doc, score: Number(score.toFixed(3)), lexicalEvidence: { exactTerms: exactTerms.length,
      queryTerms: queryTerms.length, completeExactMatch, distinctive, strong: completeExactMatch && distinctive } };
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

  householdDay(date) { return getRecordedHouseholdDay(this.state, date); }
  effectiveHouseholdDay(date) { return getEffectiveHouseholdDay(this.state, date); }

  // Scores can only rank current, permitted source IDs. Retrieval candidates are
  // not factual answers, and similarity is never a confidence/probability of truth.
  async retrieve(query, options = {}) {
    const boundedLimit = checkedSearch(query, options.limit);
    const allowedTypes = checkedTypes(options.types);
    const getDocuments = () => indexPersonalKnowledge(this.state, { now: this.now() });
    const select = docs => docs.filter(doc => !allowedTypes || allowedTypes.includes(doc.type));
    const fallback = (status, documents = getDocuments()) => ({
      matches: lexicalResults(query, select(documents)).slice(0, boundedLimit),
      mode: 'local-lexical', semantic: { status }, answerability: 'sources-only',
    });
    const documents = getDocuments();
    if (!this.semanticScorer) return fallback('disabled', documents);
    if (documents.length > 2000) return fallback('index-limit', documents);
    const signature = doc => JSON.stringify([doc.text, doc.source, doc.updatedAt, doc.confirmation, doc.expiresAt]);
    const before = new Map(documents.map(doc => [doc.id, signature(doc)]));
    let semantic;
    const timeoutMs = Math.max(50, Math.min(10_000, Number(options.semanticTimeoutMs) || 1500));
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) return fallback('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let timeout, rejectAbort, timedOut = false;
    try {
      semantic = await Promise.race([
        Promise.resolve().then(() => this.semanticScorer(query, documents.map(({ id, text, source, updatedAt }) =>
          ({ id, text, revision: source?.revision || 0, updatedAt })), { signal: controller.signal })),
        new Promise((_, reject) => { timeout = setTimeout(() => {
          timedOut = true; controller.abort(); reject(new Error('Semantisk søgning fik timeout.'));
        }, timeoutMs); }),
        new Promise((_, reject) => { rejectAbort = () => reject(new Error('Semantisk søgning blev afbrudt.'));
          controller.signal.addEventListener('abort', rejectAbort, { once: true }); }),
      ]);
    } catch {
      // Never return a pre-inference snapshot after a correction/expiry.
      return fallback(timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'unavailable');
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', rejectAbort); }
    if (controller.signal.aborted) return fallback('cancelled');
    if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) return fallback('invalid-result');
    const current = select(getDocuments());
    // A correction during inference invalidates the mixed snapshot. Return the
    // current lexical view immediately; the next read incrementally re-embeds it.
    if (current.some(doc => before.get(doc.id) !== signature(doc))) return fallback('source-changed');
    const lexical = lexicalResults(query, current);
    const lexicalRanks = new Map(lexical.map((doc, index) => [doc.id, index + 1]));
    const lexicalById = new Map(lexical.map(doc => [doc.id, doc]));
    const semanticOrder = current.filter(doc => before.get(doc.id) === signature(doc) && Object.hasOwn(semantic, doc.id) &&
      typeof semantic[doc.id] === 'number' && Number.isFinite(semantic[doc.id]) && semantic[doc.id] > 0 && semantic[doc.id] <= 1)
      .sort((a, b) => semantic[b.id] - semantic[a.id] || a.id.localeCompare(b.id));
    const semanticRanks = new Map(semanticOrder.map((doc, index) => [doc.id, index + 1]));
    if (!semanticOrder.length) return fallback('no-current-scores');
    // The fixed Danish evaluation exposed RRF's missing-list bias: any weak
    // lexical overlap outvoted a good semantic-only paraphrase. Use a stable,
    // inspectable candidate allocation instead of mixing incompatible scores.
    // Four semantic candidates retain their order; each fifth slot may add one
    // complete distinctive exact match. The prefix is independent of limit.
    const exact = lexical.filter(doc => doc.lexicalEvidence.strong);
    const selected = new Set(), ranked = [];
    let semanticAt = 0, exactAt = 0, lexicalAt = 0;
    const take = (list, at) => { while (at < list.length && selected.has(list[at].id)) at++; return at; };
    while (ranked.length < boundedLimit) {
      semanticAt = take(semanticOrder, semanticAt); exactAt = take(exact, exactAt); lexicalAt = take(lexical, lexicalAt);
      let doc, selectedBy;
      if (ranked.length % 5 === 4 && exactAt < exact.length) { doc = exact[exactAt++]; selectedBy = 'exact-lexical-complement'; }
      else if (semanticAt < semanticOrder.length) { doc = semanticOrder[semanticAt++]; selectedBy = 'semantic'; }
      else if (lexicalAt < lexical.length) { doc = lexical[lexicalAt++]; selectedBy = 'lexical-remainder'; }
      else break;
      selected.add(doc.id);
      const semanticRank = semanticRanks.get(doc.id), lexicalRank = lexicalRanks.get(doc.id);
      ranked.push({ ...doc, score: 1 / (ranked.length + 1), retrieval: {
        strategy: HYBRID_RETRIEVAL_STRATEGY, selectedBy, lexicalRank: lexicalRank || null, semanticRank: semanticRank || null,
        semanticSimilarity: semanticRank ? semantic[doc.id] : null,
        lexicalEvidence: lexicalById.get(doc.id)?.lexicalEvidence || null,
      } });
    }
    return { matches: ranked, mode: 'local-hybrid',
      semantic: { status: 'ready', fusion: HYBRID_RETRIEVAL_STRATEGY },
      answerability: 'sources-only' };
  }

  async searchHybrid(query, options = {}) { return (await this.retrieve(query, options)).matches; }

  async contextAsync(query, options = {}) {
    const { matches } = await this.retrieve(query, { ...options, limit: 6 });
    return this.formatContext(matches);
  }

  formatContext(matches) {
    return matches.map(doc => `[${doc.id} · ${doc.label}${doc.source.revision ? ` · revision ${doc.source.revision}` : ''}${doc.updatedAt ? ` · opdateret ${doc.updatedAt}` : ''}] ${doc.text}`)
      .join('\n').slice(0, 5200);
  }

  context(query) {
    return this.formatContext(this.search(query, { limit: 6 }));
  }
}
