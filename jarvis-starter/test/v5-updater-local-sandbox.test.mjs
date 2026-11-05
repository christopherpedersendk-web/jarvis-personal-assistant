import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateManager } from '../update-manager.mjs';

async function fixture(t, { environment = {}, host = 'unix:///synthetic/docker.sock', failRun = false, failCleanup = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-update-local-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = []; const sha = 'c'.repeat(40);
  const manager = await new UpdateManager({ dataDirectory: directory, stagingDirectory: join(directory, 'stage'),
    repository: 'git@github.com:synthetic/project.git', currentVersion: 'v4.9.1', environment,
    readPackage: async () => JSON.stringify({ version: '5.0.0', jarvisSchemaVersion: 1, jarvisReadableSchemaFrom: 0 }),
    command: async (program, args, options) => {
      calls.push({ program, args, options });
      if (program === 'git' && args[0] === 'clone') {
        await mkdir(join(args.at(-1), 'jarvis-starter'), { recursive: true });
        await writeFile(join(args.at(-1), 'jarvis-starter/package.json'), JSON.stringify({ version: '5.0.0', jarvisSchemaVersion: 1, jarvisReadableSchemaFrom: 0 }));
      }
      if (program === 'git' && args[0] === 'ls-remote') return { stdout: `${sha}\trefs/tags/v5.0.0\n` };
      if (program === 'git' && args[0] === 'rev-parse') return { stdout: sha + '\n' };
      if (program === 'docker' && args[0] === 'context') return { stdout: JSON.stringify(host) };
      if (program === 'docker' && args[2] === 'run' && failRun) throw Object.assign(new Error('synthetic Docker timeout'), { killed: true, signal: 'SIGTERM' });
      if (program === 'docker' && args[2] === 'rm' && failCleanup) throw new Error('synthetic cleanup unavailable');
      return { stdout: '' };
    },
  }).load();
  await manager.check(); return { manager, calls, sha };
}

test('release tests resolve and pin a local Docker endpoint with clean CLI env and no container env forwarding', async t => {
  const f = await fixture(t, { environment: { DOCKER_CONTEXT: 'desktop-linux', HOME: '/synthetic/local-home',
    NODE_OPTIONS: '--import=synthetic-private', OPENAI_API_KEY: 'synthetic-private-key', NEMLIG_PASS: 'synthetic-private-password' } });
  await f.manager.stage();
  const calls = f.calls.filter(call => call.program === 'docker');
  assert.equal(calls[0].args[0], 'context');
  for (const call of calls) {
    assert.equal(call.options.env.NODE_OPTIONS, undefined); assert.equal(call.options.env.OPENAI_API_KEY, undefined); assert.equal(call.options.env.NEMLIG_PASS, undefined);
    assert.equal(call.options.env.HOME, '/synthetic/local-home'); assert.equal(call.options.env.DOCKER_CONTEXT, undefined);
  }
  for (const call of calls.slice(1)) assert.deepEqual(call.args.slice(0, 2), ['--host', 'unix:///synthetic/docker.sock']);
  const run = calls.find(call => call.args[2] === 'run').args;
  assert.equal(run.includes('--env'), false); assert.equal(run.includes('-e'), false);
  for (const flag of ['none', '--read-only', '--pull', 'never', '--name', 'no-new-privileges']) assert.ok(run.includes(flag));
  assert.equal(f.manager.snapshot().staged.testedSha, f.sha); assert.equal(f.manager.snapshot().approved, null);
});

test('remote or unknown Docker contexts cannot produce staged release-test evidence', async t => {
  for (const host of ['ssh://synthetic.invalid', 'tcp://127.0.0.1:2375', null]) {
    const f = await fixture(t, { host }); await assert.rejects(f.manager.stage(), /lokalt endpoint/);
    assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
    assert.deepEqual(f.calls.filter(call => call.program === 'docker').map(call => call.args[0]), ['context']);
  }
});

test('release test timeout cleans up only its uniquely named local container and never reports success', async t => {
  const f = await fixture(t, { environment: { DOCKER_HOST: 'unix:///synthetic/explicit.sock' }, failRun: true });
  await assert.rejects(f.manager.stage(), /synthetic Docker timeout/);
  const calls = f.calls.filter(call => call.program === 'docker');
  assert.deepEqual(calls.map(call => call.args[2]), ['image', 'run', 'rm']);
  for (const call of calls) assert.deepEqual(call.args.slice(0, 2), ['--host', 'unix:///synthetic/explicit.sock']);
  const run = calls[1].args; const name = run[run.indexOf('--name') + 1];
  assert.match(name, /^jarvis-release-test-[a-f0-9-]{36}$/); assert.deepEqual(calls[2].args.slice(2), ['rm', '-f', name]);
  assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
});

test('unverified release-container cleanup is explicit rather than swallowed as an ordinary test failure', async t => {
  const f = await fixture(t, { failRun: true, failCleanup: true });
  await assert.rejects(f.manager.stage(), /containeroprydning kunne ikke verificeres/);
  assert.match(f.manager.snapshot().error, /jarvis-release-test-[a-f0-9-]+/);
  assert.equal(f.manager.snapshot().staged, null); assert.equal(f.manager.snapshot().approved, null);
});
