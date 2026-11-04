// Deterministic local planning. Calendar data and user-selected work windows
// are explicit inputs; a missing calendar response never means an empty day.

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MINUTE = 60_000;

function instant(value, label) {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error(`${label} skal være et ISO-tidspunkt med tidszone.`);
  return Date.parse(value);
}

function interval(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`Ugyldigt ${label}.`);
  const start = instant(value.start, `${label}.start`);
  const end = instant(value.end, `${label}.end`);
  if (end <= start) throw new Error(`${label} skal slutte efter start.`);
  return { start, end, source: value.source || null };
}

function overlapping(a, b) { return a.start < b.end && b.start < a.end; }
const iso = value => new Date(value).toISOString();

function checkTask(raw) {
  if (!raw || !/^[a-zA-Z0-9:_-]{1,100}$/.test(raw.id || '') ||
      !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 5 || raw.durationMinutes > 24 * 60)
    throw new Error('Opgave kræver entydigt ID og varighed på 5–1440 minutter.');
  const earliest = raw.earliestStart ? instant(raw.earliestStart, `${raw.id}.earliestStart`) : -Infinity;
  const deadline = raw.deadline ? instant(raw.deadline, `${raw.id}.deadline`) : Infinity;
  if (deadline < earliest) throw new Error(`Opgave ${raw.id} har deadline før tidligste start.`);
  const dependencies = raw.dependencies || [];
  if (!Array.isArray(dependencies) || dependencies.length > 30 || dependencies.some(d => typeof d !== 'string'))
    throw new Error(`Ugyldige afhængigheder for ${raw.id}.`);
  const lockedStart = raw.lockedStart ? instant(raw.lockedStart, `${raw.id}.lockedStart`) : null;
  const allowedWindows = raw.allowedWindows === undefined ? [] : raw.allowedWindows;
  if (!Array.isArray(allowedWindows) || allowedWindows.length > 30)
    throw new Error(`Ugyldige tilladte tidsvinduer for ${raw.id}.`);
  return { id: raw.id, title: String(raw.title || raw.id).slice(0, 160),
    duration: raw.durationMinutes * MINUTE, earliest, deadline, dependencies,
    lockedStart, priority: Number.isInteger(raw.priority) ? raw.priority : 0,
    allowedWindows: allowedWindows.map(window => interval(window, `${raw.id}.allowedWindow`)),
    source: raw.source || null };
}

function orderedTasks(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Opgave-ID skal være unikke.');
  const ordered = [];
  const visited = new Set();
  const active = new Set();
  const visit = task => {
    if (active.has(task.id)) throw new Error(`Cirkulær afhængighed ved ${task.id}.`);
    if (visited.has(task.id)) return;
    active.add(task.id);
    for (const id of task.dependencies) {
      const dep = byId.get(id);
      if (!dep) throw new Error(`Ukendt afhængighed ${id} for ${task.id}.`);
      visit(dep);
    }
    active.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };
  for (const task of [...tasks].sort((a, b) => a.deadline - b.deadline || b.priority - a.priority || a.id.localeCompare(b.id))) visit(task);
  return ordered;
}

function fitsWindow(span, windows) { return windows.some(window => span.start >= window.start && span.end <= window.end); }

export function planPersonalTasks({ tasks = [], calendarEvents = [], workWindows = [],
  calendarCoverage = null, timeZone = 'Europe/Copenhagen', bufferMinutes = 0 } = {}) {
  try { new Intl.DateTimeFormat('da-DK', { timeZone }); }
  catch { throw new Error('Ugyldig IANA-tidszone.'); }
  if (!Array.isArray(tasks) || !Array.isArray(calendarEvents) || !Array.isArray(workWindows) ||
      tasks.length > 250 || calendarEvents.length > 1000 || workWindows.length > 500)
    throw new Error('Ugyldige eller for store planlægningsdata.');
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 180)
    throw new Error('Buffer skal være 0–180 minutter.');
  const normalized = orderedTasks(tasks.map(checkTask));
  const windows = workWindows.map(w => interval(w, 'arbejdsvindue')).sort((a, b) => a.start - b.start);
  if (!windows.length) return { feasible: false, proposals: [], conflicts: [{ code: 'no-windows',
    explanation: 'Ingen tilladte tidsvinduer er registreret.' }], alternatives: ['Registrér tidsvinduer eller ændr opgavefrist.'] };
  const covered = calendarCoverage?.status === 'ready' && calendarCoverage.start && calendarCoverage.end &&
    instant(calendarCoverage.start, 'kalenderdækning.start') <= windows[0].start &&
    instant(calendarCoverage.end, 'kalenderdækning.end') >= Math.max(...windows.map(w => w.end));
  if (!covered) return { feasible: false, proposals: [], conflicts: [{ code: 'calendar-unknown',
    explanation: 'Kalenderens dækning og aktualitet er ukendt. Ledig tid kan ikke fastslås.' }],
    alternatives: ['Opdatér den valgte kalender eller gennemgå tilgængeligheden manuelt.'] };

  const reservations = calendarEvents.map(raw => {
    const span = interval(raw, 'kalenderaftale');
    return { start: span.start - bufferMinutes * MINUTE, end: span.end + bufferMinutes * MINUTE,
      source: raw.source || { kind: 'calendar' } };
  });
  const results = new Map();
  const conflicts = [];
  // Reserve all locked choices before planning flexible tasks.
  for (const task of normalized.filter(task => task.lockedStart !== null)) {
    const span = { start: task.lockedStart, end: task.lockedStart + task.duration,
      source: { kind: 'personal-task', id: task.id } };
    const valid = fitsWindow(span, windows) &&
      (!task.allowedWindows.length || fitsWindow(span, task.allowedWindows)) &&
      span.start >= task.earliest && span.end <= task.deadline &&
      reservations.every(other => !overlapping(span, other));
    if (!valid) {
      conflicts.push({ taskId: task.id, code: 'locked-conflict', explanation: `Låst tid til ${task.title} kolliderer med en aftale, et vindue eller en frist.` });
      continue;
    }
    results.set(task.id, span);
    reservations.push(span);
  }

  for (const task of normalized) {
    const dependencies = task.dependencies.map(id => results.get(id));
    if (dependencies.some(value => !value)) {
      conflicts.push({ taskId: task.id, code: 'dependency-unavailable', explanation: `Forudgående arbejde for ${task.title} kan ikke placeres.` });
      continue;
    }
    const earliest = Math.max(task.earliest, ...dependencies.map(span => span.end));
    if (task.lockedStart !== null) {
      const locked = results.get(task.id);
      if (locked && locked.start < earliest) {
        results.delete(task.id);
        conflicts.push({ taskId: task.id, code: 'locked-dependency', explanation: `Låst tid til ${task.title} ligger før en afhængighed.` });
      }
      continue;
    }
    let chosen = null;
    for (const window of windows) {
      let start = Math.max(window.start, earliest);
      while (start + task.duration <= Math.min(window.end, task.deadline)) {
        const span = { start, end: start + task.duration };
        const conflict = reservations.filter(other => overlapping(span, other)).sort((a, b) => a.end - b.end)[0];
        if (!conflict && (!task.allowedWindows.length || fitsWindow(span, task.allowedWindows))) {
          chosen = span; break;
        }
        if (!conflict) {
          const following = task.allowedWindows.find(allowed => allowed.start > start &&
            allowed.start < Math.min(window.end, task.deadline));
          if (!following) break;
          start = following.start;
          continue;
        }
        start = Math.max(start + MINUTE, conflict.end);
      }
      if (chosen) break;
    }
    if (!chosen) {
      conflicts.push({ taskId: task.id, code: task.allowedWindows.length ? 'personal-window-capacity' : 'capacity',
        explanation: `Der er ikke en sammenhængende ledig blok til ${task.title} i de tilladte tider inden fristen.` });
      continue;
    }
    chosen.source = { kind: 'personal-task', id: task.id };
    results.set(task.id, chosen);
    reservations.push(chosen);
  }
  const proposals = normalized.filter(task => results.has(task.id)).map(task => {
    const span = results.get(task.id);
    return { taskId: task.id, title: task.title, start: iso(span.start), end: iso(span.end),
      locked: task.lockedStart !== null, source: task.source };
  });
  return { feasible: conflicts.length === 0, proposals, conflicts,
    alternatives: conflicts.length ? ['Reducer varighed eller opgavens scope.', 'Flyt eller frigør en låst opgave.',
      'Vælg et ekstra tidsvindue eller genforhandl deadline.'] : [],
    timeZone, calendarCoverage: { status: 'ready', start: calendarCoverage.start, end: calendarCoverage.end } };
}
