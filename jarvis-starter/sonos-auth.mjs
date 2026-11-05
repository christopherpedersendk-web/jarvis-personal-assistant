import { randomBytes, timingSafeEqual } from 'node:crypto';
const CALLBACK = '/api/smart-home/sonos/callback';
const validToken = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const sonosCredentialKey = config => JSON.stringify([config.sonosToken, config.sonosRefreshToken, config.sonosExpiresAt, config.sonosAuthRevision]);

// Only the server holds client secrets and refresh tokens. Persist before use.
export class SonosAuth {
  constructor({ clientId = '', clientSecret = '', redirectUri = '', getConfig, persist, fetcher = fetch, now = Date.now }) {
    Object.assign(this, { clientId, clientSecret, redirectUri, getConfig, persist, fetcher, now });
    this.pending = null; this.refreshing = null;
  }
  configured() {
    try { const url = new URL(this.redirectUri); return Boolean(this.clientId && this.clientSecret && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === CALLBACK); }
    catch { return false; }
  }
  status() {
    const config = this.getConfig();
    return { oauthConfigured: this.configured(), automaticRefresh: Boolean(config.sonosRefreshToken && this.configured()), expiresAt: config.sonosExpiresAt || null };
  }
  begin() {
    if (!this.configured()) throw new Error('Sonos OAuth mangler serveropsætning.');
    const state = randomBytes(32).toString('hex'), browser = randomBytes(32).toString('hex');
    this.pending = { state, browser, expires: this.now() + 600_000, expected: sonosCredentialKey(this.getConfig()) };
    const url = new URL('https://api.sonos.com/login/v3/oauth');
    url.search = new URLSearchParams({ client_id: this.clientId, response_type: 'code', scope: 'playback-control-all', redirect_uri: this.redirectUri, state }).toString();
    return { url: url.href, cookie: `jarvis_sonos=${browser}; HttpOnly; Secure; SameSite=Lax; Path=${CALLBACK}; Max-Age=600` };
  }
  async exchange({ state, browser, code, error }) {
    const pending = this.pending;
    if (!pending || !/^[a-f0-9]{64}$/.test(state || '') || !/^[a-f0-9]{64}$/.test(browser || '') || !same(state, pending.state) || !same(browser, pending.browser)) throw new Error('Sonos-login kunne ikke valideres. Start igen fra Indstillinger.');
    this.pending = null;
    if (pending.expires <= this.now() || error || !validToken(code)) throw new Error('Sonos-login udløb eller blev afvist.');
    const tokens = await this.request({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
    await this.persist(tokens, pending.expected);
  }
  async request(fields) {
    if (!this.configured()) throw new Error('Sonos OAuth mangler serveropsætning.');
    let response;
    try { response = await this.fetcher('https://api.sonos.com/login/v3/oauth/access', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }); } catch { throw new Error('Sonos-login kunne ikke kontaktes. Start login igen ved fortsatte fejl.'); }
    if (!response.ok) throw Object.assign(new Error(`Sonos-login blev afvist (${response.status}). Forbind Sonos igen.`), { status: response.status });
    let data; try { data = await response.json(); } catch { throw new Error('Ugyldigt svar fra Sonos-login.'); }
    if (!validToken(data.access_token) || !validToken(data.refresh_token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 366 * 86400 || String(data.token_type).toLowerCase() !== 'bearer') throw new Error('Ufuldstændigt svar fra Sonos-login.');
    return { sonosToken: data.access_token, sonosRefreshToken: data.refresh_token, sonosExpiresAt: this.now() + data.expires_in * 1000 };
  }
  async credentials() {
    const config = this.getConfig();
    if (!config.sonosRefreshToken || config.sonosExpiresAt > this.now() + 60_000) return config;
    if (this.refreshing) return this.refreshing;
    const expected = sonosCredentialKey(config);
    const operation = (async () => {
      const tokens = await this.request({ grant_type: 'refresh_token', refresh_token: config.sonosRefreshToken });
      await this.persist(tokens, expected);
      return this.getConfig();
    })();
    this.refreshing = operation;
    try { return await operation; } finally { if (this.refreshing === operation) this.refreshing = null; }
  }
}
export const clearSonosCookie = `jarvis_sonos=; HttpOnly; Secure; SameSite=Lax; Path=${CALLBACK}; Max-Age=0`;
