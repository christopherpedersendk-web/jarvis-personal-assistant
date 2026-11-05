import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { busyMealDates } from './calendar-planning.mjs';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const AUTH_HOST = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_HOST = 'https://oauth2.googleapis.com/token';
const EVENTS_ROOT = 'https://www.googleapis.com/calendar/v3/calendars/';

function checkedCalendarId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._@%+#-]{1,200}$/.test(value))
    throw new Error('Kalender-ID indeholder ugyldige tegn.');
  return value;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export class GoogleCalendarReadOnly {
  constructor({ clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || '', refreshToken = '', saveRefreshToken = async () => {},
    calendarId = 'primary', saveCalendarId = async () => {},
    fetcher = fetch, now = () => Date.now(), cacheTtlMs = 5 * 60_000 } = {}) {
    this.clientId = clientId; this.clientSecret = clientSecret; this.redirectUri = redirectUri;
    this.refreshToken = refreshToken; this.saveRefreshToken = saveRefreshToken; this.fetcher = fetcher; this.now = now;
    this.calendarId = checkedCalendarId(calendarId); this.saveCalendarId = saveCalendarId;
    this.lastReadAt = null; this.lastReadError = ''; this.coverage = null; this.loginExpired = false;
    this.pending = null; this.accessToken = ''; this.accessUntil = 0;
    if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 1000 || cacheTtlMs > 60 * 60_000) throw new Error('Kalendercachens levetid er ugyldig.');
    this.cacheTtlMs = cacheTtlMs; this.eventCache = null; this.cacheConfiguration = this.configurationFingerprint();
  }

  configurationFingerprint() {
    // This digest stays inside the integration object. Credentials and their
    // fingerprint are never returned to the UI, stored in events or logged.
    return createHash('sha256').update(JSON.stringify([this.clientId, this.clientSecret, this.redirectUri, this.refreshToken, this.calendarId])).digest('hex');
  }

  checkCacheConfiguration() {
    const fingerprint = this.configurationFingerprint();
    if (fingerprint !== this.cacheConfiguration) {
      this.eventCache = null; this.coverage = null; this.lastReadAt = null; this.lastReadError = ''; this.loginExpired = false;
      this.accessToken = ''; this.accessUntil = 0;
      this.cacheConfiguration = fingerprint;
    }
    return fingerprint;
  }

  configured() {
    try {
      const u = new URL(this.redirectUri);
      return Boolean(this.clientId && this.clientSecret && u.protocol === 'https:' && u.pathname === '/api/google/calendar/callback');
    } catch { return false; }
  }

  status() { this.checkCacheConfiguration(); return { configured: this.configured(), connected: Boolean(this.refreshToken), scope: 'calendar.readonly', canEdit: false,
    calendarId: this.calendarId, connectionState: !this.configured() ? 'not_configured' : !this.refreshToken ? 'not_connected'
      : this.loginExpired ? 'expired_login' : this.lastReadError ? 'unavailable' : this.lastReadAt ? 'connected' : 'not_verified',
    lastReadAt: this.lastReadAt, lastReadError: this.lastReadError, coverage: this.coverage }; }

  cached({ start, end, startDate, days = 7 } = {}) {
    const status = this.status(), snapshot = this.eventCache;
    let requestedRange = null;
    if (start !== undefined || end !== undefined) {
      if (typeof start !== 'string' || typeof end !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(start)
        || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
        || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 14 * 24 * 60 * 60_000)
        throw new Error('Kalenderdækning kræver en entydig periode på højst 14 dage.');
      requestedRange = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    }
    const rangeCovered = Boolean(snapshot && (!requestedRange || Date.parse(requestedRange.start) >= Date.parse(snapshot.coverage.start)
      && Date.parse(requestedRange.end) <= Date.parse(snapshot.coverage.end)));
    const cacheState = status.connectionState === 'expired_login' ? 'expired_login' : status.lastReadError ? 'unavailable'
      : !snapshot ? 'unknown' : Date.parse(snapshot.expiresAt) <= this.now() ? 'stale' : !rangeCovered ? 'outside_coverage' : 'ready';
    const result = { calendarId: this.calendarId, scope: 'calendar.readonly', canEdit: false, connectionState: status.connectionState,
      cacheState, ready: cacheState === 'ready', requestedRange, rangeCovered,
      fetchedAt: snapshot?.fetchedAt || null, expiresAt: snapshot?.expiresAt || null,
      coverage: snapshot ? { ...snapshot.coverage } : null, lastReadError: status.lastReadError,
      // A cache read is a local copy, never a Google request. Old observations
      // can be shown with stale/error labels but cannot prove current capacity.
      events: snapshot ? snapshot.events.map(event => ({ ...event })) : [] };
    const first = startDate || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    busyMealDates([], { startDate: first, days }); // shared validation; no inferred attendance
    result.dinnerWindow = { start: '16:00', end: '20:00', timeZone: 'Europe/Copenhagen' };
    result.dinnerDays = Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.parse(first + 'T12:00:00Z') + index * 86_400_000).toISOString().slice(0, 10);
      const day = { date, status: 'unknown', reason: cacheState, events: [], eventCount: 0 };
      if (!result.ready) return day;
      try {
        const options = { startDate: date, days: 1, calendarWindow: { from: snapshot.coverage.start, until: snapshot.coverage.end } };
        const busy = busyMealDates(snapshot.events, options).includes(date);
        const relevant = busy ? snapshot.events.filter(event => busyMealDates([event], options).length) : [];
        return { ...day, status: busy ? 'busy' : 'no_conflict', reason: null,
          eventCount: relevant.length, events: relevant.slice(0, 6).map(event => ({ ...event })) };
      } catch { return { ...day, reason: 'outside_coverage' }; }
    });
    return result;
  }

  async selectCalendar(calendarId) {
    const selected = checkedCalendarId(calendarId);
    if (selected === this.calendarId) return this.status();
    await this.saveCalendarId(selected);
    this.calendarId = selected;
    this.coverage = null;
    this.lastReadAt = null;
    this.lastReadError = '';
    return this.status();
  }

  begin() {
    if (!this.configured()) throw new Error('Google Kalender kræver OAuth-klient og HTTPS-redirect i serverens miljø.');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending = { state, verifier, expiresAt: this.now() + 10 * 60_000 };
    const url = new URL(AUTH_HOST);
    for (const [key, value] of Object.entries({ client_id: this.clientId, redirect_uri: this.redirectUri,
      response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
      scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return url.toString();
  }

  async exchange({ state, code, error } = {}) {
    const pending = this.pending;
    this.pending = null; // An OAuth attempt can never be reused, even on error.
    if (!pending || pending.expiresAt < this.now() || !secureEqual(state, pending.state) || error || typeof code !== 'string' || !code || code.length > 8192)
      throw new Error('Google-godkendelsen er udløbet eller ugyldig. Start forbindelsen igen.');
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: pending.verifier });
    if (!tokens.refresh_token || typeof tokens.refresh_token !== 'string') throw new Error('Google returnerede intet refresh-token. Prøv igen med samtykke.');
    // Do not accept a broader scope than the one JARVIS explicitly requested.
    if (tokens.scope && tokens.scope.split(' ').some(scope => scope !== SCOPE)) throw new Error('Google returnerede uventede rettigheder.');
    await this.saveRefreshToken(tokens.refresh_token);
    this.refreshToken = tokens.refresh_token;
    this.checkCacheConfiguration();
    this.loginExpired = false; this.lastReadError = '';
    this.accessToken = tokens.access_token || '';
    this.accessUntil = this.now() + Math.max(0, Number(tokens.expires_in || 0) - 60) * 1000;
    return this.status();
  }

  async tokenRequest(payload) {
    const response = await this.fetcher(TOKEN_HOST, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...payload }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) this.loginExpired = true;
      this.lastReadError = `Google OAuth fejlede (HTTP ${response.status}).`;
      throw new Error(this.lastReadError);
    }
    return response.json();
  }

  async token() {
    if (!this.refreshToken) throw new Error('Google Kalender er ikke forbundet.');
    if (this.accessToken && this.accessUntil > this.now()) return this.accessToken;
    const result = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
    if (!result.access_token) throw new Error('Google returnerede ikke adgangstoken.');
    if (result.refresh_token && result.refresh_token !== this.refreshToken) {
      await this.saveRefreshToken(result.refresh_token);
      this.refreshToken = result.refresh_token;
      this.checkCacheConfiguration();
    }
    this.accessToken = result.access_token;
    this.accessUntil = this.now() + Math.max(0, Number(result.expires_in || 0) - 60) * 1000;
    return this.accessToken;
  }

  async upcoming(days = 7) {
    if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('Kalenderperioden skal være 1–14 dage.');
    this.checkCacheConfiguration();
    const from = new Date(this.now());
    const until = new Date(this.now() + days * 24 * 60 * 60_000);
    const calendarId = this.calendarId;
    const url = new URL(`${EVENTS_ROOT}${encodeURIComponent(calendarId)}/events`);
    for (const [key, value] of Object.entries({ timeMin: from.toISOString(), timeMax: until.toISOString(),
      maxResults: '100', singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', timeZone: 'Europe/Copenhagen' })) url.searchParams.set(key, value);
    const events = [];
    let accessToken;
    try { accessToken = await this.token(); }
    catch (error) { this.lastReadError = error.message; throw error; }
    const configuration = this.checkCacheConfiguration();
    if (calendarId !== this.calendarId) throw new Error('Kalendervalget blev ændret under læsningen. Hent den valgte kalender igen.');
    let nextPageToken = '';
    const seenPages = new Set();
    const signal = AbortSignal.timeout(20_000);
    try { do {
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
      let response;
      try { response = await this.fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal }); }
      catch (error) { this.lastReadError = 'Kalenderkilden kunne ikke læses. Kalenderdækningen er ukendt.'; throw error; }
      if (!response.ok) {
        this.lastReadError = `Google Kalender svarede med HTTP ${response.status}.`;
        throw new Error(this.lastReadError);
      }
      const data = await response.json();
      if (data.items !== undefined && !Array.isArray(data.items)) throw new Error('Google Kalender returnerede et ukendt dataformat.');
      events.push(...(data.items || []));
      nextPageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (events.length > 500 || (nextPageToken && (seenPages.has(nextPageToken) || seenPages.size >= 4))) {
        throw new Error('Kalenderperioden kunne ikke læses fuldstændigt. Vælg en kortere periode.');
      }
      if (nextPageToken) seenPages.add(nextPageToken);
    } while (nextPageToken); }
    catch (error) {
      if (configuration === this.configurationFingerprint()) this.lastReadError ||= 'Kalenderperioden kunne ikke læses fuldstændigt. Dækningen er ukendt.';
      throw error;
    }
    if (configuration !== this.checkCacheConfiguration()) throw new Error('Kalenderforbindelsen blev ændret under læsningen. Tidligere kildedata bruges ikke.');
    this.lastReadAt = new Date(this.now()).toISOString();
    this.lastReadError = '';
    this.coverage = { start: from.toISOString(), end: until.toISOString(), calendarId: this.calendarId,
      fetchedAt: this.lastReadAt, complete: true };
    const normalized = events.filter(x => x.status !== 'cancelled')
      .map(event => ({ id: String(event.id || '').slice(0, 120),
        title: String(event.summary || 'Optaget').slice(0, 160),
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        allDay: Boolean(event.start?.date),
        ...(event.transparency === 'transparent' ? { transparency: 'transparent' } : {}),
      })); // No description, locations, attendee details or conference links.
    this.eventCache = { calendarId, fetchedAt: this.lastReadAt,
      expiresAt: new Date(this.now() + this.cacheTtlMs).toISOString(), coverage: { ...this.coverage }, events: normalized };
    return normalized.map(event => ({ ...event }));
  }

  async disconnect() {
    await this.saveRefreshToken('');
    this.refreshToken = ''; this.accessToken = ''; this.accessUntil = 0;
    this.lastReadAt = null; this.coverage = null; this.lastReadError = ''; this.loginExpired = false;
    return this.status();
  }
}
