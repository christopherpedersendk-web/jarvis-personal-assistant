// Evidence-backed local suggestions. No network access, external writes, calendar
// title interpretation, or implicit approvals are performed by this module.

function localDay(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function dayNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? Math.floor(date.getTime() / 86_400_000) : null;
}

function suggestion(id, priority, title, detail, source, tab, { date = null, sourceRefs = [] } = {}) {
  return { id, priority, title, detail, reason: detail, source, sourceRefs: [source, ...sourceRefs].slice(0, 8), tab, date };
}

export function buildPlanningSuggestions({ state, now = new Date() }) {
  const result = [];
  const todayNumber = dayNumber(localDay(now));
  const inWeek = value => {
    const day = dayNumber(value);
    return day !== null && day >= todayNumber && day < todayNumber + 7;
  };
  const plans = (state.mealPlans || []).filter(plan => plan && plan.id && !plan.archived && Array.isArray(plan.dishes));
  const currentPlans = plans.filter(plan => plan.dishes.some(dish => inWeek(dish.date)));
  const household = state.mealHousehold;
  const coveredDays = new Set(currentPlans.flatMap(plan => plan.dishes.map(dish => dish.date)));
  const uncoveredDays = Object.entries(household?.days || {}).filter(([date, day]) =>
    inWeek(date) && day && !day.skip && Number.isInteger(day.adults) && Array.isArray(day.children) &&
    day.adults + day.children.length > 0 && !coveredDays.has(date)).map(([date]) => date).sort();
  if (uncoveredDays.length) result.push(suggestion('household:unplanned-days', 'normal',
    'Madplan mangler for registrerede hjemmedage',
    `Du har registreret fremmøde, men ingen gemt madplan for ${uncoveredDays.join(', ')}. Forbered et forslag, når det passer dig.`,
    { kind: 'household-days', dates: uncoveredDays, revision: household.revision || 1 }, 'meals', { date: uncoveredDays[0] }));

  for (const plan of currentPlans.slice(0, 5)) {
    const source = { kind: 'meal-plan', id: plan.id, revision: plan.revision || 1 };
    const missingAttendance = plan.dishes.filter(dish => inWeek(dish.date) && !dish.skip &&
      (dish.householdConfirmed === false || dish.adults === null));
    if (missingAttendance.length) result.push(suggestion(`meal:${plan.id}:attendance`, 'high',
      'Bekræft hvem der spiser hjemme',
      `Madplanen bruger ubekræftet fremmøde ${missingAttendance.map(x => x.date).join(', ')}. Ret voksne og børn, før indkøbet beregnes. Kalenderaftaler bruges ikke som bevis for fremmøde.`,
      source, 'meals', { sourceRefs: [{ kind: 'household', revision: household?.revision || 1 }] }));
    if (plan.profileStale || plan.householdStale || plan.recipeStale || plan.staleReason) {
      result.push(suggestion(`meal:${plan.id}:stale`, 'high', 'Madplanen skal gennemgås igen',
        'Gemte madpræferencer, fremmøde eller opskrifter er ændret siden dette forslag. Gennemgå retterne og beregn en ny indkøbsliste; gamle kurvforslag må ikke genbruges.', source, 'meals'));
    } else if (plan.status === 'draft') {
      result.push(suggestion(`meal:${plan.id}:draft`, 'normal', 'Madplansforslag klar til tilretning',
        `Forslaget fra ${plan.startDate} er endnu ikke omsat til en indkøbsliste. Ret retter, temaer, portioner og eventuelle udedage først.`, source, 'meals'));
    } else if (plan.status === 'shopping_ready' && Array.isArray(plan.shoppingList) && plan.shoppingList.length &&
        !(state.shoppingDrafts || []).some(draft => draft.planId === plan.id && draft.planRevision === plan.revision) &&
        !(state.nemligProposals || []).some(proposal => proposal.sourcePlan?.id === plan.id && proposal.sourcePlan?.revision === plan.revision)) {
      result.push(suggestion(`meal:${plan.id}:shopping`, 'normal', 'Indkøbslisten er klar til varevalg',
        `${plan.shoppingList.length} ingredienslinjer er beregnet efter det oplyste lager. Søg Nemligs faktiske sortiment og gennemgå et kurvforslag; ingen varer overføres automatisk.`, source, 'meals'));
    }
    const longBusyDays = plan.dishes.filter(dish => inWeek(dish.date) && !dish.skip && dish.busyDay === true && Number(dish.minutes) > 30);
    if (longBusyDays.length) result.push(suggestion(`meal:${plan.id}:time`, 'normal', 'Gennemgå madlavningstiden på travle dage',
      longBusyDays.map(dish => `${dish.date}: ${dish.minutes} minutter på en dag markeret som travl`).join(' · ') + '. Det er et forslag til gennemgang, ikke en antagelse om hvem der er hjemme.',
      source, 'meals', { sourceRefs: longBusyDays.flatMap(dish => dish.sourceRefs || []).slice(0, 4) }));
  }

  const recipeInbox = (state.recipes || []).filter(recipe => recipe && !recipe.archived && recipe.status === 'inbox');
  if (recipeInbox.length) result.push(suggestion('recipes:review', 'normal', `${recipeInbox.length} opskrift(er) venter på gennemgang`,
    'Kontrollér indlæste ingredienser, portioner og kostmærkning. Gemte links og billeder er ikke bekræftede ingredienslister, før du har gennemgået dem.',
    { kind: 'recipes', ids: recipeInbox.slice(0, 12).map(recipe => recipe.id) }, 'meals'));

  const unconfirmed = (state.memories || []).filter(memory => memory && !memory.archived && (memory.status === 'proposed' || memory.confirmed === false));
  if (unconfirmed.length) result.push(suggestion('memories:review', 'normal', `${unconfirmed.length} hukommelsesforslag afventer din bekræftelse`,
    'Forslagene bruges ikke som personlige fakta endnu. Ret, bekræft eller arkivér dem i din hukommelse.',
    { kind: 'memories', ids: unconfirmed.slice(0, 12).map(memory => memory.id) }, 'knowledge'));
  const expiredMemories = (state.memories || []).filter(memory => memory && !memory.archived && memory.status !== 'proposed' && memory.confirmed !== false &&
    memory.expiresAt && Number.isFinite(Date.parse(memory.expiresAt)) && Date.parse(memory.expiresAt) <= now.getTime());
  if (expiredMemories.length) result.push(suggestion('memories:expired', 'normal', `${expiredMemories.length} hukommelsespunkt(er) er udløbet`,
    'De bruges ikke i søgning eller personlig kontekst. Opdatér udløb eller arkivér dem, hvis oplysningerne ikke længere gælder.',
    { kind: 'memories', ids: expiredMemories.slice(0, 12).map(memory => memory.id) }, 'knowledge'));

  const proposals = (state.nemligProposals || []).filter(proposal => proposal && proposal.id).slice(0, 20);
  const pending = [];
  for (const proposal of proposals) {
    if (proposal.status === 'partial' || proposal.status === 'unknown') {
      result.push(suggestion(`basket:${proposal.id}:outcome`, 'high', 'Kontrollér Nemlig-kurven før et nyt forsøg',
        'Et tidligere godkendt kurvforslag fik delvis eller uvis status. Det må ikke gentages automatisk; se den faktiske kurv og lav om nødvendigt et nyt forslag.',
        { kind: 'nemlig-proposal', id: proposal.id }, 'meals'));
      continue;
    }
    if (proposal.status !== 'pending') continue;
    const plan = proposal.sourcePlan ? plans.find(plan => plan.id === proposal.sourcePlan.id) : null;
    const stalePlan = proposal.sourcePlan && (!plan || plan.revision !== proposal.sourcePlan.revision || plan.status !== 'shopping_ready');
    const draft = proposal.sourceDraft ? (state.shoppingDrafts || []).find(draft => draft.id === proposal.sourceDraft.id) : null;
    const staleDraft = proposal.sourceDraft && (!draft || draft.revision !== proposal.sourceDraft.revision);
    const expiresAt = Date.parse(proposal.expiresAt);
    if (stalePlan || staleDraft || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      result.push(suggestion(`basket:${proposal.id}:stale`, 'high', 'Lav et nyt kurvforslag',
        stalePlan || staleDraft ? 'Madplanen eller varevalget er ændret siden kurvforslaget. Et nyt forslag skal bygges ud fra den aktuelle indkøbsliste.'
          : 'Kurvforslagets godkendelsesfrist er udløbet. Genindlæs kurven og forbered et nyt forslag.',
        { kind: 'nemlig-proposal', id: proposal.id }, 'meals', { sourceRefs: proposal.sourcePlan ? [{ kind: 'meal-plan', ...proposal.sourcePlan }] : [] }));
    } else pending.push(proposal);
  }
  if (pending.length) result.push(suggestion('basket:approval', 'normal', `${pending.length} kurvforslag klar til din beslutning`,
    'Se de konkrete varer og antal. Kun dit klik på Overfør til Nemlig kan opdatere kurven; JARVIS bestiller eller betaler aldrig.',
    { kind: 'nemlig-proposals', ids: pending.slice(0, 10).map(proposal => proposal.id) }, 'meals'));

  return result.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || a.id.localeCompare(b.id)).slice(0, 16);
}
