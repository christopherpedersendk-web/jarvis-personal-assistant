import { randomUUID } from 'node:crypto';

// Personal work is intentionally kept separate from TaskEngine's automated jobs.
// Calendar coverage is never inferred from these records.
const ACTIVE = new Set(['pending', 'in_progress', 'blocked']);
const SOURCES = new Set(['user', 'manual', 'project', 'organizer', 'memory', 'discord']);
const CREATE_FIELDS = new Set(['title', 'purpose', 'expectedOutcome', 'durationMinutes',
  'durationUncertaintyMinutes', 'earliestStart', 'deadline', 'priority', 'dependencies',
  'allowedWindows', 'source', 'projectId', 'lockedStart', 'nextFollowUpAt']);
const UPDATE_FIELDS = new Set([...CREATE_FIELDS, 'status']);
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function timestamp(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} kræver et ISO-tidspunkt med tidszone.`);
  const match = INSTANT.exec(value);
  if (!match) throw new Error(`${label} kræver et ISO-tidspunkt med tidszone.`);
  const [, year, month, day, hour, minute, second = '00', offset] = match;
  const civil = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (civil.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4, 6)) > 59 ||
        Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4, 6)) !== 0))
    throw new Error(`Ugyldig dato i ${label}.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Ugyldig dato i ${label}.`);
  return new Date(milliseconds).toISOString();
}

function limitedText(value, label, max, required = true) {
  if (!required && (value === null || value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label} skal være 1–${max} tegn.`);
  return value.trim();
}

function taskSource(value) {
  if (value === null || value === undefined) return { kind: 'user', channel: 'manual' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !SOURCES.has(value.kind) ||
      Object.keys(value).some(key => !['kind', 'channel', 'id', 'revision'].includes(key)))
    throw new Error('Ugyldig kilde til personlig opgave.');
  if (value.id !== undefined && (typeof value.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(value.id)))
    throw new Error('Ugyldigt kilde-ID.');
  if (value.revision !== undefined && (!Number.isInteger(value.revision) || value.revision < 1))
    throw new Error('Ugyldig kilderevision.');
  if (value.channel !== undefined && !['manual', 'text', 'discord', 'voice', 'legacy'].includes(value.channel))
    throw new Error('Ugyldig kildekanal.');
  return { kind: value.kind, channel: value.channel || 'manual',
    ...(value.id ? { id: value.id } : {}), ...(value.revision ? { revision: value.revision } : {}) };
}

function checkedWindows(windows) {
  if (windows === undefined || windows === null) return [];
  if (!Array.isArray(windows) || windows.length > 30) throw new Error('Højst 30 tilladte tidsvinduer pr. opgave.');
  return windows.map((window, index) => {
    if (!window || typeof window !== 'object' || Array.isArray(window) ||
        Object.keys(window).some(key => !['start', 'end'].includes(key)))
      throw new Error('Ugyldigt tilladt tidsvindue.');
    const start = timestamp(window.start, `tidsvindue ${index + 1} start`);
    const end = timestamp(window.end, `tidsvindue ${index + 1} slut`);
    if (!start || !end || end <= start) throw new Error('Tidsvinduet skal slutte efter start.');
    return { start, end };
  }).sort((a, b) => a.start.localeCompare(b.start));
}

function checkedDependencies(value, id, tasks) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some(item =>
    typeof item !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(item))) throw new Error('Ugyldige opgaveafhængigheder.');
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.includes(id)) throw new Error('Dobbelt eller cirkulær opgaveafhængighed.');
  for (const dep of unique) {
    const task = tasks.find(item => item.id === dep);
    if (!task || task.status === 'archived') throw new Error(`Afhængig opgave findes ikke: ${dep}.`);
  }
  return unique;
}

function checkAcyclic(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const active = new Set();
  const visited = new Set();
  const visit = id => {
    if (active.has(id)) throw new Error('Cirkulær opgaveafhængighed.');
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of byId.get(id)?.dependencies || []) if (byId.has(dep)) visit(dep);
    active.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function validated(input, id, tasks) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !CREATE_FIELDS.has(key))) throw new Error('Ukendte eller ugyldige opgavefelter.');
  const title = limitedText(input.title, 'Titel', 160);
  const purpose = limitedText(input.purpose, 'Formål', 1200);
  const expectedOutcome = limitedText(input.expectedOutcome, 'Forventet resultat', 1000, false);
  const durationMinutes = input.durationMinutes;
  const durationUncertaintyMinutes = input.durationUncertaintyMinutes ?? 0;
  const priority = input.priority ?? 2;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440 ||
      !Number.isInteger(durationUncertaintyMinutes) || durationUncertaintyMinutes < 0 || durationUncertaintyMinutes > 1440)
    throw new Error('Opgavevarighed og usikkerhed skal være hele minutter.');
  if (!Number.isInteger(priority) || priority < 0 || priority > 5) throw new Error('Prioritet skal være 0–5.');
  const earliestStart = timestamp(input.earliestStart, 'Tidligste start');
  const deadline = timestamp(input.deadline, 'Deadline');
  const lockedStart = timestamp(input.lockedStart, 'Låst starttid');
  const nextFollowUpAt = timestamp(input.nextFollowUpAt, 'Næste opfølgning');
  if (earliestStart && deadline && earliestStart > deadline) throw new Error('Tidligste start er efter deadline.');
  if (lockedStart && (earliestStart && lockedStart < earliestStart ||
      deadline && Date.parse(lockedStart) + durationMinutes * 60_000 > Date.parse(deadline)))
    throw new Error('Låst starttid er uden for opgavens tidsgrænser.');
  const allowedWindows = checkedWindows(input.allowedWindows);
  if (lockedStart && allowedWindows.length && !allowedWindows.some(window =>
    lockedStart >= window.start && Date.parse(lockedStart) + durationMinutes * 60_000 <= Date.parse(window.end)))
    throw new Error('Låst opgave ligger uden for tilladte tidsvinduer.');
  const projectId = input.projectId === null || input.projectId === undefined ? null
    : limitedText(input.projectId, 'Projekt-ID', 120);
  return { title, purpose, expectedOutcome, durationMinutes, durationUncertaintyMinutes,
    earliestStart, deadline, priority, dependencies: checkedDependencies(input.dependencies, id, tasks),
    allowedWindows, source: taskSource(input.source), projectId, lockedStart, nextFollowUpAt };
}

export class PersonalTasks {
  constructor({ state, save = async () => {}, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.state.personalTasks ||= [];
  }

  list({ includeArchived = false } = {}) {
    return this.state.personalTasks.filter(task => includeArchived || task.status !== 'archived')
      .map(task => structuredClone(task));
  }

  async create(input) {
    if (this.list().length >= 250) throw new Error('Højst 250 aktive personlige opgaver.');
    const id = randomUUID();
    const fields = validated(input, id, this.state.personalTasks);
    const at = this.now().toISOString();
    const task = { id, revision: 1, status: 'pending', ...fields,
      createdAt: at, updatedAt: at, completedAt: null, archivedAt: null };
    checkAcyclic([...this.state.personalTasks, task]);
    this.state.personalTasks.push(task);
    try { await this.save(); }
    catch (error) { this.state.personalTasks = this.state.personalTasks.filter(item => item.id !== id); throw error; }
    return structuredClone(task);
  }

  async update(id, { expectedRevision, ...changes } = {}) {
    const task = this.state.personalTasks.find(item => item.id === id);
    if (!task || task.status === 'archived') throw new Error('Personlig opgave findes ikke.');
    if (!Number.isInteger(expectedRevision) || task.revision !== expectedRevision)
      throw new Error('Opgaven er ændret; genindlæs revisionen.');
    if (task.status === 'completed') throw new Error('En afsluttet opgave kan ikke ændres automatisk.');
    if (Object.keys(changes).some(key => !UPDATE_FIELDS.has(key))) throw new Error('Ukendt opgavefelt.');
    if (changes.status !== undefined && !ACTIVE.has(changes.status)) throw new Error('Brug complete eller archive for afslutning.');
    const status = changes.status ?? task.status;
    delete changes.status;
    const fields = validated(Object.fromEntries([...CREATE_FIELDS].map(key =>
      [key, changes[key] === undefined ? task[key] : changes[key]])), task.id, this.state.personalTasks);
    if (JSON.stringify(fields) === JSON.stringify(Object.fromEntries(Object.keys(fields).map(key => [key, task[key]]))) && status === task.status)
      return structuredClone(task);
    const previous = structuredClone(task);
    Object.assign(task, fields, { status, revision: task.revision + 1, updatedAt: this.now().toISOString() });
    try { checkAcyclic(this.state.personalTasks); await this.save(); }
    catch (error) { Object.keys(task).forEach(key => delete task[key]); Object.assign(task, previous); throw error; }
    return structuredClone(task);
  }

  async complete(id, expectedRevision) { return this.#finish(id, expectedRevision, 'completed'); }
  async archive(id, expectedRevision) { return this.#finish(id, expectedRevision, 'archived'); }

  async #finish(id, expectedRevision, status) {
    const task = this.state.personalTasks.find(item => item.id === id);
    if (!task || task.status === 'archived') throw new Error('Personlig opgave findes ikke.');
    if (!Number.isInteger(expectedRevision) || expectedRevision !== task.revision)
      throw new Error('Opgaven er ændret; genindlæs revisionen.');
    if (task.status === 'completed' && status === 'completed') throw new Error('Opgaven er allerede afsluttet.');
    if (status === 'archived' && this.state.personalTasks.some(other => other.status !== 'archived' &&
      other.status !== 'completed' && other.dependencies?.includes(id)))
      throw new Error('Ret først aktive opgaver, der afhænger af denne opgave.');
    const old = structuredClone(task);
    const at = this.now().toISOString();
    Object.assign(task, { status, revision: task.revision + 1, updatedAt: at,
      [status === 'completed' ? 'completedAt' : 'archivedAt']: at });
    try { await this.save(); }
    catch (error) { Object.keys(task).forEach(key => delete task[key]); Object.assign(task, old); throw error; }
    return structuredClone(task);
  }

  /** Return active task records using planPersonalTasks' task schema. */
  toPlanningTasks() {
    const active = this.state.personalTasks.filter(task => task.status === 'pending' || task.status === 'in_progress');
    const ids = new Set(active.map(task => task.id));
    for (const task of active) for (const dependency of task.dependencies) {
      const source = this.state.personalTasks.find(item => item.id === dependency);
      if (!source || source.status === 'archived' || source.status === 'blocked')
        throw new Error(`Opgaven ${task.title} afhænger af en utilgængelig opgave.`);
    }
    return active.map(task => ({ id: task.id, title: task.title, purpose: task.purpose,
      durationMinutes: task.durationMinutes, durationUncertaintyMinutes: task.durationUncertaintyMinutes,
      earliestStart: task.earliestStart, deadline: task.deadline, priority: task.priority,
      dependencies: task.dependencies.filter(dep => ids.has(dep)), allowedWindows: structuredClone(task.allowedWindows),
      lockedStart: task.lockedStart, source: { kind: 'personal-task', id: task.id, revision: task.revision },
      projectId: task.projectId, nextFollowUpAt: task.nextFollowUpAt }));
  }

  /** Postcondition until the shared capacity planner enforces per-task windows. */
  validateProposals(proposals) {
    if (!Array.isArray(proposals)) throw new Error('Ugyldige planforslag.');
    const tasks = new Map(this.toPlanningTasks().map(task => [task.id, task]));
    const conflicts = [];
    for (const proposal of proposals) {
      const task = tasks.get(proposal.taskId);
      if (!task) { conflicts.push({ taskId: proposal.taskId, code: 'unknown-task' }); continue; }
      const start = timestamp(proposal.start, 'Planlagt start');
      const end = timestamp(proposal.end, 'Planlagt slut');
      if (!start || !end || Date.parse(end) - Date.parse(start) !== task.durationMinutes * 60_000) {
        conflicts.push({ taskId: task.id, code: 'duration-conflict' }); continue;
      }
      if (task.lockedStart && task.lockedStart !== start) {
        conflicts.push({ taskId: task.id, code: 'locked-conflict' }); continue;
      }
      if (task.allowedWindows.length && !task.allowedWindows.some(window => start >= window.start && end <= window.end))
        conflicts.push({ taskId: task.id, code: 'personal-window-conflict' });
    }
    return { valid: conflicts.length === 0, conflicts };
  }
}
