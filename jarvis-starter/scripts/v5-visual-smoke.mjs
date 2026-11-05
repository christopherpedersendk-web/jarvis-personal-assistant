// Local v5 UI smoke test. Uses an isolated fixture and blocks outside origins.
// No real credentials, personal state, Google/Discord calls or Nemlig writes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { renderedAccessibilityReport } from './ui-accessibility.mjs';
import { STATE_SCHEMA_VERSION } from '../state-schema.mjs';
import { syntheticServerEnv } from '../test/helpers/synthetic-env.mjs';
import { buildTodayOverview } from '../planning-advisor.mjs';
import { guiIdentity } from './gui-evidence.mjs';

const { chromium, webkit } = createRequire(import.meta.url)('playwright');
const token = 'v5-local-visual-smoke-synthetic-access';
const app = new URL('../', import.meta.url).pathname;
const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v5-ui-'));
const screenshotDir = process.env.JARVIS_V5_ARTIFACT_DIR || dataDir;
await mkdir(screenshotDir, { recursive: true });
const monitorIds = { changed: 'd7205d69-8d41-46aa-9188-8feccbcce770', unknown: '732556ee-6fc8-482b-9bc2-b8b6a138f952' };
const fixtureObservedAt = new Date(Date.now() - 60_000).toISOString();
// Retained historical observations only. Neither seeded job has a runnable
// schedule; UI tests must never activate or re-run them.
const monitorFixtures = Object.entries(monitorIds).map(([status, id]) => ({ id, revision: 1,
  title: `Syntetisk ${status === 'changed' ? 'ændret' : 'ukendt'} monitor`, category: 'monitor', status: 'paused',
  prompt: 'Kun en syntetisk gemt observation. Må ikke aktiveres af browsertesten.',
  timeZone: 'Europe/Copenhagen', permissions: ['web.search'], parameters: {}, intervalMinutes: 0, nextRunAt: null,
  runs: [{ id: `synthetic-${status}`, at: fixtureObservedAt, status: status === 'unknown' ? 'unknown' : 'completed',
    result: status === 'unknown' ? 'NO_CHANGE tekst er ikke bevis for uændret udfald.' : 'Struktureret prisændring uden CHANGE-prefix.',
    observation: { status, subject: 'Syntetisk produkt', variant: 'Testvariant', unit: 'DKK',
      value: status === 'unknown' ? null : 25, source: 'https://synthetic.invalid/recorded-product', observedAt: fixtureObservedAt } }],
}));
await writeFile(join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION,
  tasks: monitorFixtures,
  mealHousehold: { configured: true, revision: 1, adults: 2, adultPortion: 1, children: [], days: {} },
  history: Array.from({ length: 65 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', channel: 'text',
    at: new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString(), text: `Syntetisk historikbesked ${String(index + 1).padStart(2, '0')} – ingen persondata.` })) }), { mode: 0o600 });
async function publicAssetHashes() {
  const paths = (await readdir(join(app, 'public'))).filter(name => /\.(?:css|js|html)$/.test(name)).sort();
  return Object.fromEntries(await Promise.all(paths.map(async name => [name,
    createHash('sha256').update(await readFile(join(app, 'public', name))).digest('hex')])));
}
const initialAssetHashes = await publicAssetHashes();
const candidateIdentity = await guiIdentity();
const accessibilityReports = [];
const todayReports = [];
const deviceReports = [];
const failedDevices = [];
let completed = false;
const serverSocket = createServer();
await new Promise((resolve, reject) => serverSocket.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
const port = serverSocket.address().port;
await new Promise(resolve => serverSocket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = syntheticServerEnv({ dataDir, accessToken: token, port });
const server = spawn(process.execPath, ['server.mjs'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stderr.on('data', chunk => { logs = (logs + String(chunk)).slice(-4000); });
const errors = [];
let browser;

async function signIn(page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#token').fill(token);
  await page.locator('#login-form button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
}

async function uiWrite(page, method, path, action, statuses = [200]) {
  const observedRequests = [];
  const observedNavigations = [];
  if (path.startsWith('/api/personal-tasks') && ['POST', 'PATCH'].includes(method)) {
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/personal-tasks'))
        observedRequests.push({ path: new URL(request.url()).pathname, method: request.method() });
      if (request.isNavigationRequest()) observedNavigations.push({ method: request.method(), url: request.url() });
    });
    await page.evaluate(() => {
      window.__jarvisTaskTrace = [];
      if (window.__jarvisTaskEventsInstalled) return;
      window.__jarvisTaskEventsInstalled = true;
      for (const kind of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'submit']) {
        document.addEventListener(kind, event => {
          const form = document.querySelector('#personal-task-form');
          if (form?.contains(event.target)) window.__jarvisTaskTrace?.push({ event: kind,
            target: event.target.id || event.target.textContent?.trim()?.slice(0, 40),
            button: event.target === form.querySelector('[type="submit"]') });
        }, true);
      }
    });
  }
  if (path === '/api/follow-ups') {
    page.on('request', request => {
      if (request.isNavigationRequest()) observedNavigations.push({ kind: 'navigation', method: request.method(), url: request.url() });
      if (new URL(request.url()).pathname.startsWith('/api/follow-ups'))
        observedRequests.push({ path: new URL(request.url()).pathname, method: request.method() });
    });
    const native = await page.evaluate(() => {
      const form = document.querySelector('#follow-up-form'), button = form.querySelector('[type="submit"]');
      const controls = [...form.elements].map(control => ({ id: control.id, type: control.type,
        value: control.type === 'password' ? '[redacted]' : control.value,
        disabled: control.disabled, valid: control.validity?.valid ?? true, issue: control.validity?.valid ? '' : control.validationMessage }));
      window.__jarvisFollowTrace = [];
      for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'submit']) {
        document.addEventListener(kind, event => window.__jarvisFollowTrace?.push({ event: kind, target: event.target.id || event.target.textContent?.trim()?.slice(0, 40),
          inFollowForm: form.contains(event.target), at: event instanceof PointerEvent ? [event.clientX, event.clientY] : null }), true);
      }
      form.addEventListener('click', event => window.__jarvisFollowTrace.push({ event: 'form-click', target: event.target.id || event.target.textContent?.trim() }), true);
      form.addEventListener('submit', event => {
        window.__jarvisFollowTrace.push({ event: 'submit', defaultPreventedAtCapture: event.defaultPrevented });
        queueMicrotask(() => window.__jarvisFollowTrace.push({ event: 'submit-after', defaultPrevented: event.defaultPrevented }));
      }, true);
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { valid: form.matches(':valid'), buttonForm: button.form?.id, buttonDisabled: button.disabled,
        buttonRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hit: hit?.id || hit?.outerHTML?.slice(0, 130),
        active: document.activeElement?.id || document.activeElement?.tagName,
        controls };
    });
    assert.equal(native.valid, true, `Native follow-up form invalid before click: ${JSON.stringify(native)}`);
    assert.equal(native.buttonForm, 'follow-up-form', `Follow-up submit is detached from its form: ${JSON.stringify(native)}`);
  }
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method,
    { timeout: path === '/api/follow-ups' ? 10000 : 30000 });
  await action();
  const response = await waiting.catch(async error => {
    // A browser may block an invalid native form before fetch() runs. Preserve
    // evidence of that real failure, including WebKit-specific validity rules,
    // instead of silently treating a missing HTTP write as successful.
    const diagnostic = await page.evaluate(() => ({
      invalid: [...document.querySelectorAll('form :invalid')].map(control => ({
        id: control.id, type: control.type, message: control.validationMessage,
        validity: Object.fromEntries(['badInput', 'customError', 'patternMismatch', 'rangeOverflow', 'rangeUnderflow',
          'stepMismatch', 'tooLong', 'tooShort', 'typeMismatch', 'valueMissing'].map(key => [key, control.validity?.[key] === true])),
      })).slice(0, 12),
      taskStatus: document.querySelector('#personal-task-status')?.textContent || '',
      followStatus: document.querySelector('#follow-up-status')?.textContent || '',
      focused: document.activeElement?.id || null,
      task: (() => { const form = document.querySelector('#personal-task-form');
        const button = form?.querySelector('[type="submit"]'), rect = button?.getBoundingClientRect(),
          hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return form ? { valid: form.checkValidity(), events: window.__jarvisTaskTrace || [],
          buttonDisabled: button?.disabled, buttonRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          hit: hit?.id || hit?.outerHTML?.slice(0, 130),
          controls: [...form.elements].filter(control => !control.checkValidity()).map(control => ({ id: control.id, issue: control.validationMessage })) } : null; })(),
      follow: (() => { const form = document.querySelector('#follow-up-form');
        const button = form?.querySelector('[type="submit"]'), rect = button?.getBoundingClientRect(),
          hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return form ? { valid: form.checkValidity(), events: window.__jarvisFollowTrace || [],
          active: document.activeElement?.outerHTML?.slice(0, 160), documentUrl: location.href,
          buttonDisabled: button?.disabled, buttonRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          hit: hit?.id || hit?.outerHTML?.slice(0, 130),
          formAction: form.action,
          controls: [...form.elements].filter(control => !control.checkValidity()).map(control => ({ id: control.id,
            type: control.type, value: control.value, issue: control.validationMessage })) } : null; })(),
    })).catch(() => ({ unavailable: true }));
    throw new Error(`${method} ${path}: no HTTP response (${error.message}); observed related requests: ${JSON.stringify(observedRequests)}; navigations: ${JSON.stringify(observedNavigations)}; browser state: ${JSON.stringify(diagnostic)}`);
  });
  const body = await response.json();
  assert.ok(statuses.includes(response.status()), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`);
  await page.waitForFunction(() => !document.querySelector('.meal-family-day[aria-busy="true"], .meal-card[aria-busy="true"], #meal-family-form[aria-busy="true"], #meal-recipe-form[aria-busy="true"], .project-card[aria-busy="true"], #project-form[aria-busy="true"], #code-form[aria-busy="true"], #personal-claim-form[aria-busy="true"], .memory-v49-card[aria-busy="true"], #memory-workbench-form[aria-busy="true"], #personal-task-form [type="submit"]:disabled, #follow-up-form [type="submit"]:disabled, #capacity-form [type="submit"]:disabled'));
  return { body, input: response.request().postDataJSON(), status: response.status() };
}

async function fixtureRead(page, path) {
  const response = await page.request.get(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status(), 200, path); return response.json();
}

async function openDetails(details) {
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
}

async function navigate(page, view) {
  // Exercise the redesigned navigation through its actual controls. The deep
  // assertions below still cover the original objects, writes and draft guards.
  if (await page.locator('#global-chat-panel').isVisible()) await page.locator('#global-chat-close').click();
  if (view === 'knowledge') {
    if (!await page.locator('#tab-knowledge').isVisible()) await page.locator('#global-search-open').click();
    await page.locator('#knowledge-query').waitFor({ state: 'visible' }); return;
  }
  if (await page.locator('#tab-knowledge').isVisible()) await page.locator('#global-search-close').click();
  const route = ({
    meals: ['plan', 'meals'], notes: ['plan', 'notes'], projects: ['plan', 'tasks', 'projects'],
    agent: ['plan', 'tasks', 'agent'], plan: ['plan', 'tasks', 'personal'], calendar: ['plan', 'calendar'],
    memory: ['settings', 'profile'], settings: ['settings', 'profile'],
    automations: ['settings', 'automations'], system: ['settings', 'system'],
  })[view] || [view];
  await page.locator(`a[data-tab="${route[0]}"]:visible`).first().click();
  if (route[1]) await page.locator(`button[data-${route[0] === 'plan' ? 'plan' : 'settings'}-tab="${route[1]}"]`).click();
  if (route[2]) await page.locator(`[data-task-filter="${route[2]}"]`).click();
  await page.locator(`#tab-${route[0]}`).waitFor({ state: 'visible' });
  if (view === 'meals' || view === 'projects') await page.locator(`#tab-${view}`).waitFor({ state: 'visible' });
  if (view === 'meals') for (const section of await page.locator('.meal-secondary-section').all()) await openDetails(section);
  const editors = ({ plan: ['personal-task-create', 'follow-up-create'], calendar: ['capacity-create'],
    agent: ['task-editor-shell'], projects: ['project-create-details'], system: ['code-create-details'],
    meals: ['meal-family-preferences', 'meal-profile-preferences', 'meal-recipe-create'] })[view] || [];
  for (const id of editors) await openDetails(page.locator(`#${id}`));
}

async function waitForTodayCards(page, label) {
  await page.waitForFunction(() => [...document.querySelectorAll('#home-intelligence > [data-today-section]')]
    .map(element => element.dataset.todaySection).join(',') === 'priorities,household,calendar');
  const cards = page.locator('#home-intelligence > [data-today-section]');
  assert.equal(await cards.count(), 3, `${label}: the loaded Today view contains exactly its three compact cards`);
  for (const name of ['priorities', 'household', 'calendar'])
    assert.equal(await page.locator(`#home-intelligence > [data-today-section="${name}"]`).isVisible(), true);
}

async function refreshToday(page) {
  // Navigation can already have started the read. Wait for its actual guard,
  // rather than treating a coalesced/no-op refresh call as a completed request.
  await page.waitForFunction(() => !commandLoadInProgress);
  await page.evaluate(() => refreshCommandCenter());
  await page.waitForFunction(() => !commandLoadInProgress);
}

function isLocalNemligStatusRead(request) {
  // This is JARVIS's own already-recorded integration state. Its GET handler
  // calls nemlig.status() and never contacts Nemlig. Product search, basket
  // reads, proposals and every mutation remain prohibited in these flows.
  return request.method() === 'GET' && new URL(request.url()).pathname === '/api/nemlig/status';
}

async function verifyTodaySources(page, label, task, followUp) {
  const evidence = { label, status: 'running', sourceMode: 'real local task/case/household and seeded paused monitor history; HTTP-only synthetic calendar-cache fixture',
    activatedJobs: 0, upstreamReads: 0 };
  todayReports.push(evidence);
  const writes = [], upstream = [];
  const track = request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(path);
    if (/^\/api\/google\/calendar\/(?:events|upcoming)$/.test(path) ||
        path.startsWith('/api/nemlig/') && !isLocalNemligStatusRead(request)) upstream.push(path);
  };
  page.on('request', track);
  let dashboardHandler, cacheHandler;
  try {
    await navigate(page, 'home'); await refreshToday(page); await waitForTodayCards(page, label);
    const dashboard = await fixtureRead(page, '/api/dashboard'), overview = dashboard.todayOverview;
    for (const id of [`personal-task:${task.id}`, `follow-up:${followUp.id}`, `task:${monitorIds.unknown}`, `task:${monitorIds.changed}`])
      assert.ok(overview.priorities.some(item => item.sourceId === id), `${label}: real dashboard includes ${id}`);
    const priorities = page.locator('#home-intelligence > [data-today-section="priorities"]');
    assert.match(await priorities.textContent(), /Ukendt overvågningsudfald/);
    assert.match(await priorities.textContent(), /Registreret ændring/);
    assert.equal(overview.household.known, true); assert.ok(overview.household.attendance.householdConfirmed);
    const household = page.locator('#home-intelligence > [data-today-section="household"]');
    assert.ok((await household.textContent()).includes(overview.household.detail));
    const householdUrl = new URL(await household.locator('[data-agenda-source-id]').first().getAttribute('href'), origin);
    assert.equal(householdUrl.searchParams.get('source'), overview.household.sourceId);
    const calendar = page.locator('#home-intelligence > [data-today-section="calendar"]');
    assert.equal(overview.calendar.status, 'unknown'); assert.match(await calendar.innerText(), /ukendt|ikke læst/i);
    assert.equal(await calendar.locator('[data-agenda-source-id]').count(), 0, `${label}: missing calendar does not invent an event source`);

    const draft = `Uafsendt syntetisk besked under Today-kildetur ${label}`;
    await page.locator('#message').fill(draft);
    const taskSelector = `#home-intelligence [data-agenda-source-id="personal-task:${task.id}"]`;
    const link = page.locator(taskSelector);
    await link.waitFor({ state: 'attached' });
    if (!await link.isVisible()) await openDetails(priorities.locator(':scope > details'));
    await link.focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await link.evaluate(element => { window.syntheticTodaySourceLink = element; });
    await refreshToday(page);
    assert.equal(await link.evaluate(element => element === window.syntheticTodaySourceLink && element === document.activeElement && element.isConnected), true,
      `${label}: Today polling preserves the exact keyboard-focused source link`);
    assert.equal(await page.locator('#message').inputValue(), draft);
    const taskUrl = new URL(await link.getAttribute('href'), origin);
    assert.equal(taskUrl.searchParams.get('source'), `personal-task:${task.id}`); assert.equal(taskUrl.searchParams.get('view'), 'plan');
    assert.match(await link.innerText(), new RegExp(`Kilderevision ${task.revision}`));
    evidence.contrast = await page.evaluate(renderedAccessibilityReport, [
      { name: 'I dag kildeoverskrift', selector: taskSelector + ' strong', kind: 'text' },
      { name: 'I dag kildegrundlag', selector: taskSelector + ' .muted', kind: 'text' },
      { name: 'I dag tastaturkilde', selector: taskSelector, kind: 'focus' },
    ]);
    for (const check of evidence.contrast.checks) {
      assert.equal(check.missing, undefined); assert.equal(check.visible, true); assert.equal(check.requiresManualReview, undefined);
      assert.ok(check.textRatio >= 4.5, `${label}: Today ${check.name} contrast ${check.textRatio}:1`);
      if (check.kind === 'focus') assert.ok(check.focused && check.outlineWidth >= 2 && check.outlineStyle !== 'none' && check.outlineRatio >= 3,
        `${label}: Today keyboard source has a visible >=2px, >=3:1 focus ring`);
    }
    await link.press('Enter');
    await page.locator(`[data-personal-task-id="${task.id}"].source-target`).waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('source'), `personal-task:${task.id}`);
    await page.goBack(); await page.locator('#tab-home').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('source'), null);
    assert.equal(await page.locator('#message').inputValue(), draft, `${label}: source return keeps the unsent chat draft`);
    assert.equal(await link.evaluate(element => element === window.syntheticTodaySourceLink), true);

    // There is intentionally no API for populating a real Google cache without
    // a separately chosen provider read. Exercise its browser contract through
    // GET responses only, using the actual production projection for the card.
    const now = new Date(), day = buildTodayOverview({ state: {}, now }).date, next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    let cache = { ready: true, cacheState: 'ready', calendarId: `synthetic:${label}@calendar.test`,
      fetchedAt: new Date(now.getTime() - 2000).toISOString(), expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      coverage: { start: new Date(now.getTime() - 86_400_000).toISOString(), end: new Date(now.getTime() + 129_600_000).toISOString(), complete: true },
      events: [{ id: `today:${label}`, title: `Syntetisk kalenderobservation ${label}`, start: day,
        end: next.toISOString().slice(0, 10), allDay: true }] };
    dashboardHandler = async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch(), data = await response.json();
      data.todayOverview.calendar = buildTodayOverview({ state: {}, now: new Date(), calendarSnapshot: cache }).calendar;
      return route.fulfill({ response, json: data });
    };
    cacheHandler = route => route.request().method() === 'GET' ? route.fulfill({ json: cache }) : route.continue();
    await page.route('**/api/dashboard', dashboardHandler); await page.route('**/api/google/calendar/cache?**', cacheHandler);
    await refreshToday(page);
    const expectedId = `google-calendar:${encodeURIComponent(cache.calendarId)}:${day}:${encodeURIComponent(cache.events[0].id)}:${encodeURIComponent(cache.fetchedAt)}`;
    const calendarLink = calendar.locator('[data-agenda-source-id]'); await calendarLink.waitFor({ state: 'visible' });
    assert.equal(await calendarLink.getAttribute('data-agenda-source-id'), expectedId);
    const copiedUrl = new URL(await calendarLink.getAttribute('href'), origin).href;
    assert.equal(new URL(copiedUrl).searchParams.get('source'), expectedId);
    await calendarLink.press('Enter');
    const detail = page.locator('#home-calendar-source');
    await page.locator('#home-calendar-source.source-target').waitFor({ state: 'visible' });
    assert.equal(await detail.getAttribute('data-calendar-source-id'), expectedId);
    assert.ok((await detail.innerText()).includes(cache.fetchedAt));
    assert.ok((await detail.innerText()).includes(cache.events[0].title));
    assert.equal(await page.locator('#message').inputValue(), draft);
    await detail.screenshot({ path: join(screenshotDir, `${label}-today-calendar-source.png`), animations: 'disabled' });
    cache = { ...cache, fetchedAt: new Date(Date.parse(cache.fetchedAt) + 1000).toISOString() };
    await page.goto(copiedUrl, { waitUntil: 'domcontentloaded' });
    await detail.getByText(/Kilden er utilgængelig/).waitFor({ state: 'visible' });
    assert.equal(await detail.getAttribute('data-calendar-source-id'), null, `${label}: a copied old cache URL cannot select a newer observation`);
    assert.doesNotMatch(await detail.innerText(), new RegExp(`Syntetisk kalenderobservation ${label}`));
    assert.equal(await page.locator('#message').inputValue(), draft, `${label}: ordinary chat draft survives an actual copied-source document reload`);
    await page.locator('#global-chat-open').click();
    await page.locator('#message').fill('');
    await page.locator('#global-chat-close').click();
    assert.deepEqual(writes, [], `${label}: Today polling and source navigation are read-only`);
    assert.deepEqual(upstream, [], `${label}: Today does not request Google reads or retailer actions`);
    evidence.taskSource = taskUrl.href; evidence.calendarSource = copiedUrl;
    evidence.calendarVersionMismatch = 'rejected'; evidence.status = 'passed';
  } finally {
    if (dashboardHandler) await page.unroute('**/api/dashboard', dashboardHandler);
    if (cacheHandler) await page.unroute('**/api/google/calendar/cache?**', cacheHandler);
    page.off('request', track);
  }
  await navigate(page, 'plan'); await refreshPlanning(page);
}

async function refreshClaims(page, id) {
  await page.evaluate(async sourceId => {
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:v5-sources-changed', {
      detail: { sourceId, waitUntil: promise => pending.push(promise) },
    }));
    await Promise.all(pending);
  }, `claim:${id}`);
}

async function verifyClaimCorrection(page, originalId, label) {
  await navigate(page, 'memory');
  const original = (await fixtureRead(page, '/api/personal-claims')).claims.find(item => item.id === originalId);
  const correctedValue = `Syntetisk rettet personligt faktum ${label}`;
  await page.locator(`[data-claim-id="${originalId}"]`).getByRole('button', { name: 'Ret oplysning', exact: true }).click();
  await page.locator('#claim-value').fill(correctedValue);
  await page.locator('#claim-source-id').fill(`syntetisk-kildereference-${label}`);
  await page.locator('#claim-valid-from').fill('2020-01-01T09:00');
  await page.locator('#claim-expires-at').fill('2035-01-01T09:00');
  await page.locator('#claim-value').evaluate(input => { input.focus(); input.setSelectionRange(3, 10); window.syntheticClaimField = input; });
  await refreshClaims(page, originalId);
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticClaimField,
    selection: [window.syntheticClaimField.selectionStart, window.syntheticClaimField.selectionEnd] })), { same: true, selection: [3, 10] });
  await navigate(page, 'home'); await navigate(page, 'memory');
  assert.equal(await page.locator('#claim-value').inputValue(), correctedValue);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#settings-profile').waitFor({ state: 'visible' });
  await refreshClaims(page, originalId);
  assert.equal(await page.locator('#claim-value').inputValue(), correctedValue);
  assert.match(await page.locator('#claim-draft-status').innerText(), new RegExp(`basisrevision ${original.revision}`));
  const created = await uiWrite(page, 'POST', '/api/personal-claims', () => page.locator('#personal-claim-form [type="submit"]').click(), [201]);
  const proposalId = created.body.claim.id;
  assert.equal(created.input.correctsId, originalId); assert.equal(created.input.correctsRevision, original.revision);
  assert.equal(created.body.claim.status, 'proposed');
  assert.equal((await fixtureRead(page, '/api/personal-claims')).claims.find(item => item.id === originalId).status, 'confirmed');
  const proposal = page.locator(`[data-claim-id="${proposalId}"]`);
  assert.equal(await proposal.getByRole('button', { name: 'Bekræft oplysning', exact: true }).isDisabled(), true,
    `${label}: creating a correction does not silently choose or replace its original`);
  await proposal.getByRole('button', { name: 'Redigér forslag', exact: true }).click();
  await page.locator('#claim-value').fill(`Ugemt lokal rettelse ${label}`);
  const concurrent = await page.request.patch(`${origin}/api/personal-claims/${proposalId}`, { headers: { Authorization: `Bearer ${token}` },
    data: { expectedRevision: created.body.claim.revision, value: `Syntetisk samtidig rettelse ${label}` } });
  assert.equal(concurrent.status(), 200); const latest = (await concurrent.json()).claim;
  await refreshClaims(page, proposalId);
  assert.equal(await page.locator('#claim-value').inputValue(), `Ugemt lokal rettelse ${label}`);
  assert.match(await page.locator('#claim-draft-status').innerText(), /Ændret et andet sted/);
  assert.equal(await page.locator('#personal-claim-form [type="submit"]').isDisabled(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Hent nyeste oplysning og kassér kladde', exact: true }).click();
  await page.waitForFunction(value => document.getElementById('claim-value').value === value, latest.value);
  await page.locator('#claim-value').fill(correctedValue);
  const saved = await uiWrite(page, 'PATCH', `/api/personal-claims/${proposalId}`, () => page.locator('#personal-claim-form [type="submit"]').click());
  assert.equal(saved.input.expectedRevision, latest.revision);
  await page.locator(`#claim-replaces-${proposalId}`).selectOption(originalId);
  const confirmed = await uiWrite(page, 'POST', `/api/personal-claims/${proposalId}/confirm`, () => proposal.getByRole('button', { name: 'Bekræft oplysning', exact: true }).click());
  assert.deepEqual(confirmed.input, { expectedRevision: saved.body.claim.revision, supersedesId: originalId, supersedesRevision: original.revision });
  await proposal.getByText('Bekræftet af dig', { exact: true }).waitFor({ state: 'visible' });
  const changed = await fixtureRead(page, '/api/personal-claims');
  assert.equal(changed.claims.find(item => item.id === originalId).status, 'superseded');
  assert.equal(changed.claims.find(item => item.id === proposalId).status, 'confirmed');
  await navigate(page, 'knowledge');
  await page.locator('#knowledge-query').fill(correctedValue); await page.locator('#knowledge-search-form button').click();
  const result = page.locator('.knowledge-result').filter({ hasText: correctedValue }).first();
  await result.getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('source'), `claim:${proposalId}`);
  await page.goBack();
  // Historical exact sources remain addressable without treating them as active
  // facts or opening every archived record in the account.
  // Exercise a genuinely copied source URL, including document reload and the
  // authenticated initial-source coordinator, not only a tab state change.
  await page.goto(`${origin}/?view=knowledge&source=${encodeURIComponent(`claim:${originalId}`)}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-claim-id="${originalId}"].source-target`).waitFor({ state: 'visible' });
  assert.match(await page.locator(`[data-claim-id="${originalId}"]`).innerText(), /Erstattet — kun historik/);
  await page.goBack();
}

async function verifyOrganizerDraft(page, label) {
  await navigate(page, 'notes');
  await page.locator('#collection-type').selectOption('notes');
  await page.locator('#collection-title').fill(`Syntetisk kladdeliste ${label}`);
  const created = await uiWrite(page, 'POST', '/api/organizer', () => page.locator('#collection-form [type="submit"]').click(), [201]);
  const collectionId = created.body.collection.id, collection = page.locator(`[data-collection-id="${collectionId}"]`);
  await collection.waitFor({ state: 'visible' });
  const add = collection.locator('[data-organizer-role="add"]'); await add.locator('[name="text"]').fill(`Syntetisk notepunkt ${label}`);
  const added = await uiWrite(page, 'POST', `/api/organizer/${collectionId}/items`, () => add.locator('[type="submit"]').click(), [201]);
  const itemId = added.body.item.id, item = page.locator(`[data-organizer-item-id="${collectionId}:${itemId}"]`);
  await openDetails(item.locator('details.collection-edit'));
  const editor = item.locator('[data-organizer-role="item-editor"]'), notes = editor.locator('[name="notes"]');
  const draft = `Ugemt note med præcis kilde ${label}`; await notes.fill(draft);
  await notes.evaluate(input => { input.focus(); input.setSelectionRange(2, 9); window.syntheticOrganizerNotes = input; });
  const neighbour = await page.request.post(`${origin}/api/organizer/${collectionId}/items`, {
    headers: { Authorization: `Bearer ${token}` }, data: { text: `Syntetisk importeret nabo ${label}` },
  }); assert.equal(neighbour.status(), 201);
  await page.evaluate(() => refreshOrganizer());
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticOrganizerNotes,
    selection: [window.syntheticOrganizerNotes.selectionStart, window.syntheticOrganizerNotes.selectionEnd] })), { same: true, selection: [2, 9] });
  await navigate(page, 'home'); await navigate(page, 'notes'); assert.equal(await notes.inputValue(), draft);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#plan-notes').waitFor({ state: 'visible' });
  await item.waitFor({ state: 'visible' }); assert.equal(await notes.inputValue(), draft);
  assert.equal(await item.locator('details.collection-edit').evaluate(element => element.open), true);
  const concurrent = await page.request.patch(`${origin}/api/organizer/${collectionId}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { updatedAt: added.body.item.updatedAt, notes: `Syntetisk samtidighed ${label}` },
  }); assert.equal(concurrent.status(), 200); const current = (await concurrent.json()).item;
  await page.evaluate(() => refreshOrganizer());
  assert.match(await item.innerText(), /Ændret et andet sted/); assert.equal(await notes.inputValue(), draft);
  assert.equal(await editor.locator('[type="submit"]').isDisabled(), true);
  page.once('dialog', dialog => dialog.accept());
  await item.getByRole('button', { name: 'Hent nyeste punkt og kassér kladde', exact: true }).click();
  await page.waitForFunction(({ id, text }) => document.querySelector(`[data-organizer-item-id="${id}"] [name="notes"]`)?.value === text,
    { id: `${collectionId}:${itemId}`, text: current.notes });
  await notes.fill(`Gennemgået note ${label}`);
  const saved = await uiWrite(page, 'PATCH', `/api/organizer/${collectionId}/items/${itemId}`, () => editor.locator('[type="submit"]').click());
  assert.equal(saved.input.updatedAt, current.updatedAt); assert.equal(saved.body.item.notes, `Gennemgået note ${label}`);
}

async function verifySettingsDraft(page, label) {
  await navigate(page, 'automations');
  await page.evaluate(() => refreshSettings());
  const before = await fixtureRead(page, '/api/settings'), draft = before.maxRunsPerDay === 20 ? 21 : 20;
  await page.locator('#max-runs').fill(String(draft)); await page.locator('#max-runs').focus();
  await page.evaluate(() => refreshSettings());
  assert.equal(await page.locator('#max-runs').inputValue(), String(draft));
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'max-runs');
  await navigate(page, 'home'); await navigate(page, 'automations');
  assert.equal(await page.locator('#max-runs').inputValue(), String(draft));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#tab-settings').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#max-runs').inputValue(), String(draft));
  const changed = structuredClone(before); changed.maxRunsPerDay = draft + 1;
  changed.basis.maxRunsPerDay.digest = `synthetic-conflicting-basis-${label}`;
  const routePattern = `${origin}/api/settings`;
  const handler = route => route.request().method() === 'GET'
    ? route.fulfill({ json: changed }) : route.continue();
  await page.route(routePattern, handler); await page.evaluate(() => refreshSettings());
  assert.equal(await page.locator('#max-runs').inputValue(), String(draft));
  assert.match(await page.locator('#settings-draft-status').innerText(), /Ændret et andet sted/);
  assert.equal(await page.locator('#settings-submit').isDisabled(), true);
  await page.unroute(routePattern, handler);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#settings-reload').click();
  await page.waitForFunction(value => document.getElementById('max-runs').value === String(value), before.maxRunsPerDay);
  const after = await fixtureRead(page, '/api/settings');
  for (const key of ['maxRunsPerDay', 'remindersEnabled', 'discordAlertsEnabled', 'pushConfigured']) assert.equal(after[key], before[key]);
  assert.equal(await page.locator('#push-user').inputValue(), ''); assert.equal(await page.locator('#push-token').inputValue(), '');
}

async function refreshNotes(page) {
  await page.evaluate(async () => {
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:memories-changed', { detail: { waitUntil: promise => pending.push(promise) } }));
    await Promise.all(pending);
  });
}

async function verifyNoteDraft(page, label) {
  await navigate(page, 'memory');
  const unsent = await page.locator('#memory-workbench-text').inputValue();
  await page.locator('#memory-editor-mode').selectOption('note');
  await page.locator('#memory-workbench-text').fill(`Syntetisk gemt note ${label}`);
  const created = await uiWrite(page, 'POST', '/api/memories', () => page.locator('#memory-workbench-form [type="submit"]').click(), [201]);
  await page.locator('#memory-workbench-text').fill(unsent);
  const id = created.body.memory.id, card = page.locator(`[data-memory-id="${id}"]`);
  await openDetails(card.locator('details.memory-v49-editor'));
  const editor = card.locator('form'), input = editor.locator('textarea'), draft = `Ugemt rettelse af noten ${label}`;
  await input.fill(draft); await input.evaluate(field => { field.focus(); field.setSelectionRange(2, 8); window.syntheticNoteInput = field; });
  await refreshNotes(page);
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticNoteInput,
    selection: [window.syntheticNoteInput.selectionStart, window.syntheticNoteInput.selectionEnd] })), { same: true, selection: [2, 8] });
  await navigate(page, 'home'); await navigate(page, 'memory'); assert.equal(await input.inputValue(), draft);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#settings-profile').waitFor({ state: 'visible' });
  await refreshNotes(page); assert.equal(await input.inputValue(), draft); assert.equal(await page.locator('#memory-workbench-text').inputValue(), unsent);
  assert.equal(await card.locator('details.memory-v49-editor').evaluate(element => element.open), true);
  const concurrent = await page.request.put(`${origin}/api/memories/${id}`, { headers: { Authorization: `Bearer ${token}` },
    data: { expectedRevision: created.body.memory.revision, text: `Syntetisk samtidig note ${label}` } });
  assert.equal(concurrent.status(), 200); const current = (await concurrent.json()).memory;
  await refreshNotes(page); assert.equal(await input.inputValue(), draft); assert.match(await card.innerText(), /Ændret et andet sted/);
  assert.equal(await editor.locator('[type="submit"]').isDisabled(), true);
  page.once('dialog', dialog => dialog.accept()); await card.getByRole('button', { name: 'Hent nyeste note og kassér kladde', exact: true }).click();
  await page.waitForFunction(({ id, text }) => document.querySelector(`[data-memory-id="${id}"] textarea`)?.value === text,
    { id, text: current.text });
  await input.fill(`Gennemgået syntetisk note ${label}`);
  const saved = await uiWrite(page, 'PUT', `/api/memories/${id}`, () => editor.locator('[type="submit"]').click());
  assert.equal(saved.input.expectedRevision, current.revision);
  await page.goto(`${origin}/?view=knowledge&source=${encodeURIComponent(`memory:${id}`)}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-memory-id="${id}"].source-target`).waitFor({ state: 'visible' });
  await page.goBack(); assert.equal(await page.locator('#memory-workbench-text').inputValue(), unsent);
  const historyReads = [], historyPath = `/api/memories/${id}/history`;
  const trackHistory = request => { if (new URL(request.url()).pathname === historyPath) historyReads.push(request.method()); };
  page.on('request', trackHistory);
  try {
    const details = card.locator('.memory-v49-history'); await openDetails(details);
    const laterDraft = `Ugemt rettelse mens historik læses ${label}`;
    await input.fill(laterDraft); await input.focus();
    await refreshNotes(page); assert.deepEqual(historyReads, [], `${label}: opening history and polling must not automatically fetch prior facts`);
    const reading = page.waitForResponse(response => new URL(response.url()).pathname === historyPath);
    await details.getByRole('button', { name: 'Hent tidligere revisioner', exact: true }).click();
    const historyResponse = await reading; assert.equal(historyResponse.status(), 200);
    const history = await historyResponse.json(); assert.equal(history.historyCount, 2);
    assert.deepEqual(history.history.map(item => item.revision), [1, 2]);
    await details.locator('[data-memory-revision="1"]').waitFor({ state: 'visible' });
    assert.match(await details.innerText(), new RegExp(`Syntetisk gemt note ${label}`));
    assert.match(await details.innerText(), /ikke i søgning eller modelkontekst/);
    assert.equal(await input.inputValue(), laterDraft);
    await input.evaluate(field => { field.focus(); field.setSelectionRange(2, 8); window.syntheticHistoryNoteInput = field; });
    await refreshNotes(page);
    assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticHistoryNoteInput,
      selection: [window.syntheticHistoryNoteInput.selectionStart, window.syntheticHistoryNoteInput.selectionEnd] })),
    { same: true, selection: [2, 8] }, `${label}: loading historical facts never replaces the current correction draft`);
    assert.deepEqual(historyReads, ['GET']);
    assert.equal(await page.evaluate(() => (sessionStorage.getItem('jarvis:v5:memory-note-edits') || '').includes('revisionHistory')), false);
    await card.getByRole('button', { name: 'Fortryd rettelse', exact: true }).click();
    const archived = await uiWrite(page, 'POST', `/api/memories/${id}/archive`,
      () => card.getByRole('button', { name: 'Arkivér fra aktiv hukommelse', exact: true }).click());
    assert.equal(archived.input.expectedRevision, saved.body.memory.revision); assert.equal(archived.body.memory.historyCount, 3);
    assert.equal((await fixtureRead(page, '/api/memories')).memories.some(item => item.id === id), false);
    await page.goto(`${origin}/?view=knowledge&source=${encodeURIComponent(`memory:${id}`)}`, { waitUntil: 'domcontentloaded' });
    await page.locator(`[data-memory-id="${id}"].source-target`).waitFor({ state: 'visible' });
    assert.match(await card.innerText(), /Arkiveret · kun læsning · bruges ikke/);
    assert.equal(await card.locator('.memory-v49-editor').isVisible(), false);
    assert.equal(await card.getByRole('button', { name: 'Arkivér fra aktiv hukommelse', exact: true }).isVisible(), false);
    assert.deepEqual(historyReads, ['GET'], `${label}: an archived deep link is read-only and does not load revision contents implicitly`);
    await openDetails(details);
    const archivedReading = page.waitForResponse(response => new URL(response.url()).pathname === historyPath);
    await details.getByRole('button', { name: 'Hent tidligere revisioner', exact: true }).click();
    const archiveResponse = await archivedReading; assert.equal(archiveResponse.status(), 200);
    assert.equal((await archiveResponse.json()).archived, true);
    await details.locator('[data-memory-revision="3"]').waitFor({ state: 'visible' });
    await card.screenshot({ path: join(screenshotDir, `${label}-note-history.png`), animations: 'disabled' });
    await page.goBack(); assert.equal(await page.locator('#memory-workbench-text').inputValue(), unsent);
    await page.locator('#memory-show-archived').check(); await refreshNotes(page);
    assert.equal((await fixtureRead(page, '/api/memories?includeArchived=yes')).memories.find(item => item.id === id).active, false);
    assert.match(await card.innerText(), /Arkiveret · kun læsning/);
    await page.locator('#memory-show-archived').uncheck(); await refreshNotes(page);
    assert.deepEqual(historyReads, ['GET', 'GET']);
  } finally { page.off('request', trackHistory); }
  await page.locator('#memory-editor-mode').selectOption('claim');
}

async function openMealDay(plan, date) {
  await openDetails(plan.locator(`[data-meal-date="${date}"]`).locator('..'));
}

async function verifyMealLeftovers(page, label, householdDay, recipeId, recipeDraft) {
  const start = new Date(`${householdDay}T12:00:00Z`); start.setUTCDate(start.getUTCDate() + 2);
  const startDate = start.toISOString().slice(0, 10), inventoryBefore = await fixtureRead(page, '/api/meals/inventory');
  const calendarReads = [];
  const trackCalendar = request => { if (/^\/api\/google\/calendar\/(?:events|upcoming)$/.test(new URL(request.url()).pathname)) calendarReads.push(request.method()); };
  page.on('request', trackCalendar);
  try {
    // The preceding household flow explicitly discarded its stale day draft.
    // The separate, incomplete recipe draft remains untouched; plans consume
    // the saved reviewed recipe revision, never these unsaved editor fields.
    await page.locator('#meal-start').fill(startDate); await page.locator('#meal-days').selectOption('3');
    await page.locator('#meal-use-calendar').uncheck();
    // Create a real historical choice through the same form before testing
    // switching between two plans with a locally edited day.
    await uiWrite(page, 'POST', '/api/meals/plans',
      () => page.locator('#meal-plan-form button[type="submit"]').click(), [201]);
    const created = await uiWrite(page, 'POST', '/api/meals/plans',
      () => page.locator('#meal-plan-form button[type="submit"]').click(), [201]);
    assert.equal(created.input.useCalendar, false); assert.equal(created.body.plan.days, 3);
    const id = created.body.plan.id, plan = page.locator(`[data-record-key="plan:${id}"]`);
    await plan.waitFor({ state: 'visible' });
    const [fromDate, toDate, unaffectedDate] = created.body.plan.dishes.map(dish => dish.date);
    assert.ok(created.body.plan.dishes.every(dish => dish.servings === 3.25 && !dish.skip && !dish.locked));
    assert.equal(await page.locator('.meal-plan-card:visible').count(), 1, `${label}: exactly one meal plan is shown`);
    assert.equal(await plan.locator('.meal-day-disclosure[open]').count(), 0, `${label}: week starts as a compact overview`);
    assert.equal(await plan.locator('.meal-day-disclosure > summary:visible').count(), 3);
    await plan.screenshot({ path: join(screenshotDir, `${label}-compact-meal-plan.png`), animations: 'disabled' });
    await openMealDay(plan, fromDate);
    await plan.locator(`[data-meal-date="${fromDate}"]`).getByLabel('Ret', { exact: true }).selectOption(recipeId);
    const previousPlan = await page.locator('#meal-plan-choice option').evaluateAll((options, selected) => options.find(option => option.value !== selected)?.value, id);
    assert.ok(previousPlan, `${label}: fixture retains a historical plan in the selector`);
    await page.locator('#meal-plan-choice').selectOption(previousPlan);
    await page.locator(`[data-record-key="plan:${previousPlan}"]`).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.meal-plan-card:visible').count(), 1);
    await page.locator('#meal-plan-choice').selectOption(id);
    await plan.waitFor({ state: 'visible' });
    assert.equal(await plan.locator(`[data-meal-date="${fromDate}"]`).getByLabel('Ret', { exact: true }).inputValue(), recipeId,
      `${label}: changing selected plan preserves the unsaved meal choice`);
    const selected = await uiWrite(page, 'PUT', `/api/meals/plans/${id}`,
      () => plan.getByRole('button', { name: 'Gem ændringer i madplanen', exact: true }).click());
    assert.equal(selected.input.expectedRevision, created.body.plan.revision);
    const sourceBefore = selected.body.plan.dishes.find(dish => dish.date === fromDate);
    assert.equal(sourceBefore.recipeId, recipeId); assert.equal(sourceBefore.ingredients.find(item => item.name === 'ris').quantity, 325);
    const leftovers = plan.locator('.meal-leftovers-editor'); await openDetails(leftovers);
    await leftovers.getByRole('button', { name: 'Tilføj planlagte rester', exact: true }).click();
    const row = leftovers.locator('.meal-leftovers-row'), minutes = row.locator('[data-leftover-field="minutes"]');
    assert.equal(await minutes.inputValue(), '', `${label}: leftover preparation time is never invented`);
    assert.equal(await row.locator('[data-leftover-field="servings"]').inputValue(), '3.25');
    await minutes.focus(); await minutes.evaluate(input => { window.syntheticLeftoverMinutes = input; });
    await page.evaluate(() => refreshMeals());
    assert.equal(await page.evaluate(() => document.activeElement === window.syntheticLeftoverMinutes && window.syntheticLeftoverMinutes.isConnected), true);
    assert.equal(await minutes.inputValue(), '');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#tab-meals').waitFor({ state: 'visible' });
    await page.evaluate(() => refreshMeals());
    assert.equal(await minutes.inputValue(), '', `${label}: an incomplete leftover estimate survives reload without becoming zero`);
    assert.equal(Number(await plan.getAttribute('data-revision')), selected.body.plan.revision);
    assert.equal(await page.locator(`[data-record-key="recipe:${recipeId}"]`).getByLabel('Titel', { exact: true }).inputValue(), recipeDraft);
    const concurrent = await page.request.put(`${origin}/api/meals/plans/${id}`, { headers: { Authorization: `Bearer ${token}` },
      data: { expectedRevision: selected.body.plan.revision,
        dishes: selected.body.plan.dishes.map(dish => ({ date: dish.date, ...(dish.date === unaffectedDate ? { locked: true } : {}) })) } });
    assert.equal(concurrent.status(), 200); const current = (await concurrent.json()).plan;
    await page.evaluate(() => refreshMeals()); assert.match(await plan.locator('[data-edit-status]').innerText(), /ændret et andet sted/);
    await minutes.fill('12');
    const rejected = await uiWrite(page, 'POST', `/api/meals/plans/${id}/leftovers`,
      () => leftovers.getByRole('button', { name: 'Gem planlagte rester', exact: true }).click(), [400, 409]);
    assert.equal(rejected.input.expectedRevision, selected.body.plan.revision); assert.match(rejected.body.error, /revision|ændret/i);
    assert.equal(await minutes.inputValue(), '12');
    assert.equal((await fixtureRead(page, '/api/meals')).plans.find(item => item.id === id).plannedLeftovers?.length || 0, 0);
    await plan.getByRole('button', { name: 'Genindlæs / kassér lokale rettelser', exact: true }).click();
    await page.waitForFunction(({ id, revision }) => document.querySelector(`[data-record-key="plan:${id}"]`)?.dataset.revision === String(revision),
      { id, revision: current.revision });
    await openDetails(leftovers); await leftovers.getByRole('button', { name: 'Tilføj planlagte rester', exact: true }).click();
    await minutes.fill('12');
    const saved = await uiWrite(page, 'POST', `/api/meals/plans/${id}/leftovers`,
      () => leftovers.getByRole('button', { name: 'Gem planlagte rester', exact: true }).click());
    assert.deepEqual(saved.input, { expectedRevision: current.revision, links: [{ fromDate, toDate, servings: 3.25, minutes: 12 }] });
    const source = saved.body.plan.dishes.find(dish => dish.date === fromDate), target = saved.body.plan.dishes.find(dish => dish.date === toDate);
    assert.equal(source.plannedCookServings, 6.5); assert.equal(source.ingredients.find(item => item.name === 'ris').quantity, 650);
    assert.equal(target.leftoverFromDate, fromDate); assert.deepEqual(target.ingredients, []);
    assert.equal(saved.body.plan.dishes.find(dish => dish.date === unaffectedDate).locked, true);
    await openMealDay(plan, toDate);
    const targetCard = plan.locator(`[data-meal-date="${toDate}"]`);
    assert.match(await targetCard.innerText(), /Planlagte rester fra/);
    assert.deepEqual(await targetCard.locator('input,select,textarea').evaluateAll(fields => fields.filter(field => !field.disabled).map(field => field.type)), ['checkbox']);
    assert.match(await plan.locator('.meal-price-summary').innerText(), /Samlet pris: ukendt/);
    assert.doesNotMatch(await plan.locator('.meal-price-summary').innerText(), /inden for budget|Samlet pris: 0/);
    await targetCard.getByRole('link', { name: `Åbn den præcise tilberedningsdag ${fromDate}`, exact: true }).click();
    await plan.locator(`[data-meal-date="${fromDate}"].source-target`).waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('source'), `meal-plan:${id}:${fromDate}`);
    await page.goBack();
    await plan.screenshot({ path: join(screenshotDir, `${label}-planned-leftovers.png`), animations: 'disabled' });
    await leftovers.getByRole('button', { name: 'Fjern fordeling', exact: true }).click();
    assert.equal((await fixtureRead(page, '/api/meals')).plans.find(item => item.id === id).plannedLeftovers.length, 1,
      `${label}: removing a local row cannot itself mutate a saved plan`);
    const removed = await uiWrite(page, 'POST', `/api/meals/plans/${id}/leftovers`,
      () => leftovers.getByRole('button', { name: 'Gem planlagte rester', exact: true }).click());
    assert.deepEqual(removed.input, { expectedRevision: saved.body.plan.revision, links: [] });
    assert.deepEqual(removed.body.plan.dishes, current.dishes, `${label}: unlink restores original meal choices and preserves the unrelated manual lock`);
    await verifyShoppingChoices(page, label, removed.body.plan);
    assert.deepEqual(await fixtureRead(page, '/api/meals/inventory'), inventoryBefore, `${label}: planned leftovers do not record consumption, purchase, delivery or new inventory`);
    assert.deepEqual(calendarReads, [], `${label}: useCalendar:false must cause zero upstream calendar-read requests`);
  } finally { page.off('request', trackCalendar); }
}

async function verifySharedShoppingEntry(page, label, expected) {
  const writes = [];
  const track = request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname }); };
  page.on('request', track);
  try {
    await navigate(page, 'notes');
    const link = page.locator(`#meal-shopping-links [data-meal-plan-id="${expected.id}"]`);
    await link.waitFor({ state: 'visible' }); assert.equal(await link.count(), 1);
    await link.click();
    const original = page.locator(`[data-record-key="plan:${expected.id}"].source-target`);
    await original.waitFor({ state: 'visible' });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('view'), 'plan'); assert.equal(url.searchParams.get('section'), 'meals');
    assert.equal(url.searchParams.get('source'), `meal-plan:${expected.id}`);
    assert.equal(Number(await original.getAttribute('data-revision')), expected.revision);
    const saved = (await fixtureRead(page, '/api/meals')).plans.filter(plan => plan.id === expected.id);
    assert.equal(saved.length, 1, `${label}: the second entry cannot create a copied shopping list`);
    assert.equal(saved[0].revision, expected.revision);
    assert.deepEqual(saved[0].shoppingList, expected.shoppingList);
    assert.deepEqual(writes, [], `${label}: opening the shared original shopping list is read-only`);
  } finally { page.off('request', track); }
}

async function verifyShoppingChoices(page, label, previous) {
  const id = previous.id, sourceDate = previous.dishes[0].date;
  const plan = page.locator(`[data-record-key="plan:${id}"]`);
  const source = plan.locator(`[data-meal-date="${sourceDate}"]`);
  const prohibitedReadsOrWrites = [];
  const trackRetailer = request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/nemlig/') && !isLocalNemligStatusRead(request) || path.endsWith('/nemlig-draft') ||
        request.method() !== 'GET' && path.startsWith('/api/shopping-drafts')) prohibitedReadsOrWrites.push(path);
  };
  page.on('request', trackRetailer);
  try {
    // The preceding E1 check already proved the unchanged three-day plan and
    // unrelated lock. Explicitly skip its other two meals now, so this separate
    // G1 case has exactly the selected recipe's known 200 g / two portions.
    // This avoids assuming the other generated recipes contain no rice.
    for (const dish of previous.dishes.slice(1)) {
      await openMealDay(plan, dish.date);
      await plan.locator(`[data-meal-date="${dish.date}"]`).getByLabel('Spring denne dag over', { exact: true }).check();
    }
    const isolated = await uiWrite(page, 'PUT', `/api/meals/plans/${id}`,
      () => plan.getByRole('button', { name: 'Gem ændringer i madplanen', exact: true }).click());
    assert.equal(isolated.input.expectedRevision, previous.revision);
    assert.ok(isolated.body.plan.dishes.slice(1).every(dish => dish.skip && dish.ingredients.length === 0));
    assert.equal(isolated.body.plan.dishes[2].locked, true, `${label}: the separate shopping case still preserves the unrelated lock`);
    assert.equal(isolated.body.plan.dishes[0].servings, 3.25);
    assert.deepEqual(isolated.body.plan.dishes[0].ingredients, [{ name: 'ris', quantity: 325, unit: 'g' }]);
    const build = () => uiWrite(page, 'POST', `/api/meals/plans/${id}/shopping-list`,
      () => plan.getByRole('button', { name: /^(Opret|Genberegn) indkøbsliste$/ }).click());
    const initial = await build();
    assert.equal(initial.input.expectedRevision, isolated.body.plan.revision);
    assert.equal(initial.body.plan.shoppingList.length, 1);
    assert.equal(initial.body.plan.shoppingList[0].quantity, 325);
    const quantity = plan.locator('.meal-list-editor').getByLabel('Mængde', { exact: true });
    const openList = () => openDetails(plan.locator('.meal-list-editor').locator('..'));
    await openList(); await quantity.fill('1000');
    const chosen = await uiWrite(page, 'PUT', `/api/meals/plans/${id}/shopping-list`,
      () => plan.getByRole('button', { name: 'Gem rettelser til listen', exact: true }).click());
    assert.deepEqual(chosen.input, { expectedRevision: initial.body.plan.revision, items: [{ name: 'ris', quantity: 1000, unit: 'g' }] });
    assert.equal(chosen.body.plan.shoppingList[0].quantity, 1000);
    assert.equal(chosen.body.plan.shoppingNeedsReview, false);
    assert.equal(chosen.body.plan.status, 'shopping_ready');
    await verifySharedShoppingEntry(page, label, chosen.body.plan);

    await openMealDay(plan, sourceDate);
    await source.getByLabel('Lås denne ret ved nye forslag', { exact: true }).check();
    const locked = await uiWrite(page, 'PUT', `/api/meals/plans/${id}`,
      () => plan.getByRole('button', { name: 'Gem ændringer i madplanen', exact: true }).click());
    assert.equal(locked.input.expectedRevision, chosen.body.plan.revision);
    const sameBasis = await build();
    assert.equal(sameBasis.input.expectedRevision, locked.body.plan.revision);
    assert.equal(sameBasis.body.plan.shoppingList[0].quantity, 1000);
    assert.equal(sameBasis.body.plan.shoppingNeedsReview, false, `${label}: a pure lock change must not invalidate the ingredient basis`);

    await openMealDay(plan, sourceDate);
    await source.getByLabel('Portioner', { exact: true }).fill('4');
    const increased = await uiWrite(page, 'PUT', `/api/meals/plans/${id}`,
      () => plan.getByRole('button', { name: 'Gem ændringer i madplanen', exact: true }).click());
    assert.equal(increased.input.expectedRevision, sameBasis.body.plan.revision);
    assert.equal(increased.body.plan.dishes[0].ingredients[0].quantity, 400);
    assert.equal(increased.body.plan.dishes[0].locked, true);
    const changed = await build();
    assert.equal(changed.input.expectedRevision, increased.body.plan.revision);
    assert.equal(changed.body.plan.shoppingList[0].quantity, 1000);
    assert.equal(changed.body.plan.shoppingNeedsReview, true);
    const choice = changed.body.plan.shoppingReview.rows.find(item => item.name === 'ris' && item.unit === 'g');
    assert.equal(choice.previousBasis.quantity, 325); assert.equal(choice.computedQuantity, 400); assert.equal(choice.selectedQuantity, 1000);
    const review = plan.locator('[data-shopping-choice="ris|g"]');
    assert.match(await review.innerText(), /dit valg: 1000 g.*beregnet at tilføje: 400 g/s);
    assert.match(await review.innerText(), /Oprindeligt beregnet behov: 325 g/);
    assert.equal(await plan.getByRole('button', { name: 'Find varer på Nemlig', exact: true }).isDisabled(), true);
    await plan.screenshot({ path: join(screenshotDir, `${label}-shopping-choice-review.png`), animations: 'disabled' });

    await openList(); await quantity.fill('');
    await quantity.evaluate(input => { input.focus(); window.syntheticShoppingQuantity = input; });
    const reset = plan.locator('[data-shopping-reset="ris|g"]');
    assert.equal(await reset.isDisabled(), true, `${label}: switching to the calculated quantity must not discard incomplete manual fields`);
    await page.evaluate(() => refreshMeals());
    assert.equal(await page.evaluate(() => document.activeElement === window.syntheticShoppingQuantity && window.syntheticShoppingQuantity.isConnected), true);
    assert.equal(await quantity.inputValue(), '');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#tab-meals').waitFor({ state: 'visible' });
    await page.evaluate(() => refreshMeals());
    assert.equal(await quantity.inputValue(), ''); assert.equal(await reset.isDisabled(), true);
    assert.equal(Number(await plan.getAttribute('data-revision')), changed.body.plan.revision);
    const stillSaved = (await fixtureRead(page, '/api/meals')).plans.find(item => item.id === id);
    assert.equal(stillSaved.revision, changed.body.plan.revision); assert.equal(stillSaved.shoppingList[0].quantity, 1000);
    await plan.getByRole('button', { name: 'Genindlæs / kassér lokale rettelser', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`[data-record-key="plan:${id}"] [data-shopping-reset="ris|g"]`)?.disabled === false, id);
    assert.equal(await quantity.inputValue(), '1000');
    const restored = await uiWrite(page, 'PUT', `/api/meals/plans/${id}/shopping-list`, () => reset.click());
    assert.deepEqual(restored.input, { expectedRevision: changed.body.plan.revision, items: changed.body.plan.shoppingList,
      useComputed: [{ name: 'ris', unit: 'g' }] });
    assert.equal(restored.body.plan.shoppingList[0].quantity, 400);
    assert.deepEqual(restored.body.plan.manualShoppingOverrides, []); assert.equal(restored.body.plan.shoppingNeedsReview, false);
    assert.equal(await plan.getByRole('button', { name: 'Find varer på Nemlig', exact: true }).isDisabled(), false);

    // An explicit zero is a durable omission, not consumption or inventory.
    await openList(); await quantity.fill('0');
    const omitted = await uiWrite(page, 'PUT', `/api/meals/plans/${id}/shopping-list`,
      () => plan.getByRole('button', { name: 'Gem rettelser til listen', exact: true }).click());
    assert.equal(omitted.input.expectedRevision, restored.body.plan.revision);
    assert.deepEqual(omitted.input.items, [{ name: 'ris', quantity: 0, unit: 'g' }]);
    assert.deepEqual(omitted.body.plan.shoppingList, []);
    const recomputed = await build();
    assert.equal(recomputed.input.expectedRevision, omitted.body.plan.revision);
    assert.deepEqual(recomputed.body.plan.shoppingList, []);
    assert.equal(recomputed.body.plan.shoppingReview.rows[0].excluded, true);
    assert.match(await plan.locator('.meal-shopping-review').innerText(), /eksplicit udeladt/);
    assert.match(await plan.innerText(), /ikke dokumentation for, at ingredienserne er på lager/);
    assert.deepEqual(prohibitedReadsOrWrites, [], `${label}: manual shopping review, polling and reload never search products, create retailer drafts or write a basket`);
  } finally { page.off('request', trackRetailer); }
}

async function verifyHistory(page, label) {
  assert.equal(await page.locator('#messages .bubble').count(), 20, `${label}: bootstrap is bounded to the latest twenty messages`);
  assert.match(await page.locator('#history-count').innerText(), /20 af 65/);
  await page.locator('#history-older').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'chat-attach-context',
    `${label}: the explicit context control remains in the normal keyboard order before history and composer`);
  await page.keyboard.press('Tab');
  // Chromium makes a genuinely scrollable region keyboard-focusable; WebKit
  // may go directly to the composer. Both must retain the same logical order,
  // with no unrelated control or focus trap inserted between these regions.
  if (await page.evaluate(() => document.activeElement?.id) === 'messages') {
    assert.equal(await page.locator('#messages').evaluate(element => element.scrollHeight > element.clientHeight), true,
      `${label}: the intermediate keyboard stop is the real scrollable history`);
    await page.keyboard.press('Tab');
  }
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'message', `${label}: history and chat are connected by normal keyboard order`);
  const draft = `Ugemt besked under historiklæsning ${label}`;
  await page.locator('#message').fill(draft);
  await page.locator('#message').evaluate(input => { input.focus(); input.setSelectionRange(2, 8); window.syntheticHistoryInput = input; });
  for (const count of [40, 60, 65]) {
    const waiting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/history');
    // Programmatic click represents a background read while typing. Normal
    // keyboard access to the same button is checked separately below.
    await page.locator('#history-older').evaluate(button => button.click());
    const response = await waiting; assert.equal(response.status(), 200);
    assert.ok(new URL(response.url()).searchParams.get('cursor'), `${label}: history uses the server's opaque cursor`);
    await page.waitForFunction(expectedCount => document.querySelectorAll('#messages .bubble').length === expectedCount, count);
    assert.equal(await page.locator('#message').inputValue(), draft);
    assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticHistoryInput,
      selection: [window.syntheticHistoryInput.selectionStart, window.syntheticHistoryInput.selectionEnd] })),
    { same: true, selection: [2, 8] }, `${label}: older history never replaces or blurs the chat draft`);
  }
  assert.equal(await page.locator('#history-older').isVisible(), false);
  assert.equal(await page.locator('#messages .bubble').first().innerText().then(value => value.includes('historikbesked 01')), true);
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('#messages .bubble').count(), 65, `${label}: unchanged bootstrap polling keeps the expanded history`);
  await page.locator('#message').fill('');
}

async function verifyProjectDrafts(page, label) {
  await navigate(page, 'projects');
  await page.locator('#project-title').fill(`Syntetisk projekt ${label}`);
  await page.locator('#project-description').fill('Kun en tom lokal testmappe. Ingen model, pakkeinstallation eller genereret kode.');
  const created = await uiWrite(page, 'POST', '/api/projects', () => page.locator('#project-create').click(), [201]);
  const project = created.body.project;
  assert.equal(project.revision, 0); assert.equal(project.operation.status, 'completed');
  const card = page.locator(`[data-project-id="${project.id}"]`);
  await card.waitFor({ state: 'visible' });
  const request = card.locator('textarea'), draft = `Ugemt udviklingsønske ${label}`;
  await request.fill(draft); await request.evaluate(input => { input.focus(); input.setSelectionRange(2, 8); window.syntheticProjectInput = input; });
  await page.evaluate(() => refreshProjects());
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticProjectInput,
    connected: window.syntheticProjectInput.isConnected, selection: [window.syntheticProjectInput.selectionStart, window.syntheticProjectInput.selectionEnd] })),
  { same: true, connected: true, selection: [2, 8] }, `${label}: project polling preserves the focused input and selection`);
  await page.locator('#project-title').fill(`Næste usendte projekt ${label}`);
  await page.locator('#project-description').fill('Ufuldstændig formularkladde må ikke oprette et projekt.');
  await navigate(page, 'system');
  await page.locator('#code-file').selectOption('public/styles.css');
  await page.locator('#code-request').fill(`Usendt kodeanmodning ${label}`);
  await navigate(page, 'home'); await page.goBack();
  assert.equal(await request.inputValue(), draft); assert.equal(await page.locator('#code-request').inputValue(), `Usendt kodeanmodning ${label}`);
  await navigate(page, 'projects');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-projects').waitFor({ state: 'visible' }); await page.evaluate(() => refreshProjects());
  await openDetails(page.locator('#project-create-details'));
  assert.equal(await request.inputValue(), draft); assert.equal(await page.locator('#project-title').inputValue(), `Næste usendte projekt ${label}`);
  assert.equal(await page.locator('#code-file').inputValue(), 'public/styles.css');
  assert.equal(await page.locator('#code-request').inputValue(), `Usendt kodeanmodning ${label}`);
  // A synthetic changed read response exercises the actual rendered conflict
  // state without running a model or editing the real fixture's project files.
  const changedRead = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const data = await response.json();
    data.projects = data.projects.map(item => item.id === project.id ? { ...item, revision: 1, contentHash: 'synthetic-unreviewed-revision' } : item);
    await route.fulfill({ response, json: data });
  };
  await page.route('**/api/projects', changedRead);
  try {
    await page.evaluate(() => refreshProjects());
    assert.match(await card.locator('.project-draft-status').innerText(), /grundlag er ændret.*revision 0/);
    assert.equal(await request.inputValue(), draft);
    assert.equal(await card.getByRole('button', { name: 'Videreudvikl', exact: true }).isDisabled(), true);
    await card.screenshot({ path: join(screenshotDir, `${label}-project-draft.png`), animations: 'disabled' });
  } finally { await page.unroute('**/api/projects', changedRead); }
  await page.evaluate(() => refreshProjects());
  assert.equal(await request.inputValue(), draft);
  const actual = (await fixtureRead(page, `/api/projects/${project.id}`)).project;
  assert.equal(actual.revision, 0); assert.equal(actual.files.length, 0); assert.deepEqual(actual.pendingPackages, []);
  const packages = ['synthetic-package@1.0.0'];
  let syntheticProject = { ...actual, revision: 1, contentHash: 'e'.repeat(64), pendingPackages: packages };
  let dependencyReview = { status: 'dependency-review-required', directPackages: packages,
    reasons: [{ code: 'LOCK_REQUIRED', message: 'Syntetisk test: en komplet offentlig v3-låsefil mangler.' }] };
  const listed = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(), data = await response.json();
    data.projects = data.projects.map(item => item.id === project.id ? syntheticProject : item);
    return route.fulfill({ response, json: data });
  };
  const inspected = route => route.request().method() !== 'GET' ? route.continue() : route.fulfill({ json: {
    project: { ...syntheticProject, sourceContentHash: syntheticProject.contentHash, dependencyReview,
      files: [{ path: 'package.json', content: '{"private":true,"description":"Kun syntetisk læsefixture"}' }] },
  } });
  const inspectPath = `${origin}/api/projects/${project.id}`;
  async function readDependencyReview(text) {
    const waiting = page.waitForResponse(response => response.url() === inspectPath && response.request().method() === 'GET');
    await card.getByRole('button', { name: 'Se projektfiler', exact: true }).click();
    assert.equal((await waiting).status(), 200);
    await page.waitForFunction(({ id, text }) => document.querySelector(`[data-project-id="${id}"] .project-dependency-status`)?.textContent.includes(text),
      { id: project.id, text });
  }
  await page.route('**/api/projects', listed); await page.route(inspectPath, inspected);
  try {
    await page.evaluate(() => refreshProjects());
    const install = card.getByRole('button', { name: 'Godkend npm-installation', exact: true });
    assert.equal(await install.isDisabled(), true);
    await readDependencyReview('LOCK_REQUIRED'); assert.equal(await install.isDisabled(), true);
    assert.match(await card.locator('.project-dependency-status').innerText(), /Installation er blokeret/);
    dependencyReview = { status: 'ready', directPackages: packages, reasons: [], mode: 'reviewed-lockfile-ci',
      manifestHash: 'a'.repeat(64), lockHash: 'b'.repeat(64), dependencyCount: 2 };
    await readDependencyReview('Pakkegrundlaget er klar'); assert.equal(await install.isDisabled(), false);
    assert.match(await card.locator('.project-dependency-status').innerText(), /uden livscyklusscripts.*node_modules.*gendannelse/);
    assert.equal(await request.inputValue(), draft);
    syntheticProject = { ...syntheticProject, packageInstallAttempt: { id: 'synthetic-blocked', revision: 1, contentHash: syntheticProject.contentHash,
      packages, status: 'blocked', dependencyReview, note: 'Syntetisk downloadfejl før publicering; intet installeret.' } };
    await page.evaluate(() => refreshProjects());
    assert.equal(await install.isDisabled(), true, `${label}: a changed attempt invalidates the old dependency inspection`);
    assert.match(await card.locator('.project-operation-status').innerText(), /Blokeret – ingen projektpakker publiceret/);
    await readDependencyReview('Pakkegrundlaget er klar'); assert.equal(await install.isDisabled(), false);
    // No approval/installation click occurs. This test controls read responses
    // only and must leave the underlying empty project and package state intact.
    await card.screenshot({ path: join(screenshotDir, `${label}-project-dependency-review.png`), animations: 'disabled' });
    syntheticProject = { ...syntheticProject, packageInstallAttempt: { ...syntheticProject.packageInstallAttempt, status: 'unknown' } };
    await page.evaluate(() => refreshProjects());
    assert.equal(await install.isDisabled(), true); assert.match(await card.locator('.project-operation-status').innerText(), /Ukendt udfald/);
    assert.equal(await card.getByRole('button', { name: 'Arkivér projekt', exact: true }).isDisabled(), true);
  } finally { await page.unroute('**/api/projects', listed); await page.unroute(inspectPath, inspected); }
  await page.evaluate(() => refreshProjects()); assert.equal(await request.inputValue(), draft);
  const unchanged = (await fixtureRead(page, `/api/projects/${project.id}`)).project;
  assert.equal(unchanged.revision, 0); assert.deepEqual(unchanged.pendingPackages, []);
  assert.equal(unchanged.packageInstallAttempt, undefined);
}

async function verifyPausedJob(page, label) {
  await navigate(page, 'agent');
  await page.locator('#task-title').fill(`Syntetisk pauset job ${label}`);
  await page.locator('#task-prompt').fill('Læs kun den syntetiske testkilde. Denne test aktiverer aldrig jobbet.');
  await page.locator('#task-repeat').selectOption('60');
  await openDetails(page.locator('#task-policy-fields'));
  await page.locator('#task-budget-runs').fill('2');
  const created = await uiWrite(page, 'POST', '/api/tasks', () => page.locator('#task-submit').click(), [201]);
  assert.equal(created.input.activation, 'paused'); assert.equal(created.input.intervalMinutes, 60);
  assert.deepEqual(created.input.permissions, ['web.search']);
  assert.deepEqual(created.input.budget, { maxRunsPerDay: 2, maxOutputTokens: 3500 });
  assert.equal(created.body.task.status, 'paused');
  const task = created.body.task, card = page.locator(`[data-task-id="${task.id}"]`);
  await card.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#task-submit').disabled);
  await card.locator('[data-task-action="edit"]').click();
  const title = `Redigeret pauset job ${label}`;
  await page.locator('#task-title').fill(title); await page.locator('#task-retry-count').fill('0');
  await page.locator('#task-title').evaluate(input => { input.focus(); input.setSelectionRange(2, 8); window.syntheticJobInput = input; });
  await page.evaluate(() => refreshTasks());
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticJobInput,
    connected: window.syntheticJobInput.isConnected, selection: [window.syntheticJobInput.selectionStart, window.syntheticJobInput.selectionEnd] })),
  { same: true, connected: true, selection: [2, 8] }, `${label}: paused job policy edits retain focus through polling`);
  await navigate(page, 'home'); await page.goBack();
  assert.equal(await page.locator('#task-title').inputValue(), title); assert.equal(await page.locator('#task-retry-count').inputValue(), '0');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-plan').waitFor({ state: 'visible' }); await page.evaluate(() => refreshTasks());
  await openDetails(page.locator('#task-editor-shell'));
  assert.equal(await page.locator('#task-title').inputValue(), title);
  const edited = await uiWrite(page, 'PATCH', `/api/tasks/${task.id}`, () => page.locator('#task-submit').click());
  assert.equal(edited.input.expectedRevision, task.revision); assert.equal(edited.input.activation, 'paused');
  assert.equal(edited.body.task.status, 'paused'); assert.equal(edited.body.task.revision, task.revision + 1);
  assert.equal(edited.body.task.retryPolicy.maxRetries, 0);
  await page.waitForFunction(() => !document.querySelector('#task-submit').disabled);
  await card.locator('[data-task-action="edit"]').click(); await page.locator('#task-title').fill(`Ugemt jobkonflikt ${label}`);
  const changedRead = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const data = await response.json();
    data.tasks = data.tasks.map(item => item.id === task.id ? { ...item, revision: item.revision + 1 } : item);
    await route.fulfill({ response, json: data });
  };
  await page.route('**/api/tasks', changedRead);
  try {
    await page.evaluate(() => refreshTasks());
    assert.match(await page.locator('#task-draft-status').innerText(), /ændret et andet sted/);
    assert.equal(await page.locator('#task-title').inputValue(), `Ugemt jobkonflikt ${label}`);
    assert.equal(await page.locator('#task-submit').isDisabled(), true);
    await page.locator('#task-form').screenshot({ path: join(screenshotDir, `${label}-paused-job.png`), animations: 'disabled' });
  } finally { await page.unroute('**/api/tasks', changedRead); }
  await page.evaluate(() => refreshTasks());
  const actual = (await fixtureRead(page, '/api/tasks')).tasks.find(item => item.id === task.id);
  assert.equal(actual.status, 'paused'); assert.equal(actual.runs.length, 0);
  return task.id;
}

async function verifyFamilyCalendar(page, label, day, dateCard) {
  const before = (await fixtureRead(page, '/api/meals')).household;
  await openDetails(page.locator('#meal-family-calendar'));
  await page.evaluate(() => refreshHouseholdCalendar());
  const row = page.locator(`[data-calendar-household-date="${day}"]`);
  assert.equal(await row.locator('[data-calendar-state]').getAttribute('data-calendar-state'), 'unknown');
  assert.match(await row.innerText(), /2 voksne og 1 børn hjemme; 1 gæster/);
  assert.match(await row.innerText(), /ikke ledig tid/);
  assert.equal(await page.locator('#meal-family-calendar-load').isDisabled(), true,
    `${label}: unconfigured Google is not shown as a connected calendar`);
  const response = { calendarId: 'synthetic-read-only-calendar', scope: 'calendar.readonly', canEdit: false,
    connectionState: 'not_configured', cacheState: 'ready', ready: true, fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(), coverage: { start: `${day}T00:00:00Z`, end: `${day}T23:59:59Z`, complete: true },
    dinnerDays: [{ date: day, status: 'busy', reason: null, eventCount: 1, events: [{ id: 'synthetic-calendar-source',
      title: 'Kalendertekst siger børnene ikke er hjemme – må ikke ændre husstand', start: `${day}T17:00:00+01:00`, end: `${day}T18:00:00+01:00` }] }], events: [] };
  const readResponse = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  await page.route('**/api/google/calendar/cache?**', readResponse);
  try {
    await dateCard.getByLabel('Voksne hjemme', { exact: true }).focus();
    await page.evaluate(() => { window.syntheticCalendarFocus = document.activeElement; });
    await page.evaluate(() => refreshHouseholdCalendar());
    assert.equal(await row.locator('[data-calendar-state]').getAttribute('data-calendar-state'), 'busy');
    assert.match(await row.innerText(), /synthetic-calendar-source/);
    assert.match(await row.innerText(), /2 voksne og 1 børn hjemme; 1 gæster/);
    assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '3', `${label}: calendar context cannot overwrite an unsaved explicit attendance edit`);
    assert.equal(await page.evaluate(() => document.activeElement === window.syntheticCalendarFocus), true);
    assert.match(await page.locator('#meal-family-calendar-status').innerText(), /synthetic-read-only-calendar.*Kun læsning/);
    await page.locator('#meal-family-calendar').screenshot({ path: join(screenshotDir, `${label}-family-calendar.png`), animations: 'disabled' });
    response.ready = false; response.cacheState = 'unavailable'; response.lastReadError = 'Syntetisk kildefejl';
    await page.evaluate(() => refreshHouseholdCalendar());
    assert.equal(await row.locator('[data-calendar-state]').getAttribute('data-calendar-state'), 'unknown');
    assert.match(await row.innerText(), /læsning fejlede.*ikke ledig tid/);
    assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '3');
  } finally { await page.unroute('**/api/google/calendar/cache?**', readResponse); }
  await page.evaluate(() => refreshHouseholdCalendar());
  assert.deepEqual((await fixtureRead(page, '/api/meals')).household, before,
    `${label}: context reads and calendar text cannot mutate recorded household facts`);
}

async function refreshPlanning(page) {
  await page.evaluate(async () => {
    await refresh();
    const pending = [];
    document.dispatchEvent(new CustomEvent('jarvis:v5-sources-changed', {
      detail: { waitUntil: promise => pending.push(Promise.resolve(promise)) },
    }));
    await Promise.allSettled(pending);
  });
}

async function verifyPlanning(page, label, task, followUp) {
  const automatedBefore = (await fixtureRead(page, '/api/tasks')).tasks.map(item => item.id).sort();
  const taskCard = page.locator(`[data-personal-task-id="${task.id}"]`);
  await taskCard.getByRole('button', { name: 'Redigér opgave', exact: true }).click();
  const editedTitle = `Redigeret personlig opgave ${label}`;
  await page.locator('#personal-task-title').fill(editedTitle);
  await page.locator('#personal-task-title').evaluate(input => {
    input.focus(); input.setSelectionRange(2, 8); window.syntheticPlanFocus = input;
  });
  await refreshPlanning(page);
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticPlanFocus,
    connected: window.syntheticPlanFocus.isConnected, selection: [window.syntheticPlanFocus.selectionStart, window.syntheticPlanFocus.selectionEnd] })),
  { same: true, connected: true, selection: [2, 8] }, `${label}: planning refresh preserves the exact focused edit and caret`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-plan').waitFor({ state: 'visible' }); await refreshPlanning(page);
  await openDetails(page.locator('#personal-task-create'));
  assert.equal(await page.locator('#personal-task-title').inputValue(), editedTitle);
  assert.match(await page.locator('#personal-task-form').innerText(), new RegExp(`Redigerer revision ${task.revision}`),
    `${label}: recovered task edit stays bound to the original revision`);
  await page.locator('#personal-task-outcome').fill('Et gennemgået lokalt resultat uden ekstern kontakt');
  await page.getByRole('button', { name: 'Fjern deadline', exact: true }).click();
  assert.equal(await page.locator('#personal-task-deadline').inputValue(), '');
  assert.equal(await page.locator('#personal-task-deadline').evaluate(input => input.checkValidity()), true);
  await page.locator('#personal-task-uncertainty').fill('15');
  await page.locator('#personal-task-planned').fill('2030-11-06T09:30');
  await page.locator('#personal-task-locked').check();
  const edited = await uiWrite(page, 'PATCH', `/api/personal-tasks/${task.id}`,
    () => page.locator('#personal-task-form button[type="submit"]').click());
  assert.equal(edited.input.expectedRevision, task.revision);
  assert.equal(edited.body.task.title, editedTitle);
  assert.equal(edited.body.task.deadline, null, `${label}: the explicit edit removes the earlier synthetic Today deadline before future capacity planning`);
  assert.equal(edited.body.task.lockedStart, '2030-11-06T08:30:00.000Z', `${label}: local time uses Copenhagen, not the browser host timezone`);
  assert.equal(edited.body.task.plannedStart, edited.body.task.lockedStart);
  assert.match(await taskCard.innerText(), /Låst lokal placering/);

  await page.locator('#personal-task-title').fill(`Ny lokal placering ${label}`);
  await page.locator('#personal-task-purpose').fill('Kontrollér lokale placeringer uden Google-skrivning');
  const second = await uiWrite(page, 'POST', '/api/personal-tasks',
    () => page.locator('#personal-task-form button[type="submit"]').click(), [201]);
  const secondId = second.body.task.id;
  await navigate(page, 'calendar');
  await page.locator('#capacity-start').fill('2030-11-06T09:00');
  await page.locator('#capacity-end').fill('2030-11-06T12:00');
  await openDetails(page.locator('#capacity-form details').first());
  await page.locator('#capacity-reviewed').uncheck();
  await page.locator('#capacity-manual-review').uncheck();
  const unknown = await uiWrite(page, 'POST', '/api/planning/simulate',
    () => page.locator('#capacity-form button[type="submit"]').click());
  assert.equal(unknown.input.calendarCoverage.status, 'unknown');
  assert.equal(unknown.body.plan.feasible, false); assert.deepEqual(unknown.body.plan.proposals, []);
  assert.ok(unknown.body.plan.conflicts.some(conflict => conflict.code === 'calendar-unknown'));
  assert.equal(await page.locator('#capacity-results [data-proposed-task-id]').count(), 0,
    `${label}: missing calendar/manual coverage cannot become free time`);
  await page.locator('#capacity-manual-review').check();
  const ready = await uiWrite(page, 'POST', '/api/planning/simulate',
    () => page.locator('#capacity-form button[type="submit"]').click());
  assert.equal(ready.input.useCalendar, false); assert.equal(ready.input.calendarCoverage.status, 'ready');
  assert.equal(ready.input.calendarCoverage.source, 'explicit-owner-review');
  assert.equal(ready.body.plan.feasible, true, `${label}: explicit reviewed synthetic capacity must produce a feasible plan`);
  const locked = ready.body.plan.proposals.find(proposal => proposal.taskId === task.id);
  const movable = ready.body.plan.proposals.find(proposal => proposal.taskId === secondId);
  assert.equal(locked.start, edited.body.task.lockedStart); assert.equal(locked.placement, 'locked'); assert.ok(movable);
  const proposalCard = page.locator(`[data-proposed-task-id="${secondId}"]`);
  const placed = await uiWrite(page, 'PATCH', `/api/personal-tasks/${secondId}`,
    () => proposalCard.getByRole('button', { name: 'Gem placering lokalt', exact: true }).click());
  assert.equal(placed.input.expectedRevision, second.body.task.revision);
  assert.equal(placed.body.task.plannedStart, movable.start); assert.equal(placed.body.task.lockedStart, null);
  const repeated = await uiWrite(page, 'POST', '/api/planning/simulate',
    () => page.locator('#capacity-form button[type="submit"]').click());
  const preserved = repeated.body.plan.proposals.find(proposal => proposal.taskId === secondId);
  assert.equal(preserved.start, movable.start); assert.equal(preserved.placement, 'preserved');
  const nowLocked = await uiWrite(page, 'PATCH', `/api/personal-tasks/${secondId}`,
    () => proposalCard.getByRole('button', { name: 'Gem og lås placering', exact: true }).click());
  assert.equal(nowLocked.input.expectedRevision, placed.body.task.revision);
  assert.equal(nowLocked.body.task.lockedStart, movable.start);
  assert.match(await page.locator('#capacity-status').textContent(), /Ingen kalenderaftale/);
  await page.locator('#tab-plan').screenshot({ path: join(screenshotDir, `${label}-planning.png`), animations: 'disabled' });

  await navigate(page, 'plan');
  const followCard = page.locator(`[data-follow-up-id="${followUp.id}"]`);
  await followCard.getByRole('button', { name: 'Udskyd / registrér observation', exact: true }).click();
  assert.equal(await page.locator('#follow-up-awaiting').evaluate(element => element.readOnly), true);
  assert.equal(await page.locator('#follow-up-stop').evaluate(element => element.readOnly), true);
  await page.locator('#follow-up-check').fill('2030-11-07T12:00');
  const snoozed = await uiWrite(page, 'PATCH', `/api/follow-ups/${followUp.id}`,
    () => page.locator('#follow-up-form button[type="submit"]').click());
  assert.equal(snoozed.input.action, 'snooze'); assert.equal(snoozed.input.expectedRevision, followUp.revision);
  assert.equal(snoozed.body.case.nextCheckAt, '2030-11-07T11:00:00.000Z');
  await followCard.getByRole('button', { name: 'Udskyd / registrér observation', exact: true }).click();
  await page.locator('#follow-observation-status').selectOption('unknown');
  const unknownSource = `Syntetisk utilgængelig kilde ${label}`;
  await page.locator('#follow-observation-source').fill(unknownSource);
  await page.locator('#follow-observation-source').focus();
  await refreshPlanning(page);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'follow-observation-source');
  assert.equal(await page.locator('#follow-observation-source').inputValue(), unknownSource);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-plan').waitFor({ state: 'visible' }); await refreshPlanning(page);
  await openDetails(page.locator('#follow-up-create'));
  assert.equal(await page.locator('#follow-observation-status').inputValue(), 'unknown');
  assert.equal(await page.locator('#follow-observation-source').inputValue(), unknownSource);
  const observed = await uiWrite(page, 'PATCH', `/api/follow-ups/${followUp.id}`,
    () => page.locator('#follow-up-form button[type="submit"]').click());
  assert.equal(observed.input.action, 'observe'); assert.equal(observed.input.expectedRevision, snoozed.body.case.revision);
  assert.equal(observed.body.case.observations[0].status, 'unknown');
  assert.equal(observed.body.case.observations[0].source, unknownSource);
  assert.equal(observed.body.case.observations[0].value, null);
  assert.match(await followCard.innerText(), /Ukendt/);
  const cancelled = await uiWrite(page, 'PATCH', `/api/follow-ups/${followUp.id}`,
    () => followCard.getByRole('button', { name: 'Annullér sag', exact: true }).click());
  assert.equal(cancelled.body.case.status, 'cancelled'); assert.equal(cancelled.body.case.nextCheckAt, null);
  assert.equal(cancelled.body.case.observations[0].status, 'unknown');
  await followCard.waitFor({ state: 'detached' });
  assert.equal((await fixtureRead(page, '/api/follow-ups')).cases.find(record => record.id === followUp.id).status, 'cancelled');
  // End only this device's synthetic records so the next matrix case has
  // independent capacity; history remains reviewable and no jobs are created.
  for (const id of [task.id, secondId]) {
    const completed = await uiWrite(page, 'POST', `/api/personal-tasks/${id}/complete`,
      () => page.locator(`[data-personal-task-id="${id}"]`).getByRole('button', { name: 'Markér afsluttet', exact: true }).click());
    assert.equal(completed.body.task.status, 'completed');
  }
  assert.deepEqual((await fixtureRead(page, '/api/tasks')).tasks.map(item => item.id).sort(), automatedBefore,
    `${label}: personal planning and follow-ups must not activate automated jobs`);
}

async function verifyAccessibility(page, width, height, label) {
  const evidence = { label, viewport: { width, height }, status: 'running', keyboard: [], reflow: [] };
  accessibilityReports.push(evidence);
  const desktop = width >= 768;
  const primary = [['home', 'I dag'], ['plan', 'Planlægning'], ['smart-home', 'Hjem'], ['watches', 'Overvågninger']];
  for (const [view, title] of primary) assert.equal(await page.locator(`.tab-nav a[data-tab="${view}"]:visible .nav-label`).innerText(), title);
  assert.equal(await page.locator('#more-toggle').isVisible(), false, 'settings remains directly reachable without More');
  await page.locator('.tab-nav a[data-tab="home"]:visible').focus();
  for (const view of ['plan', 'smart-home', 'watches']) {
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(`.tab-nav a[data-tab="${view}"]:visible`).evaluate(element => document.activeElement === element), true,
      `${label}: keyboard navigation must reach ${view} in the same primary order`);
    evidence.keyboard.push(view);
  }
  await navigate(page, 'plan');
  await page.locator('[data-plan-tab="meals"]').focus(); await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).searchParams.get('view'), 'plan');
  assert.equal(new URL(page.url()).searchParams.get('section'), 'meals', `${label}: Enter activates the real meals subroute`);
  for (const id of ['meal-family-preferences', 'meal-profile-preferences', 'meal-recipe-create']) await openDetails(page.locator(`#${id}`));
  await page.evaluate(() => refreshMeals());
  await page.getByLabel('Voksne som standard', { exact: true }).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#meal-adult-portion').evaluate(element => document.activeElement === element), true);
  evidence.contrast = await page.evaluate(renderedAccessibilityReport, [
    { name: 'Normal husstand', selector: '#meal-adults', kind: 'field' },
    { name: 'Portionsfaktor', selector: '#meal-adult-portion', kind: 'field' },
    { name: 'Tastaturfokus', selector: '#meal-adult-portion', kind: 'focus' },
    { name: 'Barnets alder', selector: '#meal-family-form input[aria-label="Barnets alder"]', kind: 'field' },
    { name: 'Opskriftskilde og pladsholder', selector: '#meal-recipe-text', kind: 'field' },
    { name: 'Feltlabel', selector: '#meal-family-form label[for="meal-adults"]', kind: 'text' },
    { name: 'Gemmeknap', selector: '#meal-family-form button[type="submit"]', kind: 'text' },
    { name: 'Gemmedialogstatus', selector: '#meal-family-status', kind: 'text' },
    { name: 'Aktiv navigation', selector: '.tab-nav a[data-tab="plan"]', kind: 'text' },
    { name: 'Sidefod', selector: 'footer', kind: 'text' },
  ]);
  for (const check of evidence.contrast.checks) {
    assert.equal(check.missing, undefined, `${label}: missing contrast sample ${check.name}`);
    assert.equal(check.visible, true, `${label}: contrast sample is not rendered: ${check.name}`);
    assert.equal(check.disabled, false, `${label}: disabled controls cannot stand in for enabled contrast evidence`);
    assert.equal(check.requiresManualReview, undefined, `${label}: unsupported backdrop for ${check.name}: ${JSON.stringify(check.requiresManualReview)}`);
    assert.ok(check.textRatio >= 4.5, `${label}: ${check.name} normal text contrast is ${check.textRatio}:1`);
    if (check.kind === 'field') {
      assert.ok(check.borderWidth >= 1 && check.borderStyle !== 'none' && check.borderRatio >= 3,
        `${label}: ${check.name} control-boundary contrast is ${check.borderRatio}:1`);
      if (check.hasPlaceholder) assert.ok(check.placeholderRatio >= 4.5, `${label}: ${check.name} placeholder contrast is ${check.placeholderRatio}:1`);
    }
    if (check.kind === 'focus') assert.ok(check.focused && check.outlineWidth >= 2 && check.outlineStyle !== 'none' && check.outlineRatio >= 3,
      `${label}: visible keyboard focus must have a >=2px ring and >=3:1 adjacent contrast`);
  }

  const originalDraft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('jarvis:v5:meal-drafts') || 'null'));
  // Desktop viewport halving exercises the layout space equivalent to 200%
  // zoom. The mobile case separately checks the standard 320 CSS-pixel reflow
  // width. Neither is a physical-device or real browser zoom acceptance claim.
  const reduced = desktop ? { width: Math.floor(width / 2), height: Math.floor(height / 2) } : { width: 320, height };
  evidence.reflowMethod = desktop ? '200%-equivalent CSS viewport (synthetic; not browser zoom)' : '320 CSS-pixel mobile reflow (synthetic; not physical zoom)';
  try {
    await page.setViewportSize(reduced);
    for (const [view, control, labelText] of [
      ['home', '#message', 'Din besked'], ['plan', '#personal-task-title', 'Hvad vil du nå?'], ['meals', '#meal-adults', 'Voksne som standard'],
      ['knowledge', '#knowledge-query', 'Hvad vil du finde?'], ['projects', '#project-title', 'Nyt projekt'], ['memory', '#preferences', 'Hukommelsesnoter'],
      ['smart-home', '#smart-home-load-hue', 'Opdater Hue-lys'],
    ]) {
      await navigate(page, view);
      await page.locator(control).waitFor({ state: 'visible' });
      const accessible = view === 'smart-home' ? page.getByRole('button', { name: labelText, exact: true }) : page.getByLabel(labelText, { exact: true });
      assert.equal(await accessible.isVisible(), true,
        `${label}: the reflowed ${view} control retains its exact accessible label`);
      const input = page.locator(control); await input.scrollIntoViewIfNeeded(); await input.focus();
      const layout = await page.evaluate(selector => {
        const input = document.querySelector(selector); const rect = input.getBoundingClientRect();
        const bar = document.querySelector('.tab-nav').getBoundingClientRect();
        const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        return { width: document.documentElement.clientWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          input: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, navTop: bar.top,
          unobscured: hit === input || input.contains(hit),
          hit: hit && { id: hit.id, tag: hit.tagName, className: String(hit.className) },
          toast: (() => { const el = document.querySelector('#toast'); if (!el || el.classList.contains('hidden')) return null;
            const area = el.getBoundingClientRect(); return { top: area.top, bottom: area.bottom,
              pointerEvents: getComputedStyle(el).pointerEvents }; })(),
          overflow: [...document.querySelectorAll('body *')].filter(node => node.getClientRects().length)
            .map(node => ({ tag: node.tagName, id: node.id, className: String(node.className), right: node.getBoundingClientRect().right }))
            .filter(node => node.right > document.documentElement.clientWidth + 2).slice(0, 15) };
      }, control);
      evidence.reflow.push({ view, labelText, ...reduced, ...layout });
      assert.ok(layout.scrollWidth <= layout.width + 2,
        `${label}: ${evidence.reflowMethod} overflows in ${view}: ${JSON.stringify(layout)}`);
      assert.ok(layout.input.left >= -1 && layout.input.right <= layout.width + 1 && layout.input.top >= -1 && layout.input.bottom <= layout.height + 1 && layout.unobscured,
        `${label}: ${control} must remain reachable and not obscured by navigation or an overlay`);
      if (view === 'meals') await page.locator('#meal-family-days').screenshot({
        path: join(screenshotDir, `${label}-reflow-household.png`), animations: 'disabled' });
    }
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('jarvis:v5:meal-drafts') || 'null')), originalDraft,
      `${label}: reflow and keyboard navigation must not change any recovered household/recipe draft`);
  } finally { await page.setViewportSize({ width, height }); }
  evidence.status = 'passed';
}

async function verifyHouseholdAndSources(page, width, height, label) {
  const day = ({ desktop: '2026-12-07', mobile: '2026-12-14', 'webkit-desktop': '2026-12-21', 'webkit-mobile': '2026-12-28' })[label];
  const tomorrow = new Date(`${day}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const absentDay = tomorrow.toISOString().slice(0, 10);
  await navigate(page, 'meals');
  await page.evaluate(() => refreshMeals());
  const household = page.locator('#meal-family-form');
  await household.getByRole('button', { name: 'Kassér husstandskladde og hent gemte oplysninger', exact: true }).click();
  await page.evaluate(() => refreshMeals());
  await page.getByLabel('Brug ugentlig eller flerugers rytme', { exact: true }).uncheck();
  await household.getByLabel('Voksne som standard', { exact: true }).fill('2');
  await household.getByLabel('Portionsfaktor for voksne', { exact: true }).fill('1.25');
  while (await household.getByRole('button', { name: 'Fjern barn', exact: true }).count())
    await household.getByRole('button', { name: 'Fjern barn', exact: true }).first().click();
  await household.getByRole('button', { name: '+ Tilføj barn', exact: true }).click();
  await household.getByLabel('Barnets alder', { exact: true }).fill('8');
  await household.getByLabel('Portionsfaktor', { exact: true }).fill('0.75');
  const savedHousehold = await uiWrite(page, 'PUT', '/api/meals/household',
    () => household.locator('button[type="submit"]').click());
  assert.equal(savedHousehold.body.household.adultPortion, 1.25);
  assert.equal(savedHousehold.body.household.children[0].portion, 0.75);
  assert.match(savedHousehold.body.household.children[0].ageRecordedAt, /^\d{4}-\d{2}-\d{2}$/,
    `${label}: a user-entered age has an explicit recording date, not an invented birthday`);

  await page.getByLabel('Brug ugentlig eller flerugers rytme', { exact: true }).check();
  await page.getByLabel('Mandag hvor rytmen begynder', { exact: true }).fill('2026-12-07');
  await openDetails(page.locator('.meal-rhythm-week').first());
  const monday = page.locator('.meal-rhythm-day').first();
  await monday.getByLabel('Mandag – brug særlig husstand', { exact: true }).check();
  await monday.getByLabel('Voksne hjemme', { exact: true }).fill('1');
  await monday.getByLabel('Portionsfaktor for voksne', { exact: true }).fill('1');
  const rhythmSaved = await uiWrite(page, 'PUT', '/api/meals/household',
    () => household.locator('button[type="submit"]').click());
  assert.equal(rhythmSaved.input.expectedRevision, savedHousehold.body.household.revision);
  assert.equal(rhythmSaved.body.household.rhythm.weeks[0]['1'].adults, 1);

  await page.locator('#meal-family-start').fill(day);
  await page.locator('#meal-family-show').click();
  const dateCard = page.locator(`[data-household-date="${day}"]`);
  const absentCard = page.locator(`[data-household-date="${absentDay}"]`);
  assert.match(await dateCard.locator('.meal-status').textContent(), /Familierytme/);
  assert.match(await absentCard.locator('.meal-status').textContent(), /Standardhusstand/);
  assert.match(await absentCard.innerText(), /3,25 portioner/,
    `${label}: explicit defaults supply 2 × 1.25 + 0.75 portions on an unruled day`);
  await openDetails(dateCard.locator('.meal-family-editor'));
  await dateCard.getByLabel('Voksne hjemme', { exact: true }).fill('2');
  await dateCard.getByLabel('Portionsfaktor for voksne', { exact: true }).fill('1.25');
  const residentChildren = dateCard.getByRole('group', { name: 'Børn hjemme – alder og portioner', exact: true });
  await residentChildren.getByRole('button', { name: '+ Tilføj barn', exact: true }).click();
  await residentChildren.getByLabel('Barnets alder', { exact: true }).fill('8');
  await residentChildren.getByLabel('Portionsfaktor', { exact: true }).fill('0.75');
  await dateCard.getByLabel('Voksne gæster', { exact: true }).fill('1');
  await dateCard.getByLabel('Dagens forhold', { exact: true }).selectOption('holiday');
  assert.match(await dateCard.locator('.meal-portions-preview').textContent(), /4,25 portioner/,
    `${label}: guests are additional, and holiday does not invent attendance`);
  const savedDate = await uiWrite(page, 'PUT', `/api/meals/household/days/${day}`,
    () => dateCard.getByRole('button', { name: 'Gem dag', exact: true }).click());
  assert.equal(savedDate.input.expectedRevision, rhythmSaved.body.household.revision);
  assert.equal(savedDate.body.household.days[day].guests.adults, 1);
  assert.equal(savedDate.body.household.days[day].occasion, 'holiday');
  assert.match(await dateCard.locator('.meal-status').textContent(), /Dagsundtagelse/);

  await openDetails(absentCard.locator('.meal-family-editor'));
  await absentCard.getByLabel('Dagens forhold', { exact: true }).selectOption('absence');
  assert.match(await absentCard.locator('.meal-portions-preview').textContent(), /^0 portioner/);
  const savedAbsence = await uiWrite(page, 'PUT', `/api/meals/household/days/${absentDay}`,
    () => absentCard.getByRole('button', { name: 'Gem dag', exact: true }).click());
  assert.equal(savedAbsence.body.household.days[absentDay].adults, 0);
  assert.deepEqual(savedAbsence.body.household.days[absentDay].children, []);
  assert.equal(savedAbsence.body.household.days[absentDay].skip, true);

  await openDetails(dateCard.locator('.meal-family-editor'));
  await dateCard.getByLabel('Voksne hjemme', { exact: true }).fill('3');
  await dateCard.getByLabel('Voksne hjemme', { exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await dateCard.getByLabel('Portionsfaktor for voksne', { exact: true }).evaluate(el => el === document.activeElement), true,
    `${label}: keyboard tab order reaches the labelled adult portion editor`);
  await page.keyboard.press('Shift+Tab');
  await page.evaluate(() => { window.syntheticHouseholdFocus = document.activeElement; });
  const draftRevision = Number(await dateCard.getAttribute('data-revision'));
  await page.evaluate(() => refreshMeals());
  assert.equal(await page.evaluate(() => document.activeElement === window.syntheticHouseholdFocus && window.syntheticHouseholdFocus.isConnected), true,
    `${label}: polling must not detach the focused dirty household card`);
  assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '3');
  await page.locator('#meal-family-days').screenshot({ path: join(screenshotDir, `${label}-household.png`), animations: 'disabled' });
  await verifyFamilyCalendar(page, label, day, dateCard);

  const recipeTitle = `Syntetisk risret ${label}`;
  await page.locator('#meal-recipe-text').fill(`${recipeTitle}\n200 g ris\nKog risene. Syntetisk testkilde uden persondata.`);
  const captured = await uiWrite(page, 'POST', '/api/recipes',
    () => page.locator('#meal-recipe-form button[type="submit"]').click(), [201]);
  const recipeId = captured.body.recipe.id;
  const recipeCard = page.locator(`[data-record-key="recipe:${recipeId}"]`);
  await recipeCard.waitFor({ state: 'visible' });
  await openDetails(recipeCard.locator(':scope > .meal-details'));
  const unreviewedSearch = await page.request.post(`${origin}/api/knowledge/search`, {
    headers: { Authorization: `Bearer ${token}` }, data: { query: recipeTitle },
  });
  assert.equal(unreviewedSearch.status(), 200);
  assert.equal((await unreviewedSearch.json()).matches.some(match => match.id === `recipe:${recipeId}`), false,
    `${label}: an imported, unreviewed recipe is not a usable personal knowledge source`);
  await recipeCard.getByLabel('Titel', { exact: true }).fill(recipeTitle);
  await recipeCard.getByLabel('Kosttype — skal være kontrolleret', { exact: true }).selectOption('vegan');
  await recipeCard.getByLabel('Tilberedningstid i minutter', { exact: true }).fill('20');
  await recipeCard.getByLabel('Opskriftens portioner', { exact: true }).fill('2');
  const ingredients = recipeCard.getByRole('group', { name: 'Ingredienser og mængder', exact: true });
  while (await ingredients.getByRole('button', { name: 'Fjern ingrediens', exact: true }).count())
    await ingredients.getByRole('button', { name: 'Fjern ingrediens', exact: true }).first().click();
  await ingredients.getByRole('button', { name: '+ Tilføj vare', exact: true }).click();
  await ingredients.getByLabel('Ingrediens', { exact: true }).fill('ris');
  await ingredients.getByLabel('Mængde', { exact: true }).fill('200');
  await ingredients.getByLabel('Enhed', { exact: true }).selectOption('g');
  const approved = await uiWrite(page, 'PUT', `/api/recipes/${recipeId}`,
    () => recipeCard.getByRole('button', { name: 'Godkend opskrift til madplaner', exact: true }).click());
  assert.equal(approved.input.confirmed, true); assert.equal(approved.body.recipe.confirmed, true);
  assert.equal(approved.body.recipe.status, 'confirmed');
  await openDetails(recipeCard.locator(':scope > .meal-details'));
  const rawTitle = `Ugemt opskriftsrettelse ${label}`;
  await recipeCard.getByLabel('Titel', { exact: true }).fill(rawTitle);
  await ingredients.getByRole('button', { name: '+ Tilføj vare', exact: true }).click();
  await ingredients.getByLabel('Ingrediens', { exact: true }).last().fill('Ufærdig testvare');
  await ingredients.getByLabel('Mængde', { exact: true }).last().fill('');
  await recipeCard.getByLabel('Titel', { exact: true }).evaluate(input => {
    input.focus(); input.setSelectionRange(2, 8); window.syntheticRecipeFocus = input;
  });
  // A neighbouring durable import exercises reconciliation while this exact
  // focused input contains an incomplete ingredient draft. Only synthetic text.
  const imported = await page.request.post(`${origin}/api/recipes`, {
    headers: { Authorization: `Bearer ${token}` }, data: { text: `Syntetisk nabokilde ${label}` },
  });
  assert.equal(imported.status(), 201);
  await page.evaluate(() => refreshMeals());
  assert.deepEqual(await page.evaluate(() => ({ same: document.activeElement === window.syntheticRecipeFocus,
    connected: window.syntheticRecipeFocus.isConnected,
    selection: [window.syntheticRecipeFocus.selectionStart, window.syntheticRecipeFocus.selectionEnd] })),
  { same: true, connected: true, selection: [2, 8] }, `${label}: imports/polling must preserve the recipe input node and caret`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-meals').waitFor({ state: 'visible' });
  await page.evaluate(() => refreshMeals());
  for (const section of await page.locator('.meal-secondary-section').all()) await openDetails(section);
  await page.locator('#meal-family-start').fill(day); await page.locator('#meal-family-show').click();
  assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '3');
  assert.equal(Number(await dateCard.getAttribute('data-revision')), draftRevision,
    `${label}: a reloaded draft retains its original expected revision`);
  assert.equal(await recipeCard.getByLabel('Titel', { exact: true }).inputValue(), rawTitle);
  assert.equal(await ingredients.getByLabel('Ingrediens', { exact: true }).last().inputValue(), 'Ufærdig testvare');
  assert.equal(await ingredients.getByLabel('Mængde', { exact: true }).last().inputValue(), '',
    `${label}: reload must not coerce an incomplete ingredient quantity to zero`);

  const beforeConcurrent = await fixtureRead(page, '/api/meals');
  const changed = await page.request.put(`${origin}/api/meals/household/days/${day}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...beforeConcurrent.household.days[day], adults: 4, expectedRevision: beforeConcurrent.household.revision },
  });
  assert.equal(changed.status(), 200);
  await page.evaluate(() => refreshMeals());
  assert.match(await dateCard.locator('[data-edit-status]').textContent(), /ændret et andet sted/);
  assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '3');
  const rejected = await uiWrite(page, 'PUT', `/api/meals/household/days/${day}`,
    () => dateCard.getByRole('button', { name: 'Gem dag', exact: true }).click(), [400, 409]);
  assert.equal(rejected.input.expectedRevision, draftRevision);
  assert.match(rejected.body.error, /ændret|revision/i);
  assert.equal((await fixtureRead(page, '/api/meals')).household.days[day].adults, 4,
    `${label}: a stale UI save cannot replace concurrent saved attendance`);
  await dateCard.getByRole('button', { name: 'Kassér lokale rettelser', exact: true }).click();
  await page.evaluate(() => refreshMeals());
  await openDetails(dateCard.locator('.meal-family-editor'));
  assert.equal(await dateCard.getByLabel('Voksne hjemme', { exact: true }).inputValue(), '4');
  assert.equal((await fixtureRead(page, '/api/meals')).household.days[day].adults, 4,
    `${label}: discarding a local draft must not remove the saved date exception`);

  await navigate(page, 'memory');
  await page.locator('#memory-editor-mode').selectOption('note');
  const memoryDraft = await page.locator('#memory-workbench-text').inputValue();
  await navigate(page, 'knowledge');
  await page.locator('#knowledge-query').fill(`Husstand ${day}`);
  await page.locator('#knowledge-search-form button[type="submit"]').click();
  const householdSource = page.locator('.knowledge-result').filter({ hasText: day }).first();
  await householdSource.getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('source'), `household:${day}`);
  await page.locator(`[data-household-date="${day}"].source-target`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#meal-family-start').inputValue(), day);
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('panel'), 'search');
  assert.equal(new URL(page.url()).searchParams.get('source'), null);
  assert.equal(await page.locator('#memory-workbench-text').inputValue(), memoryDraft,
    `${label}: opening and returning from a household date keeps the memory editor draft`);
  await page.locator('#knowledge-query').fill(recipeTitle);
  const storedRecipe = (await fixtureRead(page, `/api/recipes/${recipeId}`)).recipe;
  assert.equal(storedRecipe.confirmed, true); assert.equal(storedRecipe.title, recipeTitle,
    `${label}: unsaved local edits must not alter the reviewed knowledge-source revision`);
  await page.locator('#knowledge-search-form button[type="submit"]').click();
  await page.locator('.knowledge-result').filter({ hasText: recipeTitle }).first().getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('source'), `recipe:${recipeId}`);
  await page.locator(`[data-record-key="recipe:${recipeId}"].source-target`).waitFor({ state: 'visible' });
  assert.equal(await recipeCard.getByLabel('Titel', { exact: true }).inputValue(), rawTitle,
    `${label}: a source read must not overwrite the recipe editor draft`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`[data-record-key="recipe:${recipeId}"].source-target`).waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).searchParams.get('source'), `recipe:${recipeId}`,
    `${label}: copied/reloaded source URL keeps the exact source identity`);
  assert.equal(await recipeCard.getByLabel('Titel', { exact: true }).inputValue(), rawTitle);
  assert.equal(await ingredients.getByLabel('Mængde', { exact: true }).last().inputValue(), '');
  await recipeCard.screenshot({ path: join(screenshotDir, `${label}-recipe-draft.png`), animations: 'disabled' });
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('panel'), 'search');
  assert.equal(await page.locator('#knowledge-query').inputValue(), recipeTitle,
    `${label}: returning after a source reload restores the original search context`);
  assert.equal(await page.locator('#memory-workbench-text').inputValue(), memoryDraft);
  await navigate(page, 'meals');
  await page.evaluate(() => refreshMeals());
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  assert.equal(horizontalOverflow, false, `${label}: structured editors must fit the ${width} × ${height} viewport`);
  await verifyMealLeftovers(page, label, day, recipeId, rawTitle);
}

async function runDevice(type, width, height, label, page, evidence) {
  const basketMutations = [];
  const prohibitedPlanningActivations = [];
  const jobWrites = [], projectWrites = [], prohibitedCodeActions = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && path.startsWith('/api/nemlig/') && path !== '/api/nemlig/search') basketMutations.push(path);
    if (request.method() !== 'GET' && path.startsWith('/api/tasks')) jobWrites.push({ path, method: request.method(), body: request.postDataJSON() });
    if (request.method() !== 'GET' && path.startsWith('/api/projects')) projectWrites.push({ path, method: request.method() });
    if (request.method() !== 'GET' && (path.startsWith('/api/code') || /^\/api\/projects\/[^/]+\//.test(path))) prohibitedCodeActions.push(path);
    if (request.method() !== 'GET' && (path.startsWith('/api/google/calendar') || path.endsWith('/action') && path.startsWith('/api/tasks') || path === '/api/proactive/settings'))
      prohibitedPlanningActivations.push(path);
  });
  page.on('pageerror', error => { errors.push(`${label}: ${error.message}`); evidence.runtimeErrors.push(error.message); });
  await signIn(page);
  for (const view of ['home', 'plan', 'meals', 'knowledge', 'smart-home', 'projects', 'watches', 'settings']) {
    assert.equal(await page.locator(`#tab-${view}`).count(), 1, `${label}: missing view ${view}`);
  }
  await page.locator('#tab-home .chat-panel').waitFor({ state: 'visible' });
  await waitForTodayCards(page, label);
  assert.equal((await page.locator('#tab-home .hero-panel h1').innerText()).trim(), 'I dag',
    `${label}: the Danish Today heading retains its explicit word spacing without inventing a user name`);
  assert.equal(await page.locator('#system-health-details').isVisible(), false,
    `${label}: normal technical system details must not crowd Today`);
  assert.equal(await page.locator('#message').isVisible(), true, `${label}: message input hidden`);
  const composerBottom = await page.locator('#message').evaluate(el => el.getBoundingClientRect().bottom);
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-initial-home.png`), animations: 'disabled' });
  assert.ok(composerBottom < height, `${label}: chat input below first screen (${composerBottom}px)`);
  await verifyHistory(page, label);
  const topNav = page.locator('.tab-nav a[data-tab="plan"]:visible');
  await topNav.click();
  for (const id of ['personal-task-create', 'follow-up-create']) await openDetails(page.locator(`#${id}`));
  assert.equal(new URL(page.url()).searchParams.get('view'), 'plan');
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'home');
  assert.equal(await page.locator('#tab-home').isVisible(), true);

  await topNav.click();
  await page.locator('#personal-task-title').fill(`Syntetisk personlig opgave ${label}`);
  await page.locator('#personal-task-purpose').fill('Verificér den separate planlægningsarbejdsgang');
  const pastLocalTime = await page.evaluate(() => JarvisPlan.fromInstant(new Date(Date.now() - 120_000).toISOString()).slice(0, 16));
  await page.locator('#personal-task-deadline').fill(pastLocalTime);
  const nativeTaskValidity = await page.locator('#personal-task-form').evaluate(form => ({
    valid: form.checkValidity(), invalid: [...form.querySelectorAll(':invalid')].map(control => ({
      id: control.id, type: control.type, message: control.validationMessage,
      stepMismatch: control.validity?.stepMismatch === true,
    })),
  }));
  assert.equal(nativeTaskValidity.valid, true, `${label}: native task form invalid before submit: ${JSON.stringify(nativeTaskValidity)}`);
  const createdTask = await uiWrite(page, 'POST', '/api/personal-tasks',
    () => page.locator('#personal-task-form button[type="submit"]').click(), [201]);
  await page.locator(`[data-personal-task-id="${createdTask.body.task.id}"]`).waitFor({ state: 'visible' });
  await page.locator('#follow-up-awaiting').fill(`Afvent syntetisk svar ${label}`);
  await page.locator('#follow-up-check').fill(pastLocalTime);
  await page.locator('#follow-up-stop').fill('Når svaret er modtaget');
  const createdFollowUp = await uiWrite(page, 'POST', '/api/follow-ups',
    () => page.locator('#follow-up-form button[type="submit"]').click(), [201]);
  await page.locator(`[data-follow-up-id="${createdFollowUp.body.case.id}"]`).waitFor({ state: 'visible' });
  await verifyTodaySources(page, label, createdTask.body.task, createdFollowUp.body.case);
  await verifyPlanning(page, label, createdTask.body.task, createdFollowUp.body.case);
  assert.deepEqual(jobWrites, [], `${label}: independent personal planning/follow-up must not create or activate jobs`);
  const pausedJobId = await verifyPausedJob(page, label);
  await verifyProjectDrafts(page, label);

  await navigate(page, 'system');
  await page.locator('#system-health-details .system-health-card').first().waitFor({ state: 'visible' });
  assert.match(await page.locator('#system-health-details').innerText(), /Lager/,
    `${label}: technical status remains reachable in its canonical settings category`);
  await verifySettingsDraft(page, label);
  await navigate(page, 'memory');
  await page.locator('#preferences').fill('Lokalt udkast: mine noter må ikke forsvinde');
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('#preferences').inputValue(), 'Lokalt udkast: mine noter må ikke forsvinde');
  assert.match(await page.locator('#preferences-draft-status').textContent(), /Ikke gemt/);
  assert.equal(await page.locator('#preferences-draft-status').evaluate(el => el.classList.contains('draft-conflict')),
    false, `${label}: an unchanged server value must not appear as a concurrent conflict`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-settings').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#preferences').inputValue(), 'Lokalt udkast: mine noter må ikke forsvinde',
    `${label}: unsaved preferences draft was lost on reload`);
  assert.match(await page.locator('#preferences-draft-status').textContent(), /Ugemt kladde|Ikke gemt/);
  await page.evaluate(() => refresh()); // establish server baseline even if draft was typed before the first fetch
  const beforeEdit = await page.evaluate(() => ({ dirty: savedDrafts.preferences.dirty,
    serverValue: savedDrafts.preferences.serverValue, draftValue: savedDrafts.preferences.value }));
  const concurrentText = `Syntetisk ændring fra en anden fane: ${label}`;
  const concurrentChange = await page.request.post(`${origin}/api/preferences`, {
    headers: { Authorization: `Bearer ${token}` }, data: { text: concurrentText },
  });
  assert.equal(concurrentChange.status(), 200);
  const serverProof = await page.request.get(`${origin}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(serverProof.status(), 200);
  const savedServerText = (await serverProof.json()).preferences;
  assert.equal(savedServerText, concurrentText, 'each device must produce a real new synthetic server revision');
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('#preferences').inputValue(), 'Lokalt udkast: mine noter må ikke forsvinde',
    `${label}: concurrent save replaced a dirty local draft`);
  const afterEdit = await page.evaluate(() => ({ dirty: savedDrafts.preferences.dirty,
    serverValue: savedDrafts.preferences.serverValue, draftValue: savedDrafts.preferences.value }));
  assert.match(await page.locator('#preferences-draft-status').textContent(), /Ændret et andet sted/,
    `${label}: conflict mismatch; before=${JSON.stringify(beforeEdit)} after=${JSON.stringify(afterEdit)} saved=${JSON.stringify(savedServerText)}`);

  await page.locator('#tab-settings').screenshot({ path: join(screenshotDir, `${label}-settings.png`), animations: 'disabled' });
  await navigate(page, 'memory');
  await page.locator('#settings-profile').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#memory-workbench-form').isVisible(), true,
    `${label}: the unified knowledge editor must open with legacy notes available`);
  assert.equal(await page.locator('#personal-claim-form').isVisible(), false,
    `${label}: there must not be two simultaneously visible memory creation forms`);
  await page.locator('#memory-workbench-text').fill(`Syntetisk ugemt hukommelseskladde ${label}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#settings-profile').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#memory-workbench-text').inputValue(), `Syntetisk ugemt hukommelseskladde ${label}`,
    `${label}: unsaved memory creation draft must recover after reload`);
  await page.locator('#memory-editor-mode').selectOption('claim');
  assert.equal(await page.locator('#memory-workbench-form').isVisible(), false);
  assert.equal(await page.locator('#personal-claim-form').isVisible(), true);
  // The four browser cases intentionally share one synthetic server. Each must
  // create a distinct claim: otherwise a later case finds the already-confirmed
  // first claim, whose first button is "Arkivér" rather than "Bekræft".
  const subject = `syntetisk_emne_${label}`;
  const value = `Syntetisk personligt faktum ${label}`;
  await page.locator('#claim-subject').fill(subject);
  await page.locator('#claim-value').fill(value);
  const claimCreated = await uiWrite(page, 'POST', '/api/personal-claims',
    () => page.locator('#personal-claim-form [type="submit"]').click(), [201]);
  assert.equal(claimCreated.input.sourceId, '', `${label}: an omitted optional source uses an empty string, not an invalid null provenance`);
  assert.equal(claimCreated.body.claim.subject, subject); assert.equal(claimCreated.body.claim.status, 'proposed');
  const createdClaim = page.locator(`[data-claim-id="${claimCreated.body.claim.id}"]`);
  await createdClaim.waitFor({ state: 'visible' });
  assert.match(await createdClaim.innerText(), new RegExp(subject));
  const claimConfirmed = await uiWrite(page, 'POST', `/api/personal-claims/${claimCreated.body.claim.id}/confirm`,
    () => createdClaim.getByRole('button', { name: 'Bekræft oplysning', exact: true }).click());
  assert.equal(claimConfirmed.input.expectedRevision, claimCreated.body.claim.revision);
  await createdClaim.getByText('Bekræftet af dig').waitFor({ state: 'visible' });
  await navigate(page, 'knowledge');
  await page.locator('#knowledge-query').fill(value);
  await page.locator('#knowledge-search-form button').click();
  const exactClaimResult = page.locator('.knowledge-result').filter({ hasText: subject }).first();
  await exactClaimResult.locator('button').waitFor({ state: 'visible' });
  await exactClaimResult.locator('button').click();
  const selectedSource = new URL(page.url()).searchParams.get('source');
  assert.match(selectedSource || '', /^claim:/,
    `${label}: source navigation selected another record: ${selectedSource}`);
  const selectedId = selectedSource.slice('claim:'.length);
  await page.waitForTimeout(700);
  const sourceDiagnostic = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-claim-id]')].map(card => ({
      id: card.dataset.claimId, selected: card.classList.contains('source-target'), visible: Boolean(card.getClientRects().length),
    })),
    status: document.querySelector('#tab-knowledge > .source-open-status')?.textContent || '',
  }));
  console.log(`${label} R11 source diagnostic: ${JSON.stringify({ selectedId, ...sourceDiagnostic, pageErrors: errors })}`);
  await page.locator('[data-claim-id].source-target').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-claim-id].source-target').first().getAttribute('data-claim-id'), selectedId,
    `${label}: highlighted card must match the exact selected source revision`);
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('source'), null,
    `${label}: going back must restore the pre-source route`);
  await page.locator('#knowledge-query').focus();
  await page.evaluate(() => refresh());
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'knowledge-query',
    `${label}: polling cannot steal focus from the active knowledge editor`);
  await verifyClaimCorrection(page, selectedId, label);
  await verifyOrganizerDraft(page, label);
  await verifyNoteDraft(page, label);
  await page.locator('#settings-profile').screenshot({ path: join(screenshotDir, `${label}-memory.png`), animations: 'disabled' });
  await verifyHouseholdAndSources(page, width, height, label);
  await verifyAccessibility(page, width, height, label);
  assert.deepEqual(basketMutations, [], `${label}: planning, imports, polling and source/draft navigation must request zero basket writes or transfer intents`);
  assert.deepEqual(prohibitedPlanningActivations, [], `${label}: the local planning flow cannot activate jobs, messages or calendar writes`);
  assert.deepEqual(jobWrites.map(item => ({ path: item.path, method: item.method, activation: item.body.activation })), [
    { path: '/api/tasks', method: 'POST', activation: 'paused' }, { path: `/api/tasks/${pausedJobId}`, method: 'PATCH', activation: 'paused' },
  ], `${label}: the additional job-editor flow may only create/edit its one synthetic paused job`);
  assert.deepEqual(projectWrites, [{ path: '/api/projects', method: 'POST' }], `${label}: project draft review may only create its one empty synthetic local project`);
  assert.deepEqual(prohibitedCodeActions, [], `${label}: project/approval views cannot generate code, run an installer/test or apply code`);
  await navigate(page, 'home');
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-home.png`), animations: 'disabled' });
  return `${label}: navigation, compact Today/history pagination, personal task edit/lock/local placement, unknown-capacity guard, follow-up unknown/snooze/cancel, paused job policy edits, project/form drafts and dependency review without model/installer activity, field-bound settings drafts, claim correction/replacement/history, lazy legacy-note history/read-only archive, organizer drafts/conflicts, household precedence/guests/holiday/absence/portions, explicit revision-bound planned leftovers/unlink/unknown pricing, manual shopping quantities/basis review/reset/exclusion without retailer activity, structured drafts, revision conflicts, exact source return, keyboard focus, selected contrast/reflow and first-screen composer passed`;
}

async function attemptDevice(type, width, height, label) {
  const evidence = { label, engine: type, viewport: { width, height }, status: 'running',
    startedAt: new Date().toISOString(), runtimeErrors: [] };
  deviceReports.push(evidence);
  let context, page;
  try {
    context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort('blockedbyclient'));
    page = await context.newPage();
    const summary = await runDevice(type, width, height, label, page, evidence);
    assert.deepEqual(evidence.runtimeErrors, [], `${label}: browser runtime errors`);
    evidence.status = 'passed';
    return summary;
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.stack || String(error); evidence.url = page?.url() || null;
    if (page) {
      const filename = `${label}-failure.png`;
      await page.screenshot({ path: join(screenshotDir, filename), fullPage: true, animations: 'disabled' })
        .then(() => { evidence.failureScreenshot = filename; })
        .catch(failure => { evidence.screenshotError = failure.message; });
    }
    failedDevices.push({ label, error: error.message });
    return `${label}: FAILED — ${evidence.error}`;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await context?.close().catch(error => {
      evidence.cleanupError = error.message;
      if (evidence.status !== 'failed') { evidence.status = 'failed'; failedDevices.push({ label, error: `Context cleanup: ${error.message}` }); }
      console.error(`${label}: context cleanup failed: ${error.message}`);
    });
  }
}

try {
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) throw new Error(`Server failed: ${logs}`);
    try { ready = (await fetch(`${origin}/health`)).ok; } catch { /* starting */ }
    if (ready) break;
    await delay(100);
  }
  assert.equal(ready, true, `Server did not start: ${logs}`);
  const chromiumPath = existsSync(chromium.executablePath()) ? chromium.executablePath()
    : existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath();
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox'] });
  const reports = [];
  reports.push(await attemptDevice('chromium', 1390, 950, 'desktop'));
  reports.push(await attemptDevice('chromium', 390, 844, 'mobile'));
  await browser.close(); browser = undefined;
  if (existsSync(webkit.executablePath())) {
    browser = await webkit.launch({ headless: true });
    reports.push(await attemptDevice('webkit', 1390, 950, 'webkit-desktop'));
    reports.push(await attemptDevice('webkit', 390, 844, 'webkit-mobile'));
  } else if (process.env.JARVIS_REQUIRE_WEBKIT === 'yes') throw new Error('WebKit is required by the v5 CI gate, but its binary is absent.');
  else reports.push('WebKit: PENDING; browser binary unavailable in this development environment');
  console.log(reports.join('\n'));
  console.log(`Synthetic screenshots: ${screenshotDir}`);
  assert.deepEqual(errors, [], 'browser runtime errors');
  assert.deepEqual(await publicAssetHashes(), initialAssetHashes, 'public assets changed while browser evidence was being collected');
  assert.equal(failedDevices.length, 0, `Deep v5 device failures: ${JSON.stringify(failedDevices)}`);
  completed = true;
} finally {
  try {
    const finalAssetHashes = await publicAssetHashes();
    await writeFile(join(screenshotDir, 'accessibility-report.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), ...candidateIdentity, candidateRevision: candidateIdentity.candidateCommit,
      status: completed ? deviceReports.length === 4 ? 'passed' : 'partial' : 'failed',
      devices: deviceReports, failures: failedDevices,
      fixtureScope: 'Each device uses a fresh browser context. The disposable local server state is shared, as in the original v5 regression; later cases can observe earlier synthetic writes, including writes preceding a failed case. No retries or live integrations.',
      publicAssetHashes: initialAssetHashes, assetsUnchangedDuringRun: JSON.stringify(initialAssetHashes) === JSON.stringify(finalAssetHashes),
      reports: accessibilityReports, today: todayReports, limitations: ['Selected computed-style checks are not a full accessibility certification.',
        'Calendar browser evidence uses synthetic HTTP cache responses and the real card projection; it is not a live Google or production check.',
        'Reduced CSS viewports do not replace manual browser zoom or physical iPhone/desktop acceptance.'],
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}
