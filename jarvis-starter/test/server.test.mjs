import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from './helpers/synthetic-env.mjs';

test('local server protects endpoints and persists preferences without a paid API request', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-test-'));
  const token = 'a-long-private-test-token-for-jarvis';
  const port = 27000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: syntheticServerEnv({ dataDir, accessToken: token, port }),
    stdio: 'ignore',
  });
  t.after(() => server.kill());

  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${base}/health`);
      ready = response.ok;
      if (ready) break;
    } catch { /* wait for process */ }
    await delay(100);
  }
  assert.equal(ready, true, 'server should start');

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /JARVIS/);
  for (const asset of ['/organizer.js','/organizer.css','/dashboard.css','/intelligence.js','/intelligence.css','/meals.js','/meals.css']) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200, `${asset} must be served to both Windows and iPhone browsers`);
  }

  const unauthorized = await fetch(`${base}/api/state`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await fetch(`${base}/api/discord/settings`)).status, 401);
  assert.equal((await fetch(`${base}/api/knowledge/search`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/api/proactive`)).status, 401);
  assert.equal((await fetch(`${base}/api/skills`)).status, 401);
  assert.equal((await fetch(`${base}/api/integrations`)).status, 401);
  assert.equal((await fetch(`${base}/api/meals`)).status, 401);
  assert.equal((await fetch(`${base}/api/nemlig/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/google/calendar/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/nemlig/proposals/example/approve`, { method: 'POST' })).status, 401);

  const authorizedHeaders = { Authorization: `Bearer ${token}` };
  const discordInitial = await fetch(`${base}/api/discord/settings`, { headers: authorizedHeaders });
  assert.equal((await discordInitial.json()).hasToken, false);
  const discordInvalid = await fetch(`${base}/api/discord/settings`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, userId: '123', guildId: '', token: 'secret-bot' }),
  });
  assert.equal(discordInvalid.status, 400);
  const discordSaved = await fetch(`${base}/api/discord/settings`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, userId: '123456789012345678', guildId: '', token: 'secret-bot' }),
  });
  assert.equal(discordSaved.status, 200);
  const discordSettings = await (await fetch(`${base}/api/discord/settings`, { headers: authorizedHeaders })).json();
  assert.equal(discordSettings.hasToken, true);
  assert.equal(discordSettings.token, undefined, 'the bot secret must not be exposed');
  const privateSettings = JSON.parse(await readFile(join(dataDir, 'private-settings.json'), 'utf8'));
  assert.equal(privateSettings.discord.token, 'secret-bot');
  const initial = await fetch(`${base}/api/state`, { headers: authorizedHeaders });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).configured, false);

  const save = await fetch(`${base}/api/preferences`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Kan lide D&D' }),
  });
  assert.equal(save.status, 200);
  const stored = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(stored.preferences, 'Kan lide D&D');

  const taskResponse = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Planlagt research', prompt: 'Undersøg noget i morgen', runAt: '2027-01-10T12:00:00Z' }),
  });
  assert.equal(taskResponse.status, 201);
  const createdTask = (await taskResponse.json()).task;
  const taskListResponse = await fetch(`${base}/api/tasks`, { headers: authorizedHeaders });
  assert.equal(taskListResponse.status, 200);
  assert.equal((await taskListResponse.json()).tasks[0].id, createdTask.id);
  const pauseResponse = await fetch(`${base}/api/tasks/${createdTask.id}/action`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pause' }),
  });
  assert.equal((await pauseResponse.json()).task.status, 'paused');

  const unauthTasks = await fetch(`${base}/api/tasks`);
  assert.equal(unauthTasks.status, 401);

  const codeList = await fetch(`${base}/api/code`, { headers: authorizedHeaders });
  assert.equal(codeList.status, 200);
  const codeInfo = await codeList.json();
  assert.ok(codeInfo.files.includes('persona.md'));
  assert.equal(codeInfo.files.includes('.env'), false);
  const unauthorizedCode = await fetch(`${base}/api/code`);
  assert.equal(unauthorizedCode.status, 401);
  const forbiddenCode = await fetch(`${base}/api/code`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: '.env', request: 'Rediger nøgler' }),
  });
  assert.equal(forbiddenCode.status, 400);

  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test webapp', description: 'En lille app til test' }),
  });
  assert.equal(projectResponse.status, 201);
  const newProject = (await projectResponse.json()).project;
  const projectsResponse = await fetch(`${base}/api/projects`, { headers: authorizedHeaders });
  assert.ok((await projectsResponse.json()).projects.some(p => p.id === newProject.id));
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);

  const secretaryResponse = await fetch(`${base}/api/secretary`, { headers: authorizedHeaders });
  assert.equal(secretaryResponse.status, 200);
  assert.match((await secretaryResponse.json()).playbook, /Morgenrapport/);
  const memoryResponse = await fetch(`${base}/api/memories`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Jeg foretrækker danske kilder.' }),
  });
  assert.equal(memoryResponse.status, 201);
  const actionResponse = await fetch(`${base}/api/approvals`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'booking', title: 'Biograf', description: 'Forbered to billetter', url: 'https://example.com' }),
  });
  assert.equal(actionResponse.status, 201);
  const action = (await actionResponse.json()).action;
  const decision = await fetch(`${base}/api/approvals/${action.id}/decision`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal((await decision.json()).action.status, 'approved_not_executed');
  assert.equal((await fetch(`${base}/api/secretary`)).status, 401);

  const newListResponse = await fetch(`${base}/api/organizer`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Fødselsdage', type: 'dates' }),
  });
  assert.equal(newListResponse.status, 201);
  const newList = (await newListResponse.json()).collection;
  const itemResponse = await fetch(`${base}/api/organizer/${newList.id}/items`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Min brors fødselsdag', date: '1980-11-07', annual: true }),
  });
  assert.equal(itemResponse.status, 201);
  const item = (await itemResponse.json()).item;
  const found = await fetch(`${base}/api/organizer/search`, { method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'brors' }) });
  assert.equal((await found.json()).matches[0].id, item.id);
  const dashboardResponse = await fetch(`${base}/api/dashboard`, { headers: authorizedHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.ok(dashboard.upcoming.some(x => x.title === 'Min brors fødselsdag'));
  assert.ok(dashboard.agenda.week.some(x => x.title === 'Min brors fødselsdag'));
  assert.equal((await fetch(`${base}/api/organizer`)).status, 401);

  const knowledgeResponse = await fetch(`${base}/api/knowledge/search`, { method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'brors' }) });
  assert.equal(knowledgeResponse.status, 200);
  const knowledge = await knowledgeResponse.json();
  assert.equal(knowledge.mode, 'local-lexical');
  assert.ok(knowledge.matches.some(x => x.source.itemId === item.id));
  const skillsResponse = await fetch(`${base}/api/skills`, { headers: authorizedHeaders });
  const versions = (await skillsResponse.json()).skills;
  assert.equal(versions.length, 8, 'four current procedure versions and four preserved historical ones');
  assert.equal(versions.filter(skill => skill.current && skill.version === '1.1.0').length, 4);
  assert.equal(versions.filter(skill => !skill.current && skill.version === '1.0.0').length, 4);
  const integrationsResponse = await fetch(`${base}/api/integrations`, { headers: authorizedHeaders });
  const integrations = await integrationsResponse.json();
  assert.equal(integrations.integrations.find(x => x.id === 'google-calendar').implementation, 'available');
  assert.equal(integrations.integrations.find(x => x.id === 'nemlig').status, 'not_configured');
  assert.doesNotMatch(JSON.stringify(integrations), /secret-bot/);
  const calendarStatus = await (await fetch(`${base}/api/google/calendar/status`, { headers: authorizedHeaders })).json();
  assert.equal(calendarStatus.configured, false);
  assert.equal(calendarStatus.canEdit, false);
  assert.equal((await fetch(`${base}/api/google/calendar/connect`, { method: 'POST', headers: authorizedHeaders })).status, 409);
  const nemligStatus = await (await fetch(`${base}/api/nemlig/status`, { headers: authorizedHeaders })).json();
  assert.equal(nemligStatus.configured, false);
  assert.equal(nemligStatus.canPlaceOrder, false);
  assert.equal(nemligStatus.approvalRequired, true);
  const newProfile = await fetch(`${base}/api/meals/profile`, {
    method: 'PUT', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdSize: 3, diet: 'vegan', avoid: ['æg'], pantry: [{ name: 'ris', quantity: 100, unit: 'g' }], budgetDkk: 500 }),
  });
  assert.equal(newProfile.status, 200);
  assert.equal((await newProfile.json()).profile.diet, 'vegan');
  const newPlan = await fetch(`${base}/api/meals/plans`, {
    method: 'POST', headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: '2026-11-05', days: 3 }),
  });
  assert.equal(newPlan.status, 201);
  const planned = (await newPlan.json()).plan;
  assert.equal(planned.dishes.length, 3);
  assert.equal(planned.priceStatus, 'unknown-until-retailer-lookup');
  const mealSearch = await fetch(`${base}/api/knowledge/search`, { method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'madplan' }) });
  assert.equal((await mealSearch.json()).matches.some(x => x.type === 'meal-plan'), true);
  const proactiveSettings = await fetch(`${base}/api/proactive/settings`, { method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyTime: '08:45', discordEnabled: false }) });
  assert.equal(proactiveSettings.status, 200);
  assert.equal((await proactiveSettings.json()).settings.dailyTime, '08:45');
  const badProactiveSettings = await fetch(`${base}/api/proactive/settings`, { method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyTime: '25:90' }) });
  assert.equal(badProactiveSettings.status, 400);

  const chat = await fetch(`${base}/api/message`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hej!' }),
  });
  assert.equal(chat.status, 503, 'chat should require a configured API key');
  const chatFailure = await chat.json();
  assert.equal(chatFailure.code, 'CHAT_NOT_CONFIGURED');
  assert.equal(chatFailure.outcome, 'no_actions');

  const transcript = await fetch(`${base}/api/transcript`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', text: 'Et godt spørgsmål', eventId: 'unique-test-event' }),
  });
  assert.equal(transcript.status, 200);
  const updated = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(updated.history[0].text, 'Et godt spørgsmål');
});
