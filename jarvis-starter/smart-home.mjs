import { IntegrationHealth } from './integration-health.mjs';
const API = 'https://api.ws.sonos.com/control/api/v1';

export class SmartHome {
  constructor({ state, save, fetcher = fetch, now, authorizeSonos = async config => config }) {
    this.state = state;
    this.save = save;
    this.fetcher = fetcher;
    this.authorizeSonos = authorizeSonos;
    this.health = new IntegrationHealth({ now });
    if (!Array.isArray(state.homeEvents)) state.homeEvents = [];
  }

  snapshot(config = {}) {
    return {
      sonos: { ...this.health.snapshot(config, Boolean(config.sonosToken)), mode: 'Sonos Control API', tokenExpires: config.sonosRefreshToken ? 'Token fornyes før næste forespørgsel ved udløb.' : 'Manuelt token: forbind via Sonos-login for automatisk fornyelse.' },
      google: { configured: false, status: 'Batteridrevet Nest: live-hændelser er ikke understøttet i v5' },
      events: this.state.homeEvents.slice(-40).reverse(),
    };
  }

  async event({ source, kind, label, detail = '' }) {
    if (!['manual', 'google', 'sonos', 'test'].includes(source)) throw new Error('Ukendt kilde');
    if (!['doorbell', 'motion', 'device', 'music', 'other'].includes(kind)) throw new Error('Ukendt hændelse');
    const item = { id: crypto.randomUUID(), source, kind, label: String(label).slice(0, 140), detail: String(detail).slice(0, 500), at: new Date().toISOString() };
    this.state.homeEvents.push(item);
    this.state.homeEvents = this.state.homeEvents.slice(-100);
    await this.save();
    return item;
  }

  async credentials(config) {
    try { return await this.authorizeSonos(config); }
    catch (error) { return this.health.check(config, async () => { throw error; }); }
  }

  async sonos(config, action) {
    if (!config.sonosToken) throw new Error('Sonos er ikke forbundet.');
    if (!/^[A-Za-z0-9_:-]{1,120}$/.test(action.groupId || '')) throw new Error('Ugyldigt Sonos-gruppe-ID.');
    const allowed = { play: 'play', pause: 'pause', skip: 'skipToNextTrack', previous: 'skipToPreviousTrack' };
    if (!allowed[action.command]) throw new Error('Ukendt afspilningskommando.');
    config = await this.credentials(config);
    return this.health.check(config, async () => {
    const response = await this.fetcher(`${API}/groups/${encodeURIComponent(action.groupId)}/playback/${allowed[action.command]}`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.sonosToken}`, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw Object.assign(new Error(`Sonos afviste handlingen (${response.status}). Kontrollér token, gruppe-ID og tilladelser.`), { status: response.status });
    return { ok: true };
    });
  }

  async sonosGroups(config) {
    if (!config.sonosToken || !config.sonosHouseholdId) return { groups: [], message: 'Angiv et gyldigt Sonos-token og household-ID under Indstillinger.' };
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(config.sonosHouseholdId)) throw new Error('Ugyldigt household-ID.');
    config = await this.credentials(config);
    return this.health.check(config, async () => {
    const response = await this.fetcher(`${API}/households/${config.sonosHouseholdId}/groups`, {
      headers: { Authorization: `Bearer ${config.sonosToken}` }, redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw Object.assign(new Error(`Sonos kunne ikke hente rum (${response.status}).`), { status: response.status });
    const data = await response.json();
    return { groups: Array.isArray(data.groups) ? data.groups.map(x => ({ id: x.id, name: x.name })).filter(x => x.id && x.name) : [] };
    });
  }
}
