import { randomUUID } from 'node:crypto';

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 30 * 24 * 60;
const DEFAULT_RETRY = Object.freeze({ maxRetries: 1, delayMinutes: 5 });

function checkedRetry(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['maxRetries', 'delayMinutes'].includes(key))) throw new Error('Ugyldig genforsøgspolitik.');
  const maxRetries = value.maxRetries ?? DEFAULT_RETRY.maxRetries;
  const delayMinutes = value.delayMinutes ?? DEFAULT_RETRY.delayMinutes;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3 ||
      !Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 180) throw new Error('Ugyldig genforsøgspolitik.');
  return { maxRetries, delayMinutes };
}

function recurring(task) { return Boolean(task.intervalMinutes || task.dailyTime); }

function regularNext(task, now) {
  return task.dailyTime ? nextCopenhagenTime(now, task.dailyTime)
    : new Date(now.getTime() + task.intervalMinutes * 60_000).toISOString();
}

function failureKind(error) {
  if (error?.unknownOutcome === true) return 'unknown';
  if (error?.permanent === true || error?.retryable === false || ['PERMISSION_DENIED', 'AUTH_EXPIRED', 'INVALID_INPUT'].includes(error?.code)) return 'permanent';
  // A failed read/network call is eligible for bounded retries; never retry
  // an external write whose outcome may be unknown.
  return 'temporary';
}

/** Monitoring uses explicit observations, not NO_CHANGE/CHANGE text prefixes. */
export function normalizeObservation(value, at = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['changed', 'unchanged', 'unknown'].includes(value.status)) throw new Error('Observation mangler gyldig status.');
  const text = (field, max = 240) => typeof value[field] === 'string' ? value[field].slice(0, max) : '';
  if (!text('subject') || !text('source')) throw new Error('Observation kræver emne og kilde.');
  return { status: value.status, subject: text('subject'), variant: text('variant'),
    unit: text('unit', 40), value: typeof value.value === 'string' ? value.value.slice(0, 240)
      : typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null,
    source: text('source', 1000), observedAt: at.toISOString() };
}

export function nextCopenhagenTime(now, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Tidspunktet skal være HH:MM (dansk tid).');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const start = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  for (let minute = 0; minute < 50 * 60; minute++) {
    const candidate = new Date(start + minute * 60_000);
    if (formatter.format(candidate) === time) return candidate.toISOString();
  }
  throw new Error('Kunne ikke beregne næste danske tidspunkt.');
}

export class TaskEngine {
  constructor({ state, save, runTask, notify = async () => {}, now = () => new Date(), maxRunsPerDay = 10,
    skillsRegistry = null }) {
    this.state = state;
    this.save = save;
    this.runTask = runTask;
    this.notify = notify;
    this.now = now;
    this.maxRunsPerDay = Math.min(100, Math.max(1, Number(maxRunsPerDay) || 10));
    this.skillsRegistry = skillsRegistry;
    this.active = false;
    this.state.tasks ||= [];
    this.state.usage ||= { day: '', started: 0 };
    for (const task of this.state.tasks) {
      if (task.status === 'running') {
        // A persisted background response ID can be polled again by the
        // read-only research/monitor worker without creating a new request.
        const resumableRead = recurring(task) && typeof task.responseId === 'string' &&
          task.responseId.length > 0 && ['research', 'briefing', 'monitor'].includes(task.category);
        task.status = resumableRead ? 'scheduled' : 'interrupted';
        task.nextRunAt = resumableRead ? this.now().toISOString() : null;
        task.interruptionReason = resumableRead ? 'Genoptager den eksisterende læsebaserede opgave.'
          : 'Uafklaret udfald efter genstart; genoptag eksplicit.';
      }
    }
  }

  currentUsage() {
    const day = this.now().toISOString().slice(0, 10);
    if (this.state.usage.day !== day) this.state.usage = { day, started: 0 };
    return { ...this.state.usage, maxRunsPerDay: this.maxRunsPerDay };
  }

  list() {
    return this.state.tasks.filter(task => !task.archived)
      .sort((a, b) => (a.nextRunAt || '9999').localeCompare(b.nextRunAt || '9999'));
  }

  async create(input) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!title || title.length > 120) throw new Error('Titel skal være 1–120 tegn.');
    if (!prompt || prompt.length > 3500) throw new Error('Opgaven skal være 1–3.500 tegn.');
    if (this.list().length >= 100) throw new Error('Maksimalt 100 aktive opgaver. Arkivér nogle først.');
    const intervalMinutes = Number(input.intervalMinutes || 0);
    if (!Number.isInteger(intervalMinutes) || (intervalMinutes !== 0 && (intervalMinutes < MIN_INTERVAL || intervalMinutes > MAX_INTERVAL))) {
      throw new Error('Gentagelser skal være mindst hver time og højst hver 30. dag.');
    }
    const category = input.category || 'research';
    if (!['research', 'briefing', 'monitor'].includes(category)) throw new Error('Ukendt opgavetype.');
    const dailyTime = input.dailyTime || null;
    if (dailyTime && intervalMinutes) throw new Error('Vælg enten et dagligt klokkeslæt eller et interval.');
    const now = this.now();
    const retryPolicy = checkedRetry(input.retryPolicy);
    if (input.skillId !== undefined && (!/^[a-z][a-z0-9-]{1,79}$/.test(input.skillId) ||
        !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(input.skillVersion || ''))) throw new Error('Skill kræver ID og version.');
    if (input.skillId && this.skillsRegistry) this.skillsRegistry.resolve(input.skillId, input.skillVersion);
    const next = dailyTime ? new Date(nextCopenhagenTime(now, dailyTime)) : input.runAt ? new Date(input.runAt) : now;
    if (Number.isNaN(next.getTime()) || next.getTime() > now.getTime() + 366 * 24 * 3600_000) {
      throw new Error('Ugyldig dato eller mere end et år fremme.');
    }
    const task = {
      id: randomUUID(), title, prompt, intervalMinutes, category, dailyTime,
      retryPolicy, retryAttempt: 0, consecutiveFailures: 0,
      skillId: input.skillId || null, skillVersion: input.skillVersion || null,
      timeZone: 'Europe/Copenhagen', deliveryChannel: 'inbox',
      nextRunAt: new Date(Math.max(next.getTime(), now.getTime())).toISOString(),
      status: 'scheduled', archived: false, responseId: null,
      runs: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    this.state.tasks.push(task);
    await this.save();
    return task;
  }

  async action(id, action) {
    const task = this.state.tasks.find(item => item.id === id && !item.archived);
    if (!task) throw new Error('Opgaven findes ikke.');
    if (task.status === 'running') throw new Error('Opgaven er i gang. Vent på resultatet.');
    if (action === 'pause') task.status = 'paused';
    else if (action === 'resume') {
      task.status = 'scheduled';
      task.nextRunAt ||= this.now().toISOString();
      task.retryAttempt = 0;
    } else if (action === 'run') {
      task.status = 'scheduled';
      task.nextRunAt = this.now().toISOString();
    } else if (action === 'archive') {
      task.archived = true;
      task.status = 'archived';
    } else throw new Error('Ukendt handling.');
    task.updatedAt = this.now().toISOString();
    await this.save();
    if (action === 'run') this.tick().catch(error => console.error('Opgavefejl:', error.message));
    return task;
  }

  async remove(id) {
    const task = this.state.tasks.find(item => item.id === id && !item.archived);
    if (!task) throw new Error('Opgaven findes ikke.');
    if (task.status === 'running') throw new Error('En igangværende opgave kan ikke slettes. Vent til den er færdig.');
    task.archived = true;
    task.status = 'archived';
    task.updatedAt = this.now().toISOString();
    await this.save();
    return task;
  }

  async tick() {
    if (this.active) return;
    const usage = this.currentUsage();
    if (usage.started >= this.maxRunsPerDay) return;
    const nowIso = this.now().toISOString();
    const task = this.list().find(t => t.status === 'scheduled' && t.nextRunAt <= nowIso);
    if (!task) return;
    this.active = true;
    this.state.usage.started += 1;
    task.status = 'running';
    task.updatedAt = nowIso;
    try {
      await this.save();
      const result = await this.runTask(task, async responseId => {
        task.responseId = responseId;
        await this.save();
      });
      const observation = result && typeof result === 'object' && result.observation
        ? normalizeObservation(result.observation, this.now()) : null;
      task.runs.unshift({ at: this.now().toISOString(), status: observation?.status === 'unknown' ? 'unknown' : 'completed',
        result: (typeof result === 'string' ? result : result?.summary || '').slice(0, 18000),
        ...(observation ? { observation } : {}) });
      task.runs = task.runs.slice(0, 10);
      task.responseId = null;
      task.lastRunStatus = task.runs[0].status;
      task.retryAttempt = 0;
      task.consecutiveFailures = 0;
      task.lastErrorKind = null;
      if (recurring(task)) {
        task.nextRunAt = regularNext(task, this.now());
        task.status = 'scheduled';
      } else {
        task.status = 'completed';
        task.nextRunAt = null;
      }
    } catch (error) {
      const kind = failureKind(error);
      task.runs.unshift({ at: this.now().toISOString(), status: kind === 'unknown' ? 'unknown' : 'failed',
        result: String(error.message).slice(0, 1500), errorKind: kind });
      task.runs = task.runs.slice(0, 10);
      task.lastRunStatus = task.runs[0].status;
      task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
      task.lastErrorKind = kind;
      task.responseId = null;
      if (recurring(task) && kind === 'temporary') {
        const policy = checkedRetry(task.retryPolicy);
        const attempts = task.retryAttempt || 0;
        task.nextRunAt = attempts < policy.maxRetries
          ? new Date(this.now().getTime() + policy.delayMinutes * 60_000 * 2 ** attempts).toISOString()
          : regularNext(task, this.now());
        task.retryAttempt = attempts < policy.maxRetries ? attempts + 1 : 0;
        task.status = 'scheduled';
      } else {
        task.status = recurring(task) ? 'paused' : 'failed';
        task.nextRunAt = null;
        task.retryAttempt = 0;
      }
    } finally {
      task.updatedAt = this.now().toISOString();
      try {
        await this.save();
        const status = task.runs[0]?.status;
        const observationStatus = task.runs[0]?.observation?.status;
        const observation = task.runs[0]?.observation;
        const previousObservation = task.runs[1]?.observation;
        const repeatedChange = observation?.status === 'changed' && previousObservation?.status === 'changed' &&
          ['subject', 'variant', 'unit', 'value', 'source'].every(key => observation[key] === previousObservation[key]);
        if (status === 'unknown' || status === 'completed' && observationStatus !== 'unchanged' && !repeatedChange ||
            status === 'failed' && (task.consecutiveFailures === 1 || task.status === 'paused')) {
          try { await this.notify(task, status); }
          catch (error) { console.error(`Notifikationsfejl: ${error.message}`); }
        }
      } finally { this.active = false; }
    }
  }
}
