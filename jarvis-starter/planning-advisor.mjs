// Evidence-backed local suggestions. No network access, external writes, calendar
// title interpretation, or implicit approvals are performed by this module.
import { personalTaskRecords } from './personal-tasks.mjs';
import { FollowUpCases } from './follow-up-cases.mjs';
import { resolveHouseholdAttendance } from './meal-planner.mjs';
import { planningInstant } from './capacity-planner.mjs';
import { containsSecret } from './privacy.mjs';

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

// Plans are stored newest first. Retain historical records, but let only the
// newest non-archived plan contribute a meal or reminder for a given date.
export function effectiveMealPlans(state) {
  const seen = new Set(), result = [];
  for (const plan of state.mealPlans || []) {
    if (!plan || !plan.id || plan.archived || !Array.isArray(plan.dishes)) continue;
    const dishes = plan.dishes.filter(dish => {
      if (!dish || dayNumber(dish.date) === null || seen.has(dish.date)) return false;
      seen.add(dish.date); return true;
    });
    if (dishes.length) result.push({...plan,dishes});
  }
  return result;
}

export function buildPlanningSuggestions({ state, now = new Date() }) {
  const result = [];
  const todayNumber = dayNumber(localDay(now));
  const inWeek = value => {
    const day = dayNumber(value);
    return day !== null && day >= todayNumber && day < todayNumber + 7;
  };
  const plans = effectiveMealPlans(state);
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

const todayClock = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' });
const readInstant = value => { try { return planningInstant(value); } catch { return null; } };
const clockLabel = value => readInstant(value) === null ? 'tidspunkt ukendt' : todayClock.format(new Date(value));
const sourceHref = (view, sourceId) => `?view=${view}&source=${encodeURIComponent(sourceId)}`;
const safeTodayRow = row => !containsSecret(JSON.stringify(row));

function todayRow(id, title, detail, source, sourceId, view, priority = 'normal', rank = 30, dueAt = null) {
  return { id, title: String(title || '').slice(0, 160), detail: String(detail || '').slice(0, 600),
    source, sourceId, href: sourceHref(view, sourceId), tab: view, priority, rank, dueAt };
}

/** Latest run per monitor. Text-only old runs remain explicitly unverified;
 * they cannot override a current structured unchanged/unknown observation. */
export function latestMonitorObservations(tasks = [], now = new Date()) {
  return tasks.filter(task => task && !task.archived && task.category === 'monitor' && task.id).flatMap(task => {
    const runs = (task.runs || []).filter(run => run && typeof run === 'object');
    if (!runs.length) return [];
    const latest = runs.find(run => readInstant(run.at) === null) || [...runs].sort((a, b) => readInstant(b.at) - readInstant(a.at))[0];
    const validTime = readInstant(latest.at) !== null && readInstant(latest.at) <= now.getTime();
    const structured = latest.observation && typeof latest.observation === 'object';
    const status = validTime && latest.status === 'completed' && structured &&
      ['changed', 'unchanged'].includes(latest.observation.status) ? latest.observation.status : 'unknown';
    if (status === 'unchanged') return [];
    const basis = structured ? 'structured-observation' : 'legacy-text';
    const at = validTime ? latest.at : null;
    const source = { kind: 'task', id: task.id, revision: task.revision || 1,
      ...(latest.id ? { runId: latest.id } : {}), at };
    const row = { taskTitle: String(task.title || 'Overvågning').slice(0, 160), taskId: task.id, at, status, basis, source,
      result: String(latest.result || 'Intet læsbart observationsresultat.').slice(0, 1800),
      note: basis === 'legacy-text' ? 'Historisk tekst uden struktureret måling; kræver gennemgang, også ved CHANGE/NO_CHANGE-markører.'
        : status === 'unknown' ? 'Seneste udfald er ukendt. Det er ikke bevis for uændret kilde.'
          : 'En registreret struktureret ændring; gennemgå observationens kilde før beslutning.' };
    return safeTodayRow(row) ? [row] : [];
  }).sort((a, b) => Number(b.status === 'unknown') - Number(a.status === 'unknown') ||
    (readInstant(b.at) || 0) - (readInstant(a.at) || 0) || a.taskId.localeCompare(b.taskId));
}

function householdToday(state, date) {
  let attendance;
  try { attendance = resolveHouseholdAttendance(state.mealHousehold, date); }
  catch { attendance = resolveHouseholdAttendance(null, date); }
  const known = attendance.householdConfirmed;
  const kind = attendance.attendanceSource === 'day-override' ? 'household-day'
    : attendance.attendanceSource === 'recurring-rhythm' ? 'household-rhythm' : 'household';
  const source = { kind, date, revision: state.mealHousehold?.revision || 1 };
  const basis = { 'day-override': 'dagsundtagelse', 'recurring-rhythm': 'familierytme', 'household-defaults': 'eksplicit standard' }[attendance.attendanceSource];
  const guests = (attendance.guests?.adults || 0) + (attendance.guests?.children?.length || 0);
  const detail = known ? `${attendance.adults} voksne, ${attendance.children.length} børn og ${guests} gæster · ${attendance.servings} planlagte portioner.`
    + ` Grundlag: registreret ${basis}; ${attendance.skip ? 'ingen aftensmad hjemme planlagt' : 'ikke observeret tilstedeværelse eller forbrug'}.`
    : 'Husstanden er ikke oplyst for planlægningen. Kalendertekst og standardportioner beviser ikke hvem der er hjemme.';
  return { ...todayRow(`household:${date}`, 'Husstand i dag', detail, source, `${kind}:${date}`, 'meals'),
    known, attendance: structuredClone(attendance) };
}

function mealsToday(state, date, validateMealSources) {
  const rows = [];
  for (const plan of effectiveMealPlans(state)) {
    for (const dish of plan.dishes.filter(item => item && item.date === date)) {
      let sourceInvalid = false;
      if (!dish.skip) {
        try {
          if (typeof validateMealSources === 'function') {
            const checked = validateMealSources([dish]);
            if (checked === false || checked?.then) sourceInvalid = true;
          } else sourceInvalid = (dish.sourceRefs || []).some(source => source.kind === 'recipe');
        } catch { sourceInvalid = true; }
      }
      const stale = sourceInvalid || plan.recipeStale || plan.householdStale || plan.profileStale || plan.needsReview;
      const status = dish.skip ? 'skipped' : stale ? 'stale' : plan.status === 'draft' ? 'draft' : 'planned';
      const source = { kind: 'meal-plan', id: plan.id, date, revision: plan.revision || 1 };
      const title = dish.skip ? 'Aftensmad er sprunget over i planen' : sourceInvalid ? 'Aftensmad kræver opskriftsgennemgang'
        : `Forslag: ${dish.title || 'Ret uden titel'}`;
      const detail = sourceInvalid ? 'Den gemte opskriftskilde er ændret eller utilgængelig. Det tidligere indhold bruges ikke som aktuelt grundlag.'
        : `${dish.skip ? 'Eksplicit planvalg.' : `${Number.isFinite(dish.servings) ? dish.servings : '?'} portioner i den gemte ret${Number.isFinite(dish.minutes) ? ` · ${dish.minutes} minutter` : ''}.`}`
          + `${stale ? ' Skal gennemgås igen.' : plan.status === 'draft' ? ' Udkast, ikke en endelig beslutning.' : ''}`
          + `${dish.leftoverFromDate ? ' Planlagt restemad, ikke bekræftet lager.' : ''} Planen beviser ikke indkøb eller at måltidet er spist.`;
      const row = { ...todayRow(`meal:${plan.id}:${date}`, title, detail, source, `meal-plan:${plan.id}:${date}`, 'meals'), status };
      if (safeTodayRow(row)) rows.push(row);
    }
  }
  return rows;
}

function calendarToday(snapshot, date, now) {
  const fetched = readInstant(snapshot?.fetchedAt), expires = readInstant(snapshot?.expiresAt);
  const from = readInstant(snapshot?.coverage?.start), until = readInstant(snapshot?.coverage?.end);
  let status = snapshot?.cacheState || 'unknown';
  if (['expired_login', 'unavailable'].includes(status)) { /* preserve failed source state */ }
  else if (fetched === null || fetched > now.getTime() || expires === null || from === null || until === null || until <= from ||
      snapshot?.coverage?.complete !== true) status = 'unknown';
  else if (expires <= now.getTime()) status = 'stale';
  else if (snapshot?.ready !== true) status = status === 'stale' ? 'stale' : 'unknown';
  else if (from > now.getTime() || localDay(new Date(until)) <= date) status = 'outside_coverage';
  else status = 'ready';
  const reasons = { unknown: 'Kalenderdækning er ukendt eller ikke læst. Det betyder ikke ledig tid.',
    stale: 'Kalenderkopien er forældet. Tidligere aftaler bekræfter ikke den aktuelle kapacitet.',
    unavailable: 'Seneste kalenderlæsning fejlede. Eventuelle viste aftaler er fra en ældre kopi.',
    expired_login: 'Google-login er udløbet. Kalenderens aktuelle indhold er ukendt.',
    outside_coverage: 'Den læste periode dækker ikke hele den resterende dag; den øvrige kapacitet er ukendt.' };
  const rows = [];
  const ids = new Map();
  for (const event of snapshot?.events || []) if (event?.id) ids.set(event.id, (ids.get(event.id) || 0) + 1);
  if (fetched !== null && fetched <= now.getTime() && typeof snapshot?.calendarId === 'string') for (const event of snapshot.events || []) {
    if (!event?.id || ids.get(event.id) !== 1 || event.status === 'cancelled') continue;
    let start, end, label;
    if (event.allDay === true) {
      if (dayNumber(event.start) === null || dayNumber(event.end) === null || event.end <= event.start || !(event.start <= date && date < event.end)) continue;
      start = Date.parse(event.start + 'T12:00:00Z'); end = Date.parse(event.end + 'T12:00:00Z'); label = 'Heldagsregistrering';
    } else {
      start = readInstant(event.start); end = readInstant(event.end);
      if (start === null || end === null || end <= start || end <= now.getTime() || localDay(new Date(start)) > date ||
          localDay(new Date(end - 1)) < date) continue;
      label = `${clockLabel(event.start)} – ${clockLabel(event.end)}`;
    }
    const source = { kind: 'google-calendar', calendarId: snapshot.calendarId, eventId: event.id, date, fetchedAt: snapshot.fetchedAt };
    const sourceId = `google-calendar:${encodeURIComponent(source.calendarId)}:${date}:${encodeURIComponent(source.eventId)}:${encodeURIComponent(source.fetchedAt)}`;
    const row = { ...todayRow(`calendar:${event.id}`, event.title || 'Aftale uden titel',
      `${status === 'ready' ? '' : 'Ældre/ufuldstændig kalenderkopi · '}${label}${event.transparency === 'transparent' ? ' · Markereren står som ledig i kalenderen' : ''}. Kalenderen siger ikke hvem der er hjemme.`,
      source, sourceId, 'home'), stale: status !== 'ready', sortAt: start };
    if (sourceId.length <= 2000 && safeTodayRow(row)) rows.push(row);
  }
  rows.sort((a, b) => a.sortAt - b.sortAt || a.source.eventId.localeCompare(b.source.eventId));
  return { status, detail: reasons[status] || (rows.length ? 'Kommende registrerede aftaler i dagens læste periode. Kun læsning.'
    : 'Ingen registrerede aftaler i den dækkede periode resten af dagen. Det er ikke en garanti for ledig kapacitet.'),
    calendarId: snapshot?.calendarId || null, fetchedAt: fetched === null ? null : snapshot.fetchedAt,
    expiresAt: expires === null ? null : snapshot.expiresAt,
    coverage: from === null || until === null ? null : { start: snapshot.coverage.start, end: snapshot.coverage.end,
      complete: snapshot.coverage.complete === true }, eventCount: rows.length, events: rows.slice(0, 12) };
}

/** Dashboard-only projection. It never calls an integration, saves, schedules a
 * job or changes ProactivePlanner/digest delivery scope. */
export function buildTodayOverview({ state, now = new Date(), calendarSnapshot = null, validateMealSources } = {}) {
  const date = localDay(now), priorities = [];
  for (const task of personalTaskRecords(state)) {
    if (!task?.id || !['pending', 'in_progress', 'blocked'].includes(task.status)) continue;
    const candidates = [['deadline', 'Frist'], ['nextFollowUpAt', 'Personlig opfølgning'], ['plannedStart', 'Lokalt planlagt start']]
      .map(([key, label]) => ({ key, label, value: task[key], time: readInstant(task[key]) }))
      .filter(item => item.time !== null && localDay(new Date(item.time)) <= date);
    if (!candidates.length) continue;
    const next = candidates.sort((a, b) => a.time - b.time)[0], overdue = next.time < now.getTime();
    const source = { kind: 'personal-task', id: task.id, revision: task.revision || 1 };
    const row = todayRow(`personal-task:${task.id}`, task.title, `${task.status === 'blocked' ? 'Blokeret · ' : ''}${next.label}: ${clockLabel(next.value)}.`
      + `${overdue ? ' Tidspunktet er passeret; opgaven er ikke registreret afsluttet.' : ''} Ingen kalenderaftale oprettes.`,
      source, `personal-task:${task.id}`, 'plan', overdue || task.status === 'blocked' ? 'high' : 'normal', overdue ? 90 : 40, next.value);
    if (safeTodayRow(row)) priorities.push(row);
  }
  // Read the domain's existing open-case contract through an isolated wrapper;
  // its constructor cannot add or normalize fields in the application state.
  const cases = new FollowUpCases({ state: { followUpCases: state.followUpCases || [] }, now: () => now }).list();
  for (const follow of cases) {
    const due = readInstant(follow.nextCheckAt);
    if (!follow.id || due === null || due > now.getTime()) continue;
    const source = { kind: 'follow-up', id: follow.id, revision: follow.revision || 1 };
    const row = todayRow(`follow-up:${follow.id}`, `Følg op: ${follow.awaiting}`, `Næste kontrol: ${clockLabel(follow.nextCheckAt)}.`
      + `${follow.observations?.[0]?.status === 'unknown' ? ' Seneste observation er ukendt.' : ''} Sagen er åben; intet eksternt tjek eller kontakt er startet.`,
      source, `follow-up:${follow.id}`, 'plan', 'high', 95, follow.nextCheckAt);
    if (safeTodayRow(row)) priorities.push(row);
  }
  for (const monitor of latestMonitorObservations(state.tasks, now)) priorities.push(todayRow(`monitor:${monitor.taskId}`,
    monitor.status === 'unknown' ? `Ukendt overvågningsudfald: ${monitor.taskTitle}` : `Registreret ændring: ${monitor.taskTitle}`,
    `${clockLabel(monitor.at)} · ${monitor.note}`, monitor.source, `task:${monitor.taskId}`, 'plan',
    monitor.status === 'unknown' ? 'high' : 'normal', monitor.status === 'unknown' ? 100 : 60, monitor.at));
  priorities.sort((a, b) => b.rank - a.rank || (readInstant(a.dueAt) || 0) - (readInstant(b.dueAt) || 0) || a.id.localeCompare(b.id));
  const meals = mealsToday(state, date, validateMealSources);
  return { date, timeZone: 'Europe/Copenhagen', priorities: priorities.slice(0, 24), priorityCount: priorities.length,
    household: householdToday(state, date), meals: meals.slice(0, 12), mealCount: meals.length,
    // Persisted domain flag only, not a second shopping-validity calculation.
    // It lets the dashboard clarify retained legacy insights without changing
    // the separately configured ProactivePlanner or its saved digests.
    shoppingReviewPlanIds: (state.mealPlans || []).filter(plan => plan?.id && !plan.archived && plan.shoppingNeedsReview === true).map(plan => plan.id),
    calendar: calendarToday(calendarSnapshot, date, now) };
}
