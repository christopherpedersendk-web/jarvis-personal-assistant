import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readlink, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicLink, validatedApproval, unprivilegedGitCommand } from '../scripts/deploy-release.mjs';

const commit = 'a'.repeat(40);
test('deployment requires both staged proof and explicit approval of the same commit', () => {
  const staged = { version: 'v4.7.0', sha: commit, testedAt: '2026-11-04T12:00:00Z' };
  const approved = { ...staged, approvedAt: '2026-11-04T12:10:00Z' };
  assert.deepEqual(validatedApproval({ staged, approved }), { version: 'v4.7.0', sha: commit });
  assert.equal(validatedApproval({ staged, approved: { ...approved, sha: 'b'.repeat(40) } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, version: '../other' } }), null);
  assert.equal(validatedApproval({ staged, approved: { ...approved, approvedAt: null } }), null);
  assert.equal(validatedApproval({ staged, approved: null }), null);
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
