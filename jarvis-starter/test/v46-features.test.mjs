import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, UpdateManager } from '../update-manager.mjs';
import { DiscordGateway } from '../discord-gateway.mjs';
import { systemHealth } from '../system-health.mjs';

test('version comparison is numeric and rejects untrusted refs', () => {
  assert.equal(compareVersions('v4.10.0', 'v4.9.9'), 1);
  assert.equal(compareVersions('v4.6.0', 'v4.6.0'), 0);
  assert.throws(() => compareVersions('main;rm', 'v4.6.0'));
});

test('updater only stages a pinned GitHub tag and requires explicit approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-update-test-'));
  const commit = 'a'.repeat(40);
  const calls = [];
  const manager = await new UpdateManager({
    dataDirectory: directory, stagingDirectory: join(directory, 'stage'),
    repository: 'git@github.com:example/jarvis.git', currentVersion: 'v4.6.0',
    readPackage: async () => JSON.stringify({ version: '4.7.0' }),
    command: async (program, args) => {
      calls.push([program, ...args]);
      if (args[0] === 'ls-remote') return { stdout: `${commit}\trefs/tags/v4.7.0\n` };
      if (args[0] === 'rev-parse') return { stdout: commit + '\n' };
      return { stdout: '' };
    },
  }).load();
  await manager.check();
  assert.equal(manager.snapshot().available.version, 'v4.7.0');
  assert.equal(manager.snapshot().approved, null);
  await manager.stage();
  await manager.approve('v4.7.0');
  assert.equal(manager.snapshot().approved.sha, commit);
  assert.ok(calls.some(call => call[0] === 'docker' && call.includes('--network')));
  assert.match(await readFile(join(directory, 'update-state.json'), 'utf8'), /v4\.7\.0/);
});

test('Discord proactive notifications only target the configured owner DM', async () => {
  const requests = [];
  const gateway = new DiscordGateway({ onMessage: async () => '', fetcher: async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/channels') ? { ok: true, json: async () => ({ id: '123456789012345678' }) } : { ok: true };
  }});
  gateway.config = { token: 'fake', userId: '234567890123456789' };
  gateway.status = 'connected';
  assert.equal(await gateway.notifyOwner('test'), true);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].options.body), { recipient_id: '234567890123456789' });
  assert.deepEqual(JSON.parse(requests[1].options.body).allowed_mentions, { parse: [] });
});

test('System Health returns bounded measurements without credentials', async () => {
  const report = await systemHealth({
    discord: { snapshot: () => ({ status: 'connected', lastError: '' }) },
    taskEngine: { currentUsage: () => ({ started: 0 }), list: () => [] },
    dataDirectory: tmpdir(),
  });
  assert.equal(report.process.healthy, true);
  assert.ok(report.host.totalMemoryBytes > 0);
  assert.equal(report.discord.status, 'connected');
  assert.equal(JSON.stringify(report).includes('OPENAI_API_KEY'), false);
});
