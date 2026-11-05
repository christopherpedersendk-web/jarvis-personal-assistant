import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJavaScriptSyntax, cleanProcessEnvironment, dockerProcessEnvironment,
  isLocalDockerEndpoint, localDockerEndpoint, runBoundedProcess } from '../subprocess-safety.mjs';
import { dockerTest } from '../isolated-test.mjs';
import { systemHealth } from '../system-health.mjs';

const poisoned = {
  PATH: process.env.PATH || '/usr/bin:/bin', SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  HOME: '/synthetic-private-home', DOCKER_CONFIG: '/synthetic-private-home/.docker',
  OPENAI_API_KEY: 'sk-synthetic-not-real', NEMLIG_PASS: 'synthetic-not-real', DISCORD_TOKEN: 'synthetic-not-real',
  JARVIS_ACCESS_TOKEN: 'synthetic-not-real', NODE_OPTIONS: '--import=data:text/javascript,throw%20new%20Error(%22preload-ran%22)',
  NODE_PATH: '/synthetic-private-home/node_modules', LD_PRELOAD: '/synthetic/private-library',
  HTTP_PROXY: 'https://synthetic-private-proxy.invalid', npm_config_registry: 'https://synthetic-private-registry.invalid',
  DOCKER_HOST: 'ssh://synthetic-private-daemon', DOCKER_CONTEXT: 'synthetic-remote',
};

function fakeSpawn(onSpawn) {
  return (binary, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = signal => { child.killedWith = signal; setImmediate(() => child.emit('close', 0, signal)); return true; };
    setImmediate(() => onSpawn(child, binary, args, options)); return child;
  };
}

test('host parse subprocesses receive only the system allowlist, not credentials/preloads/proxies/config', async () => {
  const environment = cleanProcessEnvironment(poisoned);
  assert.deepEqual(Object.keys(environment).sort(), ['LANG', 'PATH', 'SystemRoot']);
  const result = await runBoundedProcess(process.execPath, ['--input-type=module', '-e', 'console.log(JSON.stringify(process.env))'], { environment });
  assert.equal(result.ok, true); const actual = JSON.parse(result.output);
  for (const field of Object.keys(poisoned).filter(key => !['PATH', 'SystemRoot'].includes(key))) assert.equal(actual[field], undefined, field);
  assert.equal(actual.PATH, poisoned.PATH);
  const docker = dockerProcessEnvironment(poisoned);
  assert.equal(docker.HOME, poisoned.HOME); assert.equal(docker.DOCKER_CONFIG, poisoned.DOCKER_CONFIG);
  for (const field of ['NODE_OPTIONS', 'NEMLIG_PASS', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'HTTP_PROXY']) assert.equal(docker[field], undefined, field);
});

test('real --check parses source without executing it or the inherited NODE_OPTIONS preload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-parse-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'must-not-exist');
  await checkJavaScriptSyntax(`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('must not run');`, { environment: poisoned });
  await checkJavaScriptSyntax(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`, { inputType: 'commonjs', environment: poisoned });
  await assert.rejects(access(marker), { code: 'ENOENT' });
  await assert.rejects(checkJavaScriptSyntax('const = broken;', { environment: poisoned }), /syntaksfejl/);
});

test('subprocess output is bounded in bytes and zero exit after forced timeout cannot become success', async () => {
  let processHandle;
  const result = await runBoundedProcess('synthetic-tool', [], { environment: {}, timeoutMs: 15, maxOutputBytes: 64,
    spawnProcess: fakeSpawn((child, binary, args, options) => {
      processHandle = child; assert.equal(options.shell, false); assert.deepEqual(options.env, {});
      child.stderr.write('æ'.repeat(10000));
    }),
  });
  assert.equal(result.ok, false); assert.equal(result.timedOut, true); assert.equal(processHandle.killedWith, 'SIGKILL');
  assert.equal(Buffer.byteLength(result.output), 64);
});

test('spawn failure is truthful and does not leak raw command errors', async () => {
  const result = await runBoundedProcess('synthetic-tool', [], { environment: {},
    spawnProcess: fakeSpawn(child => child.emit('error', Object.assign(new Error('private synthetic text'), { code: 'ENOENT' }))),
  });
  assert.equal(result.ok, false); assert.equal(result.unavailable, true); assert.equal(result.output, '');
  assert.equal(JSON.stringify(result).includes('private synthetic'), false);
  assert.throws(() => runBoundedProcess('tool', []), /afgrænset miljø/);
});

test('Docker accepts only explicit local transports, rejects remote/unknown without executing test code', async () => {
  for (const value of ['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker.sock', 'npipe:////./pipe/docker_engine']) assert.equal(isLocalDockerEndpoint(value), true, value);
  for (const value of ['tcp://127.0.0.1:2375', 'ssh://host', 'npipe:////host/pipe/docker_engine', 'unix://host/socket', 'unix:///socket?host=remote', '', null]) assert.equal(isLocalDockerEndpoint(value), false, value);
  let calls = 0;
  const remote = await dockerTest([{ path: 'app.js', content: 'throw new Error("never execute")' }], {
    environment: { DOCKER_HOST: 'ssh://synthetic.invalid' }, runner: async () => { calls++; throw new Error('must not be called'); },
  });
  assert.equal(remote.status, 'unavailable'); assert.equal(calls, 0);
  const unknown = await localDockerEndpoint(async () => ({ ok: true, output: 'not valid JSON' }), { environment: {} });
  assert.equal(unknown.ok, false);
});

test('local Docker context is resolved once and pinned through inspect/run/timeout cleanup with no env injection', async () => {
  const calls = [];
  const report = await dockerTest([{ path: 'test/app.test.js', content: 'console.log("synthetic")' }], {
    environment: { ...poisoned, DOCKER_CONTEXT: 'desktop-linux' },
    runner: async (binary, args) => {
      calls.push({ binary, args });
      if (args[0] === 'context') return { ok: true, output: JSON.stringify('unix:///synthetic/docker.sock') };
      if (args[2] === 'run') return { ok: false, timedOut: true, output: 'synthetic timeout' };
      return { ok: true, output: '' };
    },
  });
  assert.equal(report.status, 'failed');
  assert.deepEqual(calls[0].args, ['context', 'inspect', 'desktop-linux', '--format', '{{json .Endpoints.docker.Host}}']);
  for (const call of calls.slice(1)) assert.deepEqual(call.args.slice(0, 2), ['--host', 'unix:///synthetic/docker.sock']);
  assert.deepEqual(calls.slice(1).map(call => call.args[2]), ['image', 'run', 'rm']);
  const run = calls[2].args; const name = run[run.indexOf('--name') + 1];
  assert.deepEqual(calls[3].args.slice(2), ['rm', '-f', name]);
  for (const required of ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pull', 'never']) assert.ok(run.includes(required));
  assert.equal(run.includes('--env'), false); assert.equal(run.includes('-e'), true, 'the fixed node -e harness is not a Docker env flag');
  assert.ok(run.indexOf('-e') > run.indexOf('node:22-alpine'));
  assert.equal(JSON.stringify(calls).includes('synthetic-private'), false);
});

test('unsafe/duplicate snapshot paths and excessive payloads stop before any Docker lookup', async () => {
  let calls = 0; const runner = async () => { calls++; throw new Error('must not run'); };
  for (const path of ['../escape.js', '/absolute.js', 'test/../../escape.js', 'node_modules/package.js', '.env', 'test//file.js'])
    await assert.rejects(dockerTest([{ path, content: '' }], { runner, environment: {} }), /usikker/);
  await assert.rejects(dockerTest([{ path: 'app.js', content: '' }, { path: 'App.js', content: '' }], { runner, environment: {} }), /gentaget/);
  await assert.rejects(dockerTest([{ path: 'app.js', content: 'x'.repeat(2 * 1024 * 1024 + 1) }], { runner, environment: {} }), /stor/);
  assert.equal(calls, 0);
});

test('a lost Docker CLI connection also requires cleanup and unverified cleanup remains visible', async () => {
  const calls = [];
  const report = await dockerTest([{ path: 'app.js', content: 'const synthetic = true;' }], {
    environment: { DOCKER_HOST: 'unix:///synthetic/docker.sock' },
    runner: async (binary, args) => { calls.push(args); return args[2] === 'image' ? { ok: true, output: '' } : { ok: false, output: 'synthetic lost connection' }; },
  });
  assert.equal(report.status, 'failed'); assert.match(report.summary, /oprydning.*ikke verificeres/);
  assert.deepEqual(calls.map(args => args[2]), ['image', 'run', 'rm']);
  assert.equal(report.reports[0].cleanupVerified, false);
  assert.equal(report.reports[0].containerName, calls[2][4]);
});

test('systemctl diagnostics are read-only, bounded and receive no application secrets or loader options', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-health-env-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const report = await systemHealth({ dataDirectory: directory, environment: poisoned,
    discord: { snapshot: () => ({ status: 'disabled' }) }, taskEngine: { currentUsage: () => ({}), list: () => [] },
    command: async (program, args, options) => {
      calls++; assert.equal(program, 'systemctl'); assert.equal(args[0], 'show'); assert.equal(args[1], 'jarvis-backup.service');
      assert.ok(args.includes('--no-pager')); assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 8000);
      assert.deepEqual(options.env, cleanProcessEnvironment(poisoned));
      return { stdout: 'ActiveState=inactive\nResult=success\nExecMainStatus=0\n' };
    },
  });
  assert.equal(calls, 1); assert.equal(report.backup.result, 'success'); assert.equal(report.storage.ready, true);
});
