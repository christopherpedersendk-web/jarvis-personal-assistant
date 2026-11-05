import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, access, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectAgent } from '../project-agent.mjs';
import { installNpmPackages, npmStagingDirectory, reviewNpmPackages } from '../npm-package-review.mjs';

const sri = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const publicPackage = (name, version, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: sri, ...extra });
const requested = ['alpha@1.2.3'];
function documents() {
  const manifest = { name: 'synthetic-project', version: '1.0.0', private: true, dependencies: { alpha: '1.2.3' },
    scripts: { install: 'MUST_NOT_EXECUTE', test: 'MUST_NOT_EXECUTE' } };
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { '': { name: manifest.name, version: manifest.version, dependencies: { alpha: '1.2.3' } },
      'node_modules/alpha': publicPackage('alpha', '1.2.3', { dependencies: { beta: '^2.0.0' } }),
      'node_modules/beta': publicPackage('beta', '2.1.0') } };
  return { manifest, lock };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-npm-review-')); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'project'); await mkdir(directory);
  const doc = documents();
  const publish = async ({ manifest = doc.manifest, lock = doc.lock } = {}) => {
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
  };
  await publish(); await mkdir(join(directory, 'node_modules')); await writeFile(join(directory, 'node_modules', 'manual-old.txt'), 'previous synthetic bytes');
  return { root, directory, ...doc, publish };
}

function npmDouble(action) {
  return (program, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.emit('close', null, 'SIGKILL'); return true; };
    setImmediate(async () => {
      try { await action({ child, program, args, options }); } catch (error) { child.emit('error', error); }
    });
    return child;
  };
}

async function stagedModules(options) {
  await mkdir(join(options.cwd, 'node_modules')); await writeFile(join(options.cwd, 'node_modules', 'new-package.txt'), 'new synthetic bytes');
}

const enabled = { PATH: process.env.PATH || '/usr/bin:/bin', JARVIS_ALLOW_NPM_INSTALL: 'yes',
  NODE_OPTIONS: '--import=synthetic-private-preload', NODE_PATH: '/synthetic/private/modules',
  OPENAI_API_KEY: 'synthetic-private-key', NEMLIG_PASS: 'synthetic-private-password',
  npm_config_registry: 'https://synthetic-private-registry.invalid', HOME: '/synthetic/private/home' };

test('R06 npm review binds exact direct versions and the complete public lock graph without writes or spawn', async t => {
  const f = await fixture(t); const before = await readdir(f.directory);
  const review = await reviewNpmPackages(f.directory, requested);
  assert.equal(review.status, 'ready'); assert.equal(review.dependencyCount, 2);
  assert.equal(review.registry, 'https://registry.npmjs.org/'); assert.deepEqual(review.directPackages, requested);
  assert.match(review.manifestHash, /^[a-f0-9]{64}$/); assert.match(review.lockHash, /^[a-f0-9]{64}$/);
  assert.equal(review.scripts, 'not-executed'); assert.equal(review.mode, 'reviewed-lockfile-ci');
  assert.deepEqual(await readdir(f.directory), before);
  assert.equal(await readFile(join(f.directory, 'node_modules/manual-old.txt'), 'utf8'), 'previous synthetic bytes');
});

test('missing, private, linked, unpinned or mismatched npm review grounds fail closed with specific reasons', async t => {
  const f = await fixture(t);
  const cases = [
    ['LOCK_FORMAT', doc => { doc.lock.lockfileVersion = 2; }],
    ['LOCK_INTEGRITY', doc => { delete doc.lock.packages['node_modules/beta'].integrity; }],
    ['LOCK_INTEGRITY', doc => { doc.lock.packages['node_modules/beta'].integrity = `sha512-${'A'.repeat(87)}=`; }],
    ['LOCK_PRIVATE_SOURCE', doc => { doc.lock.packages['node_modules/beta'].resolved = 'https://synthetic-private-registry.invalid/package.tgz'; }],
    ['LOCK_PRIVATE_SOURCE', doc => { doc.lock.packages['node_modules/beta'].resolved = 'https://secret@registry.npmjs.org/beta.tgz'; }],
    ['LOCK_PRIVATE_SOURCE', doc => { doc.lock.packages['node_modules/beta'].link = true; }],
    ['LOCK_PRIVATE_REFERENCE', doc => { doc.lock.packages['node_modules/alpha'].dependencies.beta = 'file:/synthetic/private'; }],
    ['LOCK_INCOMPLETE', doc => { delete doc.lock.packages['node_modules/beta']; }],
    ['LOCK_DIRECT_VERSION', doc => { doc.lock.packages['node_modules/alpha'].version = '9.9.9'; }],
    ['LOCK_IDENTITY', doc => { doc.lock.packages[''].name = 'different-project'; }],
    ['UNPINNED_DIRECT_DEPENDENCY', doc => { doc.manifest.dependencies.alpha = '^1.2.3'; }],
    ['MANIFEST_DIRECT_SET', doc => { doc.manifest.devDependencies = { unapproved: '1.0.0' }; }],
    ['DUPLICATE_DIRECT_DEPENDENCY', doc => { doc.manifest.devDependencies = { alpha: '1.2.3' }; }],
    ['MANIFEST_UNSUPPORTED', doc => { doc.manifest.workspaces = ['packages/*']; }],
    ['MANIFEST_UNSUPPORTED', doc => { doc.manifest.overrides = { beta: 'file:/synthetic/private' }; }],
  ];
  for (const [code, alter] of cases) {
    const doc = documents(); alter(doc); await f.publish(doc);
    const result = await reviewNpmPackages(f.directory, requested);
    assert.equal(result.status, 'dependency-review-required', code); assert.equal(result.reasons[0].code, code);
  }
  await f.publish();
  for (const packages of [['alpha'], ['alpha@latest'], ['alpha@^1.2.3'], ['alpha@1.2.3', 'ALPHA@1.2.3']])
    assert.equal((await reviewNpmPackages(f.directory, packages)).status, 'dependency-review-required');
});

test('private npm config is only detected, never read/reused; missing or symlinked lock fails before spawn', async t => {
  const f = await fixture(t); let spawns = 0;
  await writeFile(join(f.directory, '.npmrc'), '//synthetic.invalid/:_authToken=never-copy-this-synthetic-secret', { mode: 0o600 });
  const result = await reviewNpmPackages(f.directory, requested);
  assert.equal(result.reasons[0].code, 'PROJECT_CONFIG'); assert.equal(JSON.stringify(result).includes('never-copy'), false);
  await assert.rejects(installNpmPackages(f.directory, requested, { environment: enabled, operationId: randomUUID(), spawnProcess: () => { spawns++; } }), error => error.installationNotStarted === true);
  await rm(join(f.directory, '.npmrc')); await rename(join(f.directory, 'package-lock.json'), join(f.root, 'lock.json'));
  const missing = await reviewNpmPackages(f.directory, requested); assert.equal(missing.reasons[0].code, 'MISSING_FILE'); assert.match(missing.reasons[0].message, /package-lock.json/);
  await symlink(join(f.root, 'lock.json'), join(f.directory, 'package-lock.json'));
  assert.equal((await reviewNpmPackages(f.directory, requested)).reasons[0].code, 'UNSAFE_FILE');
  assert.equal(spawns, 0);
});

test('npm ci uses reviewed copies and empty configs/clean env; publication preserves prior modules and leaves all source bytes unchanged', async t => {
  const f = await fixture(t); const operationId = randomUUID(); let calls = 0;
  const originalManifest = await readFile(join(f.directory, 'package.json'), 'utf8'); const originalLock = await readFile(join(f.directory, 'package-lock.json'), 'utf8');
  const result = await installNpmPackages(f.directory, requested, { environment: enabled, operationId, expectedContentHash: 'a'.repeat(64),
    spawnProcess: npmDouble(async ({ child, program, args, options }) => {
      calls++; assert.equal(program, process.platform === 'win32' ? process.execPath : 'npm');
      for (const flag of ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false', '--registry=https://registry.npmjs.org/']) assert.ok(args.includes(flag), flag);
      assert.notEqual(options.cwd, f.directory); assert.equal(options.shell, false);
      assert.equal(await readFile(join(options.cwd, 'package.json'), 'utf8'), originalManifest);
      assert.equal(await readFile(join(options.cwd, 'package-lock.json'), 'utf8'), originalLock);
      for (const flag of ['--userconfig=', '--globalconfig=']) assert.equal(await readFile(args.find(value => value.startsWith(flag)).slice(flag.length), 'utf8'), '');
      for (const name of ['JARVIS_ALLOW_NPM_INSTALL', 'NODE_OPTIONS', 'NODE_PATH', 'OPENAI_API_KEY', 'NEMLIG_PASS', 'npm_config_registry', 'HOME']) assert.equal(options.env[name], undefined, name);
      await stagedModules(options); child.emit('close', 0);
    }),
  });
  assert.equal(calls, 1); assert.equal(result.status, 'completed'); assert.equal(result.previousModulesPreserved, true);
  assert.equal(await readFile(join(f.directory, 'node_modules/new-package.txt'), 'utf8'), 'new synthetic bytes');
  assert.equal(await readFile(join(result.stagingDirectory, 'previous-node_modules/manual-old.txt'), 'utf8'), 'previous synthetic bytes');
  assert.equal(await readFile(join(f.directory, 'package.json'), 'utf8'), originalManifest);
  assert.equal(await readFile(join(f.directory, 'package-lock.json'), 'utf8'), originalLock);
  const journal = JSON.parse(await readFile(join(result.stagingDirectory, 'review.json'), 'utf8'));
  assert.equal(journal.status, 'completed'); assert.equal(journal.expectedContentHash, 'a'.repeat(64)); assert.equal(journal.operationId, operationId);
});

test('failed staging, a changed source basis, and altered npm copies preserve project modules and never expose subprocess stderr', async t => {
  const f = await fixture(t);
  const cases = [
    async ({ child }) => { child.stderr.write('synthetic-password-and-private-config'); child.emit('close', 1); },
    async ({ child, options }) => { await stagedModules(options); await writeFile(join(options.cwd, 'package-lock.json'), '{}'); child.emit('close', 0); },
    async ({ child, options }) => { await stagedModules(options); await writeFile(join(f.directory, 'package-lock.json'), '{}'); child.emit('close', 0); },
  ];
  for (const action of cases) {
    await f.publish();
    await assert.rejects(installNpmPackages(f.directory, requested, { environment: enabled, operationId: randomUUID(), spawnProcess: npmDouble(action) }), error => {
      assert.equal(error.installationNotStarted, true); assert.equal(error.message.includes('synthetic-password'), false); return true;
    });
    assert.equal(await readFile(join(f.directory, 'node_modules/manual-old.txt'), 'utf8'), 'previous synthetic bytes');
  }
  await f.publish(); let checks = 0;
  await assert.rejects(installNpmPackages(f.directory, requested, { environment: enabled, operationId: randomUUID(),
    verifyBasis: async () => { if (++checks === 2) throw new Error('synthetic changed source hash'); },
    spawnProcess: npmDouble(async ({ child, options }) => { await stagedModules(options); child.emit('close', 0); }),
  }), error => error.installationNotStarted === true && /source hash/.test(error.message));
  assert.equal(await readFile(join(f.directory, 'node_modules/manual-old.txt'), 'utf8'), 'previous synthetic bytes');
});

test('partial node_modules publication remains unknown and retains the exact previous tree for explicit recovery', async t => {
  const f = await fixture(t); const operationId = randomUUID(); const workspace = npmStagingDirectory(f.directory, operationId); let checks = 0;
  await assert.rejects(installNpmPackages(f.directory, requested, { environment: enabled, operationId,
    verifyBasis: async () => { if (++checks === 2) await rename(join(workspace, 'candidate/node_modules'), join(workspace, 'synthetic-withheld-candidate')); },
    spawnProcess: npmDouble(async ({ child, options }) => { await stagedModules(options); child.emit('close', 0); }),
  }), error => error.code === 'ENOENT' && error.installationNotStarted !== true);
  await assert.rejects(access(join(f.directory, 'node_modules')), { code: 'ENOENT' });
  assert.equal(await readFile(join(workspace, 'previous-node_modules/manual-old.txt'), 'utf8'), 'previous synthetic bytes');
  assert.equal(JSON.parse(await readFile(join(workspace, 'review.json'), 'utf8')).status, 'publishing');
});

async function projectFixture(t, npmAction, { withLock = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-project-npm-')); t.after(() => rm(root, { recursive: true, force: true }));
  const installer = (directory, packages, context) => installNpmPackages(directory, packages, { ...context, environment: enabled, spawnProcess: npmDouble(npmAction) });
  Object.assign(installer, { preflight: reviewNpmPackages, enabled: () => true, stagingDirectory: npmStagingDirectory });
  const agent = new ProjectAgent({ root: join(root, 'projects'), backupRoot: join(root, 'backups'), state: {}, save: async () => {}, installer,
    generate: async () => ({ summary: 'Syntetisk godkendelsesforslag', files: [{ path: 'index.html', content: '<h1>Syntetisk projekt</h1>' }], packages: requested }),
  });
  const project = await agent.create({ title: 'Syntetisk pakkeprojekt', description: 'Udelukkende isoleret kontrakttest.' });
  const directory = join(root, 'projects', project.slug); const doc = documents();
  await writeFile(join(directory, 'package.json'), JSON.stringify(doc.manifest));
  if (withLock) await writeFile(join(directory, 'package-lock.json'), JSON.stringify(doc.lock));
  await agent.develop(project.id, 'Forbered pakkeplanen');
  return { agent, project, directory, root };
}

test('ProjectAgent exposes precise dependency review and missing lock does not journal a false running/unknown installation', async t => {
  let calls = 0; const f = await projectFixture(t, async () => { calls++; }, { withLock: false });
  const view = await f.agent.inspect(f.project.id); assert.equal(view.dependencyReview.status, 'dependency-review-required');
  assert.match(view.dependencyReview.reasons[0].message, /package-lock.json/);
  await assert.rejects(f.agent.install(f.project.id, requested, f.project.revision), error => error.code === 'DEPENDENCY_REVIEW_REQUIRED' && error.status === 409);
  assert.equal(calls, 0); assert.equal(f.agent.get(f.project.id).packageInstallAttempt, undefined); assert.equal(f.agent.busy, false);
  const names = await readdir(join(f.root, 'projects')); assert.equal(names.some(name => name.startsWith('.jarvis-npm-')), false);
});

test('ProjectAgent distinguishes known no-publication from unknown, then permits only another explicit reviewed attempt', async t => {
  let calls = 0;
  const f = await projectFixture(t, async ({ child, options }) => { if (++calls === 1) child.emit('close', 1); else { await stagedModules(options); child.emit('close', 0); } });
  const revision = f.project.revision;
  await assert.rejects(f.agent.install(f.project.id, requested, revision), /Klargøring/);
  const blocked = f.agent.get(f.project.id).packageInstallAttempt;
  assert.equal(blocked.status, 'blocked'); assert.equal(calls, 1); assert.match(blocked.dependencyReview.lockHash, /^[a-f0-9]{64}$/);
  await f.agent.inspect(f.project.id); assert.equal(calls, 1, 'read-only review does not replay install');
  const completed = await f.agent.install(f.project.id, requested, revision);
  assert.equal(completed.packageInstallAttempt.status, 'completed'); assert.notEqual(completed.packageInstallAttempt.id, blocked.id);
  assert.equal(calls, 2); assert.deepEqual(completed.pendingPackages, []);
});

test('ProjectAgent full source hash binds reviewed lock bytes; a changed lock never reaches the installer', async t => {
  let calls = 0; const f = await projectFixture(t, async () => { calls++; });
  const view = await f.agent.inspect(f.project.id); assert.equal(view.dependencyReview.status, 'ready');
  const lock = JSON.parse(await readFile(join(f.directory, 'package-lock.json'), 'utf8')); lock.packages['node_modules/beta'].integrity = `sha512-${Buffer.alloc(64, 8).toString('base64')}`;
  await writeFile(join(f.directory, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(f.agent.install(f.project.id, requested, f.project.revision), /indhold er ændret/);
  assert.equal(calls, 0); assert.equal(f.agent.get(f.project.id).packageInstallAttempt, undefined);
});

test('owner inspection hash is optional for legacy clients but exact and mandatory when supplied; malformed/stale hashes never stage', async t => {
  let calls = 0;
  const f = await projectFixture(t, async ({ child, options }) => { calls++; await stagedModules(options); child.emit('close', 0); });
  const view = await f.agent.inspect(f.project.id);
  for (const value of [null, '', 'a'.repeat(64), 42])
    await assert.rejects(f.agent.install(f.project.id, requested, f.project.revision, value), error => error.status === 409 && error.code === 'REVISION_CONFLICT');
  assert.equal(calls, 0); assert.equal(f.agent.get(f.project.id).packageInstallAttempt, undefined);
  assert.equal((await readdir(join(f.root, 'projects'))).some(name => name.startsWith('.jarvis-npm-')), false);
  const completed = await f.agent.install(f.project.id, requested, f.project.revision, view.sourceContentHash);
  assert.equal(calls, 1); assert.equal(completed.packageInstallAttempt.status, 'completed');
  assert.equal(completed.packageInstallAttempt.contentHash, view.sourceContentHash);
});

test('the owner inspection hash is rechecked after npm staging, preserving a newer manual source edit and old modules', async t => {
  let directory; let calls = 0;
  const f = await projectFixture(t, async ({ child, options }) => {
    calls++; await stagedModules(options); await writeFile(join(directory, 'index.html'), '<h1>Nyere manuel ændring</h1>'); child.emit('close', 0);
  });
  directory = f.directory; await mkdir(join(directory, 'node_modules')); await writeFile(join(directory, 'node_modules/manual-old.txt'), 'old synthetic bytes');
  const view = await f.agent.inspect(f.project.id);
  await assert.rejects(f.agent.install(f.project.id, requested, f.project.revision, view.sourceContentHash), /indhold er ændret efter godkendelsen/);
  assert.equal(calls, 1); assert.equal(f.agent.get(f.project.id).packageInstallAttempt.status, 'blocked');
  assert.equal(await readFile(join(directory, 'node_modules/manual-old.txt'), 'utf8'), 'old synthetic bytes');
  assert.equal(await readFile(join(directory, 'index.html'), 'utf8'), '<h1>Nyere manuel ændring</h1>');
});
