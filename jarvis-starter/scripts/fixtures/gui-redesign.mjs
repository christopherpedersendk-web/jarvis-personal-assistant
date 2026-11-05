// One stable, synthetic GUI fixture shared by every width and browser engine.
// API responses here exercise rendering and request contracts, not live services.
// Never import this module from public/ or the production server.
import { MealPlanner } from '../../meal-planner.mjs';
import { integrationCatalog } from '../../integration-catalog.mjs';
import { uiBootstrap } from '../../ui-read-model.mjs';
import { buildCommandCenter } from '../../organizer-core.mjs';
import { buildPersonalAgenda } from '../../proactive-planner.mjs';

export const GUI_NOW = '2026-11-05T09:15:00.000Z';
export const GUI_ZONE = 'Europe/Copenhagen';
export const GUI_WIDTHS = Object.freeze([320, 366, 390, 768, 1024, 1440]);
export const GUI_STATES = Object.freeze(['normal', 'empty', 'error']);
export const GUI_IDS = Object.freeze({
  monitor: '00000000-0000-4000-8000-000000000101',
  paused: '00000000-0000-4000-8000-000000000102',
  stale: '00000000-0000-4000-8000-000000000103',
  personal: '00000000-0000-4000-8000-000000000201',
  collection: '00000000-0000-4000-8000-000000000301',
  item: '00000000-0000-4000-8000-000000000302',
  mealPlan: '00000000-0000-4000-8000-000000000401',
});
const clone = value => structuredClone(value);
const ok = json => ({ status: 200, json: clone(json) });
const failure = text => ({ status: 503, json: { error: text } });

function monitor(id, title, status, runs) {
  return {
    id, revision: 3, title, category: 'monitor', status,
    prompt: 'Følg den syntetiske eksempelvare på https://example.invalid/vare. Ingen køb eller eksterne konti.',
    createdAt: '2026-11-02T08:00:00.000Z', updatedAt: GUI_NOW,
    intervalMinutes: 360, dailyTime: null, timeZone: GUI_ZONE,
    nextRunAt: status === 'scheduled' ? '2026-11-05T14:00:00.000Z' : null,
    parameters: {}, permissions: ['web.search'],
    budget: { maxRunsPerDay: 4, maxOutputTokens: 3500 },
    retryPolicy: { maxRetries: 1, delayMinutes: 5 },
    missedRunPolicy: { mode: 'coalesce', maxLatenessMinutes: 120 },
    deliveryPolicy: { channel: 'inbox', quietStart: '22:00', quietEnd: '07:00', deduplicate: true },
    runs, lastRunStatus: runs[0]?.status || null,
  };
}

export async function createGuiFixture(mode = 'normal') {
  if (!GUI_STATES.includes(mode)) throw new Error(`Unknown GUI fixture state: ${mode}`);
  const populated = mode !== 'empty';
  const observation = {
    status: 'changed', subject: 'Eksempel-hovedtelefoner', variant: 'Sort', value: 1899, unit: 'DKK',
    source: 'https://example.invalid/hovedtelefoner', observedAt: '2026-11-05T09:10:00.000Z',
  };
  const oldObservation = { ...observation, subject: 'Eksempel-robotstøvsuger', value: 3299,
    source: 'https://example.invalid/robotstoevsuger', observedAt: '2026-11-04T11:00:00.000Z' };
  const tasks = populated ? [
    monitor(GUI_IDS.monitor, 'Hovedtelefoner · syntetisk eksempel', 'scheduled', [
      { id: 'fixture-run-current', status: 'completed', startedAt: '2026-11-05T09:09:00.000Z',
        at: '2026-11-05T09:10:00.000Z', result: 'Syntetisk observeret pris: 1.899 kr.', observation },
    ]),
    monitor(GUI_IDS.paused, 'Byggesæt på ønskelisten · syntetisk eksempel', 'paused', []),
    monitor(GUI_IDS.stale, 'Robotstøvsuger med lang modelbetegnelse · syntetisk eksempel', 'scheduled', [
      { id: 'fixture-run-failed', status: 'failed', startedAt: '2026-11-05T09:10:00.000Z',
        at: '2026-11-05T09:11:00.000Z', error: 'Syntetisk kilde kunne ikke læses.', result: '',
        observation: { status: 'unknown', value: null, source: '', observedAt: null } },
      { id: 'fixture-run-old', status: 'completed', startedAt: '2026-11-04T10:59:00.000Z',
        at: '2026-11-04T11:00:00.000Z', result: 'Senest kendte syntetiske pris: 3.299 kr.', observation: oldObservation },
    ]),
  ] : [];
  const personal = {
    id: GUI_IDS.personal, revision: 1, status: 'pending', title: 'Find en fødselsdagsgave · eksempel',
    purpose: 'En syntetisk personlig opgave, ikke en købsbestilling.', expectedOutcome: 'Gaveidéer på en liste',
    durationMinutes: 30, durationUncertaintyMinutes: 0, priority: 2,
    earliestStart: null, deadline: '2026-11-06T17:00:00.000Z', plannedStart: null, lockedStart: null,
    nextFollowUpAt: null, dependencies: [], allowedWindows: [], projectId: null,
    source: { kind: 'user', channel: 'manual', id: 'synthetic-gui' },
    createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z', completedAt: null, archivedAt: null,
  };
  const collection = {
    id: GUI_IDS.collection, type: 'notes', title: 'Gaveidéer · syntetisk liste',
    createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z',
    items: [{ id: GUI_IDS.item, text: 'Et brætspil til to', notes: 'Syntetisk note til kildetest.', done: false,
      date: null, person: '', tags: [], createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z' }],
  };
  const events = populated ? [{ id: 'synthetic-calendar-pickup', title: 'Hent børn · eksempel',
    start: '2026-11-05T15:30:00+01:00', end: '2026-11-05T16:00:00+01:00', allDay: false,
    htmlLink: 'https://calendar.google.com/calendar/event?eid=synthetic-gui', calendarId: 'synthetic-gui-calendar',
    transparency: 'opaque' }] : [];
  const calendar = {
    configured: true, connected: true, connectionState: mode === 'error' ? 'unavailable' : 'connected',
    scope: 'calendar.readonly', canEdit: false, calendarId: 'synthetic-gui-calendar',
    lastReadAt: '2026-11-05T09:14:00.000Z', lastReadError: mode === 'error' ? 'Syntetisk kalenderfejl.' : '',
    coverage: { start: '2026-11-02T00:00:00+01:00', end: '2026-11-20T00:00:00+01:00', complete: true,
      calendarId: 'synthetic-gui-calendar' },
  };
  const mealsState = {};
  const meals = new MealPlanner({ state: mealsState, now: () => new Date(GUI_NOW) });
  if (populated) {
    await meals.setHousehold({ expectedRevision: 1, adults: 2, children: [
      { name: 'Barn A · eksempel', age: 6, portionFactor: 0.6 },
      { name: 'Barn B · eksempel', age: 9, portionFactor: 0.75 },
    ], adultPortion: 1 });
    await meals.createPlan({ startDate: '2026-11-02', days: 7 });
    mealsState.mealPlans[0].id = GUI_IDS.mealPlan;
  }
  const history = [];
  const state = { ...mealsState, schemaVersion: 1, stateRevision: 1, history, tasks, projects: [], inbox: [], approvals: [],
    personalTasks: populated ? [personal] : [],
    preferences: '', playbook: '' };
  const calendarStatus = () => fixture.calendarDisconnected ? { ...calendar, connected: false,
    connectionState: 'not_connected', lastReadAt: null, lastReadError: '', coverage: null } : calendar;
  const calendarSnapshot = () => ({ ...calendarStatus(),
    cacheState: fixture.calendarDisconnected ? 'not_connected' : mode === 'error' ? 'unavailable' : 'ready',
    ready: !fixture.calendarDisconnected && mode !== 'error', rangeCovered: !fixture.calendarDisconnected,
    requestedRange: null, fetchedAt: fixture.calendarDisconnected ? null : calendar.lastReadAt,
    expiresAt: fixture.calendarDisconnected ? null : '2026-11-05T09:19:00.000Z', events: fixture.calendarDisconnected ? [] : events });
  const usage = { day: '2026-11-05', started: 0, limit: 10 };
  const requests = [];
  let messageGate = null;
  let messageReceived = null;
  let messageWaiter = null;
  const fixture = {
    mode, now: GUI_NOW, tasks, requests, calendar, homeOutcome: 'success', searchError: false, calendarDisconnected: false,
    holdMessage: false,
    async waitForMessage() {
      if (messageReceived) return messageReceived;
      return new Promise(resolve => { messageWaiter = resolve; });
    },
    releaseMessage() { messageGate?.(); },
    async response(method, url, body) {
      const path = url.pathname;
      requests.push({ method, path, ...(method !== 'GET' ? { body: clone(body) } : {}) });
      if (method === 'POST' && path === '/api/message') {
        messageReceived = clone(body); messageWaiter?.(messageReceived);
        if (fixture.holdMessage) await new Promise(resolve => { messageGate = resolve; });
        history.push({ role: 'user', channel: 'text', at: GUI_NOW, text: body.message },
          { role: 'assistant', channel: 'text', at: GUI_NOW, text: 'Syntetisk forsinket svar. Ingen handling er udført.' });
        return ok({ answer: history.at(-1).text });
      }
      if (method === 'POST' && path === '/api/knowledge/search') {
        if (mode === 'error' || fixture.searchError) return failure('Syntetisk søgefejl.');
        const matches = populated && String(body?.query || '').toLocaleLowerCase('da').includes('gave') ? [{
          id: `organizer:${GUI_IDS.collection}:${GUI_IDS.item}`, type: 'organizer',
          title: collection.title, label: collection.title, updatedAt: collection.updatedAt, text: collection.items[0].text, score: 1,
          source: { collectionId: GUI_IDS.collection, itemId: GUI_IDS.item, updatedAt: collection.updatedAt },
        }] : [];
        return ok({ matches, mode: 'lexical', fallback: null });
      }
      const action = /^\/api\/tasks\/([^/]+)\/action$/.exec(path);
      if (method === 'POST' && action) {
        const task = tasks.find(item => item.id === action[1]);
        if (!task || body.expectedRevision !== task.revision) return { status: 409, json: { error: 'Syntetisk revisionskonflikt.' } };
        if (!['pause', 'resume'].includes(body.action)) return { status: 400, json: { error: 'Denne fixture starter ingen kørsel.' } };
        task.status = body.action === 'pause' ? 'paused' : 'scheduled'; task.revision++;
        task.nextRunAt = task.status === 'scheduled' ? '2026-11-05T14:00:00.000Z' : null;
        return ok({ task });
      }
      if (method === 'POST' && path === '/api/smart-home/hue/control')
        return fixture.homeOutcome === 'success' ? ok({ ok: true }) : failure('Syntetisk enhed bekræftede ikke kommandoen.');
      if (method !== 'GET') return null;
      if (path === '/api/state') return ok(uiBootstrap(state, { tasks, projects: [], configured: mode !== 'error', pushEnabled: false }));
      if (path === '/api/overview') return ok({ summary: uiBootstrap(state, { tasks, projects: [] }).summary });
      if (path === '/api/tasks') return mode === 'error' ? failure('Syntetisk overvågningsfejl.') : ok({ tasks, usage });
      if (path === '/api/personal-tasks') return mode === 'error' ? failure('Syntetisk opgavefejl.') : ok({ tasks: populated ? [personal] : [] });
      if (path === '/api/organizer') return mode === 'error' ? failure('Syntetisk notefejl.') : ok({ collections: populated ? [collection] : [] });
      if (path === `/api/organizer/${GUI_IDS.collection}`) return ok({ collection });
      if (path === '/api/meals') return mode === 'error' ? failure('Syntetisk madplansfejl.') : ok({
        profile: meals.profile(), household: meals.household(), plans: meals.plans(), recipes: meals.recipes(), inventory: meals.inventory(),
      });
      if (path === '/api/google/calendar/status') return ok(calendarStatus());
      if (path === '/api/google/calendar/events') return mode === 'error' ? failure('Syntetisk kalenderfejl.') : ok({ events });
      if (path === '/api/google/calendar/cache') {
        const first = url.searchParams.get('startDate') || '2026-11-02';
        const days = Number(url.searchParams.get('days') || 7);
        return ok({ ...calendarSnapshot(),
          dinnerWindow: { start: '16:00', end: '20:00', timeZone: GUI_ZONE },
          dinnerDays: Array.from({ length: days }, (_, i) => ({
            date: new Date(Date.parse(`${first}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
            status: mode === 'error' ? 'unknown' : 'no_conflict', reason: mode === 'error' ? 'unavailable' : null, events: [], eventCount: 0,
          })),
        });
      }
      if (path === '/api/integrations') return ok({ integrations: integrationCatalog({ googleCalendarStatus: calendar,
        googleCalendarConnected: true, googleCalendarConfigured: true, discordStatus: 'disabled' }) });
      if (path === '/api/smart-home') return mode === 'error' ? failure('Syntetisk hjemmestatus kunne ikke hentes.') : ok({
        sonos: { configured: false, connectionState: 'not_configured', lastCheckedAt: null, lastSuccessfulAt: null },
        google: { configured: false, status: 'Live-hændelser er ikke implementeret.' }, events: [],
      });
      if (path === '/api/smart-home/hue/settings') return mode === 'error' ? failure('Syntetisk Hue-status kunne ikke hentes.') : ok({
        bridgeIp: populated ? '192.0.2.10' : '', configured: populated, paired: populated,
        connectionState: populated ? 'connected' : 'not_configured',
        lastCheckedAt: populated ? '2026-11-05T09:14:00.000Z' : null,
        lastSuccessfulAt: populated ? '2026-11-05T09:14:00.000Z' : null,
      });
      if (path === '/api/smart-home/settings') return ok({ hasSonosToken: false, sonosHouseholdId: '' });
      if (path === '/api/smart-home/hue/resources') return ok({
        room: [{ id: 'synthetic-room', metadata: { name: 'Stue · syntetisk enhed' }, services: [{ rtype: 'grouped_light', rid: 'synthetic-group' }] }],
        grouped_light: [{ id: 'synthetic-group', on: { on: true }, dimming: { brightness: 60 } }], zone: [], scene: [],
      });
      if (path === '/api/updates') return ok({ configured: mode !== 'error', currentVersion: '5.0.0',
        available: { version: 'v5.0.1', sha: '1'.repeat(40) }, staged: null, approved: null, error: '',
        storage: { ready: true, revision: 1, lastError: null }, publicationUnknown: false, busy: { check: false, stage: false } });
      if (path === '/api/system-health') return ok({
        version: '5.0.0', checkedAt: GUI_NOW, process: { healthy: true, uptimeSeconds: 7200 }, host: { availableDiskBytes: 20 * 1024 ** 3, freeMemoryBytes: 6 * 1024 ** 3 },
        storage: { ready: true }, discord: { status: 'disabled' }, backup: { result: 'unavailable' }, tasks: { failed: 0 },
      });
      if (path === '/api/dashboard') {
        if (mode === 'error') return failure('Syntetisk dagsoversigt kunne ikke læses.');
        const input = { state, organizer: { upcoming: () => [] }, now: new Date(GUI_NOW) };
        return ok({ ...buildCommandCenter({ ...input, calendarSnapshot: calendarSnapshot() }),
          agenda: buildPersonalAgenda(input), recentDigests: [] });
      }
      return null;
    },
  };
  return fixture;
}
