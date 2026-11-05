import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UpdateManager } from '../update-manager.mjs';
import { readReleasePackage } from '../release-checkout.mjs';
import { cleanProcessEnvironment } from '../subprocess-safety.mjs';

async function fixture(t, mode = 'normal') {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-update-path-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const outside = join(directory, 'outside'); const outsideApp = join(outside, 'private-app');
  await mkdir(outsideApp, { recursive: true });
  const metadata = JSON.stringify({ version: '5.0.0', jarvisSchemaVersion: 1, jarvisReadableSchemaFrom: 0 });
  await writeFile(join(outsideApp, 'package.json'), metadata); await writeFile(join(outsideApp, 'private.txt'), 'synthetic never mount this directory');
  let stagingDirectory = join(directory, 'stage'); let packageReads = 0; let folder;
  if (mode === 'staging-link') await symlink(outside, stagingDirectory, 'dir');
  if (mode === 'parent-link') { await symlink(outside, join(directory, 'linked-parent'), 'dir'); stagingDirectory = join(directory, 'linked-parent', 'stage'); }
  const calls = []; const sha = 'd'.repeat(40);
  let ignoredInput = false;
  const addIgnoredInput = async () => {
    await mkdir(join(folder, 'jarvis-starter/data'), { recursive: true });
    await writeFile(join(folder, 'jarvis-starter/data/extra.test.mjs'), 'throw new Error("unreviewed ignored input");');
    ignoredInput = true;
  };
  const swapApp = async () => {
    await rename(join(folder, 'jarvis-starter'), join(folder, 'previously-reviewed-app'));
    await symlink(outsideApp, join(folder, 'jarvis-starter'), 'dir');
  };
  const manager = await new UpdateManager({ dataDirectory: directory, stagingDirectory,
    repository: 'git@github.com:synthetic/release.git', currentVersion: 'v4.9.1', environment: { DOCKER_HOST: 'unix:///synthetic/docker.sock' },
    readPackage: async path => { packageReads++; const result = await readReleasePackage(path); if (mode === 'swap-after-read') await swapApp(); return result; },
    command: async (program, args) => {
      calls.push({ program, args });
      if (program === 'git' && args[0] === 'ls-remote') return { stdout: `${sha}\trefs/tags/v5.0.0\n` };
      if (program === 'git' && args[0] === 'clone') {
        folder = args.at(-1);
        if (mode === 'checkout-link') { await symlink(outside, folder, 'dir'); }
        else await mkdir(folder, { recursive: true });
        if (mode === 'app-link') await symlink(outsideApp, join(folder, 'jarvis-starter'), 'dir');
        else {
          await mkdir(join(folder, 'jarvis-starter'));
          if (mode === 'package-link') await symlink(join(outsideApp, 'package.json'), join(folder, 'jarvis-starter/package.json'));
          else await writeFile(join(folder, 'jarvis-starter/package.json'), metadata);
          if (mode === 'test-link') await symlink(join(outsideApp, 'private.txt'), join(folder, 'jarvis-starter/test.js'));
          if (mode === 'ignored-at-clone') await addIgnoredInput();
        }
      }
      if (program === 'git' && args[0] === 'rev-parse') return { stdout: sha + '\n' };
      if (program === 'git' && args[0] === 'status' && ignoredInput && args.includes('--ignored=matching')) return { stdout: '!! jarvis-starter/data/\n' };
      if (program === 'docker' && args[2] === 'image' && mode === 'swap-before-mount') await swapApp();
      if (program === 'docker' && args[2] === 'image' && mode === 'ignored-before-mount') await addIgnoredInput();
      if (program === 'docker' && args[2] === 'run' && mode === 'swap-after-test') await swapApp();
      if (program === 'docker' && args[2] === 'run' && mode === 'ignored-after-test') await addIgnoredInput();
      return { stdout: '' };
    },
  }).load();
  await manager.check();
  return { manager, calls, packageReads: () => packageReads, outside, sha };
}

test('P0 release staging rejects a symlinked staging root or parent before clone creates external files', async t => {
  for (const mode of ['staging-link', 'parent-link']) {
    const f = await fixture(t, mode);
    await assert.rejects(f.manager.stage(), /symbolsk|symlink|checkout|sti/i);
    assert.equal(f.calls.some(call => call.program === 'git' && call.args[0] === 'clone'), false);
    assert.equal(f.packageReads(), 0); assert.equal(f.calls.some(call => call.program === 'docker'), false);
    await assert.rejects(access(join(f.outside, 'v5.0.0')), { code: 'ENOENT' });
    await assert.rejects(access(join(f.outside, 'stage')), { code: 'ENOENT' });
    assert.equal(f.manager.snapshot().staged, null);
  }
});

test('P0 release checkout/app/metadata symlinks cannot read an outside package or reach Docker', async t => {
  for (const mode of ['checkout-link', 'app-link', 'package-link']) {
    const f = await fixture(t, mode);
    await assert.rejects(f.manager.stage(), /symbolsk|symlink|checkout|sti/i);
    assert.equal(f.packageReads(), 0, mode); assert.equal(f.calls.some(call => call.program === 'docker'), false, mode);
    assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
  }
});

test('P0 a source/test symlink cannot escape the reviewed application tree', async t => {
  const f = await fixture(t, 'test-link');
  await assert.rejects(f.manager.stage(), /symbolsk|symlink|checkout|sti/i);
  assert.equal(f.calls.some(call => call.program === 'docker'), false); assert.equal(f.manager.snapshot().staged, null);
});

test('P0 release paths are rechecked after metadata read and immediately before the Docker bind mount', async t => {
  for (const mode of ['swap-after-read', 'swap-before-mount']) {
    const f = await fixture(t, mode);
    await assert.rejects(f.manager.stage(), /symbolsk|symlink|checkout|sti/i);
    assert.equal(f.packageReads(), 1); assert.equal(f.calls.some(call => call.program === 'docker' && call.args[2] === 'run'), false);
    assert.equal(f.manager.snapshot().staged, null);
  }
});

test('P0 a changed mount path after test cannot be recorded as exact candidate evidence', async t => {
  const f = await fixture(t, 'swap-after-test');
  await assert.rejects(f.manager.stage(), /symbolsk|symlink|checkout|sti/i);
  assert.equal(f.calls.filter(call => call.program === 'docker' && call.args[2] === 'run').length, 1);
  assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
});

test('a plain owned checkout still binds package metadata, exact SHA and restricted local test evidence', async t => {
  const f = await fixture(t); await f.manager.stage();
  assert.equal(f.packageReads(), 1); assert.equal(f.manager.snapshot().staged.testedSha, f.sha);
  assert.equal(f.manager.snapshot().staged.packageVersion, '5.0.0'); assert.equal(f.manager.snapshot().approved, null);
  assert.equal(f.calls.filter(call => call.program === 'docker' && call.args[2] === 'run').length, 1);
});

test('P0 ignored executable input is rejected before Docker lookup and rechecked immediately before bind mount', async t => {
  for (const mode of ['ignored-at-clone', 'ignored-before-mount']) {
    const f = await fixture(t, mode);
    await assert.rejects(f.manager.stage(), /ændret|ignoreret|ikke-sporet/i);
    assert.equal(f.calls.some(call => call.program === 'docker' && call.args[2] === 'run'), false, mode);
    if (mode === 'ignored-at-clone') assert.equal(f.calls.some(call => call.program === 'docker'), false);
    assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
  }
});

test('P0 ignored executable input introduced during test invalidates the SHA-bound release evidence', async t => {
  const f = await fixture(t, 'ignored-after-test');
  await assert.rejects(f.manager.stage(), /ændret|ignoreret|ikke-sporet/i);
  assert.equal(f.calls.filter(call => call.program === 'docker' && call.args[2] === 'run').length, 1);
  assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
});

test('real local Git confirms ignored data/extra.test.mjs is invisible to the old check but rejected by the release guard', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-release-ignored-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = join(directory, 'checkout'); await mkdir(checkout);
  const emptyConfig = join(directory, 'empty.gitconfig'); await writeFile(emptyConfig, '');
  const hooks = join(directory, 'empty-hooks'); await mkdir(hooks);
  const env = { ...cleanProcessEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_ATTR_NOSYSTEM: '1' };
  const exec = promisify(execFile);
  const git = args => exec('git', ['-c', `core.hooksPath=${hooks}`, ...args], { cwd: checkout, env, timeout: 5000, maxBuffer: 32 * 1024 });
  await git(['-c', 'init.templateDir=', 'init', '--quiet']);
  await writeFile(join(checkout, '.gitignore'), 'data/\n');
  await writeFile(join(checkout, 'reviewed.test.mjs'), 'export {};\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--no-gpg-sign', '--quiet', '-m', 'synthetic release only']);
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const manager = new UpdateManager({ dataDirectory: join(directory, 'state'), stagingDirectory: join(directory, 'stage'),
    command: async (program, args) => { assert.equal(program, 'git'); return git(args); } });
  await manager.assertCheckoutUnmodified(checkout, commit, 'Releasekandidaten er ændret eller ignoreret.');
  await mkdir(join(checkout, 'data')); await writeFile(join(checkout, 'data/extra.test.mjs'), 'throw new Error("unreviewed");');
  assert.equal((await git(['status', '--porcelain', '--untracked-files=all'])).stdout.trim(), '');
  assert.match((await git(['status', '--porcelain', '--untracked-files=all', '--ignored=matching'])).stdout, /!! data\//);
  await assert.rejects(manager.assertCheckoutUnmodified(checkout, commit, 'Releasekandidaten er ændret eller ignoreret.'), /ignoreret/);
});

test('the default release metadata reader is bounded and refuses symlinks rather than reading their targets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-release-metadata-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'package.json'); const text = '{"version":"5.0.0"}';
  await writeFile(path, text); assert.equal(await readReleasePackage(path), text);
  await writeFile(path, ' '.repeat(128 * 1024 + 1)); await assert.rejects(readReleasePackage(path), /checkout-sti/);
  const outside = join(directory, 'outside.json'); await writeFile(outside, text); await rm(path); await symlink(outside, path);
  await assert.rejects(readReleasePackage(path), /checkout-sti/);
  assert.equal(await readFile(outside, 'utf8'), text);
});
