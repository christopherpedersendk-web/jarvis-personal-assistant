import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { fetchRecipeResource, recipeUrl } from './recipe-fetch.mjs';
import { redactSecrets, rejectSecrets } from './privacy.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = text => createHash('sha256').update(text).digest('hex');
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const browserLimits = Object.freeze({ sites: 10, readsPerDay: 50, concurrentReads: 2, bytes: 500000, text: 12000, drafts: 20, previewMs: 120000, sourceMs: 86400000 });
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw fail('BROWSER_INPUT', 'Ukendte felter i webanmodningen.');
}
function string(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail('BROWSER_INPUT', 'Udfyld feltet inden for den viste længde.');
  rejectSecrets(value); return value.trim();
}
export function browserUrl(value) {
  string(value, 2048);
  // Check before normalization: even tracking or fragment values may contain
  // personal data. The first adapter deliberately supports public paths only.
  let raw; try { raw = new URL(value); } catch { throw fail('BROWSER_URL', 'Angiv et gyldigt HTTPS-link.'); }
  if (raw.search || raw.hash || /[\u0000-\u0020\u007f\\]/.test(value)) throw fail('BROWSER_URL', 'Brug et offentligt link uden søgeparametre, fragment eller loginoplysninger.');
  const url = recipeUrl(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.') || /\.$/.test(host) || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host))
    throw fail('BROWSER_URL', 'Brug et offentligt domænenavn.');
  rejectSecrets(decodeURIComponent(url.pathname));
  return url;
}
function origin(value) {
  const url = browserUrl(value);
  if (url.pathname !== '/') throw fail('BROWSER_ORIGIN', 'Godkend kun selve websitet, fx https://restaurant.dk, uden en sidesti.');
  return url.origin;
}
function plain(html) {
  // Output is ONLY textContent, never HTML/Markdown or a model instruction.
  // This is an excerpt extractor, not a browser or a visibility guarantee.
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å' };
  return html.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z]+);/gi, (all, key) => {
    if (!key.startsWith('#')) return entities[key] ?? all;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
  }).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function extractWebPage(buffer, url, secrets = []) {
  const html = buffer.toString('utf8'), lower = html.toLowerCase();
  const links = new Set();
  const parts = [], titles = [], skipped = new Set(['script', 'style', 'template', 'svg', 'noscript', 'iframe']);
  let position = 0, inTitle = false;
  // Advance monotonically. Repeated unclosed tags must not trigger quadratic
  // regex backtracking on untrusted input. Malformed tails are discarded.
  while (position < html.length) {
    const open = html.indexOf('<', position), endText = open === -1 ? html.length : open;
    const text = html.slice(position, endText); parts.push(text); if (inTitle) titles.push(text);
    if (open === -1) break;
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4); if (end === -1) break; position = end + 3; continue;
    }
    const end = html.indexOf('>', open + 1); if (end === -1) break;
    const rawTag = html.slice(open + 1, end).trimStart();
    const closing = rawTag.startsWith('/');
    const body = closing ? rawTag.slice(1).trimStart() : rawTag;
    const tag = /^[a-z][a-z0-9]*/i.exec(body)?.[0];
    position = end + 1;
    if (!tag || (body[tag.length] && !'/ \t\r\n\f'.includes(body[tag.length]))) continue;
    const name = tag.toLowerCase();
    if (!closing && name === 'a' && body.length <= 4096 && links.size < 20) {
      const attributes = body.slice(tag.length).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g);
      for (const attr of attributes) {
        if (attr[1].toLowerCase() !== 'href') continue;
        try {
          const target = browserUrl(new URL(plain(attr[2] ?? attr[3] ?? attr[4] ?? ''), url).href);
          if (target.origin === new URL(url).origin && target.href !== url &&
              !secrets.some(secret => secret && decodeURIComponent(target.href).includes(secret))) links.add(target.href);
        } catch { /* Unsupported/unsafe links are never navigation candidates. */ }
        break;
      }
    }
    if (!closing && skipped.has(name)) {
      const close = lower.indexOf('</' + name, position); if (close === -1) break;
      const closeEnd = html.indexOf('>', close); if (closeEnd === -1) break;
      position = closeEnd + 1;
    } else if (name === 'title') inTitle = !closing;
  }
  const title = redactSecrets(plain(titles.join(' ')) || new URL(url).hostname, secrets).slice(0, 200);
  const fullText = redactSecrets(plain(parts.join(' ')), secrets);
  return { url, title, links: [...links], text: fullText.slice(0, browserLimits.text), truncated: fullText.length > browserLimits.text,
    contentHash: digest(buffer), trust: 'untrusted-web-content', format: 'static-html-excerpt',
    notice: 'Uddrag af sidens HTML. JavaScript og login er ikke kørt; indhold og tilgængelighed er ikke verificeret.' };
}

/** Single-owner, public read-only adapter. There is intentionally no model tool
 * registration, cookie jar, general fetch proxy, submit/execute/approval route,
 * or connection to memory/research context. Website text stays untrusted data.
 */
export class BrowserWorkspace {
  constructor({ state, transact, save, control, owner, now = () => new Date(), fetchResource = fetchRecipeResource, renderDynamic = null, secrets = () => [] }) {
    Object.assign(this, { state, transact, save, control, owner, now, fetchResource, renderDynamic, secrets });
    this.bootId = randomUUID(); this.active = new Map();
  }
  data() { return this.state.browserWorkspace || { revision: 1, origins: [], reads: [], drafts: [] }; }
  validSource(read) { return read?.status === 'completed' && read.page && Date.parse(read.completedAt) + browserLimits.sourceMs > this.now().getTime(); }
  check(read) {
    this.control.assertAllowed(read.scope);
    if (this.data().reads.find(r => r.id === read.id)?.status === 'cancelled')
      throw fail('BROWSER_CANCELLED', 'Læsningen blev stoppet.');
    if (read.owner !== this.owner || read.bootId !== this.bootId || read.configRevision !== this.data().revision || !this.data().origins.includes(new URL(read.url).origin))
      throw fail('BROWSER_PERMISSION', 'Tilladelsen er ændret eller udløbet. Gennemgå linket igen.');
  }
  snapshot() {
    const data = this.data();
    return { revision: data.revision, origins: [...data.origins], limits: browserLimits,
      stopped: this.control.snapshot().stopped,
      readsToday: data.reads.filter(r => r.startedAt && day(new Date(r.startedAt)) === day(this.now())).length,
      reads: data.reads.filter(r => r.startedAt).slice(-20).reverse().map(r => ({ id: r.id, url: r.url,
        status: r.status === 'reading' && r.bootId !== this.bootId ? 'unknown' : r.status,
        startedAt: r.startedAt, completedAt: r.completedAt || null, code: r.code || null,
        ...(this.validSource(r) ? { page: r.page } : {}) })),
      drafts: data.drafts.map(d => ({ ...d, sourceExpired: Date.parse(d.source.readAt) + browserLimits.sourceMs <= this.now().getTime() })),
      capabilities: { publicRead: true, javascript: Boolean(this.renderDynamic), login: false, formSubmission: false, payments: false, modelAccess: false } };
  }
  async configure(input) {
    shape(input, ['origins', 'expectedRevision']);
    if (!Array.isArray(input.origins) || input.origins.length > browserLimits.sites) throw fail('BROWSER_INPUT', 'Godkend højst ti websites.');
    const origins = [...new Set(input.origins.map(origin))];
    await this.transact(['browserWorkspace'], async () => {
      const old = this.data();
      if (input.expectedRevision !== old.revision) throw fail('BROWSER_REVISION', 'Websites er ændret et andet sted. Hent status og gennemgå ændringen.');
      this.state.browserWorkspace = { ...old, revision: old.revision + 1, origins }; await this.save();
    });
    for (const controller of this.active.values()) controller.abort();
    return this.snapshot();
  }
  async preview(input) {
    shape(input, ['url','javascript']);
    if (input.javascript !== undefined && typeof input.javascript !== 'boolean') throw fail('BROWSER_INPUT','Ugyldigt browservalg.');
    if (input.javascript && !this.renderDynamic) throw fail('BROWSER_DISABLED','Den isolerede JavaScript-browser er ikke aktiveret.');
    const url = browserUrl(input.url).href, scope = this.control.current();
    if (redactSecrets(url, this.secrets()) !== url) throw fail('BROWSER_INPUT', 'Linket indeholder beskyttede oplysninger.');
    this.control.assertAllowed(scope);
    return this.transact(['browserWorkspace'], async () => {
      this.control.assertAllowed(scope);
      const old = this.data();
      if (!old.origins.includes(new URL(url).origin)) throw fail('BROWSER_PERMISSION', 'Godkend først dette website i webarbejdsområdet.');
      // Bounded metadata, no automatic replay. Pending intents do not survive a
      // server restart, config change, owner-token rotation, or stop/resume.
      const reads = old.reads.filter(r => r.startedAt ? Date.parse(r.startedAt) > this.now().getTime() - 2 * 86400000 : Date.parse(r.expiresAt) > this.now().getTime());
      if (reads.filter(r => r.status === 'ready').length >= 20 || reads.length >= 150) throw fail('BROWSER_LIMIT', 'Der er for mange webanmodninger. Afvent udløb eller gennemgå historikken.');
      const read = { id: randomUUID(), owner: this.owner, bootId: this.bootId, configRevision: old.revision, scope, url, javascript: input.javascript === true,
        status: 'ready', expiresAt: new Date(this.now().getTime() + browserLimits.previewMs).toISOString() };
      this.state.browserWorkspace = { ...old, reads: [...reads, read] }; await this.save();
      return { intentId: read.id, url, javascript: read.javascript, expiresAt: read.expiresAt, effect: read.javascript ? 'Kør siden i en isoleret JavaScript-browser. Højst 25 GET-anmodninger på samme website; ingen login eller formularafsendelse.' : 'Hent denne offentlige side én gang. Der sendes ingen loginoplysninger eller formularfelter.' };
    });
  }
  async read(input) {
    shape(input, ['intentId']); string(input.intentId, 36);
    if (this.control.isTransactionActive()) throw fail('BROWSER_TRANSACTION', 'En webhentning må ikke starte i en ugemt datatransaktion.');
    const read = await this.transact(['browserWorkspace'], async () => {
      const data = this.data(), r = data.reads.find(r => r.id === input.intentId);
      if (!r || r.status !== 'ready') throw fail('BROWSER_USED', 'Anmodningen findes ikke eller er allerede brugt. Hent status; den genforsøges ikke.');
      this.check(r);
      if (Date.parse(r.expiresAt) <= this.now().getTime()) throw fail('BROWSER_EXPIRED', 'Forhåndsvisningen er udløbet. Gennemgå linket igen.');
      if (data.reads.filter(r => r.startedAt && day(new Date(r.startedAt)) === day(this.now())).length >= browserLimits.readsPerDay ||
        data.reads.filter(r => r.status === 'reading' && r.bootId === this.bootId).length >= browserLimits.concurrentReads)
        throw fail('BROWSER_LIMIT', 'Webgrænsen er nået. Højst to samtidige læsninger og 50 pr. dag.');
      r.status = 'reading'; r.startedAt = this.now().toISOString(); await this.save(); return structuredClone(r);
    });
    const controller = new AbortController(); this.active.set(read.id, controller);
    try {
      const page = await this.control.controlled(async signal => {
        this.check(read);
        const result = await (read.javascript ? this.renderDynamic : this.fetchResource)(read.url, { kind: 'html', timeoutMs: 10000, maxBytes: browserLimits.bytes,
          signal: AbortSignal.any([signal, controller.signal]), allowUrl: url => {
            this.check(read);
            // Even another approved origin needs its own explicit preview.
            return browserUrl(url.href).origin === new URL(read.url).origin;
          } });
        this.check(read); controller.signal.throwIfAborted();
        if (browserUrl(result.url).origin !== new URL(read.url).origin || result.buffer.length > browserLimits.bytes) throw fail('BROWSER_BLOCKED', 'Svaret ligger uden for den godkendte læsning.');
        const page = extractWebPage(result.buffer, result.url, this.secrets());
        if(read.javascript) { page.format='isolated-javascript-excerpt';page.notice='Isoleret JavaScript-læsning med begrænset GET-adgang på samme website. Ingen login eller formularafsendelse. Indholdet kan være ufuldstændigt.'; }
        return page;
      }, read.scope);
      return await this.transact(['browserWorkspace'], async () => {
        this.check(read); controller.signal.throwIfAborted();
        const r = this.data().reads.find(r => r.id === read.id);
        r.status = 'completed'; r.page = page; r.completedAt = this.now().toISOString();
        // Keep only ten excerpts; metadata remains available for dedupe/budget.
        for (const old of this.data().reads.filter(r => r.page).slice(0, -10)) delete old.page;
        await this.save(); return { id: r.id, page, completedAt: r.completedAt };
      });
    } catch (error) {
      const cancelled = controller.signal.aborted || this.control.snapshot().stopped || ['ASSISTANT_STOPPED', 'BROWSER_CANCELLED'].includes(error.code);
      await this.transact(['browserWorkspace'], async () => {
        const r = this.data().reads.find(r => r.id === read.id);
        r.status = cancelled ? 'cancelled' : 'failed'; r.code = cancelled ? 'BROWSER_CANCELLED' : 'BROWSER_READ_FAILED';
        delete r.page; await this.save();
      }).catch(() => {}); // An uncertain disk write leaves a consumed record.
      throw fail(cancelled ? 'BROWSER_CANCELLED' : 'BROWSER_READ_FAILED', cancelled ? 'Læsningen blev stoppet. Intet kildeuddrag er gemt.' : 'Siden kunne ikke læses sikkert. Hent status før en ny anmodning. Der er ikke genforsøgt.');
    } finally { this.active.delete(read.id); }
  }
  async cancel(input) {
    shape(input, ['id']); string(input.id, 36);
    // Persist cancellation even before the read's admission commit returns and
    // a transport controller exists. Otherwise a fast click could miss it.
    await this.transact(['browserWorkspace'], async () => {
      const read = this.data().reads.find(r => r.id === input.id);
      if (!read || read.owner !== this.owner || read.bootId !== this.bootId || !['ready', 'reading'].includes(read.status))
        throw fail('BROWSER_NOT_ACTIVE', 'Læsningen er ikke aktiv. Hent status for det gemte udfald.');
      read.status = 'cancelled'; read.code = 'BROWSER_CANCELLED'; await this.save();
    });
    this.active.get(input.id)?.abort(); return { cancellationRequested: true };
  }
  async draft(input) {
    shape(input, ['id', 'expectedRevision', 'readId', 'contentHash', 'title', 'details']);
    const title = string(input.title, 160), details = string(input.details, 2000);
    if (redactSecrets(title + details, this.secrets()) !== title + details) throw fail('BROWSER_INPUT', 'Kladden indeholder beskyttede oplysninger.');
    const scope = this.control.current(); this.control.assertAllowed(scope);
    return this.transact(['browserWorkspace'], async () => {
      this.control.assertAllowed(scope); const data = this.data(); let draft;
      if (input.id !== undefined) {
        if (input.readId !== undefined || input.contentHash !== undefined) throw fail('BROWSER_INPUT', 'Kilden til en eksisterende kladde kan ikke udskiftes.');
        draft = data.drafts.find(d => d.id === input.id);
        if (!draft || draft.revision !== input.expectedRevision) throw fail('BROWSER_REVISION', 'Kladden er ændret. Hent den aktuelle version før gemning.');
        Object.assign(draft, { title, details, revision: draft.revision + 1, updatedAt: this.now().toISOString() });
      } else {
        const read = data.reads.find(r => r.id === input.readId);
        if (!this.validSource(read) || read.page.contentHash !== input.contentHash || input.expectedRevision !== undefined)
          throw fail('BROWSER_SOURCE', 'Læs kilden igen før oprettelse af en kladde.');
        if (data.drafts.length >= browserLimits.drafts) throw fail('BROWSER_LIMIT', 'Slet en gammel kladde før du opretter flere.');
        draft = { id: randomUUID(), title, details, revision: 1, createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(),
          externalStatus: 'not_submitted', source: { readId: read.id, url: read.page.url, contentHash: read.page.contentHash, readAt: read.completedAt } };
        this.state.browserWorkspace = { ...data, drafts: [...data.drafts, draft] };
      }
      await this.save(); return { draft };
    });
  }
  async deleteDraft(input) {
    shape(input, ['id', 'expectedRevision']);
    return this.transact(['browserWorkspace'], async () => {
      const data = this.data(), draft = data.drafts.find(d => d.id === input.id);
      if (!draft || draft.revision !== input.expectedRevision) throw fail('BROWSER_REVISION', 'Kladden er ændret. Hent status før sletning.');
      this.state.browserWorkspace = { ...data, drafts: data.drafts.filter(d => d.id !== draft.id) }; await this.save(); return { deleted: true };
    });
  }
}
