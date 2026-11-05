import { createHash } from 'node:crypto';

// A configuration is not proof of a connection. Observations are local and
// expire; restarting or changing credentials returns to an unverified state.
export class IntegrationHealth {
  constructor({ now = () => new Date(), freshMs = 5 * 60_000 } = {}) {
    this.now = now; this.freshMs = freshMs; this.observation = null;
  }
  identity(config) { return createHash('sha256').update(JSON.stringify(config)).digest('hex'); }
  snapshot(config, configured) {
    const record = this.observation?.identity === this.identity(config) ? this.observation : null;
    let connectionState = !configured ? 'not_configured' : record?.state || 'not_verified';
    if (connectionState === 'connected' && this.now().getTime() - Date.parse(record.checkedAt) >= this.freshMs) connectionState = 'stale';
    return { configured: Boolean(configured), connected: connectionState === 'connected', connectionState,
      lastCheckedAt: record?.checkedAt || null, lastSuccessfulAt: record?.successfulAt || null,
      lastError: record?.error || '' };
  }
  async check(config, action) {
    const identity = this.identity(config);
    const successfulAt = this.observation?.identity === identity ? this.observation.successfulAt : null;
    try {
      const result = await action();
      const timestamp = this.now().toISOString();
      this.observation = { identity, state: 'connected', checkedAt: timestamp, successfulAt: timestamp, error: '' };
      return result;
    } catch (error) {
      const expired = [401, 403].includes(error.status || error.statusCode);
      this.observation = { identity, state: expired ? 'expired_login' : 'unavailable', checkedAt: this.now().toISOString(), successfulAt,
        error: expired ? 'Login eller tilladelse er udløbet. Kontroller forbindelsen manuelt.' : 'Seneste forespørgsel kunne ikke gennemføres. Ingen aktuel forbindelse bekræftet.' };
      throw error;
    }
  }
}
