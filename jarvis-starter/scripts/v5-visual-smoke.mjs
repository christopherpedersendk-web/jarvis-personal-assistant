// Local v5 UI smoke test. Uses an isolated fixture and blocks outside origins.
// No real credentials, personal state, Google/Discord calls or Nemlig writes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium, webkit } = createRequire(import.meta.url)('playwright');
const token = 'v5-local-visual-smoke-synthetic-access';
const app = new URL('../', import.meta.url).pathname;
const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v5-ui-'));
const screenshotDir = process.env.JARVIS_V5_ARTIFACT_DIR || dataDir;
await mkdir(screenshotDir, { recursive: true });
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

async function runDevice(type, width, height, label) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await signIn(page);
  for (const view of ['home', 'plan', 'meals', 'knowledge', 'smart-home', 'projects', 'settings']) {
    assert.equal(await page.locator(`#tab-${view}`).count(), 1, `${label}: missing view ${view}`);
  }
  await page.locator('#tab-home .chat-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#message').isVisible(), true, `${label}: message input hidden`);
  const composerBottom = await page.locator('#message').evaluate(el => el.getBoundingClientRect().bottom);
  assert.ok(composerBottom < height, `${label}: chat input below first screen (${composerBottom}px)`);
  const topNav = page.locator('.tab-nav > a[data-tab="plan"]');
  await topNav.click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'plan');
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'home');
  assert.equal(await page.locator('#tab-home').isVisible(), true);

  await topNav.click();
  await page.locator('#personal-task-title').fill('Syntetisk personlig opgave');
  await page.locator('#personal-task-purpose').fill('Verificér den separate planlægningsarbejdsgang');
  await page.locator('#personal-task-form button').click();
  await page.locator('[data-personal-task-id]').first().waitFor({ state: 'visible' });
  await page.locator('#follow-up-awaiting').fill('Afvent syntetisk svar');
  await page.locator('#follow-up-check').fill('2026-11-07T12:00');
  await page.locator('#follow-up-stop').fill('Når svaret er modtaget');
  await page.locator('#follow-up-form button').click();
  await page.locator('[data-follow-up-id]').first().waitFor({ state: 'visible' });

  if (width > 850) await page.locator('.tab-nav > a[data-tab="settings"]').click();
  else {
    await page.locator('#more-toggle').click();
    await page.locator('#more-menu a[data-tab="settings"]').click();
  }
  await page.locator('#preferences').fill('Lokalt udkast: mine noter må ikke forsvinde');
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('#preferences').inputValue(), 'Lokalt udkast: mine noter må ikke forsvinde');
  assert.match(await page.locator('#preferences-draft-status').textContent(), /Ikke gemt/);

  await page.locator('#tab-settings').screenshot({ path: join(screenshotDir, `${label}-settings.png`), animations: 'disabled' });
  await page.locator('[data-tab="knowledge"]').first().click();
  await page.locator('#tab-knowledge').waitFor({ state: 'visible' });
  await page.locator('#claim-subject').fill('syntetisk_emne');
  await page.locator('#claim-value').fill('Syntetisk personligt faktum');
  await page.locator('#personal-claim-form button').click();
  await page.locator('[data-claim-id]').first().waitFor({ state: 'visible' });
  await page.locator('[data-claim-id] button').first().click();
  await page.locator('#tab-knowledge').screenshot({ path: join(screenshotDir, `${label}-knowledge.png`), animations: 'disabled' });
  await page.locator('[data-tab="home"]').first().click();
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-home.png`), animations: 'disabled' });
  await context.close();
  return `${label}: navigation, history, drafts and first-screen composer passed`;
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
  console.log(reports.join('\n'));
  console.log(`Synthetic screenshots: ${screenshotDir}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
