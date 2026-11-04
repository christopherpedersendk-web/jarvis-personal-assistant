import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const token = 'synthetic-v49-server-integration-access-token';
const unusedId = '00000000-0000-4000-8000-000000000001';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v49-server-'));
  const logPath = join(dataDir, 'server-test.log');
  const logs = [];
  let child = null;
  let exit = null;
  let base = '';
  // Do not inherit real API credentials, Node preload hooks, update repositories
  // or integration settings from the machine running these tests.
  const env = {
    ...Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP']
      .filter(name => process.env[name]).map(name => [name, process.env[name]])),
    TZ: 'Europe/Copenhagen',
    JARVIS_DATA_DIR: dataDir,
    JARVIS_PROJECT_ROOT: join(dataDir, 'projects'),
    JARVIS_UPDATE_STAGING: join(dataDir, 'update-staging'),
    JARVIS_UPDATE_REPO: '',
    JARVIS_ACCESS_TOKEN: token,
    JARVIS_HOST: '127.0.0.1',
    OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY',
    NEMLIG_ENABLE_LIVE: 'no',
    NEMLIG_MCP_DIR: '',
    NEMLIG_MCP_UV: '',
    NEMLIG_USER: '',
    NEMLIG_PASS: '',
    GOOGLE_OAUTH_CLIENT_ID: '',
    GOOGLE_OAUTH_CLIENT_SECRET: '',
    GOOGLE_OAUTH_REDIRECT_URI: '',
    PUSHOVER_APP_TOKEN: '',
    PUSHOVER_USER_KEY: '',
    JARVIS_ALLOW_NPM_INSTALL: 'no',
  };

  async function stop() {
    if (!child) return;
    const current = child;
    if (current.exitCode === null && current.signalCode === null) {
      current.kill('SIGTERM');
      const ended = await Promise.race([exit.then(() => true), delay(3000, false, { ref: false })]);
      if (!ended) { current.kill('SIGKILL'); await exit; }
    } else await exit;
    child = null;
  }

  async function start() {
    assert.equal(child, null, 'stop the previous server before restarting');
    const port = await availablePort();
    base = `http://127.0.0.1:${port}`;
    logs.push(`\n--- synthetic server start on ${port} ---\n`);
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: root, env: { ...env, JARVIS_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.stdout.on('data', chunk => logs.push(`[stdout] ${chunk}`));
    child.stderr.on('data', chunk => logs.push(`[stderr] ${chunk}`));
    exit = new Promise(resolve => child.once('close', (code, signal) => {
      logs.push(`\n--- server closed: ${code ?? signal} ---\n`); resolve();
    }));
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError || child.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
        ready = response.ok;
        await response.text();
        if (ready) break;
      } catch { /* allow startup without hiding child-process errors */ }
      await delay(50);
    }
    assert.equal(ready, true, `server failed to start: ${spawnError?.message || ''}\n${logs.join('')}`);
  }

  async function api(method, path, input, { status = 200, auth = true } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}\n${logs.join('').slice(-12000)}`);
    return text ? JSON.parse(text) : null;
  }

  t.after(async () => {
    await stop();
    await writeFile(logPath, logs.join(''), { mode: 0o600 });
    t.diagnostic(`Synthetic integration fixture and captured server logs: ${logPath}`);
  });
  await start();
  return { dataDir, api, start, stop };
}

const dishEdits = (plan, edits = {}) => plan.dishes.map((dish, index) => ({ date: dish.date, ...(edits[index] || {}) }));

test('v4.9 HTTP workflows preserve review boundaries and survive server restarts without live integrations', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  let household;
  let meal;
  let archivedRecipe;
  let retainedRecipe;
  let archivedMemory;
  let retainedMemory;
  let proposedMemory;

  await t.test('all new routes require authentication; live integrations and paid models are disabled', async () => {
    const protectedRoutes = [
      ['GET', '/api/meals'], ['PUT', '/api/meals/household'],
      ['PUT', '/api/meals/household/days/2026-11-05'], ['DELETE', '/api/meals/household/days/2026-11-05'],
      ['POST', '/api/meals/plans'], ['GET', `/api/meals/plans/${unusedId}`], ['PUT', `/api/meals/plans/${unusedId}`],
      ['POST', `/api/meals/plans/${unusedId}/shopping-list`], ['PUT', `/api/meals/plans/${unusedId}/shopping-list`],
      ['POST', `/api/meals/plans/${unusedId}/nemlig-draft`], ['GET', '/api/shopping-drafts'],
      ['PUT', `/api/shopping-drafts/${unusedId}`], ['POST', `/api/shopping-drafts/${unusedId}/propose`],
      ['GET', '/api/recipes'], ['POST', '/api/recipes'], ['PUT', `/api/recipes/${unusedId}`],
      ['POST', `/api/recipes/${unusedId}/archive`], ['GET', `/api/recipes/${unusedId}/media/${unusedId}`],
      ['GET', '/api/memories'], ['POST', '/api/memories'], ['PUT', `/api/memories/${unusedId}`],
      ['POST', `/api/memories/${unusedId}/confirm`], ['POST', `/api/memories/${unusedId}/archive`],
      ['POST', '/api/planning/tool'], ['POST', `/api/nemlig/proposals/${unusedId}/approve`],
    ];
    for (const [method, path] of protectedRoutes) await f.api(method, path, undefined, { auth: false, status: 401 });
    assert.equal((await f.api('GET', '/api/state')).configured, false);
    assert.equal((await f.api('GET', '/api/google/calendar/status')).configured, false);
    assert.equal((await f.api('GET', '/api/discord/settings')).hasToken, false);
    const retailer = await f.api('GET', '/api/nemlig/status');
    assert.equal(retailer.configured, false);
    assert.equal(retailer.canPlaceOrder, false);
    assert.equal(retailer.approvalRequired, true);
  });

  await t.test('household and daily themes feed an editable draft before any shopping list exists', async () => {
    await f.api('PUT', '/api/meals/profile', { householdSize: 2, diet: 'omnivore', avoid: [],
      pantry: [{ name: 'pasta', quantity: 100, unit: 'g' }], budgetDkk: 750 });
    household = (await f.api('PUT', '/api/meals/household', { adults: 2, children: [{ age: 4 }, { age: 10 }] })).household;
    assert.equal(household.configured, true);
    assert.deepEqual(household.children, [{ age: 4, portion: 0.5 }, { age: 10, portion: 0.75 }]);
    await f.api('PUT', '/api/meals/household/days/2026-11-06', { adults: 1, children: [{ age: 10, portion: 0.8 }], theme: 'vegan' });
    household = (await f.api('PUT', '/api/meals/household/days/2026-11-07', { adults: 0, children: [], theme: 'quick' })).household;
    await f.api('PUT', '/api/meals/household/days/2026-11-08', { theme: 'not-a-theme' }, { status: 400 });
    meal = (await f.api('POST', '/api/meals/plans', { startDate: '2026-11-05', days: 3, useCalendar: false }, { status: 201 })).plan;
    assert.equal(meal.status, 'draft');
    assert.equal(meal.revision, 1);
    assert.deepEqual(meal.shoppingList, []);
    assert.equal(meal.shoppingGeneratedAt, null);
    assert.equal(meal.dishes[0].servings, 3.25);
    assert.equal(meal.dishes[0].adults, 2);
    assert.equal(meal.dishes[1].servings, 1.8);
    assert.equal(meal.dishes[1].theme, 'vegan');
    assert.equal(meal.dishes[1].diet, 'vegan');
    assert.equal(meal.dishes[2].skip, true);
    assert.equal(meal.dishes[2].recipeId, null);
    await f.api('POST', `/api/meals/plans/${meal.id}/nemlig-draft`, {}, { status: 409 });

    meal = (await f.api('PUT', `/api/meals/plans/${meal.id}`, {
      expectedRevision: meal.revision, dishes: dishEdits(meal, {
        0: { recipeId: 'tomato-pasta', servings: 4, title: 'Redigeret pastaaften' },
        1: { recipeId: 'bean-chili' }, 2: { recipeId: null, skip: true },
      }),
    })).plan;
    assert.equal(meal.revision, 2);
    assert.equal(meal.dishes[0].title, 'Redigeret pastaaften');
    assert.equal(meal.dishes[0].ingredients.find(item => item.name === 'pasta').quantity, 400);
    assert.equal(meal.dishes[2].skip, true, 'the full UI payload may retain recipeId:null on a skipped day');
    assert.deepEqual(meal.shoppingList, []);
    await f.api('PUT', `/api/meals/plans/${meal.id}`, { expectedRevision: 1, dishes: dishEdits(meal) }, { status: 409 });

    meal = (await f.api('POST', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: meal.revision })).plan;
    assert.equal(meal.revision, 3);
    assert.equal(meal.status, 'shopping_ready');
    assert.equal(meal.shoppingRevision, meal.revision);
    assert.equal(meal.shoppingList.find(item => item.name === 'pasta').quantity, 300, 'pantry is subtracted once when generating the list');
    const items = meal.shoppingList.map(item => ({ name: item.name, unit: item.unit, quantity: item.name === 'pasta' ? 250 : item.quantity }));
    meal = (await f.api('PUT', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: meal.revision, items })).plan;
    assert.equal(meal.revision, 4);
    assert.equal(meal.shoppingList.find(item => item.name === 'pasta').quantity, 250);
    await f.api('PUT', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: 3, items }, { status: 409 });
    meal = (await f.api('PUT', `/api/meals/plans/${meal.id}`, { expectedRevision: meal.revision, dishes: dishEdits(meal, { 0: { servings: 3 } }) })).plan;
    assert.equal(meal.status, 'draft');
    assert.deepEqual(meal.shoppingList, []);
    assert.equal(meal.shoppingGeneratedAt, null);
    meal = (await f.api('POST', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: meal.revision })).plan;

    household = (await f.api('PUT', '/api/meals/household/days/2026-11-05', { adults: 3, children: [], theme: 'child_friendly' })).household;
    meal = (await f.api('GET', `/api/meals/plans/${meal.id}`)).plan;
    assert.equal(meal.householdStale, true);
    assert.equal(meal.status, 'draft');
    assert.deepEqual(meal.shoppingList, []);
    await f.api('POST', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: meal.revision }, { status: 409 });
    meal = (await f.api('PUT', `/api/meals/plans/${meal.id}`, { expectedRevision: meal.revision, refreshHousehold: true })).plan;
    assert.equal(meal.householdStale, false);
    assert.equal(meal.dishes[0].adults, 3);
    assert.equal(meal.dishes[0].theme, 'child_friendly');
    meal = (await f.api('POST', `/api/meals/plans/${meal.id}/shopping-list`, { expectedRevision: meal.revision })).plan;
  });

  await t.test('recipe intake cannot forge Discord provenance or media and reviewed source changes invalidate plans', async () => {
    let recipe = (await f.api('POST', '/api/recipes', {
      text: 'Syntetisk opskrift til integrationstest', confirmed: true,
      source: { channel: 'discord', messageId: '123456789012345678', channelId: '987654321098765432' },
      attachments: [{ id: '111111111111111111', url: 'https://cdn.discordapp.com/attachments/987654321098765432/111111111111111111/image.png', contentType: 'image/png', filename: 'image.png', size: 20 }],
      media: [{ id: unusedId, filename: 'forged.png', contentType: 'image/png' }],
    }, { status: 201 })).recipe;
    assert.deepEqual(recipe.source, { channel: 'web' });
    assert.deepEqual(recipe.media, []);
    assert.equal(recipe.status, 'inbox');
    assert.equal(recipe.confirmed, false);
    assert.equal((await f.api('GET', '/api/meals')).recipes.some(item => item.id === recipe.id), false);
    await f.api('GET', `/api/recipes/${recipe.id}/media/${unusedId}`, undefined, { status: 404 });
    await f.api('POST', '/api/recipes', { attachments: [{ url: 'https://example.invalid/forged.png' }], source: { channel: 'discord' } }, { status: 400 });

    const fields = { title: 'Testkikærter', diet: 'vegan', minutes: 15, servings: 2, themes: ['date'],
      ingredients: [{ name: 'kikærter', quantity: 400, unit: 'g' }], instructions: 'Varm kikærterne.' };
    recipe = (await f.api('PUT', `/api/recipes/${recipe.id}`, { expectedRevision: recipe.revision, ...fields, confirmed: true })).recipe;
    assert.equal(recipe.status, 'confirmed');
    assert.equal((await f.api('GET', '/api/meals')).recipes.some(item => item.id === recipe.id), true);
    let plan = (await f.api('POST', '/api/meals/plans', { startDate: '2026-11-10', days: 1 }, { status: 201 })).plan;
    plan = (await f.api('PUT', `/api/meals/plans/${plan.id}`, { expectedRevision: plan.revision, dishes: dishEdits(plan, { 0: { recipeId: recipe.id } }) })).plan;
    assert.equal(plan.dishes[0].sourceRefs.find(source => source.kind === 'recipe').revision, recipe.revision);
    plan = (await f.api('POST', `/api/meals/plans/${plan.id}/shopping-list`, { expectedRevision: plan.revision })).plan;
    const oldPlanRevision = plan.revision;
    const oldRecipeRevision = recipe.revision;
    recipe = (await f.api('PUT', `/api/recipes/${recipe.id}`, { expectedRevision: recipe.revision, title: 'Rettede testkikærter', confirmed: true })).recipe;
    await f.api('PUT', `/api/recipes/${recipe.id}`, { expectedRevision: oldRecipeRevision, title: 'Gammelt forslag' }, { status: 409 });
    plan = (await f.api('GET', `/api/meals/plans/${plan.id}`)).plan;
    assert.ok(plan.revision > oldPlanRevision);
    assert.equal(plan.recipeStale, true);
    assert.equal(plan.status, 'draft');
    assert.deepEqual(plan.shoppingList, []);
    await f.api('POST', `/api/meals/plans/${plan.id}/shopping-list`, { expectedRevision: oldPlanRevision }, { status: 409 });
    await f.api('POST', `/api/meals/plans/${plan.id}/shopping-list`, { expectedRevision: plan.revision }, { status: 409 });
    plan = (await f.api('PUT', `/api/meals/plans/${plan.id}`, { expectedRevision: plan.revision, dishes: dishEdits(plan, { 0: { recipeId: recipe.id } }) })).plan;
    assert.equal(plan.recipeStale, false);
    assert.equal(plan.dishes[0].title, 'Rettede testkikærter');
    plan = (await f.api('POST', `/api/meals/plans/${plan.id}/shopping-list`, { expectedRevision: plan.revision })).plan;
    archivedRecipe = (await f.api('POST', `/api/recipes/${recipe.id}/archive`, {})).recipe;
    assert.equal(archivedRecipe.archived, true);
    assert.equal((await f.api('GET', '/api/recipes')).recipes.some(item => item.id === recipe.id), false);
    assert.equal((await f.api('GET', '/api/meals')).recipes.some(item => item.id === recipe.id), false);
    plan = (await f.api('GET', `/api/meals/plans/${plan.id}`)).plan;
    assert.equal(plan.recipeStale, true);
    await f.api('POST', `/api/meals/plans/${plan.id}/shopping-list`, { expectedRevision: plan.revision }, { status: 409 });
    plan = (await f.api('PUT', `/api/meals/plans/${plan.id}`, { expectedRevision: plan.revision, dishes: dishEdits(plan, { 0: { recipeId: 'bean-chili' } }) })).plan;
    assert.equal(plan.recipeStale, false);

    retainedRecipe = (await f.api('POST', '/api/recipes', { text: 'En opskrift som skal overleve genstart' }, { status: 201 })).recipe;
    retainedRecipe = (await f.api('PUT', `/api/recipes/${retainedRecipe.id}`, { expectedRevision: retainedRecipe.revision, ...fields, title: 'Vedvarende testopskrift', confirmed: true })).recipe;
  });

  await t.test('model memory is only proposed, user revisions activate or archive it, and no tool can approve a basket', async () => {
    let memory = (await f.api('POST', '/api/planning/tool', { name: 'remember_personal_fact', args: { text: 'Vi foretrækker quasarurt.' } })).memory;
    assert.equal(memory.status, 'proposed');
    assert.equal(memory.confirmed, false);
    assert.equal(memory.source.kind, 'assistant');
    assert.equal((await f.api('GET', '/api/memories')).memories.some(item => item.id === memory.id), true);
    assert.equal((await f.api('GET', '/api/secretary')).memories.some(item => item.id === memory.id), false);
    const search = query => f.api('POST', '/api/knowledge/search', { query });
    assert.equal((await search('quasarurt')).matches.some(item => item.source.id === memory.id), false);
    memory = (await f.api('PUT', `/api/memories/${memory.id}`, { expectedRevision: memory.revision, text: 'Vi foretrækker stjernedild.', category: 'food' })).memory;
    assert.equal(memory.status, 'proposed', 'editing a model suggestion is not confirmation');
    await f.api('POST', `/api/memories/${memory.id}/confirm`, { expectedRevision: 1 }, { status: 409 });
    memory = (await f.api('POST', `/api/memories/${memory.id}/confirm`, { expectedRevision: memory.revision })).memory;
    assert.equal(memory.status, 'confirmed');
    assert.equal(memory.confirmedBy, 'user');
    assert.equal((await search('stjernedild')).matches.some(item => item.source.id === memory.id), true);
    const beforeEdit = memory.revision;
    memory = (await f.api('PUT', `/api/memories/${memory.id}`, { expectedRevision: memory.revision, text: 'Vi foretrækker månepersille.' })).memory;
    assert.equal((await search('stjernedild')).matches.some(item => item.source.id === memory.id), false);
    assert.equal((await search('månepersille')).matches.some(item => item.source.id === memory.id), true);
    await f.api('PUT', `/api/memories/${memory.id}`, { expectedRevision: beforeEdit, text: 'Forældet rettelse' }, { status: 409 });
    archivedMemory = (await f.api('POST', `/api/memories/${memory.id}/archive`, { expectedRevision: memory.revision })).memory;
    assert.equal(archivedMemory.archived, true);
    assert.equal((await f.api('GET', '/api/memories')).memories.some(item => item.id === memory.id), false);
    assert.equal((await search('månepersille')).matches.some(item => item.source.id === memory.id), false);

    for (const name of ['approve_nemlig_basket', 'set_basket_quantity', 'set_basket_quantities', 'checkout', 'confirm_memory']) {
      const response = await f.api('POST', '/api/planning/tool', { name, args: { approved: true, expectedRevision: 1 } }, { status: 400 });
      assert.match(response.error, /ikke tilladt/);
    }
    retainedMemory = (await f.api('POST', '/api/memories', { text: 'Et syntetisk bekræftet hukommelsespunkt til genstart.', category: 'fact' }, { status: 201 })).memory;
    proposedMemory = (await f.api('POST', '/api/planning/tool', { name: 'remember_personal_fact', args: { text: 'En ubekræftet antagelse til genstart.' } })).memory;
    assert.equal(proposedMemory.status, 'proposed');
  });

  await t.test('restart restores household, reviewed recipes, memory states and editable synthetic shopping drafts', async () => {
    await f.stop();
    const statePath = join(f.dataDir, 'state.json');
    const stored = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(stored.mealHousehold, household);
    assert.equal(stored.recipes.find(item => item.id === archivedRecipe.id).archived, true);
    assert.equal(stored.memories.find(item => item.id === archivedMemory.id).archived, true);
    const currentMeal = stored.mealPlans.find(item => item.id === meal.id);
    assert.equal(currentMeal.status, 'shopping_ready');
    // A synthetic saved draft exercises restart and editing without contacting
    // Nemlig, searching a real catalogue or mutating any account's basket.
    const draft = {
      id: randomUUID(), planId: currentMeal.id, planRevision: currentMeal.revision,
      listFingerprint: hash(currentMeal.shoppingList), basketFingerprint: hash([]),
      revision: 1, status: 'draft', createdAt: '2026-11-04T18:00:00.000Z', warnings: ['Synthetic test fixture'],
      budgetTargetDkk: 750, estimatedProductsDkk: null,
      items: currentMeal.shoppingList.map((item, index) => ({
        lineId: randomUUID(), ingredient: item.name, neededQuantity: item.quantity, unit: item.unit,
        candidates: [{ Id: String(90000 + index), Name: item.name, Unit: '500 g', Price: 10, IsAvailable: true }],
        productId: String(90000 + index), quantity: 1, existingQuantity: 0, needsReview: true, excluded: false,
        reason: 'Synthetic product data; no live lookup',
      })),
    };
    stored.shoppingDrafts = [draft];
    await writeFile(statePath, JSON.stringify(stored), { mode: 0o600 });
    await f.start();
    const restoredMeals = await f.api('GET', '/api/meals');
    assert.deepEqual(restoredMeals.household, household);
    assert.equal(restoredMeals.plans.find(item => item.id === currentMeal.id).revision, currentMeal.revision);
    const restoredRecipes = (await f.api('GET', '/api/recipes')).recipes;
    assert.equal(restoredRecipes.find(item => item.id === retainedRecipe.id).confirmed, true);
    assert.equal(restoredRecipes.some(item => item.id === archivedRecipe.id), false);
    const restoredMemories = (await f.api('GET', '/api/memories')).memories;
    assert.equal(restoredMemories.find(item => item.id === retainedMemory.id).status, 'confirmed');
    assert.equal(restoredMemories.find(item => item.id === proposedMemory.id).status, 'proposed');
    assert.equal(restoredMemories.some(item => item.id === archivedMemory.id), false);
    assert.deepEqual((await f.api('GET', '/api/shopping-drafts')).drafts, [draft]);

    const items = draft.items.map(item => ({ lineId: item.lineId, productId: item.productId, quantity: 2 }));
    const edited = (await f.api('PUT', `/api/shopping-drafts/${draft.id}`, { expectedRevision: 1, items })).draft;
    assert.equal(edited.revision, 2);
    assert.ok(edited.items.every(item => item.quantity === 2 && item.needsReview === false));
    await f.api('PUT', `/api/shopping-drafts/${draft.id}`, { expectedRevision: 1, items }, { status: 409 });
    assert.deepEqual((await f.api('GET', '/api/nemlig/status')).proposals, [], 'editing a local draft never creates or approves a live proposal');
    await f.stop();
    await f.start();
    assert.deepEqual((await f.api('GET', '/api/shopping-drafts')).drafts, [edited]);
    const staleSource = (await f.api('GET', `/api/meals/plans/${meal.id}`)).plan;
    await f.api('PUT', `/api/meals/plans/${meal.id}`, { expectedRevision: staleSource.revision, dishes: dishEdits(staleSource, { 0: { title: 'Plan ændret efter indkøbsforslag' } }) });
    await f.api('PUT', `/api/shopping-drafts/${draft.id}`, { expectedRevision: edited.revision, items }, { status: 409 });
  });
});
