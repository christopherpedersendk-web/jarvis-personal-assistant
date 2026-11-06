import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from '../test/helpers/synthetic-env.mjs';
import { browserNetworkFixture } from '../test/helpers/browser-network.mjs';
import { renderedAccessibilityReport } from './ui-accessibility.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'jarvis-v51-smoke-'));
const artifacts = resolve(root, 'artifacts/gui/v51'); await mkdir(artifacts, { recursive: true });
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port;
await new Promise(r => probe.close(r));
const credential = 'synthetic-v51-control-owner-token', origin = `http://127.0.0.1:${port}`;
let child, browser, logs = '';
const report = { at: new Date().toISOString(), playwrightVersion: require('playwright/package.json').version, status: 'running', checks: [], scope: 'Disposable server, synthetic data, Chromium. No physical iPhone, paid model, or production access.' };
async function start() {
  child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(browserNetworkFixture)}`, 'server.mjs'], { cwd: root, env: syntheticServerEnv({ dataDir: dir, accessToken: credential, port }), stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { logs = (logs + String(b)).slice(-3000); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/health', { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    if (child.exitCode !== null) break; await delay(50);
  }
  throw new Error('Synthetic server did not start: ' + logs);
}
async function stop() {
  if (child && child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
}
async function api(path, body, expected = 200, auth = true) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, expected); assert.match(response.headers.get('x-jarvis-request-id'), /^[0-9a-f-]{36}$/); return response.json();
}
try {
  await start();
  await api('/api/assistant/control', undefined, 401, false); report.checks.push('unauthenticated access rejected');
  const call = { name: 'create_personal_task', callId: 'synthetic-once', args: { title: 'Syntetisk opgave', purpose: 'Kontrollér fælles udførelse', durationMinutes: 15 } };
  const first = await api('/api/assistant/tool', call);
  const second = await api('/api/assistant/tool', call); assert.equal(second.alreadyRecorded, true);
  assert.equal((await api('/api/personal-tasks')).tasks.length, 1); report.checks.push('real HTTP execution is deduplicated');
  await api('/api/assistant/control', { stopped: true }); await stop(); await start();
  assert.equal((await api('/api/assistant/control')).stopped, true);
  await api('/api/assistant/tool', { ...call, callId: 'blocked-call' }, 409);
  assert.equal((await api('/api/personal-tasks')).tasks.length, 1); report.checks.push('stop survives restart and prevents a new tool effect');
  await api('/api/assistant/control', { stopped: false });
  await api('/api/assistant/tool', { name: 'complete_personal_task', callId: 'complete-once', args: { id: first.task.id, expectedRevision: 1 } });
  assert.equal((await api('/api/assistant/tool', { name: 'get_weekly_review', args: {} })).openTasks.length, 0);
  report.checks.push('completion is visible in the weekly review');
  await api('/api/browser/sites', { origins: ['https://restaurant.example.org'], expectedRevision: 1 });
  browser = await chromium.launch({ headless: true, ...(process.env.JARVIS_TEST_CHROMIUM ? { executablePath: process.env.JARVIS_TEST_CHROMIUM } : {}) });
  report.browserVersion = browser.version();
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.addInitScript(value => localStorage.setItem('jarvisAccessToken', value), credential);
    await page.goto(origin + '/?view=settings&section=system');
    await page.locator('a[data-tab="settings"]:visible').first().click();
    await page.locator('[data-settings-tab="system"]').click();
    await page.locator('#assistant-control-refresh').click();
    await page.waitForFunction(() => document.getElementById('assistant-control-status').textContent.startsWith('Aktiv'));
    await page.locator('#assistant-control-stop').click();
    await page.waitForFunction(() => document.getElementById('assistant-control-status').textContent.startsWith('Stoppet'));
    await page.locator('#assistant-control-resume').click();
    await page.waitForFunction(() => document.getElementById('assistant-control-status').textContent.startsWith('Aktiv'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `control-${width}.png`), fullPage: true });
    await page.locator('a[data-tab="plan"]:visible').first().click();
    await page.locator('[data-plan-tab="web"]').click();
    await page.waitForFunction(() => document.getElementById('web-status').textContent.includes('1 godkendte websites'));
    await page.locator('#web-url').fill(`https://restaurant.example.org/menu/${width}`);
    await page.locator('#web-read-form button').click();
    await page.locator('#web-read-confirm').click();
    await page.waitForFunction(expected => document.querySelector('#web-reads article')?.textContent.includes(expected)
      && document.querySelector('#web-reads article .web-excerpt'), `/menu/${width}`);
    await page.locator('#web-reads details summary').first().click();
    const contrast = await page.evaluate(renderedAccessibilityReport, [{ name: 'Web excerpt', selector: '.web-excerpt', kind: 'text' }]);
    for (const check of contrast.checks) { assert.equal(check.visible, true); assert.equal(check.requiresManualReview, undefined); assert.ok(check.textRatio >= 4.5, JSON.stringify(check)); }
    report.checks.push(`web excerpt ${width}px: measured text contrast at least 4.5:1`);
    await page.getByRole('button', { name: 'Forbered lokal kladde', exact: true }).first().click();
    await page.locator('#web-draft-title').fill(`Syntetisk middag ${width}`);
    await page.locator('#web-draft-details').fill('To personer fredag kl. 18.');
    await page.locator('#web-draft-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('web-draft-form').classList.contains('hidden'));
    assert.ok((await page.locator('#web-drafts').innerText()).includes('Ikke sendt'));
    await page.locator('#web-drafts').getByRole('button', { name: 'Redigér', exact: true }).first().click();
    await page.locator('#web-draft-details').fill('Tre personer fredag kl. 18.');
    await page.locator('#web-draft-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('web-draft-form').classList.contains('hidden'));
    assert.ok((await page.locator('#web-drafts').innerText()).includes('Tre personer'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `web-${width}.png`), fullPage: true });
    await page.locator('#web-drafts').getByRole('button', { name: 'Slet lokal kladde', exact: true }).first().click();
    await page.waitForFunction(() => document.getElementById('web-drafts').children.length === 0);
    report.checks.push(`web UI ${width}px: preview, isolated fixture read, create/edit/delete local draft, no horizontal overflow`);
    await context.close(); report.checks.push(`control UI ${width}px: read, stop, resume, no horizontal overflow`);
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.message).slice(0, 2000); process.exitCode = 1; }
finally { await browser?.close(); await stop(); await rm(dir, { recursive: true, force: true }); await writeFile(join(artifacts, 'control-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
