// Deterministic local planning. Calendar data and user-selected work windows
// are explicit inputs; a missing calendar response never means an empty day.
// Stable earliest-fit is intentionally not claimed to be a global optimizer.

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MINUTE = 60_000;

export function planningInstant(value, label = 'Tidspunkt') {
  if (typeof value !== 'string') throw new Error(`${label} skal være et ISO-tidspunkt med tidszone.`);
  const match = INSTANT.exec(value);
  if (!match) throw new Error(`${label} skal være et ISO-tidspunkt med tidszone.`);
  const [, year, month, day, hour, minute, second = '00', offset] = match;
  const civil = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4, 6)) > 59 ||
        Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4, 6)) !== 0))
    throw new Error(`Ugyldig dato eller tidszone i ${label}.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`Ugyldigt tidspunkt i ${label}.`);
  return time;
}

function interval(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Ugyldigt ${label}.`);
  const start = planningInstant(value.start, `${label}.start`);
  const end = planningInstant(value.end, `${label}.end`);
  if (end <= start) throw new Error(`${label} skal slutte efter start.`);
  return { start, end, source: value.source || null };
}

function overlapping(a, b) { return a.start < b.end && b.start < a.end; }
const iso = value => new Date(value).toISOString();

function mergeWindows(windows) {
  const merged = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else merged.push({ start: window.start, end: window.end });
  }
  return merged;
}

function checkTask(raw, bufferMinutes) {
  if (!raw || !/^[a-zA-Z0-9:_-]{1,100}$/.test(raw.id || '') ||
      !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 5 || raw.durationMinutes > 24 * 60)
    throw new Error('Opgave kræver entydigt ID og varighed på 5–1440 minutter.');
  const uncertainty = raw.durationUncertaintyMinutes ?? 0;
  if (!Number.isInteger(uncertainty) || uncertainty < 0 || uncertainty > 1440)
    throw new Error('Varighedsusikkerhed skal være 0–1440 hele minutter.');
  const earliest = raw.earliestStart ? planningInstant(raw.earliestStart, `${raw.id}.earliestStart`) : -Infinity;
  const deadline = raw.deadline ? planningInstant(raw.deadline, `${raw.id}.deadline`) : Infinity;
  if (deadline < earliest) throw new Error(`Opgave ${raw.id} har deadline før tidligste start.`);
  const dependencies = raw.dependencies || [];
  if (!Array.isArray(dependencies) || dependencies.length > 30 || dependencies.some(d => typeof d !== 'string') ||
      new Set(dependencies).size !== dependencies.length)
    throw new Error(`Ugyldige eller dobbelte afhængigheder for ${raw.id}.`);
  const lockedStart = raw.lockedStart ? planningInstant(raw.lockedStart, `${raw.id}.lockedStart`) : null;
  const preferredStart = raw.preferredStart ? planningInstant(raw.preferredStart, `${raw.id}.preferredStart`) : null;
  const allowedWindows = raw.allowedWindows === undefined ? [] : raw.allowedWindows;
  if (!Array.isArray(allowedWindows) || allowedWindows.length > 30)
    throw new Error(`Ugyldige tilladte tidsvinduer for ${raw.id}.`);
  const priority = raw.priority ?? 2;
  if (!Number.isInteger(priority) || priority < 0 || priority > 5) throw new Error('Prioritet skal være 0–5.');
  return { id: raw.id, title: String(raw.title || raw.id).slice(0, 160),
    duration: raw.durationMinutes * MINUTE, uncertaintyMinutes: uncertainty,
    reserveDuration: (raw.durationMinutes + uncertainty + bufferMinutes) * MINUTE,
    earliest, deadline, dependencies, lockedStart, preferredStart, priority,
    allowedWindows: mergeWindows(allowedWindows.map(window => interval(window, `${raw.id}.allowedWindow`))),
    source: raw.source || null };
}

function orderedTasks(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Opgave-ID skal være unikke.');
  const ordered = [], visited = new Set(), active = new Set();
  const visit = task => {
    if (active.has(task.id)) throw new Error(`Cirkulær afhængighed ved ${task.id}.`);
    if (visited.has(task.id)) return;
    active.add(task.id);
    for (const id of task.dependencies) {
      const dependency = byId.get(id);
      if (!dependency) throw new Error(`Ukendt afhængighed ${id} for ${task.id}.`);
      visit(dependency);
    }
    active.delete(task.id); visited.add(task.id); ordered.push(task);
  };
  for (const task of [...tasks].sort((a, b) => a.deadline - b.deadline || b.priority - a.priority || a.id.localeCompare(b.id))) visit(task);
  return ordered;
}

function previousChoices(previousProposals, tasks) {
  if (!Array.isArray(previousProposals) || previousProposals.length > 250) throw new Error('Ugyldige tidligere planforslag.');
  const choices = new Map(), ids = new Set(tasks.map(task => task.id)), ignored = [];
  for (const old of previousProposals) {
    if (!old || !/^[a-zA-Z0-9:_-]{1,100}$/.test(old.taskId || '') || choices.has(old.taskId))
      throw new Error('Tidligere planforslag kræver unikke opgave-ID.');
    const start = planningInstant(old.start, 'Tidligere start');
    if (old.end && planningInstant(old.end, 'Tidligere slut') <= start) throw new Error('Tidligere slut skal være efter start.');
    choices.set(old.taskId, start);
    if (!ids.has(old.taskId)) ignored.push(old.taskId);
  }
  // A stored local choice takes precedence over a merely simulated old proposal.
  for (const task of tasks) if (task.preferredStart !== null) choices.set(task.id, task.preferredStart);
  return { choices, ignored };
}

function fitsWindow(span, windows) { return windows.some(window => span.start >= window.start && span.end <= window.end); }

export function planPersonalTasks({ tasks = [], calendarEvents = [], workWindows = [], previousProposals = [],
  calendarCoverage = null, timeZone = 'Europe/Copenhagen', bufferMinutes = 0 } = {}) {
  try { new Intl.DateTimeFormat('da-DK', { timeZone }); }
  catch { throw new Error('Ugyldig IANA-tidszone.'); }
  if (!Array.isArray(tasks) || !Array.isArray(calendarEvents) || !Array.isArray(workWindows) ||
      tasks.length > 250 || calendarEvents.length > 1000 || workWindows.length > 500)
    throw new Error('Ugyldige eller for store planlægningsdata.');
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 180)
    throw new Error('Buffer skal være 0–180 minutter.');
  const normalized = orderedTasks(tasks.map(task => checkTask(task, bufferMinutes)));
  const { choices, ignored } = previousChoices(previousProposals, normalized);
  const windows = mergeWindows(workWindows.map(window => interval(window, 'arbejdsvindue')));
  if (!windows.length) return { feasible: false, proposals: [], changes: [], conflicts: [{ code: 'no-windows',
    explanation: 'Ingen tilladte tidsvinduer er registreret.' }], alternatives: ['Registrér tidsvinduer eller ændr opgavefrist.'] };
  const covered = calendarCoverage?.status === 'ready' && calendarCoverage.start && calendarCoverage.end &&
    planningInstant(calendarCoverage.start, 'kalenderdækning.start') <= windows[0].start &&
    planningInstant(calendarCoverage.end, 'kalenderdækning.end') >= Math.max(...windows.map(window => window.end));
  if (!covered) return { feasible: false, proposals: [], changes: [], conflicts: [{ code: 'calendar-unknown',
    explanation: 'Kalenderens dækning og aktualitet er ukendt. Ledig tid kan ikke fastslås.' }],
    alternatives: ['Opdatér den valgte kalender eller gennemgå tilgængeligheden manuelt.'] };

  let reservations = calendarEvents.map(raw => {
    const span = interval(raw, 'kalenderaftale');
    // Tasks already reserve their own trailing buffer. Reserve the calendar's
    // trailing buffer here so each transition gets one gap, not two.
    return { start: span.start, end: span.end + bufferMinutes * MINUTE,
      kind: 'calendar', source: raw.source || { kind: 'calendar' } };
  });
  const results = new Map(), anchors = new Map(), initialReasons = new Map(), failedLocks = new Set();
  const conflicts = [];
  const spanAt = (task, start) => ({ start, end: start + task.reserveDuration, owner: task.id, kind: 'personal-task' });
  const reason = (task, span, earliest = task.earliest, latest = task.deadline) => {
    if (!fitsWindow(span, windows)) return 'arbejdstidsvinduet er ændret';
    if (task.allowedWindows.length && !fitsWindow(span, task.allowedWindows)) return 'opgavens tilladte tidsvindue er ændret';
    if (span.start < earliest) return 'tidligste start eller en afhængighed ligger senere';
    if (span.end > Math.min(task.deadline, latest)) return 'varighed, usikkerhed, buffer eller en afhængig deadline kan ikke overholdes';
    const collision = reservations.find(other => other.owner !== task.id && overlapping(span, other));
    return collision ? collision.kind === 'calendar' ? 'en kalenderaftale optager tiden' : 'et andet bevaret eller låst valg optager tiden' : null;
  };
  // Reserve hard locks first. Invalid locks remain in the task records and are
  // reported; they are never moved or presented as valid proposals.
  for (const task of normalized.filter(task => task.lockedStart !== null)) {
    const span = spanAt(task, task.lockedStart), why = reason(task, span);
    if (why) {
      failedLocks.add(task.id);
      conflicts.push({ taskId: task.id, code: 'locked-conflict', explanation: `Låst tid til ${task.title} kan ikke bruges: ${why}.` });
    } else { anchors.set(task.id, span); reservations.push(span); }
  }
  // Protect still-valid previous/manual placements before fitting new work.
  const preferred = normalized.filter(task => task.lockedStart === null && choices.has(task.id))
    .sort((a, b) => choices.get(a.id) - choices.get(b.id) || a.id.localeCompare(b.id));
  for (const task of preferred) {
    const span = spanAt(task, choices.get(task.id)), why = reason(task, span);
    if (why) initialReasons.set(task.id, why);
    else { anchors.set(task.id, span); reservations.push(span); }
  }

  // Propagate hard deadlines/locks backwards through dependencies, not soft
  // preferences. This prevents a prerequisite being placed after a locked child.
  const latest = new Map(normalized.map(task => [task.id, task.deadline]));
  for (const task of [...normalized].reverse()) {
    const limit = task.lockedStart !== null && !failedLocks.has(task.id)
      ? task.lockedStart : latest.get(task.id) - task.reserveDuration;
    for (const dependency of task.dependencies) latest.set(dependency, Math.min(latest.get(dependency), limit));
  }

  for (const task of normalized) {
    reservations = reservations.filter(other => other.owner !== task.id);
    if (failedLocks.has(task.id)) continue;
    const dependencies = task.dependencies.map(id => results.get(id));
    if (dependencies.some(value => !value)) {
      conflicts.push({ taskId: task.id, code: 'dependency-unavailable',
        explanation: `Forudgående arbejde for ${task.title} kan ikke placeres. Opgaven vises derfor ikke som et gyldigt forslag.` });
      continue;
    }
    const earliest = Math.max(task.earliest, ...dependencies.map(span => span.end));
    const last = latest.get(task.id);
    let chosen = anchors.get(task.id);
    const invalidAnchor = chosen ? reason(task, chosen, earliest, last) : null;
    if (chosen && invalidAnchor) { initialReasons.set(task.id, invalidAnchor); chosen = null; }
    if (task.lockedStart !== null && !chosen) {
      conflicts.push({ taskId: task.id, code: 'locked-dependency',
        explanation: `Låst tid til ${task.title} kan ikke respektere alle afhængigheder eller frister. Det låste valg er ikke flyttet.` });
      continue;
    }
    if (!chosen) {
      for (const window of windows) {
        const allowed = task.allowedWindows.length ? task.allowedWindows : [window];
        for (const personalWindow of allowed) {
          let start = Math.max(window.start, personalWindow.start, earliest);
          const end = Math.min(window.end, personalWindow.end, task.deadline, last);
          while (start + task.reserveDuration <= end) {
            const span = spanAt(task, start);
            const collision = reservations.filter(other => overlapping(span, other))
              .sort((a, b) => a.end - b.end)[0];
            if (!collision) { chosen = span; break; }
            start = collision.end;
          }
          if (chosen) break;
        }
        if (chosen) break;
      }
    }
    if (!chosen) {
      conflicts.push({ taskId: task.id, code: task.allowedWindows.length ? 'personal-window-capacity' : 'capacity',
        explanation: `Ingen sammenhængende blok er fundet til ${task.title}, inklusive usikkerhed og buffer, mens øvrige gyldige valg bevares.` });
      continue;
    }
    results.set(task.id, chosen); reservations.push(chosen);
  }

  const proposals = normalized.filter(task => results.has(task.id)).map(task => {
    const span = results.get(task.id), previous = choices.get(task.id);
    const placement = task.lockedStart !== null ? 'locked' : previous === span.start ? 'preserved' : previous !== undefined ? 'moved' : 'new';
    return { taskId: task.id, title: task.title, start: iso(span.start), end: iso(span.start + task.duration),
      reservedUntil: iso(span.end), durationUncertaintyMinutes: task.uncertaintyMinutes, bufferMinutes,
      locked: task.lockedStart !== null, source: task.source, placement,
      previousStart: previous === undefined ? null : iso(previous),
      explanation: placement === 'locked' ? 'Det låste valg er bevaret.' : placement === 'preserved' ? 'Det tidligere valg opfylder fortsat rammerne og er bevaret.'
        : placement === 'moved' ? `Kun dette berørte valg er genplaceret, fordi ${initialReasons.get(task.id) || 'rammer eller afhængigheder er ændret'}.`
          : 'Nyt forslag i en ledig blok efter afhængigheder og inden for de registrerede rammer.' };
  });
  const changes = normalized.filter(task => choices.has(task.id) && results.get(task.id)?.start !== choices.get(task.id))
    .map(task => ({ taskId: task.id, from: iso(choices.get(task.id)), to: results.has(task.id) ? iso(results.get(task.id).start) : null,
      reason: initialReasons.get(task.id) || conflicts.find(item => item.taskId === task.id)?.explanation || 'Låst valg er ændret af brugeren.' }));
  return { feasible: conflicts.length === 0, proposals, changes, conflicts, ignoredPreviousTaskIds: ignored,
    alternatives: conflicts.length ? ['Reducer varighed eller opgavens scope.', 'Gennemgå et berørt låst eller tidligere valgt tidspunkt.',
      'Vælg et ekstra tidsvindue eller genforhandl deadline.'] : [],
    strategy: 'stable-earliest-fit', timeZone,
    calendarCoverage: { status: 'ready', start: calendarCoverage.start, end: calendarCoverage.end } };
}
