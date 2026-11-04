// Pure, deliberately narrow calendar signal for meal suggestions. It neither
// stores event text nor infers who is home. Google has already expanded repeats.
const ZONE = 'Europe/Copenhagen';
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const DAY_MS = 24 * 60 * 60_000;

function checkedDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dato skal være YYYY-MM-DD.');
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('Ugyldig kalenderdato.');
  return timestamp;
}

function zonedDinnerInstant(day, hour) {
  const [year, month, date] = day.split('-').map(Number);
  const target = Date.UTC(year, month - 1, date, hour);
  let instant = target;
  // Dinner hours are unambiguous even on Danish DST-transition days. Solve for
  // the instant displaying the requested local wall time, never the host zone.
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(clockFormat.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = target - local;
    if (delta === 0) return instant;
    instant += delta;
  }
  throw new Error('Kalenderens danske tidszone kunne ikke beregnes.');
}

function eventInstant(value) {
  // A dateTime without a zone would depend on the execution host's timezone.
  // Google's normal response includes Z or an explicit numeric UTC offset.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  try { checkedDay(value.slice(0, 10)); } catch { return null; }
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

/** Return only YYYY-MM-DD values inside the requested plan range.
 * Timed events count when [start,end) overlaps Danish 16:00–20:00.
 * Multi-day all-day events cover [start,end), where Google's end is exclusive.
 * Single-day all-day notes/birthdays do not establish that dinner time is busy.
 * When calendarWindow is supplied, every requested dinner interval must be
 * fully observed; dates outside the fetched window are not assumed to be free.
 */
export function busyMealDates(events, { startDate, days = 5, now = new Date(), calendarWindow } = {}) {
  if (!Array.isArray(events) || events.length > 1000) throw new Error('Ugyldig kalenderoversigt.');
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('Madkalenderen skal dække 1–14 dage.');
  const current = typeof now === 'function' ? now() : now;
  if (startDate === undefined) {
    const date = current instanceof Date ? current : new Date(current);
    if (!Number.isFinite(date.getTime())) throw new Error('Ugyldigt aktuelt tidspunkt.');
    startDate = dayFormat.format(date);
  }
  const first = checkedDay(startDate);
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(first + index * DAY_MS).toISOString().slice(0, 10);
    return { date, start: zonedDinnerInstant(date, 16), end: zonedDinnerInstant(date, 20) };
  });
  if (calendarWindow !== undefined) {
    const from = calendarWindow?.from instanceof Date ? calendarWindow.from.getTime() : eventInstant(calendarWindow?.from);
    const until = calendarWindow?.until instanceof Date ? calendarWindow.until.getTime() : eventInstant(calendarWindow?.until);
    if (from === null || until === null || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) throw new Error('Ugyldigt observationsvindue fra kalenderen.');
    if (dates.some(slot => slot.start < from || slot.end > until)) throw new Error('Google Kalender dækker ikke hele den valgte madplansperiode. Vælg kommende middage inden for kalenderens hentede periode, eller slå kalendertilpasning fra.');
  }
  const busy = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object' || event.status === 'cancelled' || event.transparency === 'transparent') continue;
    if (event.allDay === true) {
      let from; let until;
      try { from = checkedDay(event.start); until = checkedDay(event.end); } catch { continue; }
      if (until - from <= DAY_MS) continue;
      for (const { date } of dates) if (event.start <= date && date < event.end) busy.add(date);
      continue;
    }
    const from = eventInstant(event.start);
    const until = eventInstant(event.end);
    if (from === null || until === null || until <= from) continue;
    for (const slot of dates) if (from < slot.end && until > slot.start) busy.add(slot.date);
  }
  return dates.filter(slot => busy.has(slot.date)).map(slot => slot.date);
}
