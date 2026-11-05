import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateManager } from '../update-manager.mjs';

const code = await readFile(new URL('../public/system-health.js', import.meta.url), 'utf8');
const health = vm.runInNewContext(`${code}\nJarvisHealth;`);
const sha = '1'.repeat(40), otherSha = '2'.repeat(40), testedAt = '2026-11-05T09:00:00.000Z';
const staged = () => ({ version: 'v5.0.1', sha, testedSha: sha, testedAt, packageVersion: '5.0.1', schemaVersion: 1, readableFrom: 0 });
const snapshot = () => ({ configured: true, currentVersion: 'v5.0.0', available: { version: 'v5.0.1', sha }, staged: staged(), approved: null,
  storage: { ready: true }, publicationUnknown: false });

test('GUI-T08 deployment approval requires a concrete verified test and the exact current target', () => {
  assert.equal(health.updates(snapshot()).canApprove, true);
  for (const alter of [value => { value.configured = false; }, value => { value.staged = null; },
    value => { value.available = null; }, value => { value.available.sha = otherSha; },
    value => { value.available.version = 'v5.0.2'; }, value => { value.staged.testedSha = otherSha; },
    value => { value.staged.testedAt = ''; }, value => { value.staged.packageVersion = '5.0.2'; },
    value => { value.staged.readableFrom = 2; }, value => { value.staged.sha = 'not-a-sha'; }]) {
    const value = snapshot(); alter(value); assert.equal(health.updates(value).canApprove, false, JSON.stringify(value));
  }
});

test('GUI-T08 approval of another revision never suppresses review of a newly tested target', () => {
  const value = snapshot(); value.approved = { ...staged(), sha: otherSha, testedSha: otherSha, approvedAt: testedAt };
  assert.equal(health.updates(value).canApprove, true); assert.equal(health.updates(value).alreadyApproved, false);
  value.approved = { ...staged(), approvedAt: testedAt };
  assert.equal(health.updates(value).canApprove, false); assert.equal(health.updates(value).alreadyApproved, true);
});

test('GUI-T08 server rejects changed SHA or test time before mutating or persisting approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-gui-update-'));
  try {
    let commands = 0;
    const initial = { updateStateSchemaVersion: 1, stateRevision: 1, available: snapshot().available,
      staged: staged(), approved: null, lastCheck: testedAt, error: '' };
    const manager = await new UpdateManager({ dataDirectory: directory, stagingDirectory: join(directory, 'stage'),
      repository: '', currentVersion: 'v5.0.0', readState: async () => JSON.stringify(initial),
      command: async () => { commands++; throw new Error('No process may run for approval review'); } }).load();
    const before = await readFile(manager.stateFile, 'utf8');
    for (const [expectedSha, expectedTestedAt] of [[otherSha, testedAt],
      [sha, '2026-11-05T09:01:00.000Z'], ['invalid', testedAt]]) {
      await assert.rejects(manager.approve('v5.0.1', expectedSha, expectedTestedAt), /testrevision er ændret|præcise.*revision/);
      assert.equal(manager.state.approved, null); assert.equal(await readFile(manager.stateFile, 'utf8'), before);
    }
    const result = await manager.approve('v5.0.1', sha, testedAt);
    assert.equal(result.approved.sha, sha); assert.equal(result.approved.testedAt, testedAt);
    assert.ok(result.approved.approvedAt); assert.equal(commands, 0, 'approval records intent without deployment');
    const saved = JSON.parse(await readFile(manager.stateFile, 'utf8'));
    assert.equal(saved.approved.sha, sha); assert.equal(saved.approved.testedAt, testedAt);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
