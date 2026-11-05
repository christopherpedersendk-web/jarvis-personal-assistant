import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticServerEnv } from './helpers/synthetic-env.mjs';

const run = promisify(execFile);
const poison = { PATH: process.env.PATH, HOME: '/synthetic/production-home', USERPROFILE: 'synthetic-profile',
  NODE_OPTIONS: '--import=/synthetic/must-not-be-loaded.mjs', NODE_PATH: '/synthetic/modules',
  LD_PRELOAD: '/synthetic/must-not-load.so', HTTP_PROXY: 'https://synthetic-private-proxy.invalid',
  OPENAI_API_KEY: 'sk-synthetic-parent-key-must-not-be-inherited', NEMLIG_ENABLE_LIVE: 'yes',
  NEMLIG_PASS: 'synthetic-parent-secret', PUSHOVER_APP_TOKEN: 'synthetic-parent-push-secret',
  GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-parent-oauth-secret', DISCORD_BOT_TOKEN: 'synthetic-parent-discord-secret',
  JARVIS_UPDATE_REPO: 'git@synthetic.invalid:production/repo', JARVIS_ALLOW_NPM_INSTALL: 'yes',
  JARVIS_LOCAL_SEMANTIC: 'yes', JARVIS_DATA_DIR: '/synthetic/production-data' };
const input = { dataDir: join(tmpdir(), 'synthetic-env-test-only'), accessToken: 'synthetic-fixture-access-token', port: 43210 };

test('L/I5 synthetic server env excludes parent secrets, preloads, proxies and home configuration', async () => {
  const env = syntheticServerEnv(input, poison);
  const result = await run(process.execPath, ['--input-type=module', '-e', 'process.stdout.write(JSON.stringify(process.env));'], { env });
  const child = JSON.parse(result.stdout);
  for (const key of ['HOME', 'USERPROFILE', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'HTTP_PROXY']) assert.equal(child[key], undefined, key);
  for (const key of ['NEMLIG_PASS', 'PUSHOVER_APP_TOKEN', 'GOOGLE_OAUTH_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'JARVIS_UPDATE_REPO']) assert.equal(child[key], '', key);
  assert.equal(child.OPENAI_API_KEY, 'REPLACE_WITH_YOUR_OWN_KEY');
  assert.equal(child.NEMLIG_ENABLE_LIVE, 'no'); assert.equal(child.JARVIS_ALLOW_NPM_INSTALL, 'no');
  assert.equal(child.JARVIS_LOCAL_SEMANTIC, 'no'); assert.equal(child.JARVIS_HOST, '127.0.0.1');
  assert.equal(child.JARVIS_DATA_DIR, input.dataDir); assert.equal(child.JARVIS_ACCESS_TOKEN, input.accessToken);
});

test('L/I5 test environment accepts only explicit synthetic model hooks, never an inherited key', () => {
  assert.throws(() => syntheticServerEnv({ ...input, modelKey: 'sk-not-a-synthetic-approved-fixture' }, poison), /synthetic model key/);
  assert.equal(syntheticServerEnv({ ...input, modelKey: 'sk-synthetic-only-not-a-real-key' }, poison).OPENAI_API_KEY,
    'sk-synthetic-only-not-a-real-key');
  assert.equal(syntheticServerEnv(input, poison).NODE_OPTIONS, undefined);
  assert.throws(() => syntheticServerEnv({ ...input, dataDir: 'relative' }, poison), /absolute/);
});

test('L/I5 all childserver test fixtures use the isolated environment helper without blanket parent inheritance', async () => {
  const root = new URL('./', import.meta.url);
  const files = (await readdir(root)).filter(name => name.endsWith('.test.mjs') && name !== 'v5-test-isolation.test.mjs');
  let servers = 0;
  for (const name of files) {
    const source = await readFile(new URL(name, root), 'utf8');
    if (!source.includes("'server.mjs'")) continue;
    if (!/\bspawn\(/.test(source)) continue;
    servers++; assert.match(source, /env:\s*syntheticServerEnv\(/, name);
    assert.doesNotMatch(source, /\.\.\.\s*process\.env|env:\s*process\.env/, name);
  }
  assert.equal(servers, 6, 'includes the new synthetic recipe-instructions tool server fixture');
  const legacyBrowser = await readFile(new URL('../scripts/visual-smoke.mjs', import.meta.url), 'utf8');
  assert.match(legacyBrowser, /env:\s*syntheticServerEnv\(/);
  assert.doesNotMatch(legacyBrowser, /\.\.\.\s*process\.env|env:\s*process\.env/);
});
