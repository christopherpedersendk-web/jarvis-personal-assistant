import { randomUUID } from 'node:crypto';

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 30 * 24 * 60;

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
  constructor({ state, save, runTask, notify = async () => {}, now = () => new Date(), maxRunsPerDay = 10 }) {
    this.state = state;
    this.save = save;
    this.runTask = runTask;
    this.notify = notify;
    this.now = now;
    this.maxRunsPerDay = Math.min(100, Math.max(1, Number(maxRunsPerDay) || 10));
    this.active = false;
    this.state.tasks ||= [];
    this.state.usage ||= { day: '', started: 0 };
    for (const task of this.state.tasks) {
      if (task.status === 'running') task.status = 'scheduled';
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
    const next = dailyTime ? new Date(nextCopenhagenTime(now, dailyTime)) : input.runAt ? new Date(input.runAt) : now;
    if (Number.isNaN(next.getTime()) || next.getTime() > now.getTime() + 366 * 24 * 3600_000) {
      throw new Error('Ugyldig dato eller mere end et år fremme.');
    }
    const task = {
      id: randomUUID(), title, prompt, intervalMinutes, category, dailyTime,
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
      task.runs.unshift({ at: this.now().toISOString(), status: 'completed', result: String(result).slice(0, 18000) });
      task.runs = task.runs.slice(0, 10);
      task.responseId = null;
      if (task.intervalMinutes || task.dailyTime) {
        task.nextRunAt = task.dailyTime ? nextCopenhagenTime(this.now(), task.dailyTime) : new Date(this.now().getTime() + task.intervalMinutes * 60_000).toISOString();
        task.status = 'scheduled';
      } else {
        task.status = 'completed';
        task.nextRunAt = null;
      }
    } catch (error) {
      task.runs.unshift({ at: this.now().toISOString(), status: 'failed', result: String(error.message).slice(0, 1500) });
      task.runs = task.runs.slice(0, 10);
      task.status = 'failed';
      task.nextRunAt = null;
    } finally {
      task.updatedAt = this.now().toISOString();
      try {
        await this.save();
        const status = task.runs[0]?.status;
        if (status === 'completed' || status === 'failed') {
          try { await this.notify(task, status); }
          catch (error) { console.error(`Notifikationsfejl: ${error.message}`); }
        }
      } finally { this.active = false; }
    }
  }
}
