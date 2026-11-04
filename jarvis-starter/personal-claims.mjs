import { randomUUID } from 'node:crypto';

const CATEGORIES = new Set(['fact', 'preference', 'temporary', 'planned', 'completed']);
const SOURCE_KINDS = new Set(['user', 'assistant', 'legacy']);
const CHANNELS = new Set(['manual', 'text', 'discord', 'voice', 'legacy']);
const SENSITIVE = /\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAuthorization\s*:\s*Bearer\s+\S+|\b(?:api[_ -]?key|password|adgangskode|(?:access[_ -]?)?token|(?:client[_ -]?)?secret|NEMLIG_PASS)\s*[:=]\s*\S{6,}|\b(?:cpr|personnummer)\s*:?\s*\d{6}[- ]?\d{4}\b/i;

function source(value) {
  if (!value || typeof value !== 'object' || !SOURCE_KINDS.has(value.kind) ||
      !CHANNELS.has(value.channel) || Object.keys(value).some(key => !['kind', 'channel', 'id'].includes(key)))
    throw new Error('Oplysningen kræver en kontrolleret kilde.');
  return { kind: value.kind, channel: value.channel,
    ...(typeof value.id === 'string' && value.id.length <= 120 ? { id: value.id } : {}) };
}

function optionalTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) ||
      !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('Gyldighed kræver et ISO-tidspunkt med tidszone.');
  return new Date(value).toISOString();
}

export function currentClaim(item, now = new Date()) {
  return Boolean(item && item.status === 'confirmed' && (!item.validFrom || Date.parse(item.validFrom) <= now.getTime()) &&
    (!item.expiresAt || Date.parse(item.expiresAt) > now.getTime()));
}

export function claimConflicts(state, now = new Date()) {
  const bySubject = new Map();
  for (const claim of state.personalClaims || []) {
    if (!currentClaim(claim, now) || typeof claim.value !== 'string') continue;
    const list = bySubject.get(claim.subject) || [];
    list.push(claim);
    bySubject.set(claim.subject, list);
  }
  return [...bySubject].filter(([, list]) => new Set(list.map(item => item.value.normalize('NFKC').toLocaleLowerCase('da-DK').trim())).size > 1)
    .map(([subject, claims]) => ({ subject, claims: claims.map(claim => ({ id: claim.id,
      revision: claim.revision, value: claim.value, source: structuredClone(claim.source) })) }));
}

export class PersonalClaims {
  constructor({ state, save = async () => {}, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    state.personalClaims ||= [];
  }

  list() { return structuredClone(this.state.personalClaims); }
  conflicts() { return claimConflicts(this.state, this.now()); }

  async propose({ subject, value, category = 'fact', source: provenance, validFrom = null, expiresAt = null }) {
    if (typeof subject !== 'string' || !/^[\p{L}\p{N}:_-]{2,100}$/u.test(subject) ||
        typeof value !== 'string' || !value.trim() || value.length > 1200 || !CATEGORIES.has(category))
      throw new Error('Oplysningen kræver emne, indhold og gyldig kategori.');
    if (SENSITIVE.test(value)) throw new Error('Gem ikke hemmeligheder eller CPR-numre i personlig viden.');
    const duplicate = this.state.personalClaims.find(item =>
      (item.status === 'proposed' || currentClaim(item, this.now())) &&
      item.subject === subject && item.value === value.trim());
    if (duplicate) return structuredClone(duplicate);
    if (this.state.personalClaims.filter(item => item.status !== 'archived').length >= 200)
      throw new Error('Maksimalt 200 personlige oplysninger.');
    const from = optionalTime(validFrom);
    const until = optionalTime(expiresAt);
    if (from && until && from >= until) throw new Error('Gyldighedsperioden er forkert.');
    const record = { id: randomUUID(), revision: 1, subject, value: value.trim(), category,
      source: source(provenance), validFrom: from, expiresAt: until, status: 'proposed',
      createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    this.state.personalClaims.push(record);
    await this.save();
    return structuredClone(record);
  }

  async decision(id, expectedRevision, action, { supersedesId = null } = {}) {
    const record = this.state.personalClaims.find(item => item.id === id);
    if (!record) throw new Error('Oplysningen findes ikke.');
    if (!Number.isInteger(expectedRevision) || expectedRevision !== record.revision)
      throw new Error('Oplysningen er ændret; gennemgå den nye revision.');
    if (action === 'confirm') {
      if (record.status !== 'proposed') throw new Error('Kun forslag kan bekræftes.');
      if (supersedesId) {
        const old = this.state.personalClaims.find(item => item.id === supersedesId && item.status === 'confirmed');
        if (!old || old.subject !== record.subject) throw new Error('Erstatning kræver et bekræftet punkt om samme emne.');
        old.status = 'superseded';
        old.revision++;
        old.updatedAt = this.now().toISOString();
        record.supersedesId = old.id;
      }
      record.status = 'confirmed';
      record.confirmedBy = 'user';
    } else if (action === 'archive') {
      if (record.status === 'archived') throw new Error('Allerede arkiveret.');
      record.status = 'archived';
    } else throw new Error('Ukendt beslutning.');
    record.revision++;
    record.updatedAt = this.now().toISOString();
    await this.save();
    return structuredClone(record);
  }
}
