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

const { chromium, webkit } = createRequire(import.meta.url)('playwright');
const token = 'v5-local-visual-smoke-synthetic-access';
const app = new URL('../', import.meta.url).pathname;
const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v5-ui-'));
const screenshotDir = process.env.JARVIS_V5_ARTIFACT_DIR || dataDir;
await mkdir(screenshotDir, { recursive: true });
await writeFile(join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION,
  history: Array.from({ length: 65 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', channel: 'text',
    at: new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString(), text: `Syntetisk historikbesked ${String(index + 1).padStart(2, '0')} – ingen persondata.` })) }), { mode: 0o600 });
async function publicAssetHashes() {
  const paths = (await readdir(join(app, 'public'))).filter(name => /\.(?:css|js|html)$/.test(name)).sort();
  return Object.fromEntries(await Promise.all(paths.map(async name => [name,
    createHash('sha256').update(await readFile(join(app, 'public', name))).digest('hex')])));
}
const initialAssetHashes = await publicAssetHashes();
const accessibilityReports = [];
const serverSocket = createServer();
await new Promise((resolve, reject) => serverSocket.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
const port = serverSocket.address().port;
await new Promise(resolve => serverSocket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
Object.assign(env, {
  TZ: 'Europe/Copenhagen', JARVIS_HOST: '127.0.0.1', JARVIS_PORT: String(port),
  JARVIS_ACCESS_TOKEN: token, JARVIS_DATA_DIR: dataDir,
  JARVIS_PROJECT_ROOT: join(dataDir, 'projects'), JARVIS_UPDATE_STAGING: join(dataDir, 'staging'),
  JARVIS_UPDATE_REPO: '', OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY',
  NEMLIG_ENABLE_LIVE: 'no', NEMLIG_MCP_DIR: '', NEMLIG_MCP_UV: '',
  GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
  JARVIS_ALLOW_NPM_INSTALL: 'no', DISCORD_BOT_TOKEN: '',
});
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
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
  await action();
  const response = await waiting;
  const body = await response.json();
  assert.ok(statuses.includes(response.status()), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`);
  await page.waitForFunction(() => !document.querySelector('.meal-family-day[aria-busy="true"], .meal-card[aria-busy="true"], #meal-family-form[aria-busy="true"], #meal-recipe-form[aria-busy="true"], .project-card[aria-busy="true"], #project-form[aria-busy="true"], #code-form[aria-busy="true"], #personal-task-form [type="submit"]:disabled, #follow-up-form [type="submit"]:disabled, #capacity-form [type="submit"]:disabled'));
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
  const link = page.locator(`.tab-nav > a[data-tab="${view}"]`);
  if (await link.isVisible()) await link.click();
  else { await page.locator('#more-toggle').click(); await page.locator(`#more-menu a[data-tab="${view}"]`).click(); }
  await page.locator(`#tab-${view}`).waitFor({ state: 'visible' });
}

async function verifyHistory(page, label) {
  assert.equal(await page.locator('#messages .bubble').count(), 20, `${label}: bootstrap is bounded to the latest twenty messages`);
  assert.match(await page.locator('#history-count').innerText(), /20 af 65/);
  await page.locator('#history-older').focus(); await page.keyboard.press('Tab');
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
  await page.locator('#code-file').selectOption('public/styles.css');
  await page.locator('#code-request').fill(`Usendt kodeanmodning ${label}`);
  await navigate(page, 'home'); await page.goBack();
  assert.equal(await request.inputValue(), draft); assert.equal(await page.locator('#code-request').inputValue(), `Usendt kodeanmodning ${label}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-projects').waitFor({ state: 'visible' }); await page.evaluate(() => refreshProjects());
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
}

async function verifyPausedJob(page, label) {
  await navigate(page, 'plan');
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
  assert.equal(await page.locator('#personal-task-title').inputValue(), editedTitle);
  assert.match(await page.locator('#personal-task-form').innerText(), new RegExp(`Redigerer revision ${task.revision}`),
    `${label}: recovered task edit stays bound to the original revision`);
  await page.locator('#personal-task-outcome').fill('Et gennemgået lokalt resultat uden ekstern kontakt');
  await page.locator('#personal-task-uncertainty').fill('15');
  await page.locator('#personal-task-planned').fill('2030-11-06T09:30');
  await page.locator('#personal-task-locked').check();
  const edited = await uiWrite(page, 'PATCH', `/api/personal-tasks/${task.id}`,
    () => page.locator('#personal-task-form button[type="submit"]').click());
  assert.equal(edited.input.expectedRevision, task.revision);
  assert.equal(edited.body.task.title, editedTitle);
  assert.equal(edited.body.task.lockedStart, '2030-11-06T08:30:00.000Z', `${label}: local time uses Copenhagen, not the browser host timezone`);
  assert.equal(edited.body.task.plannedStart, edited.body.task.lockedStart);
  assert.match(await taskCard.innerText(), /Låst lokal placering/);

  await page.locator('#personal-task-title').fill(`Ny lokal placering ${label}`);
  await page.locator('#personal-task-purpose').fill('Kontrollér lokale placeringer uden Google-skrivning');
  const second = await uiWrite(page, 'POST', '/api/personal-tasks',
    () => page.locator('#personal-task-form button[type="submit"]').click(), [201]);
  const secondId = second.body.task.id;
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
  const desktop = width > 850;
  assert.equal(await page.locator('.tab-nav > a[data-tab="meals"] .nav-title:visible').innerText(), desktop ? 'Mad og indkøb' : 'Mad');
  assert.equal(await page.locator('.tab-nav > a[data-tab="knowledge"] .nav-title:visible').innerText(), desktop ? 'Min viden' : 'Viden');
  await page.locator('.tab-nav > a[data-tab="home"]').focus();
  for (const view of (desktop ? ['plan', 'meals', 'knowledge', 'smart-home', 'projects', 'settings'] : ['plan', 'meals', 'knowledge'])) {
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(`.tab-nav > a[data-tab="${view}"]`).evaluate(element => document.activeElement === element), true,
      `${label}: keyboard navigation must reach ${view} in visible sidebar order`);
    evidence.keyboard.push(view);
  }
  if (!desktop) {
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#more-toggle').evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#more-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#more-menu a[data-tab="smart-home"]').evaluate(element => document.activeElement === element), true,
      `${label}: the expanded More menu must be keyboard reachable`);
    await page.locator('#more-toggle').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#more-toggle').getAttribute('aria-expanded'), 'false');
    evidence.keyboard.push('more-open', 'more-first-link', 'more-close');
  }
  await page.locator('.tab-nav > a[data-tab="meals"]').focus(); await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).searchParams.get('view'), 'meals', `${label}: Enter activates the real meals route`);
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
    { name: 'Aktiv navigation', selector: '.tab-nav > a[data-tab="meals"]', kind: 'text' },
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
      ['home', '#message', 'Besked til JARVIS'], ['plan', '#personal-task-title', 'Hvad vil du nå?'], ['meals', '#meal-adults', 'Voksne som standard'],
      ['knowledge', '#knowledge-query', 'Hvad vil du finde?'], ['projects', '#project-title', 'Nyt projekt'], ['settings', '#preferences', 'Hukommelsesnoter'],
    ]) {
      await navigate(page, view);
      await page.locator(`#tab-${view}`).waitFor({ state: 'visible' });
      assert.equal(await page.getByLabel(labelText, { exact: true }).isVisible(), true,
        `${label}: the reflowed ${view} control retains its exact accessible label`);
      const input = page.locator(control); await input.scrollIntoViewIfNeeded(); await input.focus();
      const layout = await page.evaluate(selector => {
        const input = document.querySelector(selector); const rect = input.getBoundingClientRect();
        const bar = document.querySelector('.tab-nav').getBoundingClientRect();
        return { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
          input: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, navTop: bar.top,
          overflow: [...document.querySelectorAll('body *')].filter(node => node.getClientRects().length)
            .map(node => ({ tag: node.tagName, id: node.id, className: String(node.className), right: node.getBoundingClientRect().right }))
            .filter(node => node.right > document.documentElement.clientWidth + 2).slice(0, 15) };
      }, control);
      evidence.reflow.push({ view, labelText, ...reduced, ...layout });
      assert.ok(layout.scrollWidth <= layout.width + 2,
        `${label}: ${evidence.reflowMethod} overflows in ${view}: ${JSON.stringify(layout)}`);
      assert.ok(layout.input.left >= -1 && layout.input.right <= layout.width + 1 && layout.input.top >= -1 && layout.input.bottom <= layout.navTop + 1,
        `${label}: ${control} must remain reachable and not obscured by mobile navigation`);
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
  await page.locator('[data-tab="meals"]').first().click();
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

  await page.locator('[data-tab="knowledge"]').first().click();
  await page.locator('#memory-editor-mode').selectOption('note');
  const memoryDraft = await page.locator('#memory-workbench-text').inputValue();
  await page.locator('#knowledge-query').fill(`Husstand ${day}`);
  await page.locator('#knowledge-search-form button[type="submit"]').click();
  const householdSource = page.locator('.knowledge-result').filter({ hasText: day }).first();
  await householdSource.getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('source'), `household:${day}`);
  await page.locator(`[data-household-date="${day}"].source-target`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#meal-family-start').inputValue(), day);
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'knowledge');
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
  assert.equal(new URL(page.url()).searchParams.get('view'), 'knowledge');
  assert.equal(await page.locator('#knowledge-query').inputValue(), recipeTitle,
    `${label}: returning after a source reload restores the original search context`);
  assert.equal(await page.locator('#memory-workbench-text').inputValue(), memoryDraft);
  await page.locator('[data-tab="meals"]').first().click();
  await page.evaluate(() => refreshMeals());
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  assert.equal(horizontalOverflow, false, `${label}: structured editors must fit the ${width} × ${height} viewport`);
}

async function runDevice(type, width, height, label) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
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
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await signIn(page);
  for (const view of ['home', 'plan', 'meals', 'knowledge', 'smart-home', 'projects', 'settings']) {
    assert.equal(await page.locator(`#tab-${view}`).count(), 1, `${label}: missing view ${view}`);
  }
  await page.locator('#tab-home .chat-panel').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tab-home .hero-panel h1').innerText(), /dig, Christopher/,
    `${label}: the Danish greeting lost its word spacing`);
  const moreDetails = page.locator('#home-more-details');
  assert.equal(await moreDetails.evaluate(element => element.open), false, `${label}: detailed status must not crowd the initial Today view`);
  assert.equal(await page.locator('#home-system-health').isVisible(), false);
  await openDetails(moreDetails);
  await page.locator('#home-system-health p').filter({ hasText: 'JARVIS online' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#home-system-health h2').textContent(), 'Systemtilstand');
  await page.locator('#home-smart-home h3').waitFor({ state: 'visible' });
  assert.match(await page.locator('#home-smart-home h3').textContent(), /Smart hjem/);
  await moreDetails.locator(':scope > summary').click();
  assert.equal(await moreDetails.evaluate(element => element.open), false);
  assert.equal(await page.locator('#message').isVisible(), true, `${label}: message input hidden`);
  const composerBottom = await page.locator('#message').evaluate(el => el.getBoundingClientRect().bottom);
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-initial-home.png`), animations: 'disabled' });
  assert.ok(composerBottom < height, `${label}: chat input below first screen (${composerBottom}px)`);
  await verifyHistory(page, label);
  const topNav = page.locator('.tab-nav > a[data-tab="plan"]');
  await topNav.click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'plan');
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'home');
  assert.equal(await page.locator('#tab-home').isVisible(), true);

  await topNav.click();
  await page.locator('#personal-task-title').fill(`Syntetisk personlig opgave ${label}`);
  await page.locator('#personal-task-purpose').fill('Verificér den separate planlægningsarbejdsgang');
  const createdTask = await uiWrite(page, 'POST', '/api/personal-tasks',
    () => page.locator('#personal-task-form button[type="submit"]').click(), [201]);
  await page.locator(`[data-personal-task-id="${createdTask.body.task.id}"]`).waitFor({ state: 'visible' });
  await page.locator('#follow-up-awaiting').fill(`Afvent syntetisk svar ${label}`);
  await page.locator('#follow-up-check').fill('2026-11-07T12:00');
  await page.locator('#follow-up-stop').fill('Når svaret er modtaget');
  const createdFollowUp = await uiWrite(page, 'POST', '/api/follow-ups',
    () => page.locator('#follow-up-form button[type="submit"]').click(), [201]);
  await page.locator(`[data-follow-up-id="${createdFollowUp.body.case.id}"]`).waitFor({ state: 'visible' });
  await verifyPlanning(page, label, createdTask.body.task, createdFollowUp.body.case);
  assert.deepEqual(jobWrites, [], `${label}: independent personal planning/follow-up must not create or activate jobs`);
  const pausedJobId = await verifyPausedJob(page, label);
  await verifyProjectDrafts(page, label);

  if (width > 850) await page.locator('.tab-nav > a[data-tab="settings"]').click();
  else {
    await page.locator('#more-toggle').click();
    await page.locator('#more-menu a[data-tab="settings"]').click();
  }
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
  await page.locator('[data-tab="knowledge"]').first().click();
  await page.locator('#tab-knowledge').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#memory-workbench-form').isVisible(), true,
    `${label}: the unified knowledge editor must open with legacy notes available`);
  assert.equal(await page.locator('#personal-claim-form').isVisible(), false,
    `${label}: there must not be two simultaneously visible memory creation forms`);
  await page.locator('#memory-workbench-text').fill(`Syntetisk ugemt hukommelseskladde ${label}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#tab-knowledge').waitFor({ state: 'visible' });
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
  await page.locator('#personal-claim-form button').click();
  const createdClaim = page.locator('[data-claim-id]').filter({ hasText: subject }).first();
  await createdClaim.waitFor({ state: 'visible' });
  await createdClaim.getByRole('button', { name: 'Bekræft oplysning' }).click();
  await createdClaim.getByText('Bekræftet af dig').waitFor({ state: 'visible' });
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
  await page.locator('#tab-knowledge').screenshot({ path: join(screenshotDir, `${label}-knowledge.png`), animations: 'disabled' });
  await verifyHouseholdAndSources(page, width, height, label);
  await verifyAccessibility(page, width, height, label);
  assert.deepEqual(basketMutations, [], `${label}: planning, imports, polling and source/draft navigation must request zero basket writes or transfer intents`);
  assert.deepEqual(prohibitedPlanningActivations, [], `${label}: the local planning flow cannot activate jobs, messages or calendar writes`);
  assert.deepEqual(jobWrites.map(item => ({ path: item.path, method: item.method, activation: item.body.activation })), [
    { path: '/api/tasks', method: 'POST', activation: 'paused' }, { path: `/api/tasks/${pausedJobId}`, method: 'PATCH', activation: 'paused' },
  ], `${label}: the additional job-editor flow may only create/edit its one synthetic paused job`);
  assert.deepEqual(projectWrites, [{ path: '/api/projects', method: 'POST' }], `${label}: project draft review may only create its one empty synthetic local project`);
  assert.deepEqual(prohibitedCodeActions, [], `${label}: project/approval views cannot generate code, run an installer/test or apply code`);
  await page.locator('[data-tab="home"]').first().click();
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-home.png`), animations: 'disabled' });
  await context.close();
  return `${label}: navigation, compact Today/history pagination, personal task edit/lock/local placement, unknown-capacity guard, follow-up unknown/snooze/cancel, paused job policy edits, project/form drafts without model activity, household precedence/guests/holiday/absence/portions, structured drafts, revision conflicts, exact source return, keyboard focus, selected contrast/reflow and first-screen composer passed`;
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
  reports.push(await runDevice('chromium', 1390, 950, 'desktop'));
  reports.push(await runDevice('chromium', 390, 844, 'mobile'));
  await browser.close(); browser = undefined;
  if (existsSync(webkit.executablePath())) {
    browser = await webkit.launch({ headless: true });
    reports.push(await runDevice('webkit', 1390, 950, 'webkit-desktop'));
    reports.push(await runDevice('webkit', 390, 844, 'webkit-mobile'));
  } else if (process.env.JARVIS_REQUIRE_WEBKIT === 'yes') throw new Error('WebKit is required by the v5 CI gate, but its binary is absent.');
  else reports.push('WebKit: PENDING; browser binary unavailable in this development environment');
  assert.deepEqual(errors, [], 'browser runtime errors');
  assert.deepEqual(await publicAssetHashes(), initialAssetHashes, 'public assets changed while browser evidence was being collected');
  console.log(reports.join('\n'));
  console.log(`Synthetic screenshots: ${screenshotDir}`);
} finally {
  try {
    const finalAssetHashes = await publicAssetHashes();
    await writeFile(join(screenshotDir, 'accessibility-report.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), candidateRevision: process.env.GITHUB_SHA || null,
      publicAssetHashes: initialAssetHashes, assetsUnchangedDuringRun: JSON.stringify(initialAssetHashes) === JSON.stringify(finalAssetHashes),
      reports: accessibilityReports, limitations: ['Selected computed-style checks are not a full accessibility certification.',
        'Reduced CSS viewports do not replace manual browser zoom or physical iPhone/desktop acceptance.'],
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}
