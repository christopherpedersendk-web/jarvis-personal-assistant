// Ren fortolkning af Google SDM Pub/Sub-hændelser. Ingen Cloud-adgang eller
// uautoriseret webhook er åbnet i denne forberedelsesversion.
const EVENT_TYPES = new Map([
  ['sdm.devices.events.DoorbellChime.Chime', { kind: 'doorbell', label: 'Der bliver ringet på døren' }],
  ['sdm.devices.events.CameraPerson.Person', { kind: 'motion', label: 'Nest har registreret en person' }],
  ['sdm.devices.events.CameraMotion.Motion', { kind: 'motion', label: 'Nest har registreret bevægelse' }],
]);

export function parseNestEventMessage(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const messages = payload.message?.data ? [payload] : [payload];
  const events = [];
  for (const msg of messages) {
    let data = msg;
    if (typeof msg.message?.data === 'string') {
      try { data = JSON.parse(Buffer.from(msg.message.data, 'base64').toString('utf8')); }
      catch { continue; }
    }
    if (!data || typeof data !== 'object') continue;
    const keys = data.resourceUpdate?.events;
    if (!keys || typeof keys !== 'object') continue;
    for (const [type, value] of Object.entries(keys)) {
      const mapping = EVENT_TYPES.get(type);
      if (!mapping) continue;
      const eventId = String(value?.eventId || data.eventId || '').slice(0, 160);
      const sourceDevice = String(data.resourceUpdate?.name || '').slice(0, 200);
      if (!eventId || !sourceDevice) continue;
      events.push({ source: 'google', ...mapping, eventId, sourceDevice, timestamp: data.timestamp || null });
    }
  }
  return events;
}
