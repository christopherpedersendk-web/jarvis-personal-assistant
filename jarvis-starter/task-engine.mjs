import { createHash, randomUUID } from 'node:crypto';
import { createJobTransitions } from './job-state-transition.mjs';
import { rejectSecrets } from './privacy.mjs';
import { skillContentHash as skillHash } from './skills-registry.mjs';

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 30 * 24 * 60;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const READ_CATEGORIES = ['research', 'briefing', 'monitor'];
const READ_PERMISSIONS = Object.freeze(['web.search']);
const DEFAULT_RETRY = Object.freeze({ maxRetries: 1, delayMinutes: 5 });
const DEFAULT_MISSED = Object.freeze({ mode: 'coalesce', maxLatenessMinutes: 120 });
const DEFAULT_DELIVERY = Object.freeze({ channel: 'inbox', quietStart: '22:00', quietEnd: '07:00', deduplicate: true });
const DEFAULT_BUDGET = Object.freeze({ maxRunsPerDay: 10, maxOutputTokens: 3500 });

function fields(value, allowed, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) throw new Error(message);
}

function checkedRetry(value = {}) {
  fields(value, ['maxRetries', 'delayMinutes'], 'Ugyldig genforsøgspolitik.');
  const result = { ...DEFAULT_RETRY, ...value };
  if (!Number.isInteger(result.maxRetries) || result.maxRetries < 0 || result.maxRetries > 3 ||
      !Number.isInteger(result.delayMinutes) || result.delayMinutes < 1 || result.delayMinutes > 180) throw new Error('Ugyldig genforsøgspolitik.');
  return result;
}

function checkedMissed(value = {}) {
  fields(value, ['mode', 'maxLatenessMinutes'], 'Ugyldig politik for oversprungne kørsler.');
  const result = { ...DEFAULT_MISSED, ...value };
  if (!['coalesce', 'skip', 'pause'].includes(result.mode) || !Number.isInteger(result.maxLatenessMinutes) ||
      result.maxLatenessMinutes < 1 || result.maxLatenessMinutes > MAX_INTERVAL) throw new Error('Ugyldig politik for oversprungne kørsler.');
  return result;
}

function checkedDelivery(value = {}) {
  fields(value, Object.keys(DEFAULT_DELIVERY), 'Ugyldig leveringspolitik.');
  const result = { ...DEFAULT_DELIVERY, ...value };
  // Job parameters cannot add a recipient, channel, integration or permission.
  if (result.channel !== 'inbox' || !CLOCK.test(result.quietStart) || !CLOCK.test(result.quietEnd) ||
      result.quietStart === result.quietEnd || typeof result.deduplicate !== 'boolean') throw new Error('Ugyldig leveringspolitik.');
  return result;
}

function checkedBudget(value = {}) {
  fields(value, Object.keys(DEFAULT_BUDGET), 'Ugyldigt opgavebudget.');
  const result = { ...DEFAULT_BUDGET, ...value };
  if (!Number.isInteger(result.maxRunsPerDay) || result.maxRunsPerDay < 1 || result.maxRunsPerDay > 100 ||
      !Number.isInteger(result.maxOutputTokens) || result.maxOutputTokens < 256 || result.maxOutputTokens > 12000)
    throw new Error('Ugyldigt opgavebudget.');
  return result;
}

function checkedParameters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20)
    throw new Error('Opgaveparametre skal være et lille objekt med navngivne værdier.');
  const scalar = item => item === null || typeof item === 'boolean' ||
    typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 1000;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) ||
        !(scalar(item) || Array.isArray(item) && item.length <= 20 && item.every(scalar))) throw new Error('Ugyldige opgaveparametre.');
    result[key] = structuredClone(item);
  }
  if (JSON.stringify(result).length > 4000) throw new Error('Opgaveparametrene er for store.');
  return result;
}

function checkedZone(value = 'Europe/Copenhagen') {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Ugyldig tidszone.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); }
  catch { throw new Error('Ugyldig tidszone.'); }
  return value;
}

function localParts(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
}

/** Nonexistent DST times are skipped; afterDate prevents a second fall-back run. */
export function nextLocalTime(now, time, timeZone = 'Europe/Copenhagen', afterDate = null) {
  if (!CLOCK.test(time)) throw new Error('Tidspunktet skal være HH:MM (dansk tid som standard).');
  checkedZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const start = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  for (let minute = 0; minute < 74 * 60; minute++) {
    const candidate = new Date(start + minute * 60_000);
    const p = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    if (`${p.hour}:${p.minute}` === time && (!afterDate || `${p.year}-${p.month}-${p.day}` > afterDate)) return candidate.toISOString();
  }
  throw new Error('Kunne ikke beregne næste lokale tidspunkt.');
}

export function nextCopenhagenTime(now, time) { return nextLocalTime(now, time); }
function recurring(task) { return Boolean(task.intervalMinutes || task.dailyTime); }
function regularNext(task, now) {
  const zone = task.timeZone || 'Europe/Copenhagen';
  return task.dailyTime ? nextLocalTime(now, task.dailyTime, zone, localParts(now, zone).date)
    : new Date(now.getTime() + task.intervalMinutes * 60_000).toISOString();
}

function failureKind(error) {
  if (error?.unknownOutcome === true) return 'unknown';
  if (error?.permanent === true || error?.retryable === false || ['PERMISSION_DENIED', 'AUTH_EXPIRED', 'INVALID_INPUT'].includes(error?.code)) return 'permanent';
  return 'temporary';
}

function quietUntil(now, task) {
  const policy = checkedDelivery(task.deliveryPolicy);
  const zone = checkedZone(task.timeZone);
  const clock = localParts(now, zone).clock;
  const quiet = policy.quietStart < policy.quietEnd ? clock >= policy.quietStart && clock < policy.quietEnd
    : clock >= policy.quietStart || clock < policy.quietEnd;
  return quiet ? nextLocalTime(now, policy.quietEnd, zone) : null;
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

export class TaskEngine {
  constructor({ state, save, runTask, notify = async () => {}, now = () => new Date(), maxRunsPerDay = 10,
    skillsRegistry = null, transact = null, workQueue = null }) {
    this.state = state;
    this.save = save;
    this.runTask = runTask;
    this.notify = notify;
    this.now = now;
    this.maxRunsPerDay = Math.min(100, Math.max(1, Number(maxRunsPerDay) || 10));
    this.skillsRegistry = skillsRegistry;
    this.transact = transact || createJobTransitions(state);
    this.workQueue = workQueue;
    this.active = false;
    this.waiting = new Map();
    this.pendingCheckpoints = new Map();
    this.state.tasks ||= [];
    this.state.usage ||= { day: '', started: 0 };
    // Startup normalization occurs before the application publishes its frozen
    // committed view. recover() durably saves it before any external work.
    this.recoveryPending = false;
    for (const task of this.state.tasks) {
      task.runs ||= [];
      if (task.status === 'running' || task.status === 'queued') {
        const queued = task.status === 'queued';
        const resumable = Boolean(task.responseId) && READ_CATEGORIES.includes(task.category);
        task.status = queued || resumable ? 'scheduled' : 'interrupted';
        task.nextRunAt = queued || resumable ? this.now().toISOString() : null;
        task.interruptionReason = queued ? 'Ventende arbejde havde ingen ekstern virkning; genoptages kontrolleret.'
          : resumable ? 'Genoptager den eksisterende læsebaserede opgave.' : 'Uafklaret udfald efter genstart; genoptag eksplicit.';
        if (!queued && !resumable) { task.lastRunStatus = 'unknown'; task.lastErrorKind = 'unknown'; }
        this.recoveryPending = true;
      }
      for (const run of task.runs || []) if (run.delivery?.status === 'sending') {
        run.delivery.status = 'unknown';
        run.delivery.note = 'Levering blev afbrudt. Ingen automatisk genafsendelse.';
        this.recoveryPending = true;
      }
    }
  }

  async recover() {
    if (!this.recoveryPending) return;
    await this.transact(['tasks'], () => this.save());
    this.recoveryPending = false;
  }

  currentUsage() {
    const day = this.now().toISOString().slice(0, 10);
    return { ...(this.state.usage.day === day ? this.state.usage : { day, started: 0 }), maxRunsPerDay: this.maxRunsPerDay };
  }

  list() {
    return this.state.tasks.filter(task => !task.archived)
      .sort((a, b) => (a.nextRunAt || '9999').localeCompare(b.nextRunAt || '9999'));
  }

  #task(id) {
    const task = this.state.tasks.find(item => item.id === id);
    if (!task) throw new Error('Opgaven findes ikke.');
    return task;
  }

  #execution(task) {
    let skill = null;
    if (task.skillId) {
      if (!this.skillsRegistry) throw new Error('Opgavens gennemgåede skill-katalog er utilgængeligt.');
      skill = this.skillsRegistry.resolve(task.skillId, task.skillVersion);
      if (task.skillContentHash && skillHash(skill) !== task.skillContentHash) throw new Error('Skill-indholdet er ændret uden en ny version. Opgaven skal gennemgås.');
    }
    if (!READ_CATEGORIES.includes(task.category) || task.permissions &&
        (task.permissions.length !== 1 || task.permissions[0] !== 'web.search')) throw new Error('Opgaven må kun udføre godkendt læsebaseret research.');
    const binding = { skillId: task.skillId || null, skillVersion: task.skillVersion || null,
      skillContentHash: skill ? skillHash(skill) : null, parameters: checkedParameters(task.parameters),
      permissions: [...READ_PERMISSIONS], budget: checkedBudget(task.budget),
      timeZone: checkedZone(task.timeZone), schedule: { dailyTime: task.dailyTime || null,
        intervalMinutes: task.intervalMinutes || 0 }, retryPolicy: checkedRetry(task.retryPolicy),
      missedRunPolicy: checkedMissed(task.missedRunPolicy), deliveryPolicy: checkedDelivery(task.deliveryPolicy),
      category: task.category, prompt: task.prompt };
    return { ...binding, skill: skill ? { ...skill, contentHash: binding.skillContentHash } : null,
      bindingHash: createHash('sha256').update(JSON.stringify(binding)).digest('hex') };
  }

  #newTask(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Ugyldig opgave.');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!title || title.length > 120) throw new Error('Titel skal være 1–120 tegn.');
    if (!prompt || prompt.length > 3500) throw new Error('Opgaven skal være 1–3.500 tegn.');
    rejectSecrets({ title, prompt, parameters: input.parameters });
    const activation = input.activation ?? 'scheduled';
    if (!['scheduled', 'paused'].includes(activation)) throw new Error('Vælg pauset kladde eller eksplicit planlagt aktivering.');
    const intervalMinutes = Number(input.intervalMinutes || 0);
    if (!Number.isInteger(intervalMinutes) || (intervalMinutes !== 0 && (intervalMinutes < MIN_INTERVAL || intervalMinutes > MAX_INTERVAL)))
      throw new Error('Gentagelser skal være mindst hver time og højst hver 30. dag.');
    const category = input.category || 'research';
    if (!READ_CATEGORIES.includes(category)) throw new Error('Ukendt opgavetype.');
    const dailyTime = input.dailyTime || null;
    if (dailyTime && intervalMinutes) throw new Error('Vælg enten et dagligt klokkeslæt eller et interval.');
    if (input.skillId !== undefined && (!/^[a-z][a-z0-9-]{1,79}$/.test(input.skillId) ||
        !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(input.skillVersion || ''))) throw new Error('Skill kræver ID og version.');
    if (!input.skillId && input.skillVersion) throw new Error('Skill kræver ID og version.');
    if (input.permissions !== undefined && JSON.stringify(input.permissions) !== JSON.stringify(READ_PERMISSIONS))
      throw new Error('Opgaven kan ikke udvide sine tilladelser.');
    const now = this.now();
    const timeZone = checkedZone(input.timeZone);
    if (input.runAt !== undefined && input.runAt !== null) {
      const instant = typeof input.runAt === 'string' && /^(\d{4}-\d{2}-\d{2})T([0-2]\d):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(input.runAt);
      if (!instant || Number(instant[2]) > 23 || !Number.isFinite(Date.parse(input.runAt)) ||
          new Date(`${instant[1]}T00:00:00Z`).toISOString().slice(0, 10) !== instant[1])
        throw new Error('Datoen skal være et gyldigt, entydigt tidspunkt med Z eller UTC-forskydning.');
    }
    const next = dailyTime ? new Date(nextLocalTime(now, dailyTime, timeZone)) : input.runAt ? new Date(input.runAt) : now;
    if (Number.isNaN(next.getTime()) || next.getTime() > now.getTime() + 366 * 24 * 3600_000) throw new Error('Ugyldig dato eller mere end et år fremme.');
    const selectedSkill = input.skillId && this.skillsRegistry ? this.skillsRegistry.resolve(input.skillId, input.skillVersion) : null;
    const task = { id: randomUUID(), revision: 1, title, prompt, intervalMinutes, category, dailyTime, timeZone,
      retryPolicy: checkedRetry(input.retryPolicy), missedRunPolicy: checkedMissed(input.missedRunPolicy),
      deliveryPolicy: checkedDelivery(input.deliveryPolicy), budget: checkedBudget(input.budget === undefined ? selectedSkill?.contract?.budget.defaults : input.budget),
      parameters: checkedParameters(input.parameters), permissions: [...READ_PERMISSIONS],
      retryAttempt: 0, consecutiveFailures: 0, skillId: input.skillId || null, skillVersion: input.skillVersion || null,
      deliveryChannel: 'inbox', startOnActivation: !input.runAt && !dailyTime,
      nextRunAt: new Date(Math.max(next.getTime(), now.getTime())).toISOString(),
      status: activation, archived: false, responseId: null, activeRun: null,
      runs: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
    task.skillContentHash = this.#execution(task).skillContentHash;
    return task;
  }

  async create(input) {
    const task = this.#newTask(input);
    return this.transact(['tasks'], async () => {
      if (this.list().length >= 100) throw new Error('Maksimalt 100 aktive opgaver. Arkivér nogle først.');
      this.state.tasks.push(task);
      await this.save();
      return task;
    });
  }

  async update(id, input) {
    const allowed = ['expectedRevision', 'title', 'prompt', 'category', 'intervalMinutes', 'dailyTime', 'runAt',
      'skillId', 'skillVersion', 'parameters', 'permissions', 'timeZone', 'retryPolicy', 'missedRunPolicy',
      'deliveryPolicy', 'budget', 'activation'];
    fields(input, allowed, 'Ugyldige felter i jobpolitikken.');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
      throw new Error('Jobændringen kræver den præcise basisrevision.');
    if (input.activation !== undefined && input.activation !== 'paused')
      throw new Error('Gemte jobændringer skal forblive pausede. Aktivér først efter en særskilt gennemgang.');
    return this.transact(['tasks'], async () => {
      const current = this.#task(id);
      this.#requireRevision(current, input.expectedRevision);
      if (current.archived || !['paused', 'interrupted'].includes(current.status))
        throw new Error('Pause jobbet, før du ændrer politik eller instruktioner.');
      if (current.responseId || [...this.pendingCheckpoints.keys()].some(key => key.includes(id)))
        throw new Error('En eksisterende kørsel eller et lokalt kontrolpunkt er uafklaret. Afklar resultatet før politikændring.');
      const config = { ...current, ...input, activation: 'paused',
        runAt: Object.hasOwn(input, 'runAt') ? input.runAt : current.nextRunAt || undefined };
      if (!config.skillId && input.skillVersion) throw new Error('Skill kræver ID og version.');
      if (config.skillId === null || config.skillId === '') { delete config.skillId; delete config.skillVersion; }
      const validated = this.#newTask(config);
      for (const key of ['title', 'prompt', 'category', 'intervalMinutes', 'dailyTime', 'timeZone', 'retryPolicy',
        'missedRunPolicy', 'deliveryPolicy', 'budget', 'parameters', 'permissions', 'skillId', 'skillVersion',
        'skillContentHash', 'nextRunAt', 'startOnActivation']) current[key] = validated[key];
      current.revision = (current.revision || 1) + 1;
      current.updatedAt = this.now().toISOString();
      current.status = 'paused';
      current.activeRun = null;
      current.retryAttempt = 0;
      await this.save();
      return current;
    });
  }

  #requireRevision(task, expectedRevision) {
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (task.revision || 1)))
      throw Object.assign(new Error('Jobbet er ændret siden din gennemgang. Hent den aktuelle revision; din kladde er bevaret.'),
        { code: 'REVISION_CONFLICT', status: 409 });
  }

  async action(id, action, { expectedRevision } = {}) {
    const task = await this.transact(['tasks'], async () => {
      const current = this.#task(id);
      this.#requireRevision(current, expectedRevision);
      if (current.archived) throw new Error('Opgaven findes ikke.');
      if (current.status === 'running') throw new Error('Opgaven er i gang. Vent på resultatet eller kontrollér et uafklaret lagerudfald.');
      if (action === 'pause') current.status = 'paused';
      else if (action === 'resume' || action === 'run') {
        if (current.status === 'queued') throw new Error('Opgaven står allerede i kø. Vent eller vælg Pause.');
        const firstActivation = !current.runs.length && ['paused', 'interrupted'].includes(current.status);
        current.status = 'scheduled';
        current.nextRunAt = action === 'run' || firstActivation && current.startOnActivation ? this.now().toISOString()
          : firstActivation && current.dailyTime ? nextLocalTime(this.now(), current.dailyTime, checkedZone(current.timeZone))
            : current.nextRunAt || this.now().toISOString();
        current.retryAttempt = 0;
      } else if (action === 'archive') { current.archived = true; current.status = 'archived'; }
      else throw new Error('Ukendt handling.');
      current.updatedAt = this.now().toISOString();
      current.revision = (current.revision || 1) + 1;
      await this.save();
      return current;
    });
    // Durable cancellation wins even if the queue just started its callback:
    // #execute reacquires the task and checks status before any external call.
    if (['pause', 'archive'].includes(action)) {
      const entry = this.waiting.get(id);
      if (entry) { try { this.workQueue.cancel(entry.id); } catch { /* The callback checks the committed status. */ } }
    }
    if (action === 'run') void this.tick().catch(() => {});
    return task;
  }

  async remove(id) { return this.action(id, 'archive'); }

  async cancelWaiting(queueId) {
    const found = [...this.waiting].find(([_id, entry]) => entry.id === queueId);
    if (!found) return null;
    await this.action(found[0], 'pause');
    return { id: queueId, taskId: found[0], state: 'cancelled' };
  }

  // Failed outcome/response-ID checkpoints are retried locally only. They never
  // run the worker again. A crash without a durable ID leaves an interrupted
  // run; a durable ID permits polling that same read, not creating a new one.
  async #checkpoint(key, apply) {
    try { const result = await apply(); this.pendingCheckpoints.delete(key); return result; }
    catch (error) {
      this.pendingCheckpoints.set(key, apply);
      if (error && typeof error === 'object') error.checkpointPending = true;
      throw error;
    }
  }

  async #flushCheckpoints() {
    for (const [key, apply] of [...this.pendingCheckpoints]) { await apply(); this.pendingCheckpoints.delete(key); }
  }

  async #queueDueTask() {
    return this.transact(['tasks'], async () => {
      const now = this.now();
      const day = now.toISOString().slice(0, 10);
      for (const task of this.list().filter(item => item.status === 'scheduled' && item.nextRunAt && item.nextRunAt <= now.toISOString())) {
        let execution;
        try { execution = this.#execution(task); }
        catch (error) {
          task.status = 'paused'; task.nextRunAt = null; task.lastRunStatus = 'failed'; task.lastErrorKind = 'permanent';
          task.interruptionReason = error.message;
          await this.save(); return null;
        }
        const missed = execution.missedRunPolicy;
        const lateMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(task.nextRunAt)) / 60_000));
        const missedRun = !task.responseId && lateMinutes > missed.maxLatenessMinutes;
        if (missedRun && missed.mode !== 'coalesce') {
          task.lastMissedRun = { scheduledAt: task.nextRunAt, noticedAt: now.toISOString(), lateMinutes, policy: missed.mode };
          task.status = missed.mode === 'skip' && recurring(task) ? 'scheduled' : 'paused';
          task.nextRunAt = task.status === 'scheduled' ? regularNext(task, now) : null;
          task.interruptionReason = missed.mode === 'skip' ? 'For gammel kørsel sprunget over efter den valgte politik.' : 'Forsinket kørsel afventer din beslutning.';
          await this.save(); return null;
        }
        const jobUsed = task.usage?.day === day ? task.usage.started : 0;
        // An exhausted per-job budget must not starve another eligible job.
        if (!task.responseId && (this.currentUsage().started >= this.maxRunsPerDay || jobUsed >= execution.budget.maxRunsPerDay)) continue;
        if (missedRun) task.lastMissedRun = { scheduledAt: task.nextRunAt, noticedAt: now.toISOString(), lateMinutes, policy: missed.mode };
        const runId = randomUUID();
        const { skill, ...binding } = execution;
        task.activeRun = { id: runId, scheduledAt: task.nextRunAt, queuedAt: now.toISOString(), startedAt: null,
          status: 'queued', binding };
        task.skillContentHash = execution.skillContentHash;
        task.status = 'queued'; task.updatedAt = now.toISOString();
        await this.save();
        return { id: task.id, runId, title: task.title };
      }
      return null;
    });
  }

  async #execute(id, runId) {
    const snapshot = await this.transact(['tasks', 'usage'], async () => {
      const task = this.#task(id);
      if (task.status !== 'queued' || task.activeRun?.id !== runId) return null;
      let execution;
      try {
        execution = this.#execution(task);
        if (execution.bindingHash !== task.activeRun.binding.bindingHash) throw new Error('Opgavens grundlag blev ændret, mens den ventede.');
      } catch (error) {
        task.status = 'paused'; task.nextRunAt = null; task.activeRun = null;
        task.lastRunStatus = 'failed'; task.lastErrorKind = 'permanent'; task.interruptionReason = error.message;
        await this.save(); return null;
      }
      const now = this.now();
      const day = now.toISOString().slice(0, 10);
      if (!task.responseId) {
        if (this.state.usage.day !== day) this.state.usage = { day, started: 0 };
        if (task.usage?.day !== day) task.usage = { day, started: 0 };
        if (this.state.usage.started >= this.maxRunsPerDay || task.usage.started >= execution.budget.maxRunsPerDay) {
          task.status = 'scheduled'; task.activeRun = null; await this.save(); return null;
        }
        this.state.usage.started++; task.usage.started++;
      }
      task.status = 'running'; task.updatedAt = now.toISOString();
      task.activeRun.status = 'running'; task.activeRun.startedAt = now.toISOString();
      await this.save();
      return { ...structuredClone(task), execution };
    });
    if (!snapshot) return;
    let outcome;
    let checkpointError = null;
    try {
      const result = await this.runTask(snapshot, async responseId => {
        if (typeof responseId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(responseId)) {
          const error = new Error('API returnerede et ugyldigt opgave-ID. Udfaldet skal kontrolleres.');
          error.unknownOutcome = true;
          throw error;
        }
        const apply = () => this.transact(['tasks'], async () => {
          const task = this.#task(id);
          if (task.activeRun?.id !== runId) throw new Error('Opgavens aktive kørsel er ændret.');
          task.responseId = responseId;
          // If this is a later local retry, the worker was stopped by the failed
          // checkpoint. Schedule a read of the now-durable ID, not a new POST.
          if (checkpointError) { task.status = 'scheduled'; task.nextRunAt = this.now().toISOString(); }
          await this.save();
        });
        try { await this.#checkpoint(`response:${id}:${runId}`, apply); }
        catch (error) { checkpointError = error; throw error; }
      });
      if (checkpointError) throw checkpointError;
      const observation = result && typeof result === 'object' && result.observation ? normalizeObservation(result.observation, this.now()) : null;
      outcome = { id: runId, at: this.now().toISOString(), status: observation?.status === 'unknown' ? 'unknown' : 'completed',
        result: (typeof result === 'string' ? result : result?.summary || '').slice(0, 18000), ...(observation ? { observation } : {}) };
    } catch (error) {
      if (checkpointError) throw checkpointError;
      const kind = failureKind(error);
      outcome = { id: runId, at: this.now().toISOString(), status: kind === 'unknown' ? 'unknown' : 'failed',
        result: String(error?.message || error || 'Ukendt kildefejl').slice(0, 1500), errorKind: kind, responseTerminal: error?.responseTerminal === true };
    }
    await this.#checkpoint(`outcome:${id}:${runId}`, () => this.#saveOutcome(id, runId, outcome));
    await this.#deliver(id, runId);
  }

  async #saveOutcome(id, runId, outcome) {
    return this.transact(['tasks'], async () => {
      const task = this.#task(id);
      if (task.runs.some(run => run.id === runId)) return;
      if (task.activeRun?.id !== runId || task.status !== 'running') throw new Error('Opgavens aktive kørsel er ændret.');
      const completed = !outcome.errorKind;
      const previous = task.runs[0]?.observation;
      const repeated = checkedDelivery(task.deliveryPolicy).deduplicate && outcome.observation?.status === 'changed' && previous?.status === 'changed' &&
        ['subject', 'variant', 'unit', 'value', 'source'].every(key => outcome.observation[key] === previous[key]);
      if (completed) {
        task.retryAttempt = 0; task.consecutiveFailures = 0; task.lastErrorKind = null; task.responseId = null;
        task.nextRunAt = recurring(task) ? regularNext(task, this.now()) : null;
        task.status = recurring(task) ? 'scheduled' : 'completed';
      } else {
        const kind = outcome.errorKind;
        task.lastErrorKind = kind; task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
        if (outcome.responseTerminal || kind === 'unknown') task.responseId = null;
        if (recurring(task) && kind === 'temporary') {
          const policy = checkedRetry(task.retryPolicy);
          const attempts = task.retryAttempt || 0;
          task.nextRunAt = attempts < policy.maxRetries ? new Date(this.now().getTime() + policy.delayMinutes * 60_000 * 2 ** attempts).toISOString() : regularNext(task, this.now());
          task.retryAttempt = attempts < policy.maxRetries ? attempts + 1 : 0;
          task.status = 'scheduled';
        } else {
          task.status = recurring(task) ? 'paused' : 'failed'; task.nextRunAt = null; task.retryAttempt = 0;
        }
      }
      const shouldDeliver = outcome.status === 'unknown' || outcome.status === 'completed' && outcome.observation?.status !== 'unchanged' && !repeated ||
        outcome.status === 'failed' && (task.consecutiveFailures === 1 || task.status === 'paused');
      // Quiet-period results coalesce instead of creating a backlog of messages.
      if (shouldDeliver) for (const prior of task.runs) if (prior.delivery?.status === 'pending') {
        prior.delivery.status = 'skipped'; prior.delivery.note = 'Erstattet af et nyere resultat før levering.';
      }
      task.runs.unshift({ ...outcome, scheduledAt: task.activeRun.scheduledAt, startedAt: task.activeRun.startedAt,
        binding: task.activeRun.binding, delivery: { status: shouldDeliver ? 'pending' : 'skipped',
          note: shouldDeliver ? '' : 'Uændret eller allerede meddelt observation.' } });
      task.runs = task.runs.slice(0, 10); task.activeRun = null;
      task.lastRunStatus = outcome.status; task.updatedAt = this.now().toISOString();
      await this.save();
    });
  }

  async #deliver(id, runId) {
    const candidate = this.#task(id).runs.find(run => run.id === runId);
    if (candidate?.delivery?.status !== 'pending') return;
    const sending = await this.transact(['tasks'], async () => {
      const task = this.#task(id); const run = task.runs.find(item => item.id === runId);
      if (task.archived || run?.delivery?.status !== 'pending') return null;
      const due = quietUntil(this.now(), { ...task,
        ...(run.binding?.deliveryPolicy ? { deliveryPolicy: run.binding.deliveryPolicy } : {}),
        ...(run.binding?.timeZone ? { timeZone: run.binding.timeZone } : {}) });
      if (due) {
        if (run.delivery.notBefore !== due) { run.delivery.notBefore = due; await this.save(); }
        return null;
      }
      run.delivery = { status: 'sending', attemptedAt: this.now().toISOString() };
      await this.save();
      const snapshot = structuredClone(task);
      snapshot.runs = [structuredClone(run), ...snapshot.runs.filter(item => item.id !== runId)];
      return { task: snapshot, status: run.status };
    });
    if (!sending) return;
    let delivery;
    try {
      const result = await this.notify(sending.task, sending.status, { deliveryId: runId, channel: 'inbox' });
      delivery = { status: result === false ? 'not_delivered' : 'delivered', endedAt: this.now().toISOString() };
    } catch {
      // An exception says nothing about which notification providers accepted
      // the message. Keep the intent and never blindly resend it.
      delivery = { status: 'unknown', endedAt: this.now().toISOString(), note: 'Levering kunne ikke bekræftes. Ingen automatisk genafsendelse.' };
    }
    await this.#checkpoint(`delivery:${id}:${runId}`, () => this.transact(['tasks'], async () => {
      const run = this.#task(id).runs.find(item => item.id === runId);
      if (run?.delivery?.status === 'sending') { run.delivery = { ...run.delivery, ...delivery }; await this.save(); }
    }));
  }

  async tick() {
    if (this.active) return;
    this.active = true;
    try {
      await this.recover();
      await this.#flushCheckpoints();
      // A failed pre-network running checkpoint leaves a durable queued record.
      // It is safe to requeue only when no callback owns it and no work ran.
      if (this.state.tasks.some(task => task.status === 'queued' && !this.waiting.has(task.id)))
        await this.transact(['tasks'], async () => {
          for (const task of this.state.tasks) if (task.status === 'queued' && !this.waiting.has(task.id)) {
            task.status = 'scheduled'; task.nextRunAt = task.activeRun?.scheduledAt || this.now().toISOString(); task.activeRun = null;
          }
          await this.save();
        });
      // Delivery recovery is independent of a new model run or its daily budget.
      for (const task of this.list()) for (const run of task.runs || [])
        if (run.delivery?.status === 'pending') await this.#deliver(task.id, run.id);
      const queued = await this.#queueDueTask();
      if (!queued) return;
      if (!this.workQueue) return await this.#execute(queued.id, queued.runId);
      let entry;
      try { entry = this.workQueue.enqueue(`Baggrund: ${queued.title}`.slice(0, 80), () => this.#execute(queued.id, queued.runId)); }
      catch (error) {
        await this.transact(['tasks'], async () => {
          const task = this.#task(queued.id);
          if (task.status === 'queued' && task.activeRun?.id === queued.runId) { task.status = 'scheduled'; task.activeRun = null; await this.save(); }
        });
        throw error;
      }
      this.waiting.set(queued.id, entry);
      try { await entry.promise; }
      catch (error) {
        if (error?.code !== 'JOB_CANCELLED') throw error;
        await this.#checkpoint(`cancel:${queued.id}:${queued.runId}`, () => this.transact(['tasks'], async () => {
          const task = this.#task(queued.id);
          if (task.status === 'queued' && task.activeRun?.id === queued.runId) {
            task.status = 'paused'; task.activeRun = null;
            task.interruptionReason = 'Den ventende kørsel er annulleret.';
            await this.save();
          }
        }));
      }
      finally { this.waiting.delete(queued.id); }
    } finally { this.active = false; }
  }
}
