import { randomUUID } from 'node:crypto';
import { rejectSecrets } from './privacy.mjs';

const CATEGORIES = new Set(['fact', 'preference', 'temporary', 'planned', 'completed']);
const SOURCE_KINDS = new Set(['user', 'assistant', 'legacy']);
const CHANNELS = new Set(['manual', 'text', 'discord', 'voice', 'legacy']);
const SENSITIVE = /\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAuthorization\s*:\s*Bearer\s+\S+|\b(?:api[_ -]?key|password|adgangskode|(?:access[_ -]?)?token|(?:client[_ -]?)?secret|NEMLIG_PASS)\s*[:=]\s*\S{6,}|\b(?:cpr|personnummer)\s*:?\s*\d{6}[- ]?\d{4}\b/i;
const conflict = message => { const error = new Error(message); error.status = 409; error.code = 'REVISION_CONFLICT'; throw error; };
const validateRevision = (record, revision) => {
  if (!Number.isInteger(revision) || revision !== record.revision) conflict('Oplysningen er ændret; gennemgå den nye revision.');
};

function source(value) {
  if (!value || typeof value !== 'object' || !SOURCE_KINDS.has(value.kind) ||
      !CHANNELS.has(value.channel) || Object.keys(value).some(key => !['kind', 'channel', 'id'].includes(key)))
    throw new Error('Oplysningen kræver en kontrolleret kilde.');
  if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length > 120 || /[\x00-\x1f\x7f]/.test(value.id)))
    throw new Error('Kildereferencen skal være tekst på højst 120 tegn.');
  rejectSecrets(value);
  if (SENSITIVE.test(value.id || '') || /https?:\/\/[^/\s]+@/i.test(value.id || ''))
    throw new Error('Gem ikke hemmeligheder eller CPR-numre i kildereferencer.');
  return { kind: value.kind, channel: value.channel, ...(value.id?.trim() ? { id: value.id.trim() } : {}) };
}

function optionalTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('Gyldighed kræver et ISO-tidspunkt med tidszone.');
  const date = value.slice(0, 10), checked = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 10) !== date || Number(value.slice(11, 13)) > 23)
    throw new Error('Gyldighed kræver en virkelig kalenderdato og et entydigt tidspunkt.');
  return new Date(value).toISOString();
}

function contents({ value, category, validFrom, expiresAt }) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1200 || !CATEGORIES.has(category))
    throw new Error('Oplysningen kræver indhold og gyldig kategori.');
  if (SENSITIVE.test(value)) throw new Error('Gem ikke hemmeligheder eller CPR-numre i personlig viden.');
  rejectSecrets(value);
  const from = optionalTime(validFrom), until = optionalTime(expiresAt);
  if (from && until && from >= until) throw new Error('Gyldighedsperioden er forkert.');
  return { value: value.trim(), category, validFrom: from, expiresAt: until };
}

function canRemember(record) {
  if ((record.revisions || []).length >= 100) throw new Error('Oplysningens revisionshistorik er fuld. Bevar historikken og opret et nyt forslag.');
}
function rememberRevision(record) {
  const { revisions, ...snapshot } = record;
  record.revisions = [...(revisions || []), structuredClone(snapshot)];
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

  async propose({ subject, value, category = 'fact', source: provenance, validFrom = null, expiresAt = null,
    correctsId = null, correctsRevision = null }) {
    if (typeof subject !== 'string' || !/^[\p{L}\p{N}:_-]{2,100}$/u.test(subject))
      throw new Error('Oplysningen kræver emne, indhold og gyldig kategori.');
    rejectSecrets(subject);
    const fields = contents({ value, category, validFrom, expiresAt }), provenanceChecked = source(provenance);
    let corrected = null;
    if (correctsId !== null || correctsRevision !== null) {
      corrected = this.state.personalClaims.find(item => item.id === correctsId && item.status === 'confirmed');
      if (!corrected || corrected.subject !== subject) conflict('Rettelsen kræver den gennemgåede, bekræftede oplysning om samme emne.');
      validateRevision(corrected, correctsRevision);
    }
    const duplicate = this.state.personalClaims.find(item =>
      (item.status === 'proposed' || currentClaim(item, this.now())) &&
      item.subject === subject && item.value === fields.value && item.category === fields.category &&
      item.validFrom === fields.validFrom && item.expiresAt === fields.expiresAt &&
      (item.correctsId || null) === correctsId && (item.correctsRevision || null) === correctsRevision &&
      JSON.stringify(item.source) === JSON.stringify(provenanceChecked));
    if (duplicate) return structuredClone(duplicate);
    if (this.state.personalClaims.filter(item => item.status !== 'archived').length >= 200)
      throw new Error('Maksimalt 200 personlige oplysninger.');
    const record = { id: randomUUID(), revision: 1, subject, ...fields,
      source: provenanceChecked, status: 'proposed',
      ...(corrected ? { correctsId: corrected.id, correctsRevision: corrected.revision } : {}),
      createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    this.state.personalClaims.push(record);
    await this.save();
    return structuredClone(record);
  }

  async update(id, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['expectedRevision', 'value', 'category', 'validFrom', 'expiresAt', 'sourceId'].includes(key)))
      throw new Error('Redigering må kun ændre indhold, kategori, kilde og gyldighed.');
    const record = this.state.personalClaims.find(item => item.id === id);
    if (!record) throw new Error('Oplysningen findes ikke.');
    validateRevision(record, input.expectedRevision);
    if (record.status !== 'proposed') conflict('Bekræftede oplysninger rettes med et nyt forslag, så den gennemgåede historik bevares.');
    const fields = contents({ ...record, ...input });
    const provenance = source({ kind: 'user', channel: 'manual', ...(Object.hasOwn(input, 'sourceId')
      ? { id: input.sourceId } : record.source.id ? { id: record.source.id } : {}) });
    if (Object.entries(fields).every(([key, value]) => record[key] === value) && JSON.stringify(record.source) === JSON.stringify(provenance))
      return structuredClone(record);
    canRemember(record); rememberRevision(record);
    Object.assign(record, fields, { source: provenance, revision: record.revision + 1, updatedAt: this.now().toISOString() });
    await this.save();
    return structuredClone(record);
  }

  async decision(id, expectedRevision, action, { supersedesId = null, supersedesRevision = null } = {}) {
    const record = this.state.personalClaims.find(item => item.id === id);
    if (!record) throw new Error('Oplysningen findes ikke.');
    validateRevision(record, expectedRevision);
    if (action !== 'archive') canRemember(record);
    if (action === 'confirm') {
      if (record.status !== 'proposed') throw new Error('Kun forslag kan bekræftes.');
      if (record.correctsId && (supersedesId !== record.correctsId || supersedesRevision !== record.correctsRevision))
        conflict('Bekræft rettelsen mod præcis den oprindeligt gennemgåede oplysning og revision.');
      let old = null;
      if (supersedesId !== null || supersedesRevision !== null) {
        old = this.state.personalClaims.find(item => item.id === supersedesId && item.status === 'confirmed');
        if (!old || old.subject !== record.subject) conflict('Erstatning kræver et bekræftet punkt om samme emne.');
        validateRevision(old, supersedesRevision);
        canRemember(old);
      }
      rememberRevision(record);
      if (old) {
        rememberRevision(old);
        old.status = 'superseded';
        old.revision++;
        old.updatedAt = this.now().toISOString();
        record.supersedesId = old.id;
        record.supersedesRevision = supersedesRevision;
      }
      record.status = 'confirmed';
      record.confirmedBy = 'user';
    } else if (action === 'invalidate') {
      if (record.status !== 'confirmed') conflict('Kun en aktuelt bekræftet oplysning kan markeres som forkert.');
      rememberRevision(record);
      record.status = 'invalid';
      record.invalidatedBy = 'user';
    } else if (action === 'archive') {
      if (record.status === 'archived') throw new Error('Allerede arkiveret.');
      rememberRevision(record);
      record.status = 'archived';
    } else throw new Error('Ukendt beslutning.');
    record.revision++;
    record.updatedAt = this.now().toISOString();
    await this.save();
    return structuredClone(record);
  }
}
