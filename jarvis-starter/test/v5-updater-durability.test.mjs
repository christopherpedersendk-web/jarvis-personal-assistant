import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateManager } from '../update-manager.mjs';
import { atomicStateWrite } from '../state-schema.mjs';

const sha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, { writeState = atomicStateWrite, initial, commandHook } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-updater-durable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'update-state.json');
  if (initial) await writeFile(stateFile, JSON.stringify(initial));
  const calls = []; let candidate = { version: 'v5.0.0', sha };
  const options = { dataDirectory: directory, stagingDirectory: join(directory, 'stage'),
    repository: 'git@github.com:synthetic/release.git', currentVersion: 'v4.9.1', writeState,
    environment: { DOCKER_HOST: 'unix:///synthetic/docker.sock' },
    command: async (program, args, options) => {
      calls.push({ program, args, options });
      await commandHook?.(program, args);
      if (program === 'git' && args[0] === 'ls-remote') return { stdout: `${candidate.sha}\trefs/tags/${candidate.version}\n` };
      if (program === 'git' && args[0] === 'clone') {
        await mkdir(join(args.at(-1), 'jarvis-starter'), { recursive: true });
        await writeFile(join(args.at(-1), 'jarvis-starter/package.json'), JSON.stringify({ version: args[4].slice(1),
          jarvisSchemaVersion: 1, jarvisReadableSchemaFrom: 0 }));
      }
      if (program === 'git' && args[0] === 'rev-parse') return { stdout: sha + '\n' };
      return { stdout: '' };
    },
  };
  const manager = await new UpdateManager(options).load();
  return { manager, options, directory, stateFile, calls, candidate: value => { candidate = value; } };
}

async function ready(f) { await f.manager.check(); await f.manager.stage(); }

test('P0 a failed approval rename is neither visible nor later persisted by an ordinary check', async t => {
  const f = await fixture(t); await ready(f);
  const committed = JSON.parse(await readFile(f.stateFile, 'utf8'));
  const blocked = join(f.directory, 'blocked-state-target'); await mkdir(blocked);
  f.manager.stateFile = blocked;
  await assert.rejects(f.manager.approve('v5.0.0'));
  assert.equal(f.manager.snapshot().approved, null, 'a failed local write cannot be a visible approval');
  f.manager.stateFile = f.stateFile;
  await f.manager.check();
  const disk = JSON.parse(await readFile(f.stateFile, 'utf8'));
  assert.equal(disk.approved, null, 'later work cannot accidentally commit the failed approval');
  assert.equal(disk.staged.testedSha, committed.staged.testedSha);
  assert.equal(f.manager.snapshot().storage.ready, true);
  assert.deepEqual((await readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
});

test('committed-only updater snapshots cannot be mutated by readers or expose an in-flight approval draft', async t => {
  const entered = deferred(), release = deferred(); let hold = false;
  const f = await fixture(t, { writeState: async (path, contents) => {
    if (hold && JSON.parse(contents).approved) { entered.resolve(); await release.promise; }
    await atomicStateWrite(path, contents);
  } });
  await ready(f); hold = true;
  const approval = f.manager.approve('v5.0.0'); await entered.promise;
  const snapshot = f.manager.snapshot(); assert.equal(snapshot.approved, null);
  snapshot.staged.sha = nextSha;
  assert.equal(f.manager.snapshot().staged.sha, sha);
  release.resolve(); await approval;
  assert.equal(f.manager.snapshot().approved.sha, sha);
});

test('serialized check/approve validates the committed version/SHA after an earlier check finishes publishing', async t => {
  const entered = deferred(), release = deferred(); let hold = false;
  const f = await fixture(t, { writeState: async (path, contents) => {
    const state = JSON.parse(contents);
    if (hold && state.available?.sha === nextSha) { hold = false; entered.resolve(); await release.promise; }
    await atomicStateWrite(path, contents);
  } });
  await ready(f); hold = true; f.candidate({ version: 'v5.0.1', sha: nextSha });
  const checking = f.manager.check(); await entered.promise;
  assert.equal(f.manager.snapshot().available.sha, sha, 'a check draft is not a committed release');
  const approval = f.manager.approve('v5.0.0'); const rejected = assert.rejects(approval, /præcise|ændret|forældet/);
  release.resolve(); await checking; await rejected;
  assert.equal(f.manager.snapshot().approved, null);
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).approved, null);
});

test('external staging waits do not hold the local state boundary; changed release basis cannot receive old test evidence', async t => {
  const entered = deferred(), release = deferred(); let block = false;
  const f = await fixture(t, { commandHook: async (program, args) => {
    if (block && program === 'docker' && args[2] === 'run') { entered.resolve(); await release.promise; }
  } });
  await f.manager.check(); block = true;
  const staging = f.manager.stage(); const rejected = assert.rejects(staging, /ændret|forældet|præcise/); await entered.promise;
  assert.equal(f.manager.snapshot().stageOperation.status, 'running');
  assert.equal(f.manager.snapshot().staged, null);
  f.candidate({ version: 'v5.0.1', sha: nextSha });
  const check = f.manager.check();
  await Promise.race([check, new Promise((_, reject) => setTimeout(() => reject(new Error('local check blocked behind external test')), 1000).unref())]);
  assert.equal(f.manager.snapshot().available.sha, nextSha);
  release.resolve(); await rejected;
  assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
  assert.equal(f.manager.snapshot().stageOperation.status, 'failed');
});

test('post-publication sync uncertainty adopts the disk snapshot but blocks all mutations until a fresh load', async t => {
  let fail = false;
  const f = await fixture(t, { writeState: async (path, contents) => atomicStateWrite(path, contents, fail && JSON.parse(contents).approved
    ? { syncDirectory: async () => { throw Object.assign(new Error('synthetic fsync I/O failure'), { code: 'EIO' }); } } : {}) });
  await ready(f); fail = true;
  await assert.rejects(f.manager.approve('v5.0.0'), { code: 'STATE_DURABILITY_UNKNOWN' });
  const snapshot = f.manager.snapshot();
  assert.equal(snapshot.publicationUnknown, true); assert.equal(snapshot.storage.ready, false);
  assert.equal(snapshot.approved.sha, sha, 'rename succeeded; hiding the published snapshot would diverge from disk');
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).approved.sha, sha);
  const before = f.calls.length;
  for (const action of [() => f.manager.check(), () => f.manager.stage(), () => f.manager.approve('v5.0.0')])
    await assert.rejects(action(), /ukendt|genstart/i);
  await assert.rejects(f.manager.load(), /genstart|indlæst/i);
  assert.equal(f.calls.length, before, 'unknown storage state must not start new Git or Docker work');
  fail = false;
  const restarted = await new UpdateManager(f.options).load();
  assert.equal(restarted.snapshot().publicationUnknown, false); assert.equal(restarted.snapshot().storage.ready, true);
  assert.equal(restarted.snapshot().approved.sha, sha); assert.equal(f.calls.length, before);
});

test('a failed staging checkpoint cannot start Git/Docker and a failed result commit is not retried as an ordinary stage error', async t => {
  let failAt = ''; let attempts = 0;
  const failure = Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' });
  const f = await fixture(t, { writeState: async (path, contents) => {
    const state = JSON.parse(contents);
    if (failAt === 'start' && state.stageOperation?.status === 'running' || failAt === 'finish' && state.staged) { attempts++; throw failure; }
    await atomicStateWrite(path, contents);
  } });
  await f.manager.check(); failAt = 'start'; const before = f.calls.length;
  await assert.rejects(f.manager.stage(), error => error === failure);
  assert.equal(f.calls.length, before); assert.equal(f.manager.snapshot().stageOperation, null);
  failAt = 'finish'; attempts = 0;
  await assert.rejects(f.manager.stage(), error => error === failure);
  assert.equal(attempts, 1); assert.equal(f.manager.snapshot().staged, null);
  assert.equal(f.manager.snapshot().stageOperation.status, 'running');
  const calls = f.calls.length;
  await assert.rejects(f.manager.stage(), /uafsluttet|ukendt|igangværende|genstart/i);
  assert.equal(f.calls.length, calls);
});

test('interrupted stages recover as unknown without re-running or fabricating a tested/approved release', async t => {
  const f = await fixture(t, { initial: { available: { version: 'v5.0.0', sha }, staged: null, approved: null,
    stageOperation: { id: 'synthetic-interrupted', status: 'running', version: 'v5.0.0', sha, startedAt: '2026-11-05T08:00:00.000Z' },
    checkOperation: { id: 'synthetic-check', status: 'running' }, retainedFutureIndependentField: { keep: true } } });
  const snapshot = f.manager.snapshot();
  assert.equal(snapshot.stageOperation.status, 'unknown'); assert.equal(snapshot.checkOperation.status, 'failed');
  assert.deepEqual(snapshot.retainedFutureIndependentField, { keep: true });
  await assert.rejects(f.manager.stage(), /ukendt|uafsluttet|genstart|gennemgang/i);
  await assert.rejects(f.manager.approve('v5.0.0'));
  assert.equal(f.calls.length, 0);
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).stageOperation.status, 'unknown');
});

test('a newer updater state schema is rejected without rewriting its bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-updater-schema-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'update-state.json'); const bytes = '{"updateStateSchemaVersion":999,"preserve":"synthetic"}';
  await writeFile(path, bytes);
  await assert.rejects(new UpdateManager({ dataDirectory: directory, stagingDirectory: join(directory, 'stage') }).load(), /nyere|skema/i);
  assert.equal(await readFile(path, 'utf8'), bytes);
});

test('same-tag/new-SHA approval requires the exact displayed commit; malformed explicit binding is never ignored', async t => {
  const staged = { version: 'v5.0.0', sha: nextSha, testedSha: nextSha, packageVersion: '5.0.0',
    schemaVersion: 1, readableFrom: 0, testedAt: '2026-11-05T08:00:00.000Z' };
  const f = await fixture(t, { initial: { available: { version: staged.version, sha: nextSha }, staged, approved: null } });
  for (const supplied of [sha, '', null, 'not-a-sha']) await assert.rejects(f.manager.approve('v5.0.0', supplied), /præcise|ændret/);
  assert.equal(f.manager.snapshot().approved, null); assert.equal(f.calls.length, 0);
  await f.manager.approve('v5.0.0', nextSha);
  const approved = f.manager.snapshot();
  assert.equal(approved.approved.sha, nextSha);
  await f.manager.approve('v5.0.0', nextSha);
  assert.equal(f.manager.snapshot().storage.revision, approved.storage.revision, 'an identical known approval is a true no-op');
  assert.equal(f.manager.snapshot().approved.approvedAt, approved.approved.approvedAt);
});

test('stage rejects a stale or incomplete explicitly displayed basis before any clone or Docker call', async t => {
  const f = await fixture(t); await f.manager.check();
  const before = f.calls.length; const revision = f.manager.snapshot().storage.revision;
  for (const [version, commit] of [['v5.0.1', sha], ['v5.0.0', nextSha], ['v5.0.0', undefined], [undefined, sha]])
    await assert.rejects(f.manager.stage(version, commit), /ændret|præcise/);
  assert.equal(f.calls.length, before); assert.equal(f.manager.snapshot().storage.revision, revision);
  assert.equal(f.manager.snapshot().stageOperation, null);
  const result = await f.manager.stage('v5.0.0', sha);
  assert.equal(result.staged.sha, sha); assert.equal(result.busy.stage, false);
});

test('concurrent checks coalesce one external read, and duplicate staging cannot start a second test', async t => {
  const checking = deferred(), finishCheck = deferred(), testing = deferred(), finishTest = deferred();
  const f = await fixture(t, { commandHook: async (program, args) => {
    if (program === 'git' && args[0] === 'ls-remote') { checking.resolve(); await finishCheck.promise; }
    if (program === 'docker' && args[2] === 'run') { testing.resolve(); await finishTest.promise; }
  } });
  const first = f.manager.check(); await checking.promise;
  const second = f.manager.check();
  assert.equal(f.manager.snapshot().busy.check, true); assert.equal(f.manager.snapshot().available, null);
  finishCheck.resolve(); const results = await Promise.all([first, second]);
  assert.equal(f.calls.filter(call => call.program === 'git' && call.args[0] === 'ls-remote').length, 1);
  assert.equal(results[0].busy.check, false); assert.equal(results[1].available.sha, sha);
  const stage = f.manager.stage(); await testing.promise;
  assert.equal(f.manager.snapshot().busy.stage, true);
  await assert.rejects(f.manager.stage(), /igangværende/);
  finishTest.resolve(); await stage;
  assert.equal(f.calls.filter(call => call.program === 'docker' && call.args[2] === 'run').length, 1);
});

test('a failed version-check result write keeps the last committed candidate and reports the original storage failure once', async t => {
  let fail = false; let attempts = 0;
  const failure = Object.assign(new Error('synthetic check rename failure'), { code: 'EIO' });
  const f = await fixture(t, { writeState: async (path, contents) => {
    if (fail && JSON.parse(contents).available?.sha === nextSha) { attempts++; throw failure; }
    await atomicStateWrite(path, contents);
  } });
  await ready(f); f.candidate({ version: 'v5.0.1', sha: nextSha }); fail = true;
  await assert.rejects(f.manager.check(), error => error === failure);
  assert.equal(attempts, 1); assert.equal(f.manager.snapshot().available.sha, sha);
  assert.equal(f.manager.snapshot().error, '');
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).available.sha, sha);
  fail = false; await f.manager.check();
  assert.equal(f.manager.snapshot().available.sha, nextSha); assert.equal(f.manager.snapshot().checkOperation.status, 'completed');
});
