// Integrations-kontrakter, ikke aktive forbindelser. Ingen tokens eller udgående handlinger.
const PROVIDERS = Object.freeze([
  { id: 'discord', title: 'Discord', category: 'messages', capabilities: ['notify.owner', 'message.owner'], outboundPolicy: 'owner-opt-in' },
  { id: 'google-calendar', title: 'Google Kalender', category: 'calendar', capabilities: ['events.read', 'events.propose'], outboundPolicy: 'approval-before-write' },
  { id: 'google-tasks', title: 'Google Tasks', category: 'tasks', capabilities: ['tasks.read', 'tasks.propose'], outboundPolicy: 'approval-before-write' },
  { id: 'home-assistant', title: 'Home Assistant', category: 'home', capabilities: ['entities.read', 'actions.propose'], outboundPolicy: 'approval-before-write' },
  { id: 'hue', title: 'Philips Hue', category: 'home', capabilities: ['lights.read', 'lights.control.with_user_request'], outboundPolicy: 'explicit-request' },
  { id: 'sonos', title: 'Sonos', category: 'home', capabilities: ['players.read', 'players.control.with_user_request'], outboundPolicy: 'explicit-request' },
  { id: 'nest', title: 'Google Nest', category: 'home', capabilities: ['doorbell.events'], outboundPolicy: 'read-only' },
]);

export function integrationCatalog({ discordStatus = 'disabled', discordConfigured = false, huePaired = false, sonosConfigured = false } = {}) {
  return PROVIDERS.map(provider => {
    const status = provider.id === 'discord' && discordConfigured && discordStatus === 'connected' ? 'connected'
      : provider.id === 'discord' && discordConfigured ? 'configured'
        : provider.id === 'hue' && huePaired ? 'configured'
          : provider.id === 'sonos' && sonosConfigured ? 'configured' : 'not_configured';
    return { ...provider, status, implementation: ['discord', 'hue', 'sonos'].includes(provider.id) ? 'available' : 'planned',
      permissions: { read: provider.capabilities.some(x => x.endsWith('.read') || x === 'message.owner' || x === 'doorbell.events'),
        externalWrite: provider.capabilities.some(x => x.includes('.propose') || x.includes('control') || x.startsWith('notify.')) } };
  });
}

export function normalizedIntegrationEvent(event) {
  const { provider, kind, reference, occurredAt } = event || {};
  if (!PROVIDERS.some(x => x.id === provider)) throw new Error('Ukendt integrationskilde.');
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(kind)) throw new Error('Ugyldig hændelsestype.');
  if (typeof reference !== 'string' || reference.length > 150 || !reference.trim()) throw new Error('Ugyldig hændelsesreference.');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) throw new Error('Ugyldigt hændelsestidspunkt.');
  // Ingen rå webhooks, fotos, tokens, meddelelsestekster eller identitetsdata.
  return { provider, kind, reference, occurredAt: new Date(occurredAt).toISOString() };
}
