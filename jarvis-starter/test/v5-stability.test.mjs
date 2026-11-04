import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateReleasePackage, UpdateManager } from '../update-manager.mjs';
import { exactlyApprovedPackages, ProjectAgent } from '../project-agent.mjs';

const accessToken = 'a-long-synthetic-test-token-jarvis-v5';
const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

async function fixture(t, extraEnv = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jarvis-v5-stability-'));
  const port = 27500 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  const processHandle = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, JARVIS_DATA_DIR: dataDir, JARVIS_PROJECT_ROOT: join(dataDir, 'projects'),
      JARVIS_ACCESS_TOKEN: accessToken, JARVIS_PORT: String(port), JARVIS_HOST: '127.0.0.1',
      OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY', ...extraEnv },
    stdio: 'ignore',
  });
  t.after(() => processHandle.kill());
  let ready = false;
  for (let attempt = 0; attempt < 70; attempt++) {
    try { ready = (await fetch(`${url}/health`)).ok; if (ready) break; }
    catch { /* server not ready */ }
    await delay(75);
  }
  assert.equal(ready, true, 'synthetic server must start');
  async function api(method, path, input) {
    const response = await fetch(url + path, {
      method, headers, ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  return { dataDir, api };
}

test('R01: one disk write error does not poison subsequent state saves', async t => {
  const { dataDir, api } = await fixture(t);
  // The atomic writer now uses unique, unpredictable temporary paths. Force
  // the actual publication/rename to fail by making the destination a folder.
  await mkdir(join(dataDir, 'state.json'));
  const failed = await api('POST', '/api/preferences', { text: 'Must not be saved' });
  assert.equal(failed.status, 500);
  assert.equal((await api('GET', '/api/state')).body.preferences, '');
  await rmdir(join(dataDir, 'state.json'));
  const successful = await api('POST', '/api/preferences', { text: 'Correct saved state' });
  assert.equal(successful.status, 200);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8')).preferences, 'Correct saved state');
});

test('R02: concurrent private settings edits survive and failed rename changes no active values', async t => {
  const { dataDir, api } = await fixture(t);
  await mkdir(join(dataDir, 'private-settings.json'));
  const failed = await api('POST', '/api/settings', {
    maxRunsPerDay: 8, httpsUrl: 'https://synthetic.example', pushToken: 'test-token', pushUser: 'test-user',
  });
  assert.equal(failed.status, 400);
  assert.equal((await api('GET', '/api/settings')).body.hasPushToken, false);
  await rmdir(join(dataDir, 'private-settings.json'));

  const [settings, discord] = await Promise.all([
    api('POST', '/api/settings', { maxRunsPerDay: 7, httpsUrl: 'https://synthetic.example',
      pushToken: 'test-token', pushUser: 'test-user' }),
    api('POST', '/api/discord/settings', { enabled: false, token: 'synthetic-discord-token',
      userId: '123456789012345678', guildId: '' }),
  ]);
  assert.equal(settings.status, 200);
  assert.equal(discord.status, 200);
  const privateState = JSON.parse(await readFile(join(dataDir, 'private-settings.json'), 'utf8'));
  assert.equal(privateState.token, 'test-token');
  assert.equal(privateState.url, 'https://synthetic.example');
  assert.equal(privateState.discord.token, 'synthetic-discord-token');
  assert.equal((await api('GET', '/api/settings')).body.hasPushToken, true);
  assert.equal((await api('GET', '/api/discord/settings')).body.hasToken, true);
});

test('R04: metadata mismatch is rejected even for a pinned SHA', async () => {
  assert.equal(validateReleasePackage('{"version":"5.0.0","jarvisSchemaVersion":1,"jarvisReadableSchemaFrom":0}', 'v5.0.0'), '5.0.0');
  assert.throws(() => validateReleasePackage('{"version":"5.0.0"}', 'v5.0.0'), /dataskema/);
  assert.throws(() => validateReleasePackage('{"version":"4.9.1"}', 'v5.0.0'), /matcher ikke/);
  assert.throws(() => validateReleasePackage('not json', 'v5.0.0'), /ugyldig/);
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-release-'));
  const sha = 'a'.repeat(40);
  let dockerCalls = 0;
  const manager = await new UpdateManager({
    dataDirectory: dir, stagingDirectory: join(dir, 'stage'),
    repository: 'git@github.com:example/jarvis.git', currentVersion: 'v4.9.1',
    readPackage: async () => JSON.stringify({ version: '4.9.1' }),
    command: async (_program, args) => {
      if (args[0] === 'ls-remote') return { stdout: `${sha}\trefs/tags/v5.0.0\n` };
      if (args[0] === 'rev-parse') return { stdout: sha + '\n' };
      if (args[0] === 'docker') dockerCalls++;
      return { stdout: '' };
    },
  }).load();
  await manager.check();
  await assert.rejects(manager.stage(), /package.json matcher ikke/);
  assert.equal(dockerCalls, 0, 'unmatched code must not be tested or staged as approved');
  assert.equal(manager.snapshot().staged, null);
});

test('R05: action journal survives the final tool round even when the assistant response fails', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'jarvis-v5-mock-api-'));
  const mockPath = join(folder, 'mock-openai.mjs');
  await writeFile(mockPath, `
    const nativeFetch = globalThis.fetch;
    let round = 0;
    globalThis.fetch = (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/v1/responses')) return nativeFetch(url, options);
      round += 1;
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'completed', output: [{ type: 'function_call', call_id: 'call-' + round,
          name: 'create_collection',
          arguments: JSON.stringify({ title: 'V5 test ' + round, type: 'notes' }) }]
      }) });
    };
  `);
  const { dataDir, api } = await fixture(t, {
    OPENAI_API_KEY: 'sk-synthetic-only-not-a-real-key',
    NODE_OPTIONS: `--import=${mockPath}`,
  });
  const failed = await api('POST', '/api/message', { message: 'Opret tre notesamlinger til testen' });
  assert.equal(failed.status, 500, 'the model exhausted all tool rounds');
  const actions = (await api('GET', '/api/actions')).body.actions;
  assert.equal(actions.length, 3);
  assert.ok(actions.every(entry => entry.status === 'completed' && entry.tool === 'create_collection'));
  const stored = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(stored.actionJournal.length, 3);
  assert.equal(stored.organizer.length, 3);
  assert.equal(stored.history.length, 0, 'a failed final reply does not fabricate a completed chat');
});

test('R06: approvals require unique exact package sets and an unchanged project revision', async () => {
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'beta@2.0.0'],
    ['alpha@1.0.0', 'alpha@1.0.0']), false);
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'beta@2.0.0'], ['alpha@1.0.0']), false);
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'beta@2.0.0'],
    ['alpha@1.0.0', 'gamma@2.0.0']), false);
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'beta@2.0.0'],
    ['alpha@1.0.1', 'beta@2.0.0']), false);
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'beta@2.0.0'],
    ['BETA@2.0.0', 'ALPHA@1.0.0']), true);
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'Alpha@1.0.0'],
    ['alpha@1.0.0', 'Alpha@1.0.0']), false);
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-packages-'));
  let installed = 0;
  const agent = new ProjectAgent({ root: join(root, 'projects'), backupRoot: join(root, 'backups'),
    state: { projects: [] }, save: async () => {},
    generate: async () => ({ summary: 'App', files: [{ path: 'index.html', content: 'Hello' }], packages: ['alpha@1.0.0'] }),
    installer: async () => { installed += 1; } });
  const project = await agent.create({ title: 'Revision test', description: 'Et isoleret kodeprojekt' });
  await agent.develop(project.id, 'Lav en app');
  await assert.rejects(agent.install(project.id, ['alpha@1.0.0'], project.revision - 1), /Projektet er ændret/);
  await assert.rejects(agent.install(project.id, ['alpha@1.0.0', 'alpha@1.0.0'], project.revision), /Godkend præcis/);
  assert.equal(installed, 0);
  await agent.install(project.id, ['alpha@1.0.0'], project.revision);
  assert.equal(installed, 1);
});

test('R05/R06: unknown npm install effects are journaled and cannot be replayed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-install-outcome-'));
  let installations = 0;
  const state = { projects: [] };
  const agent = new ProjectAgent({ root: join(root, 'projects'), backupRoot: join(root, 'backups'),
    state, save: async () => {},
    generate: async () => ({ summary: 'App', files: [{ path: 'index.html', content: 'Hello' }],
      packages: ['alpha@1.0.0'] }),
    installer: async () => { installations += 1; throw new Error('Unknown package-manager result'); } });
  const project = await agent.create({ title: 'Install recovery', description: 'Et isoleret kodeprojekt' });
  await agent.develop(project.id, 'Lav en app');
  await assert.rejects(agent.install(project.id, ['alpha@1.0.0'], project.revision), /Unknown/);
  assert.equal(project.packageInstallAttempt.status, 'unknown');
  await assert.rejects(agent.install(project.id, ['alpha@1.0.0'], project.revision), /ukendt udfald/);
  assert.equal(installations, 1, 'an unknown outcome must never trigger a second installation');
});
