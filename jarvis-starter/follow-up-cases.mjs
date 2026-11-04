import { randomUUID } from 'node:crypto';
import { normalizeObservation } from './task-engine.mjs';

function time(value, label) {
  if (typeof value !== 'string' || !/Z$|[+-]\d\d:\d\d$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error(`${label} kræver et ISO-tidspunkt med tidszone.`);
  return new Date(value).toISOString();
}

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} skal være 1–${max} tegn.`);
  return value.trim();
}

function source(value) {
  if (!value || typeof value !== 'object' || !/^[a-z-]{2,40}$/.test(value.kind || '') ||
      typeof value.id !== 'string' || value.id.length > 120 || !value.id)
    throw new Error('Opfølgning kræver en identificerbar kilde.');
  return { kind: value.kind, id: value.id, ...(Number.isInteger(value.revision) ? { revision: value.revision } : {}) };
}

/** Persisted, owner-editable follow-ups, independent of execution schedules. */
export class FollowUpCases {
  constructor({ state, save = async () => {}, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    state.followUpCases ||= [];
  }

  list({ includeClosed = false } = {}) {
    return this.state.followUpCases.filter(record => includeClosed || record.status === 'open')
      .map(record => structuredClone(record)).sort((a, b) =>
        (a.nextCheckAt || '9999').localeCompare(b.nextCheckAt || '9999'));
  }

  due() {
    const now = this.now().toISOString();
    return this.list().filter(record => record.nextCheckAt && record.nextCheckAt <= now);
  }

  async create(input) {
    const awaiting = text(input?.awaiting, 'Hvad der afventes', 500);
    const nextCheckAt = time(input.nextCheckAt, 'Næste kontrol');
    const stopCondition = text(input.stopCondition, 'Stopbetingelse', 300);
    if (this.list().length >= 200) throw new Error('Højst 200 aktive opfølgningssager.');
    const record = { id: randomUUID(), revision: 1, awaiting, source: source(input.source),
      nextCheckAt, stopCondition, status: 'open', observations: [],
      lastDecision: 'created', createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    this.state.followUpCases.push(record);
    await this.save();
    return structuredClone(record);
  }

  async update(id, expectedRevision, action, changes = {}) {
    const record = this.state.followUpCases.find(item => item.id === id);
    if (!record) throw new Error('Opfølgningssagen findes ikke.');
    if (record.revision !== expectedRevision) throw new Error('Opfølgningssagen er ændret; genindlæs revisionen.');
    if (record.status !== 'open') throw new Error('Afsluttede eller annullerede sager kan ikke genåbnes automatisk.');
    const at = this.now().toISOString();
    if (action === 'snooze') {
      record.nextCheckAt = time(changes.nextCheckAt, 'Næste kontrol');
    } else if (action === 'observe') {
      const observation = normalizeObservation(changes.observation, this.now());
      record.observations.unshift(observation);
      record.observations = record.observations.slice(0, 30);
      if (changes.nextCheckAt) record.nextCheckAt = time(changes.nextCheckAt, 'Næste kontrol');
    } else if (action === 'complete' || action === 'cancel') {
      record.status = action === 'complete' ? 'completed' : 'cancelled';
      record.nextCheckAt = null;
    } else throw new Error('Ukendt opfølgningshandling.');
    record.lastDecision = action;
    record.revision++;
    record.updatedAt = at;
    await this.save();
    return structuredClone(record);
  }
}
