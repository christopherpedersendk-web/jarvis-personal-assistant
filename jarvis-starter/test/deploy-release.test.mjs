import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readlink, symlink, rename, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicLink, validatedApproval, unprivilegedGitCommand, deployRelease, healthCheck } from '../scripts/deploy-release.mjs';

const commit = 'a'.repeat(40);
test('deployment requires both staged proof and explicit approval of the same commit', () => {
  const staged = { version: 'v4.7.0', sha: commit, testedSha: commit, packageVersion: '4.7.0', testedAt: '2026-11-04T12:00:00Z' };
  const approved = { ...staged, approvedAt: '2026-11-04T12:10:00Z' };
  assert.deepEqual(validatedApproval({ staged, approved }), { version: 'v4.7.0', sha: commit });
  assert.equal(validatedApproval({ staged, approved: { ...approved, sha: 'b'.repeat(40) } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, version: '../other' } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, approvedAt: null } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, testedSha: 'b'.repeat(40) } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, packageVersion: '4.8.0' } }), null);
  assert.equal(validatedApproval({ staged, approved: null }), null);
  const v5 = { ...staged, version: 'v5.0.0', packageVersion: '5.0.0', schemaVersion: 1, readableFrom: 0 };
  assert.deepEqual(validatedApproval({ staged: v5, approved: { ...v5, approvedAt: '2026-11-04T12:10:00Z' } }),
    { version: 'v5.0.0', sha: commit, schemaVersion: 1, readableFrom: 0 });
  assert.equal(validatedApproval({ staged: v5, approved: { ...v5, schemaVersion: 9,
    approvedAt: '2026-11-04T12:10:00Z' } }), null);
});

test('runtime health must report the exact approved application version', async () => {
  let checks = 0;
  const fetcher = async () => { checks++; return { ok: true,
    json: async () => ({ ok: true, version: checks === 1 ? '4.9.1' : '5.0.0' }) }; };
  assert.equal(await healthCheck('http://localhost/health', { expectedVersion: 'v5.0.0', fetcher,
    attempts: 2, intervalMs: 0 }), true);
  assert.equal(checks, 2);
  assert.equal(await healthCheck('http://localhost/health', { expectedVersion: 'v5.0.0',
    fetcher: async () => ({ ok: true, json: async () => ({ ok: true, version: '4.9.1' }) }),
    attempts: 1 }), false);
});

test('release switch replaces one symlink atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-switch-'));
  const path = join(dir, 'current');
  await symlink('/release/old', path);
  await atomicLink('/release/new', path, { symlink, rename });
  assert.equal(await readlink(path), '/release/new');
});

test('deployment Git verification drops privileges without PAM', () => {
  const [program, args] = unprivilegedGitCommand(['rev-parse', 'HEAD']);
  assert.equal(program, '/usr/bin/setpriv');
  assert.deepEqual(args.slice(0, 5), ['--reuid=1000', '--regid=1000', '--clear-groups', '--', '/usr/bin/git']);
  assert.deepEqual(args.slice(-2), ['rev-parse', 'HEAD']);
});

test('failed healthcheck automatically restores the previous release and retains shared data', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'jarvis-rollback-'));
  const root = join(sandbox, 'jarvis');
  const releases = join(root, 'releases');
  const staging = join(root, 'update-staging');
  const data = join(root, 'shared', 'data');
  const audit = join(sandbox, 'audit', 'last-result.json');
  const current = join(root, 'current');
  const previous = join(releases, 'v4.6.1');
  const candidate = join(staging, 'v4.6.2');
  await mkdir(previous, { recursive: true });
  await mkdir(join(candidate, 'jarvis-starter'), { recursive: true });
  await mkdir(data, { recursive: true });
  await writeFile(join(candidate, 'jarvis-starter', 'package.json'), '{"version":"4.6.2"}');
  await writeFile(join(data, 'state.json'), '{"important":"preserved"}');
  const approved = { version: 'v4.6.2', sha: commit, testedSha: commit, packageVersion: '4.6.2',
    testedAt: '2026-11-04T12:00:00Z', approvedAt: '2026-11-04T12:10:00Z' };
  await writeFile(join(data, 'update-state.json'), JSON.stringify({ staged: approved, approved }));
  await symlink(previous, current);

  const commands = [];
  let checks = 0;
  const result = await deployRelease({ root, staging, releases, data, current, audit }, {
    testFixturePaths: true,
    run: async (command, args) => {
      commands.push([command, ...args]);
      if (args.includes('rev-parse')) return { stdout: commit + '\n' };
      return { stdout: '' };
    },
    checkHealth: async () => ++checks > 1,
  });

  assert.deepEqual(result, { status: 'rolled-back', version: 'v4.6.2' });
  assert.equal(await readlink(current), previous);
  assert.equal(JSON.parse(await readFile(join(data, 'state.json'), 'utf8')).important, 'preserved');
  assert.equal(JSON.parse(await readFile(audit, 'utf8')).status, 'rolled-back');
  assert.equal(commands.filter(([program, action]) => program === '/usr/bin/systemctl' && action === 'restart').length, 2);
});

test('automatic rollback refuses to start v4 code after a v5 data-schema migration', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'jarvis-schema-rollback-'));
  const root = join(sandbox, 'jarvis'); const releases = join(root, 'releases');
  const staging = join(root, 'update-staging'); const data = join(root, 'shared', 'data');
  const audit = join(sandbox, 'audit', 'last-result.json'); const current = join(root, 'current');
  const previous = join(releases, 'v4.9.1'); const candidate = join(staging, 'v5.0.0');
  await mkdir(join(previous, 'jarvis-starter'), { recursive: true });
  await mkdir(join(candidate, 'jarvis-starter'), { recursive: true });
  await mkdir(data, { recursive: true });
  await writeFile(join(previous, 'jarvis-starter', 'package.json'), '{"version":"4.9.1"}');
  await writeFile(join(candidate, 'jarvis-starter', 'package.json'), '{"version":"5.0.0","jarvisSchemaVersion":1,"jarvisReadableSchemaFrom":0}');
  await writeFile(join(data, 'state.json'), '{"schemaVersion":0,"manual":"retained"}');
  const approved = { version: 'v5.0.0', sha: commit, testedSha: commit, packageVersion: '5.0.0',
    schemaVersion: 1, readableFrom: 0,
    testedAt: '2026-11-04T12:00:00Z', approvedAt: '2026-11-04T12:10:00Z' };
  await writeFile(join(data, 'update-state.json'), JSON.stringify({ staged: approved, approved }));
  await symlink(previous, current);
  let restarted = 0;
  const result = await deployRelease({ root, staging, releases, data, current, audit }, {
    testFixturePaths: true,
    run: async (_command, args) => {
      if (args.includes('rev-parse')) return { stdout: commit + '\n' };
      if (args.includes('restart')) restarted++;
      return { stdout: '' };
    },
    checkHealth: async () => {
      await writeFile(join(data, 'state.json'), '{"schemaVersion":1,"manual":"newer data"}');
      return false;
    },
  });
  assert.equal(result.status, 'rollback-blocked');
  assert.equal(restarted, 1, 'old code must not restart over newer data');
  assert.equal(await readlink(current), join(releases, 'v5.0.0'));
  assert.equal(JSON.parse(await readFile(join(data, 'state.json'), 'utf8')).manual, 'newer data');
  assert.equal(JSON.parse(await readFile(audit, 'utf8')).status, 'rollback-blocked');
});
