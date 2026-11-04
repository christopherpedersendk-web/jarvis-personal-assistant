import { randomUUID } from 'node:crypto';

export const DEFAULT_PROACTIVE_SETTINGS = Object.freeze({
  dailyEnabled: true,
  weeklyEnabled: true,
  discordEnabled: false,
  dailyTime: '07:30',
  weeklyTime: '18:00',
  quietStart: '22:00',
  quietEnd: '07:00',
});

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function validateProactiveSettings(changes = {}, current = DEFAULT_PROACTIVE_SETTINGS) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Ugyldige proaktive indstillinger.');
  const result = { ...DEFAULT_PROACTIVE_SETTINGS, ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(DEFAULT_PROACTIVE_SETTINGS, key)) throw new Error('Ukendt proaktiv indstilling.');
    if (key.endsWith('Enabled')) {
      if (typeof value !== 'boolean') throw new Error('Indstillingen skal være sand eller falsk.');
    } else if (typeof value !== 'string' || !CLOCK.test(value)) throw new Error('Klokkeslæt skal være HH:MM.');
    result[key] = value;
  }
  if (result.quietStart === result.quietEnd) throw new Error('Stilletid må ikke starte og slutte samtidig.');
  return result;
}

function localClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23',
  }).formatToParts(now).map(item => [item.type, item.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function minutes(value) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); }

export function withinQuietHours(clock, settings) {
  const start = minutes(settings.quietStart);
  const end = minutes(settings.quietEnd);
  return start < end ? clock.minutes >= start && clock.minutes < end : clock.minutes >= start || clock.minutes < end;
}

function item(priority, title, detail, source, tab, date = null) {
  return { priority, title: String(title).slice(0, 160), detail: String(detail).slice(0, 320), source, tab, date };
}

export function buildPersonalAgenda({ state, organizer, now = new Date() }) {
  const dates = organizer.upcoming(14);
  const today = [];
  const week = [];
  const insights = [];
  for (const due of dates.slice(0, 25)) {
    const entry = item(due.daysUntil === 0 ? 'high' : 'normal', due.title,
      `${due.daysUntil === 0 ? 'I dag' : `Om ${due.daysUntil} dage`} · ${due.collectionTitle} · ${due.date}`,
      { kind: 'organizer', collectionId: due.collectionId, itemId: due.itemId }, 'organizer', due.date);
    if (due.daysUntil <= 1) today.push(entry);
    if (due.daysUntil <= 7) week.push(entry);
  }
  for (const task of (state.tasks || []).filter(x => !x.archived)) {
    if (task.status === 'failed') insights.push(item('high', `Opgave fejlede: ${task.title}`, 'Se sidste kørselsresultat og beslut om et nyt forsøg.',
      { kind: 'task', id: task.id }, 'tasks'));
    if (task.status === 'scheduled' && task.nextRunAt) {
      const hours = (Date.parse(task.nextRunAt) - now.getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0 && hours <= 36) today.push(item('normal', `Planlagt: ${task.title}`,
        `Næste kørsel: ${task.nextRunAt}`, { kind: 'task', id: task.id }, 'tasks', task.nextRunAt));
    }
  }
  const approvals = (state.approvals || []).filter(x => x.status === 'pending');
  if (approvals.length) insights.push(item('high', `${approvals.length} handling(er) afventer din godkendelse`,
    'Godkendelse er ikke udførelse.', { kind: 'approvals', ids: approvals.slice(0, 8).map(x => x.id) }, 'secretary'));
  const unread = (state.inbox || []).filter(x => !x.read && x.kind !== 'proactive');
  if (unread.length) insights.push(item('normal', `${unread.length} ulæst(e) besked(er)`,
    'Se JARVIS-indbakken.', { kind: 'inbox', ids: unread.slice(0, 8).map(x => x.id) }, 'secretary'));
  for (const project of (state.projects || []).filter(x => !x.archived && x.lastTest?.status === 'failed').slice(0, 3)) {
    insights.push(item('high', `Projekt med fejlet test: ${project.title}`, 'Kontrollér testresultatet, før du videreudvikler.',
      { kind: 'project', id: project.id }, 'projects'));
  }
  return { generatedAt: now.toISOString(), today: today.slice(0, 8), week: week.slice(0, 12), insights: insights.slice(0, 8),
    evidenceCount: today.length + week.length + insights.length };
}

function formatDigest(kind, agenda) {
  const entries = kind === 'daily' ? [...agenda.today, ...agenda.insights] : [...agenda.week, ...agenda.insights];
  const unique = entries.filter((entry, i) => entries.findIndex(other => JSON.stringify(other.source) === JSON.stringify(entry.source)) === i).slice(0, 7);
  if (!unique.length) return { entries: [], text: '' };
  return { entries: unique, text: unique.map(entry => `• ${entry.title}: ${entry.detail} [${entry.source.kind}]`).join('\n').slice(0, 2300) };
}

export class ProactivePlanner {
  constructor({ state, organizer, save, notify = async () => false, now = () => new Date() }) {
    this.state = state;
    this.organizer = organizer;
    this.save = save;
    this.notify = notify;
    this.now = now;
    this.state.settings ||= {};
    this.state.proactiveDigests ||= [];
    this.running = false;
  }

  settings() { return validateProactiveSettings({}, this.state.settings.proactive || {}); }

  async configure(changes) {
    const next = validateProactiveSettings(changes, this.settings());
    this.state.settings.proactive = next;
    await this.save();
    return next;
  }

  preview(now = this.now()) { return buildPersonalAgenda({ state: this.state, organizer: this.organizer, now }); }

  history() { return this.state.proactiveDigests.slice(0, 20); }

  async tick() {
    if (this.running) return [];
    this.running = true;
    try {
      const now = this.now();
      const clock = localClock(now);
      const settings = this.settings();
      if (withinQuietHours(clock, settings)) return [];
      const eligibility = [
        { kind: 'daily', enabled: settings.dailyEnabled, time: settings.dailyTime },
        { kind: 'weekly', enabled: settings.weeklyEnabled && clock.weekday === 0, time: settings.weeklyTime },
      ];
      const sent = [];
      for (const { kind, enabled, time } of eligibility) {
        const elapsed = clock.minutes - minutes(time);
        if (!enabled || elapsed < 0 || elapsed > 120) continue; // Ingen forsinkede nattelige eller flere dage gamle beskeder.
        const key = `${kind}:${clock.date}`;
        if (this.state.proactiveDigests.some(x => x.key === key)) continue;
        const { entries, text } = formatDigest(kind, this.preview(now));
        const title = kind === 'daily' ? 'JARVIS · Dagens overblik' : 'JARVIS · Ugens overblik';
        const record = { key, kind, at: now.toISOString(), itemCount: entries.length,
          sourceRefs: entries.map(x => x.source).slice(0, 7), discordDelivered: false };
        this.state.proactiveDigests.unshift(record);
        this.state.proactiveDigests = this.state.proactiveDigests.slice(0, 90);
        if (entries.length) {
          this.state.inbox ||= [];
          this.state.inbox.unshift({ id: randomUUID(), title, text, kind: 'proactive', taskId: null,
            read: false, at: now.toISOString(), sourceRefs: record.sourceRefs });
          this.state.inbox = this.state.inbox.slice(0, 100);
        }
        await this.save(); // Gem deduplikation og indbakke samlet før eventuel ekstern notifikation.
        if (entries.length && settings.discordEnabled && this.state.settings.discordAlertsEnabled === true) {
          try { record.discordDelivered = await this.notify(title, text) === true; await this.save(); }
          catch (error) { console.error('Proaktiv Discord-fejl:', error.message); }
        }
        sent.push(record);
      }
      return sent;
    } finally { this.running = false; }
  }
}
