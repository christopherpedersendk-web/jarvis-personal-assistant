import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { IntegrationHealth } from './integration-health.mjs';

export function validBridgeIp(ip) {
  if (typeof ip !== 'string' || isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export class HueBridge {
  constructor({ request, now } = {}) { this.request = request || this.localRequest.bind(this); this.health = new IntegrationHealth({ now }); }

  status(config) { return this.health.snapshot(config, Boolean(config.applicationKey && config.certificateFingerprint)); }

  async localRequest(config, method, path, body) {
    if (!validBridgeIp(config.bridgeIp)) throw new Error('Hue Bridge skal have en privat IPv4-adresse på dit hjemmenetværk.');
    if (!/^\/(?:api|clip\/v2\/resource)(?:\/[A-Za-z0-9_-]+)*$/.test(path)) throw new Error('Ugyldig Hue API-sti.');
    const fingerprint = { value: null };
    const agent = new https.Agent({ keepAlive: false });
    // Første parring er trust-on-first-use. Efterfølgende forbindelser afvises FØR
    // HTTP-data sendes, hvis certifikatets SHA256-fingeraftryk er ændret.
    agent.createConnection = (_options, callback) => {
      const socket = tls.connect({ host: config.bridgeIp, port: 443, rejectUnauthorized: false });
      socket.once('secureConnect', () => {
        const actual = socket.getPeerCertificate()?.fingerprint256;
        if (!actual || (config.certificateFingerprint && actual !== config.certificateFingerprint)) {
          const err = new Error('Hue Bridges TLS-certifikat er ændret. Genparring kræver manuel kontrol.');
          socket.destroy(err); callback(err); return;
        }
        fingerprint.value = actual;
        callback(null, socket);
      });
      socket.once('error', () => {});
    };
    const payload = body === undefined ? null : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const req = https.request({ hostname: config.bridgeIp, port: 443, path, method, agent,
        headers: { Accept: 'application/json', ...(config.applicationKey ? { 'hue-application-key': config.applicationKey } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }, timeout: 8000 }, response => {
        const chunks = []; let length = 0;
        response.on('data', chunk => { length += chunk.length; if (length > 1_000_000) response.destroy(new Error('Hue-svar for stort.')); else chunks.push(chunk); });
        response.on('end', () => {
          try {
            if (response.statusCode >= 400) throw Object.assign(new Error(`Hue Bridge HTTP ${response.statusCode}`), { status: response.statusCode });
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (data.errors?.length) throw new Error(`Hue: ${data.errors[0].description || 'API-fejl'}`);
            resolve({ data, fingerprint: fingerprint.value });
          } catch (e) { reject(e); }
        });
        response.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Hue Bridge svarede ikke.')));
      req.on('error', reject);
      req.end(payload || undefined);
    });
  }

  async pair(bridgeIp, expectedFingerprint = '') {
    if (!validBridgeIp(bridgeIp)) throw new Error('Angiv Hue Bridges lokale IP-adresse (10.x, 172.16–31.x eller 192.168.x).');
    const { data, fingerprint } = await this.request({ bridgeIp, certificateFingerprint: expectedFingerprint }, 'POST', '/api', { devicetype: 'jarvis#personal-home' });
    const error = data?.find(x => x.error)?.error;
    if (error) throw new Error(error.type === 101 ? 'Tryk på Hue Bridges fysiske knap, og prøv igen inden 30 sekunder.' : `Hue-parring: ${error.description}`);
    const applicationKey = data?.find(x => x.success?.username)?.success?.username;
    if (!applicationKey || !fingerprint) throw new Error('Hue Bridge returnerede ikke en gyldig nøgle og certifikat.');
    return { bridgeIp, applicationKey, certificateFingerprint: fingerprint };
  }

  async resources(config) {
    if (!config.applicationKey || !config.certificateFingerprint) throw new Error('Hue er ikke parret endnu.');
    return this.health.check(config, async () => {
    const kinds = ['room','zone','grouped_light','scene','light'];
    const result = {};
    for (const kind of kinds) {
      const { data } = await this.request(config, 'GET', `/clip/v2/resource/${kind}`);
      result[kind] = Array.isArray(data.data) ? data.data : [];
    }
    return result;
    });
  }

  async control(config, { kind, id, on, brightness }) {
    if (!['grouped_light','light'].includes(kind)) throw new Error('Kun lys og lysgrupper kan tændes og slukkes.');
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Ugyldigt Hue-ID.');
    if (typeof on !== 'boolean' && brightness === undefined) throw new Error('Angiv tænd/sluk eller lysstyrke.');
    const payload = {};
    if (typeof on === 'boolean') payload.on = { on };
    if (brightness !== undefined) {
      if (!Number.isFinite(brightness) || brightness < 1 || brightness > 100) throw new Error('Lysstyrke skal være mellem 1 og 100.');
      payload.dimming = { brightness };
    }
    if (!config.applicationKey || !config.certificateFingerprint) throw Object.assign(new Error('Hue er ikke parret endnu.'), { noActionTaken: true });
    return this.health.check(config, async () => {
      await this.request(config, 'PUT', `/clip/v2/resource/${kind}/${id}`, payload);
      return { ok: true };
    });
  }

  async scene(config, id) {
    if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Ugyldigt Hue-scene-ID.');
    if (!config.applicationKey || !config.certificateFingerprint) throw Object.assign(new Error('Hue er ikke parret endnu.'), { noActionTaken: true });
    return this.health.check(config, async () => {
      await this.request(config, 'PUT', `/clip/v2/resource/scene/${id}`, { recall: { action: 'active' } });
      return { ok: true };
    });
  }
}
