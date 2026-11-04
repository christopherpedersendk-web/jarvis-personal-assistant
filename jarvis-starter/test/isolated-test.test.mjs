import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerTest } from '../isolated-test.mjs';

test('refuses to execute generated code when Docker image is unavailable', async () => {
  const commands = [];
  const report = await dockerTest([{ path: 'app.js', content: 'console.log("test")' }], {
    runner: async (binary, args) => { commands.push([binary, args]); return { ok: false, output: 'not installed' }; },
  });
  assert.equal(report.status, 'unavailable');
  assert.deepEqual(commands.map(x => x[1][0]), ['image']);
});

test('runs tests only inside restricted offline read-only Docker container', async () => {
  const commands = [];
  const report = await dockerTest([{ path: 'app.js', content: 'console.log("test")' }], {
    runner: async (binary, args) => {
      commands.push([binary, args]);
      return { ok: true, output: 'tests passed' };
    },
  });
  assert.equal(report.status, 'passed');
  assert.equal(commands[0][1][0], 'image');
  const run = commands[1][1];
  assert.equal(run[0], 'run');
  for (const required of ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--pids-limit', '--memory', '--cpus', '--user']) {
    assert.ok(run.includes(required), `missing safety flag ${required}`);
  }
  assert.ok(run.includes('node:22-alpine'));
  assert.ok(run.some(x => String(x).includes('target=/workspace,readonly')));
});
