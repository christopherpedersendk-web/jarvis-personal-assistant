import { randomUUID } from 'node:crypto';

export const MEMORY_CATEGORIES = Object.freeze(['preference', 'household', 'food', 'project', 'fact']);
export const MEMORY_HISTORY_SCHEMA_VERSION = 1;
export const MAX_MEMORY_HISTORY = 100;
const MEMORY_CHANNELS = new Set(['manual', 'text', 'discord', 'voice', 'legacy']);
const MEMORY_SOURCE_KINDS = new Set(['user', 'assistant', 'legacy']);
const SECRET = /\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAuthorization\s*:\s*Bearer\s+\S+|\b(?:api[_ -]?key|password|adgangskode|(?:access[_ -]?)?token|(?:client[_ -]?)?secret|NEMLIG_PASS)\s*[:=]\s*\S{6,}|\b(?:cpr|personnummer)\s*:?\s*\d{6}[- ]?\d{4}\b/i;

function memoryText(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('Hukommelsespunktet skal være 1–1.200 tegn.');
  if (SECRET.test(text)) throw new Error('Gem ikke adgangskoder, API-nøgler, CPR-numre eller andre hemmeligheder i hukommelsen.');
  return text.trim();
}

const comparableText = text => String(text).normalize('NFKC').toLocaleLowerCase('da-DK').replace(/\s+/g, ' ').trim();

function checkedExpiry(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(`${value.slice(0, 10)}T12:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('Udløb skal være et gyldigt ISO-tidspunkt eller tomt.');
  }
  return new Date(value).toISOString();
}

function checkedSource(source, fallback = { kind: 'user', channel: 'manual' }) {
  if (source === undefined) return { ...fallback };
  if (typeof source === 'string') source = { kind: 'user', channel: source };
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).some(key => !['kind', 'channel', 'messageId'].includes(key)) ||
      !MEMORY_SOURCE_KINDS.has(source.kind || 'user') || !MEMORY_CHANNELS.has(source.channel || 'manual')) {
    throw new Error('Ugyldig kilde til hukommelsespunktet.');
  }
  if (source.messageId !== undefined && (typeof source.messageId !== 'string' || !/^[a-zA-Z0-9:_-]{1,150}$/.test(source.messageId))) {
    throw new Error('Ugyldigt kilde-ID.');
  }
  return { kind: source.kind || 'user', channel: source.channel || 'manual',
    ...(source.messageId ? { messageId: source.messageId } : {}) };
}

function memoryExpired(memory, now) {
  if (memory.expiresAt === null || memory.expiresAt === undefined || memory.expiresAt === '') return false;
  return !Number.isFinite(Date.parse(memory.expiresAt)) || Date.parse(memory.expiresAt) <= now.getTime();
}

function memoryHistoryEntries(memory) {
  if (memory.revisionHistory === undefined) return [];
  if (!Array.isArray(memory.revisionHistory) || memory.revisionHistory.length > MAX_MEMORY_HISTORY + 1)
    throw new Error('Notens revisionshistorik har et ukendt format. Bevar data og gennemgå en kompatibel version før ændring.');
  let previous = 0;
  for (const entry of memory.revisionHistory) {
    if (!entry || typeof entry !== 'object' || entry.historySchemaVersion !== MEMORY_HISTORY_SCHEMA_VERSION || entry.historical !== true ||
        entry.id !== memory.id || !Number.isInteger(entry.revision) || entry.revision <= previous || entry.revision >= memory.revision ||
        typeof entry.text !== 'string' || !['update', 'confirm', 'archive'].includes(entry.change) ||
        typeof entry.replacedAt !== 'string' || !Number.isFinite(Date.parse(entry.replacedAt)) || Object.hasOwn(entry, 'revisionHistory'))
      throw new Error('Notens revisionshistorik er ukendt eller ufuldstændig. Ingen historie må overskrives eller rekonstrueres ved gæt.');
    previous = entry.revision;
  }
  return memory.revisionHistory;
}

// A bounded audit history is kept on the existing note, not inserted as new
// memories. Snapshot only the actual previous fields: migrated records do not
// acquire invented earlier values, sources or dates. Archive may append the
// final 101st entry so the history cap never forces an invalid fact to stay live.
function rememberMemoryRevision(memory, change, at) {
  const history = memoryHistoryEntries(memory);
  if (history.length >= MAX_MEMORY_HISTORY && !(change === 'archive' && history.length === MAX_MEMORY_HISTORY))
    throw new Error('Notens 100 historiske revisioner er bevaret. Opret en ny note eller arkivér denne; historikken slettes ikke automatisk.');
  const fields = ['id', 'revision', 'text', 'category', 'projectId', 'source', 'originSource', 'status',
    'confirmed', 'archived', 'expiresAt', 'createdAt', 'updatedAt', 'confirmedAt', 'confirmedBy'];
  const snapshot = Object.fromEntries(fields.filter(key => Object.hasOwn(memory, key)).map(key => [key, structuredClone(memory[key])]));
  memory.revisionHistory = [...history, { ...snapshot, historySchemaVersion: MEMORY_HISTORY_SCHEMA_VERSION,
    historical: true, replacedAt: at, change }];
}

function memorySummary(memory) {
  const { revisionHistory, ...current } = memory;
  return { ...structuredClone(current), historyCount: Array.isArray(revisionHistory) ? revisionHistory.length : 0 };
}

// Shared by every memory-context reader. Legacy entries were only saved on an
// explicit remember request. New suggestions are never facts until confirmed.
export function activePersonalMemory(memory, now = new Date()) {
  if (!memory || memory.historical === true || memory.archived || typeof memory.text !== 'string' || !memory.text.trim() ||
      SECRET.test(memory.text) || memory.confirmed === false || memoryExpired(memory, now)) return false;
  return memory.status === 'confirmed' || (memory.status === undefined && memory.source?.kind !== 'assistant');
}

function checkRevision(memory, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || expectedRevision !== memory.revision) {
    throw new Error('Hukommelsespunktet er ændret. Genindlæs det, før du gemmer.');
  }
}

export const DEFAULT_PLAYBOOK = `# JARVIS – sekretærens arbejdsinstruktioner

## Morgenrapport
- Skriv på dansk, kort og konkret.
- Prioritér verificerbare nyheder med dato og direkte kildelinks.
- Interesseområder: AI, cybersikkerhed, DORA, NIS2, IT-revision og Danmark/Norden.
- Fremhæv hvad der er nyt siden sidste rapport. Undgå gentagelser.
- Skeln mellem bekræftede forhold, vurderinger og usikkerhed.

## Overvågninger
- Notér altid produktnavn, nøjagtig variant, forhandler, valuta, pris, tidspunkt og kilde.
- Sammenlign med senest observerede resultat, hvis det findes.
- Skriv NO_CHANGE på første linje, hvis ingen væsentlig ændring kan dokumenteres.
- Skriv CHANGE på første linje, hvis en faktisk ændring kan dokumenteres.
- Hvis en pris ikke kan verificeres, så skriv det eksplicit.

## Personlig sekretær
- Husk præferencer på tværs af projekter, når brugeren udtrykkeligt beder dig huske dem.
- Forbered bookinger, køb og beskeder som forslag. Udfør aldrig en ekstern handling uden særskilt endelig godkendelse.
- Del aldrig API-nøgler, kundedata eller følsomme oplysninger.
`;

export class SecretaryCore {
  constructor({ state, save = async () => {}, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.state.playbook ??= DEFAULT_PLAYBOOK;
    this.state.memories ||= [];
    this.state.inbox ||= [];
    this.state.approvals ||= [];
    for (const memory of this.state.memories) {
      if (!memory || typeof memory !== 'object' || memory.historical === true) continue;
      memory.category = MEMORY_CATEGORIES.includes(memory.category) ? memory.category : memory.projectId ? 'project' : 'fact';
      memory.revision = Number.isInteger(memory.revision) && memory.revision > 0 ? memory.revision : 1;
      const legacy = memory.status === undefined && memory.confirmed !== false && memory.source?.kind !== 'assistant';
      memory.status = (memory.status === 'confirmed' && memory.confirmed !== false || legacy) ? 'confirmed' : 'proposed';
      memory.confirmed = memory.status === 'confirmed';
      try { memory.source = checkedSource(memory.source, { kind: 'legacy', channel: 'legacy' }); }
      catch { memory.source = { kind: 'legacy', channel: 'legacy' }; }
      memory.updatedAt ||= memory.createdAt || '';
      memory.expiresAt ??= null;
    }
  }

  async savePlaybook(content) {
    if (typeof content !== 'string' || !content.trim() || content.length > 15_000) throw new Error('Instruktionsdokumentet skal være 1–15.000 tegn.');
    this.state.playbook = content;
    await this.save();
    return this.state.playbook;
  }

  memoryContext() {
    return this.state.memories.filter(x => activePersonalMemory(x, this.now()))
      .map(x => `- [memory:${x.id} · ${x.category || 'fact'} · ${x.source?.kind || 'legacy'}/${x.source?.channel || 'legacy'} · revision ${x.revision || 1}] ${x.text}`)
      .join('\n').slice(0, 8000);
  }

  listMemories({ includeProposed = true, includeArchived = false } = {}) {
    return this.state.memories.filter(x => x && x.historical !== true && (includeArchived || !x.archived) && (includeProposed || x.status === 'confirmed'))
      .map(x => ({ ...memorySummary(x), active: activePersonalMemory(x, this.now()), expired: memoryExpired(x, this.now()) }));
  }

  memoryHistory(id) {
    const memory = this.state.memories.find(item => item && item.id === id && item.historical !== true);
    if (!memory) throw new Error('Hukommelsespunktet findes ikke.');
    const entries = memoryHistoryEntries(memory);
    const history = entries.map(entry => {
      // Existing private legacy bytes are preserved on disk, but a history
      // read must not export a secret-shaped value that predates validation.
      if (SECRET.test(JSON.stringify(entry))) return { id: entry.id, revision: entry.revision,
        historical: true, change: entry.change, replacedAt: entry.replacedAt, redacted: true,
        text: 'Følsomt historisk indhold er skjult.', status: 'redacted' };
      return structuredClone(entry);
    });
    const firstCapturedRevision = entries[0]?.revision ?? memory.revision;
    return { id: memory.id, revision: memory.revision, archived: Boolean(memory.archived), status: memory.status,
      historyCount: entries.length, firstCapturedRevision, earlierRevisionsUnavailable: firstCapturedRevision > 1,
      history, note: 'Tidligere revisioner er historik, ikke aktuelle fakta. De bruges ikke i personlig søgning eller modelkontekst.' };
  }

  async remember(text, projectId = null, metadata = {}) {
    const value = memoryText(text);
    if (projectId !== null && (typeof projectId !== 'string' || projectId.length > 80)) throw new Error('Ugyldigt projekt-ID.');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        Object.keys(metadata).some(key => !['category', 'source', 'confirmed', 'expiresAt'].includes(key))) throw new Error('Ugyldige hukommelsesfelter.');
    const category = metadata.category ?? (projectId ? 'project' : 'fact');
    if (!MEMORY_CATEGORIES.includes(category)) throw new Error('Ukendt hukommelseskategori.');
    if (metadata.confirmed !== undefined && typeof metadata.confirmed !== 'boolean') throw new Error('Bekræftet skal være sand eller falsk.');
    const source = checkedSource(metadata.source);
    const expiresAt = checkedExpiry(metadata.expiresAt);
    const status = metadata.confirmed === false || source.kind === 'assistant' ? 'proposed' : 'confirmed';
    const duplicate = this.state.memories.find(x => x && x.historical !== true && !x.archived && !memoryExpired(x, this.now()) &&
      (x.projectId || null) === projectId && comparableText(x.text) === comparableText(value));
    // Do not silently promote a pending suggestion just because the model repeats it.
    if (duplicate) return memorySummary(duplicate);
    if (this.state.memories.filter(x => x && x.historical !== true && !x.archived).length >= 200) throw new Error('Højst 200 aktive hukommelsespunkter.');
    const at = this.now().toISOString();
    const item = { id: randomUUID(), text: value, projectId, category, source, status, confirmed: status === 'confirmed',
      revision: 1, archived: false, createdAt: at, updatedAt: at, expiresAt, confirmedAt: status === 'confirmed' ? at : null };
    this.state.memories.unshift(item);
    await this.save();
    return memorySummary(item);
  }

  async proposeMemory(text, projectId = null, metadata = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Ugyldige hukommelsesfelter.');
    return this.remember(text, projectId, { ...metadata, confirmed: false,
      source: metadata.source || { kind: 'assistant', channel: 'text' } });
  }

  async updateMemory(id, changes) {
    const item = this.state.memories.find(x => x && x.id === id && x.historical !== true && !x.archived);
    if (!item) throw new Error('Hukommelsespunktet findes ikke.');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
        Object.keys(changes).some(key => !['expectedRevision', 'text', 'category', 'expiresAt', 'source'].includes(key))) throw new Error('Ugyldige hukommelsesfelter.');
    checkRevision(item, changes.expectedRevision);
    const text = Object.hasOwn(changes, 'text') ? memoryText(changes.text) : item.text;
    const category = changes.category ?? item.category;
    if (!MEMORY_CATEGORIES.includes(category)) throw new Error('Ukendt hukommelseskategori.');
    const expiresAt = Object.hasOwn(changes, 'expiresAt') ? checkedExpiry(changes.expiresAt) : item.expiresAt;
    const source = Object.hasOwn(changes, 'source') ? checkedSource(changes.source)
      : Object.hasOwn(changes, 'text') && text !== item.text ? { kind: 'user', channel: 'manual' } : item.source;
    const duplicate = this.state.memories.find(x => x && x.id !== id && x.historical !== true && !x.archived && !memoryExpired(x, this.now()) &&
      (x.projectId || null) === (item.projectId || null) && comparableText(x.text) === comparableText(text));
    if (duplicate) throw new Error('Det samme hukommelsespunkt er allerede gemt. Redigér det eksisterende punkt.');
    memoryHistoryEntries(item);
    if (item.text === text && item.category === category && item.expiresAt === expiresAt && JSON.stringify(item.source) === JSON.stringify(source))
      return memorySummary(item);
    const at = this.now().toISOString();
    rememberMemoryRevision(item, 'update', at);
    item.originSource ||= { ...item.source };
    Object.assign(item, { text, category, expiresAt, source, updatedAt: at, revision: item.revision + 1 });
    // Keep proposals proposed; text editing is not a separate confirmation action.
    await this.save();
    return memorySummary(item);
  }

  async confirmMemory(id, { expectedRevision } = {}) {
    const item = this.state.memories.find(x => x && x.id === id && x.historical !== true && !x.archived);
    if (!item) throw new Error('Hukommelsespunktet findes ikke.');
    checkRevision(item, expectedRevision);
    if (item.status !== 'proposed') throw new Error('Hukommelsespunktet er allerede bekræftet.');
    if (memoryExpired(item, this.now())) throw new Error('Hukommelsespunktet er udløbet. Ret udløbsdatoen først.');
    memoryText(item.text);
    const at = this.now().toISOString();
    rememberMemoryRevision(item, 'confirm', at);
    Object.assign(item, { status: 'confirmed', confirmed: true, confirmedBy: 'user',
      confirmedAt: at, updatedAt: at, revision: item.revision + 1 });
    await this.save();
    return memorySummary(item);
  }

  async archiveMemory(id, expectedRevision) {
    const item = this.state.memories.find(x => x && x.id === id && x.historical !== true);
    if (!item) throw new Error('Hukommelsespunktet findes ikke.');
    if (expectedRevision !== undefined) checkRevision(item, expectedRevision);
    memoryHistoryEntries(item);
    if (item.archived) return memorySummary(item);
    const at = this.now().toISOString();
    rememberMemoryRevision(item, 'archive', at);
    item.archived = true;
    item.updatedAt = at;
    item.revision++;
    await this.save();
    return memorySummary(item);
  }

  // This is a soft archive, not erasure of old backups or independent chat history.
  async forgetMemory(id, expectedRevision) { return this.archiveMemory(id, expectedRevision); }

  async addInbox({ title, text, kind = 'info', taskId = null }) {
    const item = { id: randomUUID(), title: String(title).slice(0, 120), text: String(text).slice(0, 2500),
      kind, taskId, read: false, at: this.now().toISOString() };
    this.state.inbox.unshift(item);
    this.state.inbox = this.state.inbox.slice(0, 100);
    await this.save();
    return item;
  }

  async readInbox(id) {
    const item = this.state.inbox.find(x => x.id === id);
    if (!item) throw new Error('Beskeden findes ikke.');
    item.read = true;
    await this.save();
    return item;
  }

  async proposeAction({ kind, title, description, url = '' }) {
    if (!['booking', 'purchase', 'message', 'other'].includes(kind)) throw new Error('Ugyldig handlingstype.');
    if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('Angiv en titel på højst 120 tegn.');
    if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new Error('Angiv en beskrivelse på højst 2.000 tegn.');
    if (url && (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.length > 500)) throw new Error('Brug kun gyldige HTTPS-links.');
    const item = { id: randomUUID(), kind, title: title.trim(), description: description.trim(), url,
      status: 'pending', createdAt: this.now().toISOString() };
    this.state.approvals.unshift(item);
    this.state.approvals = this.state.approvals.slice(0, 100);
    await this.save();
    return item;
  }

  async decideAction(id, decision) {
    const item = this.state.approvals.find(x => x.id === id && x.status === 'pending');
    if (!item) throw new Error('Handlingen findes ikke eller er allerede behandlet.');
    if (!['approve', 'reject'].includes(decision)) throw new Error('Ugyldig beslutning.');
    // Approval is explicitly NOT execution; a future browser adapter must re-check authorization.
    item.status = decision === 'approve' ? 'approved_not_executed' : 'rejected';
    item.decidedAt = this.now().toISOString();
    await this.save();
    return item;
  }
}
