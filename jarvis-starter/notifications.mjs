const endpoint = 'https://api.pushover.net/1/messages.json';

export function notificationConfig(env = process.env) {
  return {
    token: (env.PUSHOVER_APP_TOKEN || '').trim(),
    user: (env.PUSHOVER_USER_KEY || '').trim(),
    url: (env.JARVIS_HTTPS_URL || '').trim(),
  };
}

export function notificationsEnabled(config) {
  return Boolean(config.token && config.user);
}

export async function sendPushover(config, { title, message }, fetcher = fetch) {
  if (!notificationsEnabled(config)) throw new Error('Pushover er ikke konfigureret i .env.');
  if (config.url && !/^https:\/\//i.test(config.url)) throw new Error('JARVIS_HTTPS_URL skal begynde med https://');
  const fields = new URLSearchParams({
    token: config.token, user: config.user,
    title: String(title).slice(0, 250),
    message: String(message).slice(0, 1024),
    priority: '0',
  });
  if (config.url) {
    fields.set('url', config.url);
    fields.set('url_title', 'Åbn JARVIS');
  }
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('Forbindelsen til Pushover mislykkedes.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== 1) {
    throw new Error(`Pushover afviste beskeden (${response.status}). Kontrollér nøgler og appregistrering.`);
  }
  return true;
}

export function taskNotification(task, status) {
  const name = task.title.replace(/[\r\n\t]/g, ' ').slice(0, 90);
  return status === 'completed'
    ? { title: 'JARVIS · Opgave færdig', message: `"${name}" er færdig. Åbn JARVIS for at se resultatet.` }
    : { title: 'JARVIS · Opgave fejlede', message: `"${name}" kunne ikke afsluttes. Se fejlen i JARVIS.` };
}
