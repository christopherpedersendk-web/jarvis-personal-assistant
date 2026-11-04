import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const token = 'synthetic-v5-http-token-32-characters-long';
const safeEnv = () => ({
  ...Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].filter(name => process.env[name])
    .map(name => [name, process.env[name]])),
  TZ: 'Europe/Copenhagen', OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY',
  NEMLIG_ENABLE_LIVE: 'no', NEMLIG_MCP_DIR: '', GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '', PUSHOVER_APP_TOKEN: '', JARVIS_ALLOW_NPM_INSTALL: 'no',
  JARVIS_UPDATE_REPO: '', JARVIS_ACCESS_TOKEN: token, JARVIS_HOST: '127.0.0.1',
});

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const value = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return value;
}

async function fixture(t, { legacy = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-http-'));
  if (legacy) await writeFile(join(dir, 'state.json'), JSON.stringify(legacy));
  let child = null, exit = null, base = '';
  const logs = [];
  async function stop() {
    if (!child) return;
    child.kill('SIGTERM');
    await Promise.race([exit, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    child = null;
  }
  async function start() {
    const port = await freePort(); base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.mjs'], { cwd: appRoot,
      env: { ...safeEnv(), JARVIS_DATA_DIR: dir, JARVIS_UPDATE_STAGING: join(dir, 'stage'),
        JARVIS_PROJECT_ROOT: join(dir, 'projects'), JARVIS_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => logs.push(String(chunk)));
    child.stderr.on('data', chunk => logs.push(String(chunk)));
    exit = new Promise(resolve => child.once('close', resolve));
    for (let i = 0; i < 120; i++) {
      try { const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return; }
      catch { /* startup */ }
      if (child.exitCode !== null) break;
      await delay(40);
    }
    throw new Error(`synthetic server failed: ${logs.join('').slice(-6000)}`);
  }
  async function api(method, path, input, expected = 200, auth = true) {
    const response = await fetch(base + path, { method,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      signal: AbortSignal.timeout(4000) });
    const raw = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${raw} / ${logs.join('').slice(-3000)}`);
    return { raw, data: JSON.parse(raw) };
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  return { dir, start, stop, api };
}

test('v5 HTTP: independent personal knowledge, tasks and cases survive restart with revision controls', { timeout: 30_000 }, async t => {
  const f = await fixture(t, { legacy: { preferences: 'syntetisk', extraLegacy: { manual: true } } });
  for (const path of ['/api/overview', '/api/personal-tasks', '/api/personal-claims', '/api/follow-ups'])
    await f.api('GET', path, undefined, 401, false);
  assert.equal((await f.api('GET', '/health')).data.version, '5.0.0');
  const state = (await f.api('GET', '/api/state')).data;
  assert.equal(state.preferences, 'syntetisk');
  assert.equal(JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8')).extraLegacy.manual, true);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8')).schemaVersion, 1);
  assert.equal(JSON.parse(await readFile(`${join(f.dir, 'state.json')}.v4.9.1-before-v5.backup`, 'utf8')).schemaVersion, undefined);

  const task = (await f.api('POST', '/api/personal-tasks', { title: 'Afklar vilkår',
    purpose: 'Træf en informeret beslutning', durationMinutes: 30 }, 201)).data.task;
  assert.equal(task.revision, 1);
  await f.api('PATCH', `/api/personal-tasks/${task.id}`, { expectedRevision: 0, title: 'Overskrevet' }, 409);
  const claim = (await f.api('POST', '/api/personal-claims', {
    subject: 'foedselsdag_mor', value: '17. maj', category: 'fact' }, 201)).data.claim;
  assert.equal(claim.status, 'proposed');
  const confirmed = (await f.api('POST', `/api/personal-claims/${claim.id}/confirm`, { expectedRevision: 1 })).data.claim;
  assert.equal(confirmed.status, 'confirmed');
  await f.api('POST', `/api/personal-claims/${claim.id}/confirm`, { expectedRevision: 1 }, 409);
  const follow = (await f.api('POST', '/api/follow-ups', { awaiting: 'Svar på forespørgsel',
    nextCheckAt: '2026-11-07T12:00:00+01:00', stopCondition: 'Svar modtaget',
    source: { kind: 'user', id: 'manual' } }, 201)).data.case;
  assert.equal(follow.status, 'open');

  const simulatedUnknown = (await f.api('POST', '/api/planning/simulate', {
    workWindows: [{ start: '2026-11-08T09:00:00+01:00', end: '2026-11-08T12:00:00+01:00' }],
    calendarCoverage: { status: 'unknown' }, calendarEvents: [] })).data.plan;
  assert.equal(simulatedUnknown.feasible, false);
  assert.equal(simulatedUnknown.conflicts[0].code, 'calendar-unknown');
  const simulatedKnown = (await f.api('POST', '/api/planning/simulate', {
    workWindows: [{ start: '2026-11-08T09:00:00+01:00', end: '2026-11-08T12:00:00+01:00' }],
    calendarCoverage: { status: 'ready', start: '2026-11-08T09:00:00+01:00', end: '2026-11-08T12:00:00+01:00' },
    calendarEvents: [] })).data.plan;
  assert.equal(simulatedKnown.feasible, true);
  assert.equal(simulatedKnown.proposals[0].taskId, task.id);

  await f.stop(); await f.start();
  assert.equal((await f.api('GET', '/api/personal-tasks')).data.tasks[0].id, task.id);
  assert.equal((await f.api('GET', '/api/personal-claims')).data.claims[0].status, 'confirmed');
  assert.equal((await f.api('GET', '/api/follow-ups')).data.cases[0].id, follow.id);
  const completed = (await f.api('POST', `/api/personal-tasks/${task.id}/complete`, { expectedRevision: 1 })).data.task;
  assert.equal(completed.status, 'completed');
  assert.equal((await f.api('GET', '/api/overview')).data.summary.projectCount, 0);
  const full = await f.api('GET', '/api/state');
  const overview = await f.api('GET', '/api/overview');
  assert.ok(overview.raw.length < full.raw.length, 'polling uses a smaller bounded response');
});

test('v5 HTTP: reviewable household rhythm and inventory never activate retailer writes', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.api('PUT', '/api/meals/household', { adults: 2, children: [{ age: 7 }],
    rhythm: { anchorMonday: '2026-11-02', weeks: [{ '1': { adults: 1, children: [], theme: 'quick' } }] } });
  const inventory = (await f.api('PUT', '/api/meals/inventory', { expectedRevision: 1,
    items: [{ name: 'ris', quantity: 500, unit: 'g', lastConfirmedAt: '2026-11-04T10:00:00Z' }] })).data.inventory;
  assert.equal(inventory.revision, 2);
  assert.equal((await f.api('GET', '/api/meals/inventory')).data.inventory.items[0].quantity, 500);
  const plan = (await f.api('POST', '/api/meals/plans', { startDate: '2026-11-09', days: 2, useCalendar: false }, 201)).data.plan;
  assert.equal(plan.dishes[0].servings, 1);
  const changed = (await f.api('POST', `/api/meals/plans/${plan.id}/regenerate`, { expectedRevision: plan.revision })).data.plan;
  assert.equal(changed.revision, 2);
  await f.api('POST', `/api/meals/plans/${plan.id}/swap`, { expectedRevision: 1,
    firstDate: plan.dishes[0].date, secondDate: plan.dishes[1].date }, 409);
  const status = (await f.api('GET', '/api/nemlig/status')).data;
  assert.equal(status.canPlaceOrder, false);
  assert.equal(status.approvalRequired, true);
  assert.equal(status.configured, false);
});

test('v5 HTTP: Nemlig direct approvals lack one-use revision-bound owner-click intention', { timeout: 20_000 }, async t => {
  const id = '22222222-2222-4222-8222-222222222222';
  const f = await fixture(t, { legacy: { nemligProposals: [{ id, revision: 3, status: 'pending',
    basketFingerprint: 'synthetic', additions: [{ productId: '11', previous: 0, target: 1, add: 1 }],
    expiresAt: '2099-01-01T00:00:00.000Z' }] } });
  await f.api('POST', `/api/nemlig/proposals/${id}/approve`, { approved: true, expectedRevision: 3 }, 409);
  await f.api('POST', `/api/nemlig/proposals/${id}/transfer-intent`, { expectedRevision: 2 }, 409);
  const intent = (await f.api('POST', `/api/nemlig/proposals/${id}/transfer-intent`, { expectedRevision: 3 })).data;
  assert.equal(intent.revision, 3);
  // The synthetic fixture deliberately has no MCP process. It must not write
  // anything, and a consumed intention must never permit an automatic retry.
  await f.api('POST', `/api/nemlig/proposals/${id}/approve`, {
    approved: true, expectedRevision: 3, intentToken: intent.intentToken }, 409);
  await f.api('POST', `/api/nemlig/proposals/${id}/approve`, {
    approved: true, expectedRevision: 3, intentToken: intent.intentToken }, 409);
  assert.equal((await f.api('GET', '/api/nemlig/status')).data.proposals[0].status, 'pending');
});
