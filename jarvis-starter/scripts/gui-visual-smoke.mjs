// Exact-candidate GUI browser evidence. Run in the pinned CI browser image.
// All mutations are synthetic responses; outside origins are denied. The deep
// v5 smoke separately tests real writes to a disposable local application.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from '../test/helpers/synthetic-env.mjs';
import { createGuiFixture, GUI_IDS, GUI_NOW, GUI_STATES, GUI_WIDTHS, GUI_ZONE } from './fixtures/gui-redesign.mjs';
import { guiIdentity, publicAssetHashes } from './gui-evidence.mjs';
import { renderedAccessibilityReport } from './ui-accessibility.mjs';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require('playwright');
const playwrightVersion = require('playwright/package.json').version;
assert.equal(playwrightVersion, '1.64.1', 'Browser evidence requires the pinned test package.');
const app = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(process.env.JARVIS_GUI_ARTIFACT_DIR || join(app, 'artifacts/gui/browser'));
await mkdir(artifacts, { recursive: true });
const identity = await guiIdentity();
const initialAssets = identity.publicAssetHashes;
const report = { ...identity, playwrightVersion, fixtureNow: GUI_NOW, timeZone: GUI_ZONE,
  widths: [...GUI_WIDTHS], states: [...GUI_STATES], browsers: [], cases: [], failures: [],
  status: 'running', limitations: [
    'Fixture responses test GUI behavior, not real integrations, prices or AI responses.',
    'A reduced available viewport is not a physical OS keyboard or device safe-area measurement.',
    'Measured sample contrast and keyboard paths are not a complete accessibility certification.',
    'The independent deep v5 browser smoke and full Node suite must also be reviewed.',
  ] };
const saveReport = () => writeFile(join(artifacts, 'gui-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await saveReport();

const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-gui-browser-'));
const token = 'gui-fixture-only-synthetic-owner-access';
const socket = createServer();
await new Promise((yes, no) => { socket.once('error', no); socket.listen(0, '127.0.0.1', yes); });
const port = socket.address().port;
await new Promise(resolveClose => socket.close(resolveClose));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { cwd: app,
  env: syntheticServerEnv({ dataDir, accessToken: token, port }), stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', value => { serverLog = (serverLog + value).slice(-10000); });

async function waitText(page, selector, pattern) {
  await page.waitForFunction(({ selector, pattern }) => new RegExp(pattern, 'iu').test([...document.querySelectorAll(selector)].map(element => element.textContent).join('\n')),
    { selector, pattern: pattern.source });
}

async function closePanels(page) {
  if (await page.locator('#tab-knowledge').isVisible()) await page.locator('#global-search-close').click();
  if (await page.locator('#global-chat-panel').isVisible()) await page.locator('#global-chat-close').click();
}

async function navigate(page, view, section, kind) {
  await closePanels(page);
  await page.locator(`a[data-tab="${view}"]:visible`).first().click();
  if (section) await page.locator(`button[data-${view === 'plan' ? 'plan' : 'settings'}-tab="${section}"]`).click();
  if (kind) await page.locator(`[data-task-filter="${kind}"]`).click();
  await page.locator(`#tab-${view}`).waitFor({ state: 'visible' });
  if (section) {
    const id = view === 'plan' ? section === 'meals' ? 'tab-meals' : `plan-${section}` : `settings-${section}`;
    await page.locator(`#${id}`).waitFor({ state: 'visible' });
  }
}

async function openDetails(page, id) {
  const details = page.locator(`#${id}`);
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
}

async function layout(page, evidence, name, screenshot = true) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); });
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const visible = element => Boolean(element.getClientRects().length);
    const primary = [...document.querySelectorAll('.gui-nav-primary a[data-tab]')].filter(visible).map(element => {
      const rect = element.getBoundingClientRect();
      return { view: element.dataset.tab, text: element.innerText.trim(), width: rect.width, height: rect.height,
        left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    return { width, scrollWidth: document.documentElement.scrollWidth, primary,
      visibleMain: [...document.querySelectorAll('.tab-view')].filter(visible).map(element => element.id),
      localNavigation: [...document.querySelectorAll('.gui-subnav,.gui-settings-nav')].filter(visible).map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      }),
      overflow: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible)
        .filter(element => !element.closest('.gui-subnav,.gui-settings-nav')).map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.id, tag: element.tagName, left: rect.left, right: rect.right };
      }).filter(element => element.right > width + 2 || element.left < -2).slice(0, 15) };
  });
  evidence.layouts.push({ name, ...result });
  assert.ok(result.scrollWidth <= result.width + 2, `${name}: horizontal document overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.primary.map(link => link.view), ['home', 'plan', 'smart-home', 'watches']);
  assert.equal(await page.locator('.tab-nav a[data-tab="settings"]:visible, .gui-mobile-settings:visible').count(), 1,
    `${name}: secondary settings stays directly reachable`);
  for (const link of result.primary) {
    assert.ok(link.width >= 44 && link.height >= 44, `${name}: primary target smaller than 44 CSS px: ${JSON.stringify(link)}`);
    assert.ok(link.left >= -1 && link.right <= result.width + 1, `${name}: clipped primary navigation`);
    assert.ok(link.scrollWidth <= link.clientWidth + 2, `${name}: primary label is clipped: ${link.text}`);
  }
  assert.equal(result.visibleMain.length, 1, `${name}: exactly one primary view is visible`);
  for (const nav of result.localNavigation)
    assert.ok(nav.left >= -1 && nav.right <= result.width + 1, `${name}: a local navigation scroll container exceeds the viewport`);
  assert.deepEqual(result.overflow, [], `${name}: visible controls must fit horizontally`);
  assert.doesNotMatch(await page.locator('#workspace').innerText(), /\b(?:undefined|NaN)\b/, `${name}: incomplete fixture or undefined rendering`);
  if (screenshot) await page.screenshot({ path: join(artifacts, `${evidence.label}-${name}.png`), fullPage: true, animations: 'disabled' });
}

async function reachable(page, selector) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded(); await target.focus();
  const result = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const atPoint = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight, unobscured: element === atPoint || element.contains(atPoint), focused: document.activeElement === element };
  });
  assert.ok(result.left >= -1 && result.right <= result.width + 1 && result.top >= -1 && result.bottom <= result.height + 1 && result.unobscured && result.focused,
    `${selector}: control is obscured or unreachable: ${JSON.stringify(result)}`);
  return result;
}

async function navigationAndContext(page, fixture, evidence) {
  const sourceId = `organizer:${GUI_IDS.collection}:${GUI_IDS.item}`;
  await page.goto(`${origin}/?view=knowledge&source=${encodeURIComponent(sourceId)}&filter=mine`, { waitUntil: 'domcontentloaded' });
  const target = page.locator(`[data-organizer-item-id="${GUI_IDS.collection}:${GUI_IDS.item}"].source-target`);
  await target.waitFor({ state: 'visible' });
  let url = new URL(page.url());
  assert.equal(url.searchParams.get('view'), 'plan'); assert.equal(url.searchParams.get('section'), 'notes');
  assert.equal(url.searchParams.get('source'), sourceId); assert.equal(url.searchParams.get('filter'), 'mine');
  assert.equal(await page.locator('#tab-knowledge').isVisible(), false, 'old exact-source URL must not open an obstructing search overlay');
  await navigate(page, 'watches'); await page.goBack(); await target.waitFor({ state: 'visible' });
  await page.goForward(); await page.locator('#tab-watches').waitFor({ state: 'visible' });
  await page.goBack(); await page.reload({ waitUntil: 'domcontentloaded' }); await target.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).searchParams.get('source'), sourceId);

  await page.locator('#global-search-open').click(); await page.locator('#knowledge-query').fill('gave');
  await page.locator('#knowledge-search-form button[type="submit"]').click();
  await page.locator('.knowledge-result').getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  await target.waitFor({ state: 'visible' }); await page.goBack();
  await page.locator('#tab-knowledge').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).searchParams.get('panel'), 'search');
  assert.equal(await page.locator('#knowledge-query').inputValue(), 'gave');
  await page.locator('.knowledge-result').getByRole('button', { name: 'Åbn kilde', exact: true }).click();
  await target.waitFor({ state: 'visible' });
  evidence.checks.push('T01/T02/T09: exact old source, back/forward/reload and search return');

  await page.locator('#global-chat-open').click();
  await page.locator('#chat-attach-context').click();
  const attached = await page.locator('#chat-context-label').innerText();
  assert.ok(attached.includes(sourceId), 'attached context must identify the original object');
  await page.locator('#message').fill('Gennemgå denne syntetiske note');
  fixture.holdMessage = true;
  await page.locator('#send').click();
  const submitted = await fixture.waitForMessage();
  assert.deepEqual(Object.keys(submitted), ['message']);
  assert.ok(submitted.message.includes(`[Kilde-ID: ${sourceId}]`));
  assert.ok(submitted.message.endsWith('Gennemgå denne syntetiske note'));
  await page.locator('#global-chat-close').click();
  await navigate(page, 'watches'); await page.locator('#global-chat-open').click();
  assert.equal(await page.locator('#chat-context-label').innerText(), attached);
  await page.locator('#message').fill('Nyere kladde mens svaret er på vej');
  fixture.releaseMessage();
  await waitText(page, '#chat-draft-status', /nyere kladde er bevaret/);
  assert.equal(await page.locator('#message').inputValue(), 'Nyere kladde mens svaret er på vej');
  await waitText(page, '#messages', /Syntetisk forsinket svar/);
  await page.locator('#chat-context-clear').click();
  assert.equal(await page.locator('#message').inputValue(), 'Nyere kladde mens svaret er på vej');
  assert.equal(await page.locator('#messages .bubble').count(), 2);
  await page.locator('#global-chat-close').click();
  await navigate(page, 'home');
  assert.equal(await page.locator('#message').inputValue(), 'Nyere kladde mens svaret er på vej');
  assert.equal(await page.locator('#message').count(), 1, 'global and home chat share one composer');
  evidence.checks.push('T10/T11: fixed outgoing context, delayed response, newer draft and explicit context removal');
}

async function verifyCase(browser, engine, width, mode) {
  const label = `${engine}-${width}-${mode}`;
  const evidence = { label, engine, width, height: 850, mode, status: 'running', checks: [], layouts: [], runtimeErrors: [],
    forbiddenWrites: [], externalRequests: [], assetErrors: [] };
  report.cases.push(evidence);
  const fixture = await createGuiFixture(mode);
  const context = await browser.newContext({ viewport: { width, height: evidence.height }, locale: 'da-DK',
    timezoneId: GUI_ZONE, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: width < 768 });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { evidence.externalRequests.push({ method: request.method(), origin: url.origin }); return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body;
    if (request.postData()) { try { body = request.postDataJSON(); } catch { body = request.postData(); } }
    const response = await fixture.response(request.method(), url, body);
    if (response) return route.fulfill(response);
    if (['GET', 'HEAD'].includes(request.method())) return route.continue();
    evidence.forbiddenWrites.push({ method: request.method(), path: url.pathname });
    return route.fulfill({ status: 403, json: { error: 'This GUI fixture does not allow real writes.' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => evidence.runtimeErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('response', response => { const url = new URL(response.url());
    if (url.origin === origin && !url.pathname.startsWith('/api/') && response.status() >= 400)
      evidence.assetErrors.push({ path: url.pathname, status: response.status() }); });
  await page.clock.setFixedTime(new Date(GUI_NOW));
  await page.addInitScript(value => localStorage.setItem('jarvisAccessToken', value), token);
  try {
    await page.goto(`${origin}/?view=home`, { waitUntil: 'domcontentloaded' });
    await page.locator('#workspace').waitFor({ state: 'visible' });
    if (mode === 'error') {
      await waitText(page, '#today-read-status', /kunne ikke opdateres.*Syntetisk dagsoversigt/);
      assert.equal(await page.locator('#today-calendar [data-agenda-source-id]').count(), 0);
      await page.locator('#chat-readiness').waitFor({ state: 'visible' });
      assert.match(await page.locator('#chat-readiness').innerText(), /API|forbindelse|opsæt/);
    } else {
      await page.locator('#today-calendar').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#home-intelligence > [data-today-section]').count(), 3);
      if (mode === 'normal') {
        assert.match(await page.locator('#today-calendar').innerText(), /Hent børn/);
        assert.equal(await page.locator('#today-calendar [data-agenda-source-id]').count(), 1);
      } else {
        assert.match(await page.locator('#today-calendar').innerText(), /Ingen registrerede aftaler i den dækkede periode/);
        assert.equal(await page.locator('#today-calendar [data-agenda-source-id]').count(), 0);
      }
    }
    assert.equal(await page.locator('#system-health-details').isVisible(), false);
    assert.equal(await page.locator('#message').isVisible(), true);
    await layout(page, evidence, 'today');
    evidence.checks.push('T03/T12: distinct normal, successfully empty and unavailable Today states');

    await navigate(page, 'plan', 'tasks', 'personal');
    if (mode === 'normal') await page.locator(`[data-personal-task-id="${GUI_IDS.personal}"]`).waitFor({ state: 'visible' });
    else if (mode === 'empty') await waitText(page, '#personal-task-list', /Ingen/);
    else await waitText(page, '#personal-task-status', /fejl|kunne|syntetisk/);
    await layout(page, evidence, 'tasks');
    await navigate(page, 'plan', 'calendar');
    await waitText(page, '#calendar-read-status', mode === 'error' ? /ukendt|ikke dækket|kunne|forældet/ : /Kun læsning/);
    if (mode === 'normal') await page.locator('[data-calendar-event-id="synthetic-calendar-pickup"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#plan-calendar').getByRole('button', { name: /^(Opret|Redigér|Slet) (aftale|begivenhed)/ }).count(), 0);
    await layout(page, evidence, 'calendar');
    evidence.checks.push('T04/T15: cached read-only calendar, local dates and no calendar write controls');
    await navigate(page, 'plan', 'meals');
    if (mode === 'normal') await page.locator(`[data-record-key="plan:${GUI_IDS.mealPlan}"]`).waitFor({ state: 'visible' });
    await layout(page, evidence, 'meals');

    await navigate(page, 'watches');
    if (mode === 'normal') {
      const stale = page.locator(`[data-watch-id="${GUI_IDS.stale}"]`);
      await stale.waitFor({ state: 'visible' });
      assert.equal(await stale.getAttribute('data-watch-freshness'), 'stale');
      assert.match(await stale.innerText(), /Kontrol mislykkedes/); assert.match(await stale.innerText(), /Senest kendte pris.*3\.299/s);
      assert.equal(await stale.locator('a[href="https://example.invalid/robotstoevsuger"]').count(), 1);
      const active = page.locator(`[data-watch-id="${GUI_IDS.monitor}"]`);
      await active.locator('[data-task-action="pause"]').click();
      await page.waitForFunction(id => document.querySelector(`[data-watch-id="${id}"]`)?.dataset.watchOperation === 'paused', GUI_IDS.monitor);
      await active.locator('[data-task-action="resume"]').click();
      await page.waitForFunction(id => document.querySelector(`[data-watch-id="${id}"]`)?.dataset.watchOperation === 'scheduled', GUI_IDS.monitor);
      const changes = fixture.requests.filter(item => item.path === `/api/tasks/${GUI_IDS.monitor}/action`);
      assert.deepEqual(changes.map(item => item.body.expectedRevision), [3, 4]);
      assert.deepEqual(changes.map(item => item.body.action), ['pause', 'resume']);
      assert.equal(fixture.tasks.find(item => item.id === GUI_IDS.monitor).runs.length, 1, 'pause/resume does not fabricate observations');
    } else await waitText(page, '#watches-status, #watches-list', mode === 'empty' ? /Ingen overvågninger/ : /Syntetisk overvågningsfejl|kunne ikke/);
    await layout(page, evidence, 'watches');
    evidence.checks.push('T07/T12: monitor activity, result and freshness stay independent');

    await navigate(page, 'smart-home');
    await page.locator('[data-home-integration="nest"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-home-integration="nest"]').innerText(), /ikke implementeret/);
    if (mode === 'normal' && [390, 1024].includes(width)) {
      await page.locator('#smart-home-load-hue').click();
      const room = page.locator('[data-home-room="synthetic-room"]');
      await room.waitFor({ state: 'visible' });
      const on = room.getByRole('button', { name: 'Tænd', exact: true });
      await on.click(); await page.waitForFunction(() => document.querySelector('[data-home-service="hue"][data-action-state="completed"]'));
      fixture.homeOutcome = 'failure'; const off = room.getByRole('button', { name: 'Sluk', exact: true });
      await off.click(); await page.waitForFunction(() => document.querySelector('[data-home-service="hue"][data-action-state="unknown"]'));
      assert.match((await room.locator('[data-action-feedback]').allTextContents()).join('\n'), /ikke bekræftet|kunne|Syntetisk/i);
      evidence.checks.push('T06: explicitly mocked Hue success and failed confirmation; zero real device writes');
    }
    await layout(page, evidence, 'home');

    await navigate(page, 'settings', 'integrations');
    await page.locator('[data-integration-id="home-assistant"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-integration-id="home-assistant"]').innerText(), /ikke implementeret|forberedt/i);
    for (const section of ['profile', 'notifications', 'automations', 'system', 'device']) {
      await page.locator(`[data-settings-tab="${section}"]`).click();
      await page.locator(`#settings-${section}`).waitFor({ state: 'visible' });
      await layout(page, evidence, `settings-${section}`, section === 'system');
    }
    await page.locator('[data-settings-tab="system"]').click();
    await waitText(page, '#update-status', /testet|test|GitHub/i);
    assert.ok(await page.locator('#update-approve').isHidden() || await page.locator('#update-approve').isDisabled(), 'no tested target means no usable approval');
    evidence.checks.push('T04/T08: unsupported integrations and no approval without a tested target');

    if (mode === 'normal') {
      await navigationAndContext(page, fixture, evidence);
      await page.locator('.tab-nav a[data-tab="home"]:visible').focus();
      for (const view of ['plan', 'smart-home', 'watches']) {
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(`.tab-nav a[data-tab="${view}"]:visible`).evaluate(element => element === document.activeElement), true);
      }
      await navigate(page, 'home'); await page.locator('#message').focus();
      evidence.contrast = await page.evaluate(renderedAccessibilityReport, [
        { name: 'Composer', selector: '#message', kind: 'field' },
        { name: 'Composer focus', selector: '#message', kind: 'focus' },
        { name: 'Send', selector: '#send', kind: 'text' },
        { name: 'Primary navigation', selector: '.tab-nav a[data-tab="home"]', kind: 'text' },
      ]);
      for (const check of evidence.contrast.checks) {
        assert.equal(check.missing, undefined); assert.equal(check.visible, true); assert.equal(check.disabled, false);
        assert.equal(check.requiresManualReview, undefined); assert.ok(check.textRatio >= 4.5, JSON.stringify(check));
        if (check.kind === 'field') assert.ok(check.borderRatio >= 3 && check.borderWidth >= 1, JSON.stringify(check));
        if (check.kind === 'focus') assert.ok(check.focused && check.outlineRatio >= 3 && check.outlineWidth >= 2, JSON.stringify(check));
      }
      if (width <= 390) {
        await page.setViewportSize({ width, height: 420 });
        evidence.availableViewport = { kind: 'Synthetic reduced viewport, not an OS keyboard', width, height: 420,
          composer: await reachable(page, '#message'), send: await reachable(page, '#send') };
        await page.screenshot({ path: join(artifacts, `${label}-reduced-available-height.png`), animations: 'disabled' });
        await page.setViewportSize({ width, height: evidence.height });
      }
      evidence.checks.push('T12/T13/T14: computed contrast, primary keyboard order and reachable controls');
    }
    const prohibited = fixture.requests.filter(item => item.method !== 'GET' &&
      (/^\/api\/(?:google\/calendar|updates|projects|code|nemlig|notifications|discord)/.test(item.path)));
    assert.deepEqual(prohibited, [], 'GUI reads and draft navigation cannot request unrelated effects');
    assert.deepEqual(evidence.forbiddenWrites, []); assert.deepEqual(evidence.externalRequests, []);
    assert.deepEqual(evidence.assetErrors, []); assert.deepEqual(evidence.runtimeErrors, []);
    evidence.requestHash = createHash('sha256').update(JSON.stringify(fixture.requests)).digest('hex');
    evidence.requestCount = fixture.requests.length; evidence.status = 'passed';
    console.log(`${label}: PASS (${evidence.checks.length} checked flows)`);
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.stack || String(error);
    report.failures.push({ label, error: error.message });
    await page.screenshot({ path: join(artifacts, `${label}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
    console.error(`${label}: FAIL ${error.message}`);
  } finally {
    fixture.releaseMessage();
    await writeFile(join(artifacts, `${label}-requests.json`), `${JSON.stringify(fixture.requests, null, 2)}\n`);
    await context.tracing.stop({ path: join(artifacts, `${label}-trace.zip`) });
    await context.close(); await saveReport();
  }
}

try {
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) throw new Error(`Synthetic server exited: ${serverLog}`);
    try { ready = (await fetch(`${origin}/health`)).ok; } catch { /* Initial startup only. */ }
    if (ready) break;
    await delay(100);
  }
  assert.equal(ready, true, `Synthetic server failed to start: ${serverLog}`);
  for (const [name, type] of Object.entries({ chromium, webkit })) {
    let browser;
    try {
      assert.ok(existsSync(type.executablePath()), `${name} binary missing from the pinned image`);
      browser = await type.launch({ headless: true });
      report.browsers.push({ name, version: browser.version() });
      for (const width of GUI_WIDTHS) for (const mode of GUI_STATES) await verifyCase(browser, name, width, mode);
    } catch (error) { report.failures.push({ label: `${name}-runner`, error: error.stack || String(error) }); }
    finally { await browser?.close(); }
  }
} catch (error) {
  report.failures.push({ label: 'runner', error: error.stack || String(error) });
} finally {
  const finalAssets = await publicAssetHashes();
  report.assetsUnchangedDuringRun = JSON.stringify(finalAssets) === JSON.stringify(initialAssets);
  if (!report.assetsUnchangedDuringRun) report.failures.push({ label: 'candidate-identity', error: 'Public assets changed while collecting browser evidence.' });
  if (report.cases.length !== GUI_WIDTHS.length * GUI_STATES.length * 2)
    report.failures.push({ label: 'matrix-completeness', error: `Expected 36 cases, observed ${report.cases.length}.` });
  report.status = report.failures.length ? 'failed' : 'passed'; report.finishedAt = new Date().toISOString();
  await saveReport(); await writeFile(join(artifacts, 'synthetic-server.log'), serverLog);
  if (server.exitCode === null) server.kill('SIGTERM');
  await Promise.race([new Promise(done => server.exitCode !== null ? done() : server.once('exit', done)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, candidateCommit: identity.candidateCommit,
  passed: report.cases.filter(item => item.status === 'passed').length, cases: report.cases.length, failures: report.failures.length, artifacts }));
if (report.failures.length) process.exitCode = 1;
