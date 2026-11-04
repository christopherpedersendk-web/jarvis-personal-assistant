import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectAgent } from '../project-agent.mjs';

function engine(root, generator) {
  return new ProjectAgent({ root: join(root, 'projects'), backupRoot: join(root, 'backups'),
    state: { projects: [] }, save: async () => {}, generate: generator,
    installer: async () => {}, });
}

test('creates isolated project, writes generated files and rolls back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-project-'));
  const agent = engine(root, async () => ({ summary: 'Første webapp', files: [
    { path: 'index.html', content: '<h1>Hej D&D</h1>' },
    { path: 'app.js', content: 'const character = "Finn";' },
  ], packages: [] }));
  const project = await agent.create({ title: 'D&D Karakterbog', description: 'En app til D&D karakterer' });
  assert.equal(project.slug, 'd-d-karakterbog');
  const result = await agent.develop(project.id, 'Byg projektet');
  assert.deepEqual(result.changedFiles, ['index.html', 'app.js']);
  assert.equal((await agent.inspect(project.id)).files.length, 2);
  assert.equal(await readFile(join(root, 'projects', project.slug, 'app.js'), 'utf8'), 'const character = "Finn";');
  await agent.rollback(project.id);
  assert.equal((await agent.inspect(project.id)).files.length, 0);
});

test('rejects path escape, secrets and invalid generated scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-project-'));
  const agent = engine(root, async () => ({ summary: 'Farlig sti', files: [{ path: '../.env', content: 'secret' }], packages: [] }));
  const project = await agent.create({ title: 'Min app', description: 'En simpel app' });
  await assert.rejects(agent.develop(project.id, 'Lav en app'), /ugyldig eller gentaget filsti/);
  agent.generate = async () => ({ summary: 'Syntaksfejl', files: [{ path: 'app.js', content: 'const = broken;' }], packages: [] });
  await assert.rejects(agent.develop(project.id, 'Ret noget'), /syntaksfejl/);
});

test('records npm package requests but never installs without approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-project-'));
  let installed = 0;
  const agent = engine(root, async () => ({ summary: 'React app', files: [{ path: 'index.html', content: '<h1>App</h1>' }], packages: ['react@19.0.0'] }));
  agent.installer = async () => { installed += 1; };
  const project = await agent.create({ title: 'Projekt test', description: 'En React app' });
  await agent.develop(project.id, 'Byg appen');
  assert.equal(installed, 0);
  await assert.rejects(agent.install(project.id, ['other']), /Godkend præcis/);
  await agent.install(project.id, ['react@19.0.0']);
  assert.equal(installed, 1);
  assert.deepEqual(project.pendingPackages, []);
});

test('refuses rollback when a file has been modified outside agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-project-'));
  const agent = engine(root, async () => ({ summary: 'Første', files: [{ path: 'app.js', content: 'const x=1;' }], packages: [] }));
  const project = await agent.create({ title: 'Projekt test', description: 'En webapp til test' });
  await agent.develop(project.id, 'Byg appen');
  await writeFile(join(root, 'projects', project.slug, 'app.js'), 'const x=2;');
  await assert.rejects(agent.rollback(project.id), /ændret siden/);
});

test('archives project folder without deleting files and restores it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-archive-'));
  const agent = engine(root, async () => ({ summary: 'App', files: [{ path: 'index.html', content: '<h1>Bevaret</h1>' }], packages: [] }));
  const project = await agent.create({ title: 'Bevar D&D', description: 'Gem karakterer i appen' });
  await agent.develop(project.id, 'Byg app');
  await agent.archive(project.id);
  assert.equal(agent.list().length, 0);
  assert.equal(agent.archived().length, 1);
  assert.equal(await readFile(join(root, 'projects', '.jarvis-archive', project.id, 'index.html'), 'utf8'), '<h1>Bevaret</h1>');
  await agent.restore(project.id);
  assert.equal(agent.list().length, 1);
  assert.equal(await readFile(join(root, 'projects', project.slug, 'index.html'), 'utf8'), '<h1>Bevaret</h1>');
});
