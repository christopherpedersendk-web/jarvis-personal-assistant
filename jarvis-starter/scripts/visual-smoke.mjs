// GitHub Actions only: genuine Chromium visual smoke test with synthetic data.
// This script is NOT run by npm test / the offline production staging container.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
const fixture = await mkdtemp(join(tmpdir(), 'jarvis-v49-browser-'));
const proposedMemoryId = '22222222-2222-4222-8222-222222222222';
const seededAt = new Date().toISOString();
// A proposal is deliberately seeded, not created through a user-confirmed
// remember endpoint. The browser must explicitly confirm it before it is active.
await writeFile(join(fixture, 'state.json'), JSON.stringify({ memories: [{
  id: proposedMemoryId, text: 'Visuel test: forslag om rolige hverdagsaftener.',
  projectId: null, category: 'preference', revision: 1, status: 'proposed',
  confirmed: false, archived: false, source: { kind: 'assistant', channel: 'text' },
  createdAt: seededAt, updatedAt: seededAt, expiresAt: null, confirmedAt: null,
}] }), { mode: 0o600 });

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
    JARVIS_DATA_DIR: fixture, JARVIS_PROJECT_ROOT: join(fixture, 'projects'), JARVIS_UPDATE_STAGING: join(fixture, 'update-staging'), JARVIS_UPDATE_REPO: '',
    NEMLIG_ENABLE_LIVE: 'no', NEMLIG_MCP_DIR: '', NEMLIG_MCP_UV: '', NEMLIG_USER: '', NEMLIG_PASS: '',
    GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REDIRECT_URI: '' },
  stdio: 'pipe' });
let browser;
let page;
const pageErrors = [];
const dialogs = [];
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
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(`${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
  // Browser fixtures may use only this isolated local server. Nemlig responses
  // below are intercepted synthetic data, never a real customer's basket.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function readApi(path) {
    const response = await fetch(`${origin}${path}`, { headers });
    assert.equal(response.ok, true, `${path}: ${response.status}`);
    return response.json();
  }
  async function uiWrite(path, method, action) {
    const pending = page.waitForResponse(response => response.url() === `${origin}${path}` && response.request().method() === method);
    await action();
    const response = await pending;
    const body = await response.json();
    assert.equal(response.ok(), true, `${method} ${path}: ${JSON.stringify(body)}`);
    return body;
  }
  async function waitRecord(key, revision) {
    await page.waitForFunction(({ key, revision }) => [...document.querySelectorAll('[data-record-key]')]
      .some(element => element.dataset.recordKey === key && Number(element.dataset.revision) === revision), { key, revision });
  }
  async function assertNoOverflow(selector, label) {
    const sources = await page.evaluate(selector => [...document.querySelectorAll(`${selector}, ${selector} *`)]
      .filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > window.innerWidth + 2 || box.left < -2);
      }).slice(0, 12).map(element => `${element.tagName.toLowerCase()}#${element.id}.${element.className} → ${Math.round(element.getBoundingClientRect().left)}–${Math.round(element.getBoundingClientRect().right)}px`), selector);
    assert.deepEqual(sources, [], `${label} leaves viewport: ${sources.join(' | ')}`);
  }
  async function assertMealFieldLabels() {
    const errors = await page.evaluate(() => [...document.querySelectorAll('#tab-meals .meal-field')].flatMap(field => {
      const label = field.querySelector(':scope > label');
      const control = field.querySelector(':scope > input, :scope > select, :scope > textarea');
      const valid = label && control && control.id && label.htmlFor === control.id && label.control === control
        && label.textContent.trim() && !label.querySelector('input, select, textarea')
        && [...document.querySelectorAll('[id]')].filter(node => node.id === control.id).length === 1;
      return valid ? [] : [field.textContent.trim().slice(0, 160)];
    }));
    assert.deepEqual(errors, [], 'each editable meal field must have one exact label and a unique control id');
  }
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#token').fill(token);
  await page.locator('#login-form button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('#home-intelligence .intelligence-card').first().waitFor();
  assert.equal(await page.locator('#home-intelligence .intelligence-card').count(), 3);
  const chatBeforeAgenda = await page.evaluate(() => Boolean(document.querySelector('#tab-home .chat-panel')
    .compareDocumentPosition(document.getElementById('home-intelligence')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(chatBeforeAgenda, true, 'chat must precede agenda in DOM');
  await assertNoOverflow('#tab-home', 'desktop command center');
  await page.screenshot({ path: join(artifacts, 'v49-command-center-desktop.png'), animations: 'disabled' });

  // All inserted data are synthetic and use the authenticated local test server.
  const collectionResponse = await fetch(`${origin}/api/organizer`, { method: 'POST', headers,
    body: JSON.stringify({ type: 'dates', title: 'Visuel test: familie' }) });
  assert.equal(collectionResponse.status, 201);
  const collection = (await collectionResponse.json()).collection;
  const itemResponse = await fetch(`${origin}/api/organizer/${collection.id}/items`, { method: 'POST', headers,
    body: JSON.stringify({ text: 'Visuel test: mosters fødselsdag', notes: 'Ingen rigtige personoplysninger', date: '1990-11-06', annual: true }) });
  assert.equal(itemResponse.status, 201);

  await page.locator('[data-tab="knowledge"]').click();
  await page.locator('#skills-catalog .catalog-card').first().waitFor();
  assert.ok(await page.locator('#skills-catalog .catalog-card').count() >= 4);
  assert.ok(await page.locator('#integrations-catalog .catalog-card').count() >= 8);
  await page.locator('#knowledge-query').fill('mosters fødselsdag');
  await page.locator('#knowledge-search-form button').click();
  await page.locator('.knowledge-result').first().waitFor();
  assert.match(await page.locator('.knowledge-result').first().innerText(), /Visuel test: mosters fødselsdag/);
  await page.screenshot({ path: join(artifacts, 'v49-knowledge-and-skills.png'), animations: 'disabled' });

  // Personal memory: manual creation, corrections protected against refresh,
  // and a separate confirmation for an assistant's proposed fact.
  const memoryRoot = page.locator('#memory-workbench');
  await memoryRoot.locator(`[data-memory-id="${proposedMemoryId}"]`).waitFor();
  assert.equal((await readApi('/api/memories')).memories.find(item => item.id === proposedMemoryId).active, false);
  await page.locator('#memory-workbench-text').fill('Visuel test: ønsker hurtige retter på hverdage.');
  await page.locator('#memory-workbench-category').selectOption('food');
  const { memory: newMemory } = await uiWrite('/api/memories', 'POST', () => page.locator('#memory-workbench-form button[type="submit"]').click());
  let memoryCard = memoryRoot.locator(`[data-memory-id="${newMemory.id}"]`);
  await memoryCard.getByText('Bekræftet', { exact: true }).waitFor();
  await memoryCard.locator('summary').click();
  const correctedMemory = 'Visuel test: ønsker retter på højst 25 minutter på hverdage.';
  await memoryCard.getByLabel('Hukommelsespunkt', { exact: true }).fill(correctedMemory);
  await memoryRoot.getByRole('button', { name: 'Opdater hukommelsen', exact: true }).click();
  assert.equal(await memoryCard.getByLabel('Hukommelsespunkt', { exact: true }).inputValue(), correctedMemory);
  assert.match(await page.locator('#memory-workbench-status').innerText(), /ikke-gemt rettelse/);
  const { memory: editedMemory } = await uiWrite(`/api/memories/${newMemory.id}`, 'PUT', () => memoryCard.getByRole('button', { name: 'Gem rettelse', exact: true }).click());
  assert.equal(editedMemory.revision, newMemory.revision + 1);
  assert.equal(editedMemory.text, correctedMemory);
  await memoryCard.locator('.memory-v49-text').filter({ hasText: correctedMemory }).waitFor();

  memoryCard = memoryRoot.locator(`[data-memory-id="${proposedMemoryId}"]`);
  await memoryCard.locator('summary').click();
  await memoryCard.getByLabel('Hukommelsespunkt', { exact: true }).fill('Visuel test: rettet forslag om rolige hverdagsaftener.');
  assert.equal(await memoryCard.getByRole('button', { name: 'Bekræft hukommelsen', exact: true }).isDisabled(), true);
  const { memory: editedProposal } = await uiWrite(`/api/memories/${proposedMemoryId}`, 'PUT', () => memoryCard.getByRole('button', { name: 'Gem rettelse', exact: true }).click());
  assert.equal(editedProposal.status, 'proposed', 'editing is not confirmation');
  await memoryCard.getByRole('button', { name: 'Bekræft hukommelsen', exact: true }).waitFor();
  assert.equal((await readApi('/api/memories')).memories.find(item => item.id === proposedMemoryId).active, false);
  const { memory: confirmedMemory } = await uiWrite(`/api/memories/${proposedMemoryId}/confirm`, 'POST', () => memoryCard.getByRole('button', { name: 'Bekræft hukommelsen', exact: true }).click());
  assert.equal(confirmedMemory.status, 'confirmed');
  assert.equal(confirmedMemory.revision, editedProposal.revision + 1);
  await memoryCard.getByText('Bekræftet', { exact: true }).waitFor();
  assert.equal((await readApi('/api/memories')).memories.find(item => item.id === proposedMemoryId).active, true);
  await assertNoOverflow('#tab-knowledge', 'desktop knowledge and memory');
  await memoryRoot.screenshot({ path: join(artifacts, 'v49-personal-memory-desktop.png'), animations: 'disabled' });

  await page.locator('[data-tab="meals"]').click();
  await page.waitForFunction(() => document.getElementById('meal-nemlig-status')?.textContent.includes('MCP'));
  await page.locator('#meal-household').fill('4');
  await page.locator('#meal-diet').selectOption('vegan');
  await page.locator('#meal-pantry').fill('ris | 300 | g');
  await uiWrite('/api/meals/profile', 'PUT', () => page.locator('#meal-profile-form button[type="submit"]').click());
  await page.waitForFunction(() => document.getElementById('meal-profile-status')?.textContent.includes('gemte'));

  await page.locator('#meal-adults').fill('2');
  await page.locator('#meal-children').fill('4:0.5, 10:0.75');
  const { household } = await uiWrite('/api/meals/household', 'PUT', () => page.locator('#meal-family-form button[type="submit"]').click());
  assert.deepEqual(household.children, [{ age: 4, portion: 0.5 }, { age: 10, portion: 0.75 }]);
  await page.waitForFunction(() => document.getElementById('meal-family-status')?.textContent.includes('Normal husstand er gemt'));
  const firstDate = await page.locator('#meal-family-start').inputValue();
  const firstDay = page.locator(`#meal-family-days [data-record-key="family-day:${firstDate}"]`);
  await firstDay.getByText('Tilpas dagen', { exact: true }).click();
  await assertMealFieldLabels();
  await firstDay.getByLabel('Voksne', { exact: true }).fill('1');
  await firstDay.getByLabel('Børns aldre / portionsfaktorer', { exact: true }).fill('4:0.5');
  await firstDay.getByLabel('Dagens tema', { exact: true }).selectOption('child_friendly');
  const { household: withDay } = await uiWrite(`/api/meals/household/days/${firstDate}`, 'PUT', () => firstDay.getByRole('button', { name: 'Gem dag', exact: true }).click());
  assert.deepEqual(withDay.days[firstDate], { adults: 1, children: [{ age: 4, portion: 0.5 }], theme: 'child_friendly', skip: false });
  await firstDay.getByText('Tilpasset dag', { exact: true }).waitFor();

  // Source capture is local and has no live model/API credentials. The user
  // checks structured fields; an inbox draft must not appear as a usable recipe.
  await page.locator('#meal-recipe-text').fill('Visuel test: ris med linser. Til fire portioner bruges 400 g ris, 200 g linser og 400 g hakkede tomater.');
  const { recipe: inboxRecipe } = await uiWrite('/api/recipes', 'POST', () => page.locator('#meal-recipe-form button[type="submit"]').click());
  assert.equal(inboxRecipe.status, 'inbox');
  const recipeCard = page.locator(`#meal-recipes [data-record-key="recipe:${inboxRecipe.id}"]`);
  await recipeCard.waitFor();
  await assertMealFieldLabels();
  assert.equal((await readApi('/api/meals')).recipes.some(recipe => recipe.sourceRef?.id === inboxRecipe.id), false);
  await recipeCard.getByLabel('Titel', { exact: true }).fill('Visuel test: ris med linser');
  await recipeCard.getByLabel('Kosttype — skal være kontrolleret', { exact: true }).selectOption('vegan');
  await recipeCard.getByLabel('Tilberedningstid i minutter', { exact: true }).fill('25');
  await recipeCard.getByLabel('Opskriftens portioner', { exact: true }).fill('4');
  await recipeCard.getByLabel('Ingredienser: navn | antal | enhed', { exact: true }).fill('ris | 400 | g\nlinser | 200 | g\nhakkede tomater | 400 | g');
  await recipeCard.getByLabel('Børnevenlig', { exact: true }).check();
  const { recipe: confirmedRecipe } = await uiWrite(`/api/recipes/${inboxRecipe.id}`, 'PUT', () => recipeCard.getByRole('button', { name: 'Godkend opskrift til madplaner', exact: true }).click());
  assert.equal(confirmedRecipe.status, 'confirmed');
  await waitRecord(`recipe:${inboxRecipe.id}`, confirmedRecipe.revision);
  const usableRecipe = (await readApi('/api/meals')).recipes.find(recipe => recipe.sourceRef?.id === inboxRecipe.id);
  assert.ok(usableRecipe, 'confirmed inbox recipe is now available to planning');

  await page.locator('#meal-days').selectOption('3');
  await page.locator('#meal-start').fill(firstDate);
  const { plan: initialPlan } = await uiWrite('/api/meals/plans', 'POST', () => page.locator('#meal-plan-form button[type="submit"]').click());
  await waitRecord(`plan:${initialPlan.id}`, initialPlan.revision);
  const planCard = page.locator(`#meal-plans [data-record-key="plan:${initialPlan.id}"]`);
  assert.equal(initialPlan.status, 'draft');
  assert.deepEqual(initialPlan.shoppingList, []);
  assert.equal(initialPlan.dishes[0].servings, 1.5);
  assert.equal(initialPlan.dishes[0].theme, 'child_friendly');
  assert.equal(initialPlan.dishes[1].servings, 3.25);
  assert.equal(initialPlan.dishes[1].adults, 2);
  assert.deepEqual(initialPlan.dishes[1].children, [{ age: 4, portion: 0.5 }, { age: 10, portion: 0.75 }]);
  assert.equal(await planCard.locator('.meal-shopping-list').count(), 0, 'drafts do not create shopping lists');
  assert.equal(await page.locator('#meal-nemlig-search-form button').isDisabled(), true);
  assert.equal(await page.locator('#meal-use-calendar').isDisabled(), true);
  const firstDish = planCard.locator('.meal-day-editor').first();
  await assertMealFieldLabels();
  await firstDish.getByLabel('Ret', { exact: true }).selectOption(usableRecipe.id);
  await firstDish.getByLabel('Portioner', { exact: true }).fill('2.25');
  await firstDish.locator('summary').click();
  await firstDish.getByLabel('Titel', { exact: true }).fill('Visuel test: tilrettet linseret');
  await firstDish.getByLabel('Ingredienser til de viste portioner: navn | antal | enhed', { exact: true }).fill('ris | 450 | g\nlinser | 200 | g\nhakkede tomater | 400 | g');
  assert.equal(await planCard.getByRole('button', { name: 'Opret indkøbsliste', exact: true }).isDisabled(), true);
  await page.evaluate(() => refreshMeals());
  assert.equal(await firstDish.getByLabel('Titel', { exact: true }).inputValue(), 'Visuel test: tilrettet linseret', 'refresh preserves unsaved dish edits');
  const { plan: editedPlan } = await uiWrite(`/api/meals/plans/${initialPlan.id}`, 'PUT', () => planCard.getByRole('button', { name: 'Gem ændringer i madplanen', exact: true }).click());
  await waitRecord(`plan:${initialPlan.id}`, editedPlan.revision);
  assert.equal(editedPlan.status, 'draft');
  assert.equal(editedPlan.dishes[0].title, 'Visuel test: tilrettet linseret');
  assert.equal(editedPlan.dishes[0].servings, 2.25);
  assert.equal(editedPlan.dishes[0].ingredients.find(item => item.name === 'ris').quantity, 450);
  assert.deepEqual(editedPlan.shoppingList, []);
  const { plan: shoppingPlan } = await uiWrite(`/api/meals/plans/${initialPlan.id}/shopping-list`, 'POST', () => planCard.getByRole('button', { name: 'Opret indkøbsliste', exact: true }).click());
  await waitRecord(`plan:${initialPlan.id}`, shoppingPlan.revision);
  assert.equal(shoppingPlan.status, 'shopping_ready');
  assert.ok(shoppingPlan.shoppingList.length > 0);
  const riceRequired = editedPlan.dishes.filter(dish => !dish.skip).flatMap(dish => dish.ingredients)
    .filter(item => item.name === 'ris' && item.unit === 'g').reduce((sum, item) => sum + item.quantity, 0);
  assert.equal(shoppingPlan.shoppingList.find(item => item.name === 'ris').quantity, Math.round((riceRequired - 300) * 100) / 100, 'known pantry stock is deducted once');
  await planCard.getByText('Ret selve indkøbslisten', { exact: true }).click();
  const editedItems = shoppingPlan.shoppingList.map((item, index) => ({ ...item, quantity: item.quantity + (index === 0 ? 10 : 0) }));
  await planCard.getByLabel('Vare | antal | enhed — én pr. linje', { exact: true }).fill(editedItems.map(item => `${item.name} | ${item.quantity} | ${item.unit}`).join('\n'));
  const { plan: finalPlan } = await uiWrite(`/api/meals/plans/${initialPlan.id}/shopping-list`, 'PUT', () => planCard.getByRole('button', { name: 'Gem rettelser til listen', exact: true }).click());
  await waitRecord(`plan:${initialPlan.id}`, finalPlan.revision);
  assert.equal(finalPlan.shoppingList[0].quantity, editedItems[0].quantity);
  await assertNoOverflow('#tab-meals', 'desktop meal planner');
  await page.locator('#meal-family-days').screenshot({ path: join(artifacts, 'v49-household-desktop.png'), animations: 'disabled' });
  await planCard.screenshot({ path: join(artifacts, 'v49-meal-planner-desktop.png'), animations: 'disabled' });

  // The catalogue/draft/proposal responses in this segment are synthetic. Only
  // the final deliberate transfer click may call approve; no checkout is exposed.
  const productId = '1234567';
  const draftId = '33333333-3333-4333-8333-333333333333';
  const proposalId = '11111111-1111-4111-8111-111111111111';
  const proposalPath = `/api/nemlig/proposals/${proposalId}`;
  let syntheticDraft = null;
  let syntheticProposal = null;
  const draftEdits = [];
  const proposalEdits = [];
  const approvals = [];
  const forbiddenRetailRequests = [];
  const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${origin}/api/meals/plans/${initialPlan.id}/nemlig-draft`, async route => {
    assert.equal(route.request().method(), 'POST');
    syntheticDraft = { id: draftId, revision: 1, planId: initialPlan.id, planRevision: finalPlan.revision, status: 'draft', warnings: ['Syntetiske testvarer — ingen live-forbindelse.'],
      items: [{ lineId: 'test-rice', ingredient: 'ris', neededQuantity: 450, unit: 'g', productId, quantity: 1, needsReview: true,
        reason: 'Kontrollér pakningsantal.', candidates: [{ Id: productId, Name: 'Test-ris, 500 g', Price: 15, IsAvailable: true }] }] };
    await reply(route, { draft: syntheticDraft }, 201);
  });
  await page.route(url => url.origin === origin && /^\/api\/shopping-drafts(?:\/|$)/.test(url.pathname), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/shopping-drafts' && route.request().method() === 'GET') return reply(route, { drafts: syntheticDraft ? [syntheticDraft] : [] });
    if (path === `/api/shopping-drafts/${draftId}` && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); draftEdits.push(input);
      assert.equal(input.expectedRevision, syntheticDraft.revision);
      syntheticDraft = { ...syntheticDraft, revision: syntheticDraft.revision + 1,
        items: syntheticDraft.items.map(item => ({ ...item, ...input.items.find(change => change.lineId === item.lineId), needsReview: false })) };
      return reply(route, { draft: syntheticDraft });
    }
    if (path === `/api/shopping-drafts/${draftId}/propose` && route.request().method() === 'POST') {
      assert.equal(route.request().postDataJSON().expectedRevision, syntheticDraft.revision);
      assert.equal(syntheticDraft.items.some(item => item.needsReview), false);
      const item = syntheticDraft.items[0];
      syntheticProposal = { id: proposalId, revision: 1, status: 'pending', expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sourcePlan: { id: initialPlan.id, revision: finalPlan.revision }, sourceDraft: { id: draftId, revision: syntheticDraft.revision },
        additions: [{ productId: item.productId, name: 'Test-ris, 500 g', previous: 2, add: item.quantity, target: 2 + item.quantity }] };
      syntheticDraft.status = 'proposed';
      return reply(route, { proposal: syntheticProposal }, 201);
    }
    return reply(route, { error: 'Unexpected synthetic shopping request' }, 500);
  });
  await page.route(`${origin}/api/nemlig/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/nemlig/status' && route.request().method() === 'GET') return reply(route, {
      configured: true, canPlaceOrder: false, approvalRequired: true, proposals: syntheticProposal ? [syntheticProposal] : [],
    });
    if (path === proposalPath && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); proposalEdits.push(input);
      assert.equal(input.expectedRevision, syntheticProposal.revision);
      assert.equal(input.items[0].productId, productId);
      syntheticProposal = { ...syntheticProposal, revision: syntheticProposal.revision + 1,
        additions: syntheticProposal.additions.map(item => ({ ...item, add: input.items[0].quantity, target: item.previous + input.items[0].quantity })) };
      return reply(route, { proposal: syntheticProposal });
    }
    if (path === `${proposalPath}/approve` && route.request().method() === 'POST') {
      const input = route.request().postDataJSON(); approvals.push(input);
      assert.equal(input.expectedRevision, syntheticProposal.revision);
      syntheticProposal.status = 'completed';
      return reply(route, { proposal: syntheticProposal });
    }
    forbiddenRetailRequests.push(`${route.request().method()} ${path}`);
    return reply(route, { error: 'Unexpected retail request: this test never orders or checks out' }, 500);
  });
  await page.evaluate(() => refreshNemlig());
  await uiWrite(`/api/meals/plans/${initialPlan.id}/nemlig-draft`, 'POST', () => planCard.getByRole('button', { name: 'Find varer på Nemlig', exact: true }).click());
  await waitRecord(`shopping-draft:${draftId}`, 1);
  const shoppingCard = page.locator(`#meal-shopping-drafts [data-record-key="shopping-draft:${draftId}"]`);
  await assertMealFieldLabels();
  await shoppingCard.getByLabel('Pakninger der skal tilføjes (0 = udelad)', { exact: true }).fill('2');
  assert.equal(await shoppingCard.getByRole('button', { name: 'Gennemgået — opret kurvforslag', exact: true }).isDisabled(), true);
  await uiWrite(`/api/shopping-drafts/${draftId}`, 'PUT', () => shoppingCard.getByRole('button', { name: 'Gem varevalg og antal', exact: true }).click());
  await waitRecord(`shopping-draft:${draftId}`, 2);
  assert.deepEqual(draftEdits, [{ expectedRevision: 1, items: [{ lineId: 'test-rice', productId, quantity: 2 }] }]);
  assert.deepEqual(approvals, [], 'draft editing never transfers the basket');
  await uiWrite(`/api/shopping-drafts/${draftId}/propose`, 'POST', () => shoppingCard.getByRole('button', { name: 'Gennemgået — opret kurvforslag', exact: true }).click());
  await waitRecord(`nemlig-proposal:${proposalId}`, 1);
  const proposalCard = page.locator(`#meal-nemlig-proposals [data-record-key="nemlig-proposal:${proposalId}"]`);
  assert.match(await proposalCard.innerText(), /Test-ris, 500 g: 2 → 4 \(\+2\)/);
  assert.equal(await proposalCard.locator('input[type="number"]').count(), 1, 'numeric quantity editing is allowed');
  assert.equal(await proposalCard.locator('input:not([type="number"]), textarea').count(), 0, 'no typed approval confirmation');
  await proposalCard.locator('summary').click();
  await proposalCard.getByLabel('Test-ris, 500 g — tilføj (0 = udelad)', { exact: true }).fill('1');
  assert.equal(await proposalCard.getByRole('button', { name: 'Overfør til Nemlig', exact: true }).isDisabled(), true);
  await uiWrite(proposalPath, 'PUT', () => proposalCard.getByRole('button', { name: 'Gem rettet kurvforslag', exact: true }).click());
  await waitRecord(`nemlig-proposal:${proposalId}`, 2);
  assert.deepEqual(proposalEdits, [{ expectedRevision: 1, items: [{ productId, quantity: 1 }] }]);
  assert.deepEqual(approvals, [], 'preparing and revising a proposal is not consent to transfer');
  assert.match(await proposalCard.innerText(), /Test-ris, 500 g: 2 → 3 \(\+1\)/);
  await uiWrite(`${proposalPath}/approve`, 'POST', () => proposalCard.getByRole('button', { name: 'Overfør til Nemlig', exact: true }).click());
  await proposalCard.getByText('Udført', { exact: true }).waitFor();
  assert.deepEqual(approvals, [{ approved: true, expectedRevision: 2 }]);
  assert.deepEqual(forbiddenRetailRequests, []);

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
  await assertNoOverflow('#tab-home', 'mobile command center');
  await page.screenshot({ path: join(artifacts, 'v49-command-center-mobile.png'), animations: 'disabled' });
  await page.locator('[data-tab="meals"]').click();
  await page.locator('#meal-family-days .meal-family-day').first().waitFor();
  await page.locator('#meal-family-days').screenshot({ path: join(artifacts, 'v49-household-mobile.png'), animations: 'disabled' });
  await planCard.screenshot({ path: join(artifacts, 'v49-meal-planner-mobile.png'), animations: 'disabled' });
  // The tab-navigation buttons deliberately extend beyond the viewport inside
  // their own horizontal scroll container. Verify the active meal content itself
  // instead of counting those hidden navigation buttons as a layout failure.
  await assertNoOverflow('#tab-meals', 'mobile meal planner');
  await page.locator('[data-tab="knowledge"]').click();
  await memoryRoot.screenshot({ path: join(artifacts, 'v49-personal-memory-mobile.png'), animations: 'disabled' });
  await assertNoOverflow('#tab-knowledge', 'mobile knowledge and memory');
  assert.deepEqual(pageErrors, [], `Frontend runtime exceptions: ${pageErrors.join(' | ')}`);
  assert.deepEqual(dialogs, [], `No typed confirmation or unexpected dialogs: ${dialogs.join(' | ')}`);
  console.log('Visual smoke passed: desktop/mobile overflow, household themes and portions, editable draft-first meals and shopping, reviewed recipe memory, corrected/confirmed personal memory, one-click synthetic Nemlig transfer, knowledge, skills, adapters, proactive settings.');
} catch (error) {
  // Preserve the actual failing browser state before cleanup. The fixture is
  // isolated and synthetic; do not record environment variables or credentials.
  if (page && !page.isClosed()) {
    try {
      await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, 'v49-failure.png'), animations: 'disabled', timeout: 10_000 });
      await page.screenshot({ path: join(artifacts, 'v49-failure-full.png'), fullPage: true, animations: 'disabled', timeout: 10_000 });
      const fields = await page.evaluate(() => [...document.querySelectorAll('#tab-meals input, #tab-meals select, #tab-meals textarea')]
        .map(control => ({ id: control.id, tag: control.tagName, type: control.type, disabled: control.disabled,
          visible: Boolean(control.getClientRects().length), labels: [...(control.labels || [])].map(label => label.textContent.trim()),
        })));
      await writeFile(join(artifacts, 'v49-failure.json'), JSON.stringify({ message: error.message, stack: error.stack,
        url: page.url(), pageErrors, dialogs, fields }, null, 2));
    } catch (diagnosticError) { console.error('Could not capture browser failure diagnostics:', diagnosticError.message); }
  }
  throw error;
} finally {
  await browser?.close();
  backend.kill('SIGTERM');
}
