import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

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
    fetcher = fetch, now = () => Date.now() } = {}) {
    this.clientId = clientId; this.clientSecret = clientSecret; this.redirectUri = redirectUri;
    this.refreshToken = refreshToken; this.saveRefreshToken = saveRefreshToken; this.fetcher = fetcher; this.now = now;
    this.calendarId = checkedCalendarId(calendarId); this.saveCalendarId = saveCalendarId;
    this.lastReadAt = null; this.lastReadError = ''; this.coverage = null; this.loginExpired = false;
    this.pending = null; this.accessToken = ''; this.accessUntil = 0;
  }

  configured() {
    try {
      const u = new URL(this.redirectUri);
      return Boolean(this.clientId && this.clientSecret && u.protocol === 'https:' && u.pathname === '/api/google/calendar/callback');
    } catch { return false; }
  }

  status() { return { configured: this.configured(), connected: Boolean(this.refreshToken), scope: 'calendar.readonly', canEdit: false,
    calendarId: this.calendarId, connectionState: !this.configured() ? 'not_configured' : !this.refreshToken ? 'not_connected'
      : this.loginExpired ? 'expired_login' : this.lastReadError ? 'unavailable' : this.lastReadAt ? 'connected' : 'not_verified',
    lastReadAt: this.lastReadAt, lastReadError: this.lastReadError, coverage: this.coverage }; }

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
    this.refreshToken = tokens.refresh_token;
    this.loginExpired = false; this.lastReadError = '';
    this.accessToken = tokens.access_token || '';
    this.accessUntil = this.now() + Math.max(0, Number(tokens.expires_in || 0) - 60) * 1000;
    await this.saveRefreshToken(this.refreshToken);
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
    this.accessToken = result.access_token;
    this.accessUntil = this.now() + Math.max(0, Number(result.expires_in || 0) - 60) * 1000;
    if (result.refresh_token && result.refresh_token !== this.refreshToken) {
      this.refreshToken = result.refresh_token;
      await this.saveRefreshToken(this.refreshToken);
    }
    return this.accessToken;
  }

  async upcoming(days = 7) {
    if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('Kalenderperioden skal være 1–14 dage.');
    const from = new Date(this.now());
    const until = new Date(this.now() + days * 24 * 60 * 60_000);
    const url = new URL(`${EVENTS_ROOT}${encodeURIComponent(this.calendarId)}/events`);
    for (const [key, value] of Object.entries({ timeMin: from.toISOString(), timeMax: until.toISOString(),
      maxResults: '100', singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', timeZone: 'Europe/Copenhagen' })) url.searchParams.set(key, value);
    const events = [];
    const accessToken = await this.token();
    let nextPageToken = '';
    const seenPages = new Set();
    const signal = AbortSignal.timeout(20_000);
    do {
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
      const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
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
    } while (nextPageToken);
    this.lastReadAt = new Date(this.now()).toISOString();
    this.lastReadError = '';
    this.coverage = { start: from.toISOString(), end: until.toISOString(), calendarId: this.calendarId,
      fetchedAt: this.lastReadAt, complete: true };
    return events.filter(x => x.status !== 'cancelled')
      .map(event => ({ id: String(event.id || '').slice(0, 120),
        title: String(event.summary || 'Optaget').slice(0, 160),
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        allDay: Boolean(event.start?.date),
        ...(event.transparency === 'transparent' ? { transparency: 'transparent' } : {}),
      })); // No description, locations, attendee details or conference links.
  }

  async disconnect() {
    this.refreshToken = ''; this.accessToken = ''; this.accessUntil = 0;
    await this.saveRefreshToken('');
    this.lastReadAt = null; this.coverage = null; this.lastReadError = ''; this.loginExpired = false;
    return this.status();
  }
}
