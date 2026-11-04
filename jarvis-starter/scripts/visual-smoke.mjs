// GitHub Actions only: genuine Chromium visual smoke test with synthetic data.
// This script is NOT run by npm test / the offline production staging container.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(app, 'artifacts');
const token = 'visual-smoke-test-access-token-no-real-secrets';
const fixture = await mkdtemp(join(tmpdir(), 'jarvis-v48-browser-'));

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const backend = spawn(process.execPath, ['server.mjs'], { cwd: app,
  env: { ...process.env, JARVIS_PORT: String(port), JARVIS_HOST: '127.0.0.1',
    JARVIS_ACCESS_TOKEN: token, OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY',
    JARVIS_DATA_DIR: fixture, JARVIS_PROJECT_ROOT: join(fixture, 'projects'), JARVIS_UPDATE_REPO: '' },
  stdio: 'pipe' });
let browser;
let logs = '';
backend.stderr.on('data', chunk => { logs += String(chunk).slice(0, 500); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (backend.exitCode !== null) throw new Error(`JARVIS failed to start: ${logs}`);
    try { ready = (await fetch(`${origin}/health`)).ok; } catch { /* startup */ }
    if (ready) break;
    await delay(150);
  }
  assert.equal(ready, true, `Server did not respond: ${logs}`);
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1390, height: 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#token').fill(token);
  await page.locator('#login-form button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('#home-intelligence .intelligence-card').first().waitFor();
  assert.equal(await page.locator('#home-intelligence .intelligence-card').count(), 3);
  const chatBeforeAgenda = await page.evaluate(() => Boolean(document.querySelector('#tab-home .chat-panel')
    .compareDocumentPosition(document.getElementById('home-intelligence')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(chatBeforeAgenda, true, 'chat must precede agenda in DOM');
  await page.screenshot({ path: join(artifacts, 'v48-command-center-desktop.png'), animations: 'disabled' });

  // All inserted data are synthetic and use the authenticated local test server.
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const collectionResponse = await fetch(`${origin}/api/organizer`, { method: 'POST', headers,
    body: JSON.stringify({ type: 'dates', title: 'Visuel test: familie' }) });
  assert.equal(collectionResponse.status, 201);
  const collection = (await collectionResponse.json()).collection;
  const itemResponse = await fetch(`${origin}/api/organizer/${collection.id}/items`, { method: 'POST', headers,
    body: JSON.stringify({ text: 'Visuel test: mosters fødselsdag', notes: 'Ingen rigtige personoplysninger', date: '1990-11-06', annual: true }) });
  assert.equal(itemResponse.status, 201);

  await page.locator('[data-tab="knowledge"]').click();
  await page.locator('#skills-catalog .catalog-card').first().waitFor();
  assert.equal(await page.locator('#skills-catalog .catalog-card').count(), 4);
  assert.equal(await page.locator('#integrations-catalog .catalog-card').count(), 8);
  await page.locator('#knowledge-query').fill('mosters fødselsdag');
  await page.locator('#knowledge-search-form button').click();
  await page.locator('.knowledge-result').first().waitFor();
  assert.match(await page.locator('.knowledge-result').first().innerText(), /Visuel test: mosters fødselsdag/);
  await page.screenshot({ path: join(artifacts, 'v48-knowledge-and-skills.png'), animations: 'disabled' });

  await page.locator('[data-tab="meals"]').click();
  await page.waitForFunction(() => document.getElementById('meal-nemlig-status')?.textContent.includes('MCP'));
  await page.locator('#meal-household').fill('4');
  await page.locator('#meal-diet').selectOption('vegan');
  await page.locator('#meal-pantry').fill('ris | 300 | g');
  await page.locator('#meal-profile-form button[type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('meal-profile-status')?.textContent.includes('gemte'));
  await page.locator('#meal-days').selectOption('3');
  await page.locator('#meal-plan-form button[type="submit"]').click();
  await page.locator('#meal-plans .meal-card').first().waitFor();
  assert.equal(await page.locator('#meal-nemlig-search-form button').isDisabled(), true);
  assert.equal(await page.locator('#meal-use-calendar').isDisabled(), true);
  assert.match(await page.locator('#meal-plans').innerText(), /Indkøbsliste/);
  await page.screenshot({ path: join(artifacts, 'v48-meal-planner-desktop.png'), animations: 'disabled' });

  // A synthetic, already-reviewed proposal needs one explicit button click;
  // the UI must never require or accept a second typed confirmation.
  const approvals = [];
  await page.route('**/api/nemlig/proposals/*/approve', async route => {
    approvals.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ proposal: { status: 'completed' } }) });
  });
  await page.evaluate(() => showNemligProposals([{ id: '11111111-1111-1111-1111-111111111111', status: 'pending',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    additions: [{ name: 'Test-havremælk', previous: 2, add: 1, target: 3 }] }]));
  assert.match(await page.locator('#meal-nemlig-proposals').innerText(), /Test-havremælk: 2 → 3 \(\+1\)/);
  assert.equal(await page.locator('#meal-nemlig-proposals input').count(), 0);
  await page.getByRole('button', { name: 'Overfør til Nemlig' }).click();
  await page.waitForFunction(() => !document.querySelector('#meal-nemlig-proposals button.primary'));
  assert.deepEqual(approvals, [{ approved: true }]);

  await page.locator('[data-tab="settings"]').click();
  await page.locator('#proactive-daily-time').waitFor();
  assert.equal(await page.locator('#proactive-daily-time').inputValue(), '07:30');
  await page.locator('#proactive-daily-time').fill('08:15');
  await page.locator('#proactive-form button[type="submit"]').click();
  await page.getByText('Indstillingerne er gemt.', { exact: true }).waitFor();
  const persisted = await (await fetch(`${origin}/api/proactive`, { headers })).json();
  assert.equal(persisted.settings.dailyTime, '08:15');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab="home"]').click();
  await page.locator('#home-intelligence .intelligence-card').first().waitFor();
  await page.screenshot({ path: join(artifacts, 'v48-command-center-mobile.png'), animations: 'disabled' });
  await page.locator('[data-tab="meals"]').click();
  await page.screenshot({ path: join(artifacts, 'v48-meal-planner-mobile.png'), animations: 'disabled' });
  // The tab-navigation buttons deliberately extend beyond the viewport inside
  // their own horizontal scroll container. Verify the active meal content itself
  // instead of counting those hidden navigation buttons as a layout failure.
  const mealOverflowSources = await page.evaluate(() => [...document.querySelectorAll('#tab-meals, #tab-meals *')]
    .filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > window.innerWidth + 2 || b.left < -2);
    })
    .slice(0, 12).map(el => `${el.tagName.toLowerCase()}#${el.id}.${el.className} → ${Math.round(el.getBoundingClientRect().left)}–${Math.round(el.getBoundingClientRect().right)}px`));
  assert.deepEqual(mealOverflowSources, [], `meal planner content leaves mobile viewport: ${mealOverflowSources.join(' | ')}`);
  assert.deepEqual(pageErrors, [], `Frontend runtime exceptions: ${pageErrors.join(' | ')}`);
  console.log('Visual smoke passed: desktop, mobile, meal planning, knowledge sources, skills, adapters, proactive settings.');
} finally {
  await browser?.close();
  backend.kill('SIGTERM');
}
