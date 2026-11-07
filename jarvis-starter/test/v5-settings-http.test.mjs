import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rename, mkdir, rmdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticServerEnv } from './helpers/synthetic-env.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const accessToken = 'synthetic-owner-token-for-settings-http-only';
const forbiddenNetwork = `globalThis.fetch=async()=>{console.error('SYNTHETIC_NETWORK_BLOCK');throw new Error('External network forbidden in settings HTTP tests');};globalThis.WebSocket=class{constructor(){console.error('SYNTHETIC_NETWORK_BLOCK');throw new Error('External sockets forbidden in settings HTTP tests');}};`;
const scopePath = scope => scope === 'discord' ? '/api/discord/settings' : scope === 'proactive' ? '/api/proactive' : '/api/settings';
const bodyFor = (snapshot, patch) => ({ patch, expectedBasis: Object.fromEntries(Object.keys(patch).map(key => [key, snapshot.basis[key]])) });

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v5-settings-http-'));
  let child = null, base = '', output = '';
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const processToStop = child;
    await new Promise(resolve => { processToStop.once('exit', resolve); processToStop.kill('SIGTERM'); });
    child = null;
  };
  t.after(async () => {
    await stop();
    assert.equal(output.includes('SYNTHETIC_NETWORK_BLOCK'), false, 'no external fetch or socket was even attempted');
    await rm(dataDir, { recursive: true, force: true });
  });
  const start = async () => {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(forbiddenNetwork)}`, 'server.mjs'], {
      cwd: appRoot, env: syntheticServerEnv({ dataDir, accessToken, port, timeZone: 'UTC' }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes.toString()).slice(-64_000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) assert.fail(`Synthetic server exited before readiness: ${output}`);
      try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* local startup only */ }
      await delay(40);
    }
    assert.fail(`Synthetic server did not become ready: ${output}`);
  };
  const request = async (path, body, { authorized = true } = {}) => {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(authorized ? { Authorization: `Bearer ${accessToken}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  const snapshot = async scope => {
    const result = await request(scopePath(scope)); assert.equal(result.status, 200); return scope === 'proactive' ? result.body.settings : result.body;
  };
  await start();
  return { dataDir, request, snapshot, start, stop, logs: () => output,
    patch: (scope, reviewed, patch) => request(scope === 'proactive' ? '/api/proactive/settings' : scopePath(scope), bodyFor(reviewed, patch)) };
}

test('R02 HTTP simultaneous disjoint settings fields and scopes preserve every committed change', async t => {
  const f = await fixture(t), initial = await f.snapshot('settings'), initialDiscord = await f.snapshot('discord');
  const results = await Promise.all([
    f.patch('settings', initial, { maxRunsPerDay: 7 }),
    f.patch('settings', initial, { httpsUrl: 'https://synthetic-second.invalid' }),
    f.patch('discord', initialDiscord, { userId: '123456789012345678' }),
  ]);
  assert.deepEqual(results.map(item => item.status), [200, 200, 200]);
  for (const result of results) { assert.equal(result.body.ok, true); assert.ok(result.body.settings.basis); }
  const saved = await f.snapshot('settings'), savedDiscord = await f.snapshot('discord');
  assert.equal(saved.maxRunsPerDay, 7); assert.equal(saved.httpsUrl, 'https://synthetic-second.invalid');
  assert.equal(saved.discordAlertsEnabled, false); assert.equal(savedDiscord.enabled, false);
  assert.equal(savedDiscord.userId, '123456789012345678'); assert.equal(savedDiscord.status, 'disabled');
  const privateState = JSON.parse(await readFile(join(f.dataDir, 'private-settings.json'), 'utf8'));
  const state = JSON.parse(await readFile(join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(privateState.url, saved.httpsUrl); assert.equal(privateState.discord.userId, savedDiscord.userId);
  assert.equal(state.settings.maxRunsPerDay, 7);
  const tasks = await f.request('/api/tasks');
  assert.deepEqual(tasks.body.tasks, []); assert.equal(tasks.body.usage.started, 0);
});

test('R02 HTTP simultaneous same-field reviews yield one success and one complete 409 rejection', async t => {
  const f = await fixture(t), initial = await f.snapshot('settings');
  const results = await Promise.all([
    f.patch('settings', initial, { maxRunsPerDay: 7, httpsUrl: 'https://winner-seven.invalid' }),
    f.patch('settings', initial, { maxRunsPerDay: 8, httpsUrl: 'https://winner-eight.invalid' }),
  ]);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  assert.equal(results.find(item => item.status === 409).body.code, 'REVISION_CONFLICT');
  const saved = await f.snapshot('settings');
  assert.equal(saved.httpsUrl, saved.maxRunsPerDay === 7 ? 'https://winner-seven.invalid' : 'https://winner-eight.invalid');
  const persisted = JSON.parse(await readFile(join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.settings.maxRunsPerDay, saved.maxRunsPerDay);
});

test('R02/I3 HTTP secret fields remain private and HMAC wrappers survive ordinary API redaction', async t => {
  const f = await fixture(t), settings = await f.snapshot('settings'), discord = await f.snapshot('discord');
  const secrets = ['synthetic-unique-push-token-http', 'synthetic-unique-push-user-http', 'synthetic-unique-discord-token-http'];
  const results = await Promise.all([
    f.patch('settings', settings, { pushToken: secrets[0], pushUser: secrets[1] }),
    f.patch('discord', discord, { token: secrets[2] }),
  ]);
  assert.deepEqual(results.map(item => item.status), [200, 200]);
  const publicSettings = await f.snapshot('settings'), publicDiscord = await f.snapshot('discord');
  for (const value of [publicSettings, publicDiscord]) for (const proof of Object.values(value.basis)) {
    assert.deepEqual(Object.keys(proof), ['digest']); assert.match(proof.digest, /^[0-9a-f]{64}$/);
  }
  assert.equal(publicSettings.hasPushToken, true); assert.equal(publicSettings.hasPushUser, true);
  assert.equal(publicDiscord.hasToken, true); assert.equal(publicDiscord.enabled, false); assert.equal(publicDiscord.status, 'disabled');
  const responses = [results, publicSettings, publicDiscord, (await f.request('/api/state')).body,
    (await f.request('/api/integrations')).body, (await f.request('/api/skills')).body];
  const privateRaw = await readFile(join(f.dataDir, 'private-settings.json'), 'utf8');
  const publicRaw = await readFile(join(f.dataDir, 'state.json'), 'utf8');
  for (const secret of secrets) {
    assert.equal(privateRaw.includes(secret), true);
    assert.equal(publicRaw.includes(secret), false);
    assert.equal(JSON.stringify(responses).includes(secret), false);
    assert.equal(f.logs().includes(secret), false);
  }
  assert.equal((await stat(join(f.dataDir, 'private-settings.json'))).mode & 0o777, 0o600);
  assert.equal((await f.request('/api/tasks')).body.usage.started, 0);
});

test('R02 HTTP malformed or unreviewed patches cannot partially save or implicitly activate anything', async t => {
  const f = await fixture(t), initial = await f.snapshot('settings'), discord = await f.snapshot('discord');
  for (const body of [{ patch: { maxRunsPerDay: 7 }, expectedBasis: {} },
    { patch: { maxRunsPerDay: 7 }, expectedBasis: { maxRunsPerDay: initial.basis.maxRunsPerDay.digest } },
    bodyFor(initial, { pushToken: '' }), bodyFor(initial, { maxRunsPerDay: 7, httpsUrl: 'https://private:secret@synthetic.invalid' }),
    { ...bodyFor(initial, { maxRunsPerDay: 7 }), arbitraryPermission: true }]) {
    assert.equal((await f.request('/api/settings', body)).status, 400);
  }
  assert.equal((await f.patch('discord', discord, { enabled: 'true' })).status, 400);
  assert.equal((await f.patch('discord', discord, { userId: 'invalid-id' })).status, 400);
  const after = await f.snapshot('settings'), afterDiscord = await f.snapshot('discord');
  assert.equal(after.maxRunsPerDay, initial.maxRunsPerDay); assert.equal(after.httpsUrl, initial.httpsUrl);
  assert.deepEqual(after.basis, initial.basis); assert.deepEqual(afterDiscord.basis, discord.basis);
  assert.equal(afterDiscord.enabled, false); assert.deepEqual((await f.request('/api/tasks')).body.tasks, []);
});

test('R02 HTTP restart requires fresh field review while retaining every durably saved setting', async t => {
  const f = await fixture(t), initial = await f.snapshot('settings');
  const saved = await f.patch('settings', initial, { maxRunsPerDay: 7, httpsUrl: 'https://restart-synthetic.invalid' });
  assert.equal(saved.status, 200);
  const oldReview = saved.body.settings;
  await f.stop(); await f.start();
  const fresh = await f.snapshot('settings');
  assert.equal(fresh.maxRunsPerDay, 7); assert.equal(fresh.httpsUrl, oldReview.httpsUrl);
  assert.notEqual(fresh.basis.maxRunsPerDay.digest, oldReview.basis.maxRunsPerDay.digest);
  assert.equal((await f.patch('settings', oldReview, { maxRunsPerDay: 8 })).status, 409);
  assert.equal((await f.snapshot('settings')).maxRunsPerDay, 7);
  assert.equal((await f.patch('settings', fresh, { maxRunsPerDay: 8 })).status, 200);
});

test('R01/R02 HTTP known disk failure reports failure, keeps committed memory and recovers the queue', async t => {
  const f = await fixture(t), initial = await f.snapshot('settings');
  assert.equal((await f.patch('settings', initial, { httpsUrl: 'https://before-disk-error.invalid' })).status, 200);
  const before = await f.snapshot('settings'), file = join(f.dataDir, 'private-settings.json'), held = join(f.dataDir, 'private-settings-held.json');
  const privateBytes = await readFile(file, 'utf8'), publicBytes = await readFile(join(f.dataDir, 'state.json'), 'utf8');
  await rename(file, held); await mkdir(file);
  try {
    const failed = await f.patch('settings', before, { maxRunsPerDay: 7, httpsUrl: 'https://must-not-publish.invalid' });
    assert.notEqual(failed.status, 200); assert.notEqual(failed.body.ok, true);
    assert.match(failed.body.error, /Lagerfilen/);
    const visible = await f.snapshot('settings');
    assert.equal(visible.maxRunsPerDay, before.maxRunsPerDay); assert.equal(visible.httpsUrl, before.httpsUrl);
    assert.deepEqual(visible.basis, before.basis);
    assert.equal(await readFile(join(f.dataDir, 'state.json'), 'utf8'), publicBytes);
    assert.equal(await readFile(held, 'utf8'), privateBytes);
  } finally { await rmdir(file); await rename(held, file); }
  const retryAfterReview = await f.patch('settings', before, { maxRunsPerDay: 7, httpsUrl: 'https://after-disk-error.invalid' });
  assert.equal(retryAfterReview.status, 200);
  assert.equal((await f.snapshot('settings')).maxRunsPerDay, 7);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).url, 'https://after-disk-error.invalid');
});

test('H2/R02 HTTP proactive reviews preserve disjoint policy changes, reject same-field conflicts and never enable delivery', async t => {
  const f = await fixture(t), initial = await f.snapshot('proactive');
  assert.equal((await f.patch('proactive', initial, { dailyEnabled: false, weeklyEnabled: false, discordEnabled: false })).status, 200);
  const reviewed = await f.snapshot('proactive');
  const independent = await Promise.all([
    f.patch('proactive', reviewed, { dailyTime: '08:15' }), f.patch('proactive', reviewed, { weeklyTime: '19:15' }),
  ]);
  assert.deepEqual(independent.map(item => item.status), [200, 200]);
  const beforeRace = await f.snapshot('proactive');
  assert.equal(beforeRace.dailyTime, '08:15'); assert.equal(beforeRace.weeklyTime, '19:15');
  const same = await Promise.all([
    f.patch('proactive', beforeRace, { quietStart: '21:00', quietEnd: '06:00' }),
    f.patch('proactive', beforeRace, { quietStart: '23:00', quietEnd: '08:00' }),
  ]);
  assert.deepEqual(same.map(item => item.status).sort(), [200, 409]);
  const final = await f.snapshot('proactive');
  assert.equal(final.quietEnd, final.quietStart === '21:00' ? '06:00' : '08:00');
  assert.equal(final.dailyEnabled, false); assert.equal(final.weeklyEnabled, false); assert.equal(final.discordEnabled, false);
  assert.deepEqual((await f.request('/api/tasks')).body.tasks, []);
  assert.equal((await f.snapshot('discord')).enabled, false);
});

test('H2/R02 HTTP proactive invalid clocks, disk failures and stale restart reviews cannot produce false success', async t => {
  const f = await fixture(t), initial = await f.snapshot('proactive');
  assert.equal((await f.patch('proactive', initial, { dailyEnabled: false, weeklyEnabled: false, discordEnabled: false })).status, 200);
  const before = await f.snapshot('proactive');
  for (const patch of [{ dailyTime: '24:01' }, { weeklyEnabled: 'false' }, { quietStart: before.quietEnd }])
    assert.equal((await f.patch('proactive', before, patch)).status, 400);
  const stateFile = join(f.dataDir, 'state.json'), held = join(f.dataDir, 'proactive-state-held.json');
  await rename(stateFile, held); await mkdir(stateFile);
  try {
    const failed = await f.patch('proactive', before, { dailyTime: '10:05' });
    assert.notEqual(failed.status, 200); assert.notEqual(failed.body.ok, true);
    assert.equal((await f.snapshot('proactive')).dailyTime, before.dailyTime);
  } finally { await rmdir(stateFile); await rename(held, stateFile); }
  assert.equal((await f.patch('proactive', before, { dailyTime: '10:05' })).status, 200);
  const oldReview = await f.snapshot('proactive'); await f.stop(); await f.start();
  assert.equal((await f.patch('proactive', oldReview, { dailyTime: '10:10' })).status, 409);
  const fresh = await f.snapshot('proactive'); assert.equal(fresh.dailyTime, '10:05');
  assert.equal(fresh.dailyEnabled, false); assert.equal(fresh.discordEnabled, false);
});

test('H2/R11 HTTP exact skill version is authenticated, read-only, fully displayed and hash-bound to paused jobs', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/skills/daily-briefing/1.0.0', undefined, { authorized: false })).status, 401);
  const catalog = await f.request('/api/skills'), detail = await f.request('/api/skills/daily-briefing/1.0.0');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.skill.name, 'daily-briefing'); assert.equal(detail.body.skill.version, '1.0.0');
  assert.equal(detail.body.skill.sourceId, 'skill:daily-briefing:1.0.0');
  assert.equal(detail.body.skill.contentHash, catalog.body.skills.find(skill => skill.name === 'daily-briefing' && skill.version === '1.0.0').contentHash);
  assert.equal(detail.body.skill.current, false);
  assert.match(detail.body.skill.body, /^# Dags- og ugeoverblik/); assert.match(detail.body.skill.body, /7\. Ingen bookinger/);
  const missing = await f.request('/api/skills/daily-briefing/9.0.0');
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'SKILL_NOT_FOUND'); assert.equal(missing.body.skill, undefined);
  assert.notEqual((await f.request('/api/skills/daily-briefing/1.0.0', { body: 'Må ikke skrive' })).status, 200);
  const created = await f.request('/api/tasks', { title: 'Syntetisk pauset skill-kilde', prompt: 'Ingen afvikling',
    activation: 'paused', skillId: 'daily-briefing', skillVersion: '1.0.0' });
  assert.equal(created.status, 201); assert.equal(created.body.task.status, 'paused');
  assert.equal(created.body.task.skillContentHash, detail.body.skill.contentHash);
  assert.equal((await f.request('/api/tasks')).body.usage.started, 0);
});

test('H1 HTTP current procedure details expose their complete contract and retain exact historical read access', async t => {
  const f = await fixture(t), catalog = (await f.request('/api/skills')).body.skills;
  assert.equal(catalog.filter(skill => skill.current).length, 8);
  assert.equal(catalog.filter(skill => !skill.current).length, 4);
  assert.equal(catalog.filter(skill => skill.availability.status === 'historical').length, 4);
  for (const skill of catalog.filter(skill => !skill.current)) assert.equal(skill.availability.available, false);
  const current = await f.request('/api/skills/personal-follow-up/1.1.0');
  assert.equal(current.status, 200); assert.equal(current.body.skill.current, true);
  assert.equal(current.body.skill.contract.schemaVersion, 1);
  assert.deepEqual(current.body.skill.contract.budget.defaults, { maxRunsPerDay: 1, maxOutputTokens: 2500 });
  const old = await f.request('/api/skills/personal-follow-up/1.0.0');
  assert.equal(old.status, 200); assert.equal(old.body.skill.current, false);
  assert.equal(old.body.skill.contentHash, '848d095c5925ea16f56666789305c055d77c05ecdf75d3c52cefb50a28fafa68');
  const created = await f.request('/api/tasks', { title: 'Syntetisk ny procedure', prompt: 'Ingen afvikling',
    activation: 'paused', skillId: 'personal-follow-up', skillVersion: '1.1.0' });
  assert.equal(created.status, 201); assert.equal(created.body.task.status, 'paused');
  assert.deepEqual(created.body.task.budget, current.body.skill.contract.budget.defaults);
  assert.equal(created.body.task.skillContentHash, current.body.skill.contentHash);
  assert.deepEqual(created.body.task.permissions, ['web.search']);
  assert.equal((await f.request('/api/tasks')).body.usage.started, 0);
});

test('master data HTTP is private, atomic, revision checked and durable across restart',async t=>{
 const f=await fixture(t),path='/api/master-data';assert.equal((await f.request(path,undefined,{authorized:false})).status,401);
 const profile={id:'test',label:'Hjem',name:'Syntetisk Person',email:'fixture@example.org',phone:'+4512345678',delivery:{street:'Privat testvej 72',postalCode:'1234',city:'Testby',country:'DK'},billing:null};
 const input={expectedRevision:0,profiles:[profile],defaultProfileId:'test'};
 const results=await Promise.all([f.request(path,input),f.request(path,input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await f.request('/api/state')).body.masterData,undefined);assert.equal((await readFile(join(f.dataDir,'state.json'),'utf8')).includes(profile.delivery.street),false);
 assert.equal((await stat(join(f.dataDir,'private-settings.json'))).mode&0o777,0o600);
 await f.stop();await f.start();const d=(await f.request(path)).body.masterData;assert.equal(d.revision,1);assert.equal(d.profiles[0].delivery.street,profile.delivery.street);
 await f.patch('discord',await f.snapshot('discord'),{userId:'123456789012345678'});assert.equal((await f.request(path)).body.masterData.revision,1);
 assert.equal(f.logs().includes(profile.delivery.street),false);
});

test('explicit web chat address review avoids model/history and saves exactly once',async t=>{
 const f=await fixture(t),input={expectedRevision:0,profiles:[],defaultProfileId:null};const review=await f.request('/api/message',{message:'!stamdata gem '+JSON.stringify(input)});assert.equal(review.status,200);const id=review.body.answer.match(/!stamdata godkend ([0-9a-f-]+)/)[1];
 assert.equal((await f.request('/api/master-data')).body.masterData.revision,0);
 assert.equal((await f.request('/api/message',{message:'!stamdata godkend '+id})).status,200);
 assert.equal((await f.request('/api/master-data')).body.masterData.revision,1);
 await f.request('/api/message',{message:'!stamdata godkend '+id});assert.equal((await f.request('/api/master-data')).body.masterData.revision,1);
 assert.equal(JSON.stringify((await f.request('/api/state')).body.history).includes('!stamdata'),false);
});
