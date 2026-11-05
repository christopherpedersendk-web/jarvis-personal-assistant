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

async function uiWrite(page, method, path, action, statuses = [200]) {
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
  await action();
  const response = await waiting;
  const body = await response.json();
  assert.ok(statuses.includes(response.status()), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`);
  await page.waitForFunction(() => !document.querySelector('.meal-family-day[aria-busy="true"], #meal-family-form[aria-busy="true"], #meal-recipe-form[aria-busy="true"]'));
  return { body, input: response.request().postDataJSON(), status: response.status() };
}

async function fixtureRead(page, path) {
  const response = await page.request.get(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status(), 200, path); return response.json();
}

async function openDetails(details) {
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
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
  const rawTitle = `Ugemt opskriftsrettelse ${label}`;
  await recipeCard.getByLabel('Titel', { exact: true }).fill(rawTitle);
  const ingredients = recipeCard.getByRole('group', { name: 'Ingredienser og mængder', exact: true });
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
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && path.startsWith('/api/nemlig/') && path !== '/api/nemlig/search') basketMutations.push(path);
  });
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await signIn(page);
  for (const view of ['home', 'plan', 'meals', 'knowledge', 'smart-home', 'projects', 'settings']) {
    assert.equal(await page.locator(`#tab-${view}`).count(), 1, `${label}: missing view ${view}`);
  }
  await page.locator('#tab-home .chat-panel').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tab-home .hero-panel h1').innerText(), /dig, Christopher/,
    `${label}: the Danish greeting lost its word spacing`);
  await page.locator('#home-system-health p').filter({ hasText: 'JARVIS online' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#home-system-health h2').textContent(), 'Systemtilstand');
  await page.locator('#home-smart-home h3').waitFor({ state: 'visible' });
  assert.match(await page.locator('#home-smart-home h3').textContent(), /Smart hjem/);
  assert.equal(await page.locator('#message').isVisible(), true, `${label}: message input hidden`);
  const composerBottom = await page.locator('#message').evaluate(el => el.getBoundingClientRect().bottom);
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-initial-home.png`), animations: 'disabled' });
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
  await page.locator('#personal-task-form button[type="submit"]').click();
  await page.locator('[data-personal-task-id]').first().waitFor({ state: 'visible' });
  await page.locator('#follow-up-awaiting').fill('Afvent syntetisk svar');
  await page.locator('#follow-up-check').fill('2026-11-07T12:00');
  await page.locator('#follow-up-stop').fill('Når svaret er modtaget');
  await page.locator('#follow-up-form button[type="submit"]').click();
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
  assert.deepEqual(basketMutations, [], `${label}: planning, imports, polling and source/draft navigation must request zero basket writes or transfer intents`);
  await page.locator('[data-tab="home"]').first().click();
  await page.locator('#tab-home').screenshot({ path: join(screenshotDir, `${label}-home.png`), animations: 'disabled' });
  await context.close();
  return `${label}: navigation, history, household precedence/guests/holiday/absence/portions, structured incomplete drafts, revision conflicts, source return paths, keyboard focus and first-screen composer passed`;
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
