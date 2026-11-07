import { offlineSnapshot } from '../scripts/offline-snapshot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from './helpers/synthetic-env.mjs';
import { realtimeNetworkFixture } from './helpers/realtime-network.mjs';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const token = 'synthetic-v5-http-token-32-characters-long';

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const value = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return value;
}

async function fixture(t, { legacy = null, voice = false } = {}) {
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
    child = spawn(process.execPath, [...(voice?['--import',`data:text/javascript,${encodeURIComponent(realtimeNetworkFixture)}`]:[]),'server.mjs'], { cwd: appRoot,
      env: syntheticServerEnv({ dataDir: dir, accessToken: token, port,...(voice?{modelKey:'sk-synthetic-voice-http-key-32-characters'}:{}) }),
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => logs.push(String(chunk)));
    child.stderr.on('data', chunk => logs.push(String(chunk)));
    exit = new Promise(resolve => child.once('close', resolve));
    for (let i = 0; i < 120; i++) {
      try { const response = await fetch(`${base}/api/settings`, { headers:{Authorization:`Bearer ${token}`}, signal: AbortSignal.timeout(500) });
        const ownServer=response.ok;await response.body?.cancel();if(ownServer)return; }
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
  async function asset(path) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(4000) });
    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  return { dir, start, stop, api, asset, async voiceLease() {
    const response=await fetch(base+'/api/realtime',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/sdp'},body:'v=0\r\nsynthetic-offer'});
    assert.equal(response.status,201,await response.text());const id=response.headers.get('x-jarvis-voice-lease');assert.ok(id);return id;
  } };
}

test('v5 HTTP: every v5 browser entrypoint is served with its real CSS/JS type', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const page = await f.asset('/');
  assert.equal(page.status, 200);
  const linkedAssets = [...page.body.matchAll(/(?:src|href)="(\/[^" ]+\.(?:css|js))"/g)].map(match => match[1]);
  assert.ok(linkedAssets.length >= 20, 'all of the new and preserved frontend modules should be linked');
  for (const path of linkedAssets) {
    const response = await f.asset(path);
    assert.equal(response.status, 200, `${path} linked by index.html must be served`);
    assert.match(response.type, path.endsWith('.css') ? /text\/css/ : /text\/javascript/);
  }
  for (const [path, type, marker] of [
    ['/v5.css', 'text/css', '#tab-home .chat-panel'],
    ['/v5-plan.js', 'text/javascript', 'personal-task-form'],
  ]) {
    assert.match(page.body, new RegExp(path.replace('.', '\\.')));
    const response = await f.asset(path);
    assert.equal(response.status, 200, `${path} must not be a silent 404`);
    assert.match(response.type, new RegExp(type));
    assert.ok(response.body.includes(marker), `${path} is missing the expected v5 behavior`);
  }
});

test('R04 HTTP requires the exact reviewed release SHA before any staging or approval work', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const before = (await f.api('GET', '/api/updates')).data;
  assert.equal(before.storage.ready, true); assert.equal(before.publicationUnknown, false);
  await f.api('GET', '/api/updates', undefined, 401, false);
  await f.api('POST', '/api/updates/action', { action: 'approve', version: 'v5.0.0', expectedSha: 'a'.repeat(40) }, 401, false);
  for (const action of ['stage', 'approve']) for (const input of [{}, { version: 'v5.0.0' },
    { version: 'v5.0.0', expectedSha: 'short' }, { version: 'v5.0.0', expectedSha: ['a'.repeat(40)] },
    { version: 'v5.0.0-rc1', expectedSha: 'a'.repeat(40) }]) {
    const rejected = (await f.api('POST', '/api/updates/action', { action, ...input }, 409)).data;
    assert.equal(rejected.code, 'UPDATE_REVIEW_REQUIRED');
  }
  assert.deepEqual((await f.api('GET', '/api/updates')).data, before);
});

test('C5 HTTP rejects an impossible follow-up date and preserves an existing observation history', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const input = { awaiting: 'Syntetisk svar', nextCheckAt: '2026-02-30T12:00:00Z',
    stopCondition: 'Syntetisk svar modtaget', source: { kind: 'user', id: 'synthetic-manual' } };
  await f.api('POST', '/api/follow-ups', input, 400);
  assert.deepEqual((await f.api('GET', '/api/follow-ups')).data.cases, []);
  const created = (await f.api('POST', '/api/follow-ups', { ...input, nextCheckAt: '2026-11-06T12:00:00+01:00' }, 201)).data.case;
  await f.api('PATCH', `/api/follow-ups/${created.id}`, { action: 'observe', expectedRevision: 1,
    nextCheckAt: input.nextCheckAt, observation: { status: 'unknown', source: 'synthetic', subject: 'Syntetisk svar' } }, 409);
  assert.deepEqual((await f.api('GET', '/api/follow-ups')).data.cases, [created]);
});

test('v5 HTTP: independent personal knowledge, tasks and cases survive restart with revision controls', { timeout: 30_000 }, async t => {
  const f = await fixture(t, { legacy: { preferences: 'syntetisk', extraLegacy: { manual: true } } });
  for (const path of ['/api/overview', '/api/personal-tasks', '/api/personal-claims', '/api/follow-ups'])
    await f.api('GET', path, undefined, 401, false);
  assert.equal((await f.api('GET', '/health')).data.version, JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')).version);
  assert.equal((await f.api('GET', '/ready')).data.storage.ready, true);
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
  const unconnectedCalendar = (await f.api('POST', '/api/planning/simulate', {
    useCalendar: true, workWindows: [{ start: '2026-11-08T09:00:00+01:00', end: '2026-11-08T12:00:00+01:00' }],
    calendarCoverage: { status: 'ready', start: '2026-11-01T00:00:00Z', end: '2026-11-20T00:00:00Z' },
    calendarEvents: [] })).data.plan;
  assert.equal(unconnectedCalendar.feasible, false, 'a supplied ready flag cannot impersonate a connected read-only calendar');
  assert.equal(unconnectedCalendar.conflicts[0].code, 'calendar-unknown');
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

test('D4 HTTP calendar cache is authenticated, local and unknown without a configured source', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  await f.api('GET', '/api/google/calendar/cache', undefined, 401, false);
  const cache = (await f.api('GET', '/api/google/calendar/cache?startDate=2026-11-05&days=7')).data;
  assert.equal(cache.canEdit, false); assert.equal(cache.scope, 'calendar.readonly');
  assert.equal(cache.connectionState, 'not_configured'); assert.equal(cache.cacheState, 'unknown');
  assert.equal(cache.ready, false); assert.deepEqual(cache.events, []); assert.equal(cache.dinnerDays.length, 7);
  assert.ok(cache.dinnerDays.every(day => day.status === 'unknown'));
  await f.api('GET', '/api/google/calendar/cache?startDate=2026-02-31', undefined, 400);
  await f.api('GET', '/api/google/calendar/cache?days=5000', undefined, 400);
  await f.api('GET', '/api/google/calendar/cache?start=2026-11-05', undefined, 400);
  assert.equal((await f.api('GET', '/api/google/calendar/status')).data.lastReadAt, null);
  assert.deepEqual((await f.api('GET', '/api/state')).data.mealHousehold.days, {}, 'calendar text cannot supply household attendance');
});

test('B1 HTTP legacy note history is authenticated, read-only, excluded from active context and retained after restart/archive', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const note = (await f.api('POST', '/api/memories', { text: 'Syntetisk gammel akvarelpræference', category: 'preference' }, 201)).data.memory;
  const path = `/api/memories/${note.id}`;
  await f.api('GET', `${path}/history`, undefined, 401, false);
  const edited = (await f.api('PUT', path, { text: 'Syntetisk ny præference for keramik', expectedRevision: note.revision })).data.memory;
  assert.equal(edited.historyCount, 1); assert.ok(!Object.hasOwn(edited, 'revisionHistory'));
  await f.api('PUT', path, { text: 'Stale overskrivning', expectedRevision: note.revision }, 409);
  const old = (await f.api('GET', `${path}/history`)).data;
  assert.equal(old.history[0].text, note.text); assert.equal(old.history[0].historical, true);
  assert.equal(old.revision, edited.revision); assert.equal(old.history[0].revision, note.revision);
  const same = (await f.api('PUT', path, { text: edited.text, expectedRevision: edited.revision })).data.memory;
  assert.equal(same.revision, edited.revision); assert.equal(same.historyCount, 1);
  const list = (await f.api('GET', '/api/memories')).data.memories;
  assert.ok(list.every(item => !Object.hasOwn(item, 'revisionHistory')));
  const context = (await f.api('GET', '/api/secretary')).raw;
  assert.ok(context.includes(edited.text)); assert.ok(!context.includes(note.text));
  const beforeRead = await readFile(join(f.dir, 'state.json'), 'utf8');
  await f.api('GET', `${path}/history`); await f.api('GET', '/api/memories?includeArchived=yes');
  assert.equal(await readFile(join(f.dir, 'state.json'), 'utf8'), beforeRead, 'history reads never publish state');
  const archived = (await f.api('POST', `${path}/archive`, { expectedRevision: edited.revision })).data.memory;
  assert.equal(archived.historyCount, 2);
  assert.ok(!(await f.api('GET', '/api/memories')).data.memories.some(item => item.id === note.id));
  assert.ok((await f.api('GET', '/api/memories?includeArchived=yes')).data.memories.some(item => item.id === note.id && item.archived));
  await f.api('GET', '/api/memories?includeArchived=truthy', undefined, 400);
  await f.stop(); await f.start();
  const restored = (await f.api('GET', `${path}/history`)).data;
  assert.equal(restored.archived, true); assert.equal(restored.historyCount, 2);
  assert.deepEqual(restored.history.map(item => item.text), [note.text, edited.text]);
  assert.ok(!(await f.api('GET', '/api/secretary')).raw.includes(edited.text));
});

test('H2/I4 fresh installations and implicit task creation never activate new background work', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const settings = (await f.api('GET', '/api/settings')).data;
  assert.equal(settings.remindersEnabled, false); assert.equal(settings.discordAlertsEnabled, false);
  const proactive = (await f.api('GET', '/api/proactive')).data.settings;
  assert.equal(proactive.dailyEnabled, false); assert.equal(proactive.weeklyEnabled, false); assert.equal(proactive.discordEnabled, false);
  const task = (await f.api('POST', '/api/tasks', { title: 'Kun et forslag', prompt: 'Ingen model eller konto i denne test', intervalMinutes: 60 }, 201)).data.task;
  assert.equal(task.status, 'paused'); assert.deepEqual(task.runs, []);
  assert.equal((await f.api('GET', '/api/tasks')).data.usage.started, 0);
  assert.deepEqual((await f.api('GET', '/api/jobs')).data.jobs, []);
});

test('I4 migration keeps recorded v4 background preferences rather than treating them as a new activation', { timeout: 15_000 }, async t => {
  const f = await fixture(t, { legacy: { settings: { remindersEnabled: true, proactive: { dailyEnabled: true, weeklyEnabled: false, discordEnabled: false } } } });
  assert.equal((await f.api('GET', '/api/settings')).data.remindersEnabled, true);
  const current = (await f.api('GET', '/api/proactive')).data.settings;
  assert.equal(current.dailyEnabled, true); assert.equal(current.weeklyEnabled, false); assert.equal(current.discordEnabled, false);
});

test('B2 HTTP correction, source review and invalidation survive restart without rewriting history', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const proposed = (await f.api('POST', '/api/personal-claims', { subject: 'pendling', value: 'Jeg cykler til arbejde.',
    sourceId: 'note:syntetisk', source: { kind: 'assistant', channel: 'discord' }, status: 'confirmed' }, 201)).data.claim;
  assert.equal(proposed.status, 'proposed'); assert.deepEqual(proposed.source, { kind: 'user', channel: 'manual', id: 'note:syntetisk' });
  const edited = (await f.api('PATCH', `/api/personal-claims/${proposed.id}`, { expectedRevision: 1,
    value: 'Jeg cykler normalt til kontoret.', category: 'preference', sourceId: 'note:gennemgået' })).data.claim;
  assert.equal(edited.revision, 2); assert.equal(edited.revisions[0].value, proposed.value);
  await f.api('PATCH', `/api/personal-claims/${proposed.id}`, { expectedRevision: 1, value: 'Gammel kladde' }, 409);
  const original = (await f.api('POST', `/api/personal-claims/${proposed.id}/confirm`, { expectedRevision: 2 })).data.claim;
  await f.api('PATCH', `/api/personal-claims/${original.id}`, { expectedRevision: 3, value: 'Ingen historik' }, 409);
  const correction = (await f.api('POST', '/api/personal-claims', { subject: 'pendling', value: 'Jeg tager nu sporvogn til kontoret.',
    correctsId: original.id, correctsRevision: 3, sourceId: 'note:rettelse' }, 201)).data.claim;
  await f.api('POST', `/api/personal-claims/${correction.id}/confirm`, { expectedRevision: 1, supersedesId: original.id }, 409);
  await f.api('POST', `/api/personal-claims/${correction.id}/confirm`, { expectedRevision: 1, supersedesId: original.id, supersedesRevision: 3 });
  let matches = (await f.api('POST', '/api/knowledge/search', { query: 'pendling' })).data.matches;
  assert.ok(matches.some(x => x.id === `claim:${correction.id}`)); assert.ok(!matches.some(x => x.id === `claim:${original.id}`));
  await f.api('POST', `/api/personal-claims/${correction.id}/invalidate`, { expectedRevision: 2 });
  matches = (await f.api('POST', '/api/knowledge/search', { query: 'pendling' })).data.matches;
  assert.ok(!matches.some(x => x.type === 'memory'));
  await f.stop(); await f.start();
  const claims = (await f.api('GET', '/api/personal-claims')).data.claims;
  assert.equal(claims.find(x => x.id === original.id).status, 'superseded');
  const invalid = claims.find(x => x.id === correction.id);
  assert.equal(invalid.status, 'invalid'); assert.equal(invalid.revisions[1].status, 'confirmed');
  assert.equal(invalid.revisions[1].source.id, 'note:rettelse');
});

test('R03 HTTP organizer rename, archive and item delete use the reviewed version and preserve concurrent edits', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const collection = (await f.api('POST', '/api/organizer', { title: 'Syntetisk liste', type: 'notes' }, 201)).data.collection;
  const item = (await f.api('POST', `/api/organizer/${collection.id}/items`, { text: 'Første note' }, 201)).data.item;
  await f.api('PUT', `/api/organizer/${collection.id}`, { title: 'Gammel titel', updatedAt: collection.updatedAt }, 400);
  await f.api('DELETE', `/api/organizer/${collection.id}`, { updatedAt: collection.updatedAt }, 400);
  const updated = (await f.api('PATCH', `/api/organizer/${collection.id}/items/${item.id}`, { text: 'Ny note', updatedAt: item.updatedAt })).data.item;
  await f.api('DELETE', `/api/organizer/${collection.id}/items/${item.id}`, { updatedAt: item.updatedAt }, 400);
  const preserved = (await f.api('GET', `/api/organizer/${collection.id}`)).data.collection;
  assert.equal(preserved.items[0].text, 'Ny note'); assert.equal(preserved.title, collection.title);
  await f.api('DELETE', `/api/organizer/${collection.id}/items/${item.id}`, { updatedAt: updated.updatedAt });
  const current = (await f.api('GET', `/api/organizer/${collection.id}`)).data.collection;
  await f.api('DELETE', `/api/organizer/${collection.id}`, { updatedAt: current.updatedAt });
  assert.deepEqual((await f.api('GET', '/api/organizer')).data.collections, []);
});

test('J1 HTTP bootstrap and paged history omit unrelated source payloads without deleting stored data', { timeout: 20_000 }, async t => {
  const history = Array.from({ length: 65 }, (_, i) => ({ role: 'user', text: `Syntetisk besked ${i}`, channel: 'text', at: new Date(Date.UTC(2026, 10, 5, 8, i)).toISOString() }));
  const f = await fixture(t, { legacy: { history, preferences: 'Bevaret note', extraLegacy: { marker: 'bevares-paa-disk' },
    organizer: [{ id: 'source', title: 'Kilde', type: 'notes', items: Array.from({ length: 400 }, (_, i) => ({ id: String(i), text: 'Syntetisk kildepost' })) }] } });
  const boot = (await f.api('GET', '/api/state?scope=bootstrap')).data;
  assert.equal(boot.history.length, 20); assert.equal(boot.historyPagination.total, 65);
  assert.equal('organizer' in boot, false); assert.equal('extraLegacy' in boot, false);
  assert.equal((await f.api('GET', '/api/state')).data.extraLegacy.marker, 'bevares-paa-disk');
  let cursor = boot.historyPagination.nextCursor, items = boot.history;
  while (cursor) { const page = (await f.api('GET', `/api/history?cursor=${encodeURIComponent(cursor)}`)).data;
    items = [...page.items, ...items]; cursor = page.nextCursor; }
  assert.deepEqual(items, history);
  await f.api('GET', '/api/history', undefined, 401, false);
  await f.api('GET', '/api/history?limit=500', undefined, 400);
  await f.api('POST', '/api/transcript', { role: 'user', text: 'Syntetisk ny besked', eventId: 'synthetic-history-append' });
  await f.api('GET', `/api/history?cursor=${encodeURIComponent(boot.historyPagination.nextCursor)}`, undefined, 409);
});

test('R03 HTTP text saves reject stale same-field baselines and preserve a newer edit', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.api('POST', '/api/preferences', { text: 'Første' });
  await f.api('POST', '/api/preferences', { text: 'Anden', expectedText: 'Første' });
  await f.api('POST', '/api/preferences', { text: 'Forældet kladde', expectedText: 'Første' }, 409);
  assert.equal((await f.api('GET', '/api/state?scope=bootstrap')).data.preferences, 'Anden');
  const baseline = (await f.api('GET', '/api/state?scope=bootstrap')).data.playbook;
  await f.api('POST', '/api/playbook', { content: 'Gennemgået procedure', expectedText: baseline });
  await f.api('POST', '/api/playbook', { content: 'Forældet procedure', expectedText: baseline }, 409);
  assert.equal((await f.api('GET', '/api/secretary')).data.playbook, 'Gennemgået procedure');
});

test('J6 HTTP project operations enforce the owner-reviewed revision before any model, test or file move', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const project = (await f.api('POST', '/api/projects', { title: 'Syntetisk UI-projekt', description: 'Afgrænset lokal testmappe' }, 201)).data.project;
  for (const [method, suffix, input] of [['POST', '/develop', { request: 'Ingen faktisk modelkørsel' }], ['POST', '/test', {}], ['POST', '/rollback', {}], ['DELETE', '', {}]]) {
    const result = await f.api(method, `/api/projects/${project.id}${suffix}`, { ...input, expectedRevision: 99 }, 409);
    assert.equal(result.data.code, 'REVISION_CONFLICT');
  }
  assert.equal((await f.api('GET', '/api/projects')).data.projects[0].revision, 0);
  await f.api('DELETE', `/api/projects/${project.id}`, { expectedRevision: 0 });
  assert.equal((await f.api('GET', '/api/projects')).data.archived[0].id, project.id);
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

test('E1 HTTP planned leftovers are revision-bound local allocations, never confirmed stock, consumption or a basket write', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.api('PUT', '/api/meals/household', { adults: 2, children: [] });
  const plan = (await f.api('POST', '/api/meals/plans', { startDate: '2026-11-09', days: 2, useCalendar: false }, 201)).data.plan;
  const before = (await f.api('GET', '/api/state')).data;
  const links = [{ fromDate: plan.dishes[0].date, toDate: plan.dishes[1].date, servings: plan.dishes[1].servings, minutes: 10 }];
  await f.api('POST', `/api/meals/plans/${plan.id}/leftovers`, { expectedRevision: 0, links }, 409);
  const linked = (await f.api('POST', `/api/meals/plans/${plan.id}/leftovers`, { expectedRevision: 1, links })).data.plan;
  assert.equal(linked.revision, 2); assert.deepEqual(linked.plannedLeftovers, links);
  assert.deepEqual(linked.dishes[1].ingredients, []);
  const after = (await f.api('GET', '/api/state')).data;
  for (const key of ['mealInventory', 'mealHousehold', 'nemligProposals', 'shoppingDrafts']) assert.deepEqual(after[key], before[key], key);
  assert.equal((await f.api('GET', '/api/google/calendar/status')).data.lastReadAt, null);
  const restored = (await f.api('POST', `/api/meals/plans/${plan.id}/leftovers`, { expectedRevision: 2, links: [] })).data.plan;
  assert.equal(restored.dishes[1].title, plan.dishes[1].title); assert.deepEqual(restored.dishes[1].ingredients, plan.dishes[1].ingredients);
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

test('M1 offline snapshot restores notes, media and settings and boots a separate service', {timeout: 30000}, async t => {
 const f = await fixture(t);
 const collection = (await f.api('POST', '/api/organizer', {title:'Restore fixture',type:'notes'},201)).data.collection;
 await f.stop();
 await writeFile(join(f.dir, 'private-settings.json'), '{}', {mode:0o600});
 await writeFile(join(f.dir, 'synthetic-media.bin'), Buffer.from([1,4,9]), {mode:0o600});
 const backup = f.dir + '-backup';
 t.after(() => rm(backup, {recursive:true,force:true}));
 await offlineSnapshot(f.dir, backup, {quiescent:true});
 await assert.rejects(offlineSnapshot(f.dir, backup, {quiescent:true}));
 // Restore into the now absent fixture directory, never overwrite a live tree.
 await rm(f.dir, {recursive:true});
 await offlineSnapshot(backup, f.dir, {quiescent:true});
 await f.start();
 assert.equal((await f.api('GET','/ready')).data.storage.ready,true);
 assert.equal((await f.api('GET','/api/organizer/' + collection.id)).data.collection.title,'Restore fixture');
 assert.deepEqual(await readFile(join(f.dir,'synthetic-media.bin')),Buffer.from([1,4,9]));
});

test('M2 restart normalizes saved data before revoking interrupted voice sessions', {timeout: 30000}, async t => {
 const f = await fixture(t, {legacy: {
  mealPlans: [{id:'legacy-meal', dishes:[], shoppingList:[]}],
  providerControl:{stopped:true,generation:3,entries:[]},
  voiceSessions:[{id:'interrupted',owner:'synthetic-owner',scope:{requestId:'old-request',generation:2},
   day:'2026-01-01',status:'creating',callId:null,reservedSeconds:600,expiresAt:1}],
 }});
 assert.equal((await f.api('GET','/ready')).data.storage.ready,true);
 let persisted=JSON.parse(await readFile(join(f.dir,'state.json')));
 assert.equal(persisted.mealPlans[0].schemaVersion,2);
 assert.equal(persisted.voiceSessions[0].status,'unknown');
 assert.equal(persisted.providerControl.stopped,true);
 await f.stop(); await f.start();
 persisted=JSON.parse(await readFile(join(f.dir,'state.json')));
 assert.equal(persisted.voiceSessions[0].status,'unknown');
 assert.equal(persisted.providerControl.stopped,true);
 assert.equal(persisted.providerControl.generation,3);
});

test('M2 HTTP voice aliases share exact-once dispatch, owner lease and durable stop', {timeout:30000},async t=>{
 const f=await fixture(t,{voice:true});
 const call={name:'create_personal_task',callId:'synthetic-once',args:{title:'Syntetisk stemmeopgave',purpose:'Test',durationMinutes:15}};
 for(const path of ['/api/voice/tool','/api/assistant/tool']){
  await f.api('POST',path,call,401,false);await f.api('POST',path,call,409);
 }
 const leaseId=await f.voiceLease();
 await f.api('POST','/api/assistant/tool',{...call,leaseId});
 assert.equal((await f.api('POST','/api/voice/tool',{...call,leaseId})).data.alreadyRecorded,true);
 assert.equal((await f.api('GET','/api/personal-tasks')).data.tasks.length,1);
 await f.api('POST','/api/assistant/control',{stopped:true});await f.stop();await f.start();
 assert.equal((await f.api('GET','/api/assistant/control')).data.stopped,true);
 await f.api('POST','/api/voice/tool',{...call,leaseId,callId:'blocked'},409);
 await f.api('POST','/api/assistant/control',{stopped:false});
 await f.api('POST','/api/voice/tool',{...call,leaseId,callId:'still-blocked'},409);
 const fresh=await f.voiceLease();assert.notEqual(fresh,leaseId);
 await f.api('POST','/api/voice/close',{leaseId:fresh});
 assert.equal((await f.api('GET','/api/personal-tasks')).data.tasks.length,1);
});
