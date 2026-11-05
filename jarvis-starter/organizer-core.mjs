import { randomUUID } from 'node:crypto';
import { buildTodayOverview, latestMonitorObservations } from './planning-advisor.mjs';

const TYPES = new Set(['list', 'dates', 'gifts', 'shopping', 'notes']);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function requiredText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} skal være 1–${max} tegn.`);
  return value.trim();
}

function calendarDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !isoDate.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Dato skal være en gyldig kalenderdato (YYYY-MM-DD).');
  return value;
}

function todayInCopenhagen(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function nextOccurrence(date, annual, today) {
  if (!date) return null;
  if (!annual) return date;
  const year = Number(today.slice(0, 4));
  const monthAndDay = date.slice(4);
  for (let i = 0; i <= 8; i++) {
    const candidate = `${year + i}${monthAndDay}`;
    if (!isoDate.test(candidate)) continue;
    try { if (calendarDate(candidate) && candidate >= today) return candidate; }
    catch { /* 29. februar findes kun i skudår. */ }
  }
  return null;
}

function calendarDaysBetween(today, date) {
  const a = Date.UTC(...today.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  const b = Date.UTC(...date.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  return Math.round((b - a) / 86_400_000);
}

function checkUpdatedAt(record, expected, label) {
  // Legacy tool calls may omit a revision. Interactive editors always provide
  // the version they actually reviewed; an empty/malformed version is not an
  // instruction to disable the check.
  if (expected !== undefined && (typeof expected !== 'string' || !expected || expected !== record.updatedAt))
    throw new Error(`${label} er opdateret på en anden enhed. Hent den nyeste version, før du gemmer.`);
}

export class OrganizerCore {
  constructor({ state, save, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.state.organizer ||= [];
  }

  list() { return this.state.organizer.filter(c => !c.archived); }

  summary() { return this.list().map(({ id, title, type, items, updatedAt }) => ({ id, title, type, itemCount: items.length,
    recentItems: items.slice(-8).map(({ id, text, done, date }) => ({ id, text, done, date })), updatedAt })); }

  search(query) {
    const q = requiredText(query, 'Søgetekst', 120).toLocaleLowerCase('da-DK');
    return this.list().flatMap(collection => collection.items.filter(item => `${item.text} ${item.notes}`.toLocaleLowerCase('da-DK').includes(q))
      .map(item => ({ collectionId: collection.id, collectionTitle: collection.title, ...item }))).slice(0, 50);
  }

  findCollection(id) {
    const collection = this.list().find(c => c.id === id);
    if (!collection) throw new Error('Listen findes ikke.');
    return collection;
  }

  nextUpdatedAt(previous) {
    // Two writes in the same millisecond must still have distinct optimistic
    // versions, including a clock that moves backwards after restart.
    const earlier = Date.parse(previous || '');
    return new Date(Math.max(this.now().getTime(), Number.isFinite(earlier) ? earlier + 1 : 0)).toISOString();
  }

  async create({ title, type }) {
    if (!TYPES.has(type)) throw new Error('Ukendt listetype.');
    if (this.list().length >= 80) throw new Error('Du kan højst have 80 lister og notesamlinger.');
    const collection = { id: randomUUID(), title: requiredText(title, 'Titel', 100), type, items: [], createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    this.state.organizer.unshift(collection);
    await this.save();
    return collection;
  }

  async rename(id, title, { updatedAt } = {}) {
    const collection = this.findCollection(id);
    checkUpdatedAt(collection, updatedAt, 'Listen');
    collection.title = requiredText(title, 'Titel', 100);
    collection.updatedAt = this.nextUpdatedAt(collection.updatedAt);
    await this.save();
    return collection;
  }

  async archive(id, { updatedAt } = {}) {
    const collection = this.findCollection(id);
    checkUpdatedAt(collection, updatedAt, 'Listen');
    collection.archived = true;
    collection.updatedAt = this.nextUpdatedAt(collection.updatedAt);
    await this.save();
    return collection;
  }

  async addItem(id, { text, notes = '', date = null, annual = false }) {
    const collection = this.findCollection(id);
    if (collection.items.length >= 200) throw new Error('Højst 200 punkter i hver samling.');
    if (typeof notes !== 'string' || notes.length > 2500) throw new Error('Noter må højst være 2.500 tegn.');
    const item = { id: randomUUID(), text: requiredText(text, 'Tekst', 350), notes, date: calendarDate(date), annual: Boolean(annual), done: false,
      createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    collection.items.push(item);
    collection.updatedAt = this.nextUpdatedAt(collection.updatedAt);
    await this.save();
    return item;
  }

  async updateItem(id, itemId, changes) {
    const collection = this.findCollection(id);
    const item = collection.items.find(x => x.id === itemId);
    if (!item) throw new Error('Punktet findes ikke.');
    checkUpdatedAt(item, changes.updatedAt, 'Punktet');
    if (changes.text !== undefined) item.text = requiredText(changes.text, 'Tekst', 350);
    if (changes.notes !== undefined) {
      if (typeof changes.notes !== 'string' || changes.notes.length > 2500) throw new Error('Noter må højst være 2.500 tegn.');
      item.notes = changes.notes;
    }
    if (changes.date !== undefined) item.date = calendarDate(changes.date);
    if (changes.annual !== undefined) item.annual = Boolean(changes.annual);
    if (changes.done !== undefined) {
      if (typeof changes.done !== 'boolean') throw new Error('Afkrydsning skal være sand/falsk.');
      item.done = changes.done;
    }
    item.updatedAt = this.nextUpdatedAt(item.updatedAt);
    collection.updatedAt = this.nextUpdatedAt(collection.updatedAt);
    await this.save();
    return item;
  }

  async removeItem(id, itemId, { updatedAt } = {}) {
    const collection = this.findCollection(id);
    const index = collection.items.findIndex(x => x.id === itemId);
    if (index < 0) throw new Error('Punktet findes ikke.');
    checkUpdatedAt(collection.items[index], updatedAt, 'Punktet');
    collection.items.splice(index, 1);
    collection.updatedAt = this.nextUpdatedAt(collection.updatedAt);
    await this.save();
    return { removed: true };
  }

  upcoming(days = 30) {
    const today = todayInCopenhagen(this.now());
    return this.list().flatMap(collection => collection.items.filter(x => !x.done && x.date).map(item => {
      const due = nextOccurrence(item.date, item.annual, today);
      return { collectionId: collection.id, collectionTitle: collection.title, collectionType: collection.type,
        itemId: item.id, title: item.text, date: due, annual: item.annual,
        daysUntil: due ? calendarDaysBetween(today, due) : null };
    })).filter(x => x.daysUntil !== null && x.daysUntil >= 0 && x.daysUntil <= days).sort((a, b) => a.daysUntil - b.daysUntil);
  }

  context() {
    const lines = this.list().flatMap(collection => [
      `${collection.title} (${collection.type}, ID ${collection.id}):`,
      ...collection.items.slice(-35).map(item => `- [${item.done ? 'x' : ' '}] ${item.text} [punkt-ID ${item.id}]${item.date ? `, dato ${item.date}${item.annual ? ' (årligt)' : ''}` : ''}${item.notes ? `; ${item.notes}` : ''}`),
    ]);
    return lines.join('\n').slice(0, 12000);
  }
}

export function buildCommandCenter({ state, organizer, now = new Date(), calendarSnapshot = null, validateMealSources } = {}) {
  const tasks = (state.tasks || []).filter(x => !x.archived);
  const mostRecent = (filter) => tasks.filter(filter).flatMap(task => (task.runs || []).map(run => ({ ...run, taskId: task.id, taskTitle: task.title, category: task.category })))
    .filter(r => r.status === 'completed').sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const briefing = mostRecent(x => x.category === 'briefing');
  const monitor = latestMonitorObservations(tasks, now)[0] || null;
  const upcoming = organizer.upcoming(30).slice(0, 8);
  const awaiting = (state.approvals || []).filter(x => x.status === 'pending').slice(0, 6);
  const unseen = (state.inbox || []).filter(x => !x.read).slice(0, 6);
  const failed = tasks.filter(x => x.status === 'failed').slice(0, 4);
  const next = tasks.filter(x => x.status === 'scheduled' && x.nextRunAt).sort((a,b)=>a.nextRunAt.localeCompare(b.nextRunAt)).slice(0, 5)
    .map(({ id,title,nextRunAt,category }) => ({ id,title,nextRunAt,category }));
  const suggestions = [];
  for (const item of upcoming.filter(x => x.daysUntil <= 14).slice(0, 3)) {
    suggestions.push({ title: `${item.daysUntil === 0 ? 'I dag' : `Om ${item.daysUntil} dage`}: ${item.title}`, detail: `Fra ${item.collectionTitle} · ${item.date}`,
      source: { kind: 'organizer', collectionId: item.collectionId, itemId: item.itemId }, tab: 'organizer' });
  }
  if (failed.length) suggestions.push({ title: `${failed.length} opgave(r) kræver fejlgennemgang`, detail: failed.map(x=>x.title).join(', ').slice(0,180), source: { kind: 'tasks', ids: failed.map(x=>x.id) }, tab: 'tasks' });
  if (awaiting.length) suggestions.push({ title: `${awaiting.length} handling(er) afventer godkendelse`, detail: awaiting.map(x=>x.title).join(', ').slice(0,180), source: { kind: 'approvals', ids: awaiting.map(x=>x.id) }, tab: 'secretary' });
  if (monitor) suggestions.push({ title: `${monitor.status === 'unknown' ? 'Ukendt overvågningsudfald' : 'Seneste registrerede ændring'}: ${monitor.taskTitle}`,
    detail: `${monitor.at ? `Fra kørsel ${monitor.at}. ` : 'Kørselstidspunkt ukendt. '}${monitor.note}`, source: monitor.source, tab: 'plan' });
  return { generatedAt: now.toISOString(), briefing: briefing && { taskTitle: briefing.taskTitle, at: briefing.at, result: briefing.result.slice(0, 7000), taskId: briefing.taskId },
    monitor, todayOverview: buildTodayOverview({ state, now, calendarSnapshot, validateMealSources }),
    upcoming, awaiting, unseen, next, suggestions, projects: (state.projects || []).filter(project => !project.archived).slice(0, 4)
      .map(({ id,title,revision,lastTest,updatedAt }) => ({ id,title,revision,lastTest,updatedAt })) };
}
