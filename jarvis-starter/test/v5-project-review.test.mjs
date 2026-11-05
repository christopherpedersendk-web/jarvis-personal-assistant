import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectAgent, exactlyApprovedPackages } from '../project-agent.mjs';
import { DevelopmentService } from '../development-service.mjs';
import { DurableState } from '../durable-state.mjs';

async function projectFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-v5-project-review-'));
  const state = { projects: [] };
  const agent = new ProjectAgent({ root: join(directory, 'projects'), backupRoot: join(directory, 'backups'),
    state, save: async () => {}, generate: async () => ({ summary: 'Syntetisk revision',
      files: [{ path: 'app.js', content: 'const revision = 1;' }], packages: [] }), installer: async () => {} });
  return { directory, state, agent };
}

test('J6/L3 rollback rejects corrupted backup bytes instead of installing unreviewed content', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Kontrol af backup', description: 'Kun syntetiske lokale filer' });
  await f.agent.develop(project.id, 'Opret første version');
  f.agent.generate = async () => ({ summary: 'Anden syntetiske revision', files: [{ path: 'app.js', content: 'const revision = 2;' }], packages: [] });
  await f.agent.develop(project.id, 'Opret anden version');
  const backup = join(f.directory, 'backups', project.id, f.agent.get(project.id).lastRollbackManifest, 'app.js');
  await writeFile(backup, 'const unrelatedUnreviewedContent = true;');
  await assert.rejects(f.agent.rollback(project.id));
  assert.equal(await readFile(join(f.directory, 'projects', project.slug, 'app.js'), 'utf8'), 'const revision = 2;');
  assert.equal(f.agent.get(project.id).revision, 2);
});

test('J6/L3 rollback rejects a changed manifest path set and preserves unrelated manual files', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Kontrol af manifest', description: 'Kun syntetiske lokale filer' });
  await f.agent.develop(project.id, 'Opret første version');
  const manual = join(f.directory, 'projects', project.slug, 'manual.txt');
  await writeFile(manual, 'Manuelt indhold må ikke slettes af rollback.');
  const manifestPath = join(f.directory, 'backups', project.id, f.agent.get(project.id).lastRollbackManifest, 'revision.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.before[0] = { path: 'manual.txt', existed: false, content: null };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(f.agent.rollback(project.id));
  assert.equal(await readFile(manual, 'utf8'), 'Manuelt indhold må ikke slettes af rollback.');
  assert.equal(await readFile(join(f.directory, 'projects', project.slug, 'app.js'), 'utf8'), 'const revision = 1;');
});

test('A1/J6 failed project creation never grants ownership of an unrelated existing directory', async () => {
  const f = await projectFixture();
  const existing = join(f.directory, 'projects', 'bevaret');
  await mkdir(existing, { recursive: true });
  const manual = join(existing, 'manual.txt');
  await writeFile(manual, 'Eksisterende brugerarbejde');
  let created;
  try { created = await f.agent.create({ title: 'Bevaret', description: 'Et andet nyt syntetisk projekt' }); }
  catch (error) { assert.equal(error.code, 'EEXIST'); }
  if (created) assert.notEqual(created.slug, 'bevaret', 'a safe alternative slug is acceptable');
  for (const entry of f.agent.list().filter(item => item.slug === 'bevaret')) {
    await assert.rejects(f.agent.archive(entry.id), 'a failed create cannot archive a directory it never created');
    await assert.rejects(f.agent.develop(entry.id, 'Må ikke redigere den eksisterende mappe'));
  }
  assert.equal(await readFile(manual, 'utf8'), 'Eksisterende brugerarbejde');
});

test('J6 test evidence cannot call an incompletely captured oversized project unchanged and passed', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Større manuel fil', description: 'Kun syntetiske lokale filer' });
  await writeFile(join(f.directory, 'projects', project.slug, 'app.js'), 'const supported = true;');
  const large = join(f.directory, 'projects', project.slug, 'large.js');
  await writeFile(large, `const before = true;\n/*${'x'.repeat(46000)}*/`);
  const service = new DevelopmentService({ projectAgent: f.agent, save: async () => {},
    testRunner: async () => {
      await writeFile(large, `const newerManualEdit = true;\n/*${'y'.repeat(46000)}*/`);
      return { status: 'passed', summary: 'Kun de udleverede syntetiske filer er testet' };
    } });
  let result;
  try { result = await service.test(project.id); }
  catch (error) { assert.match(error.message, /stor|fil|grænse|understøtt|ufuldstændig/i); return; }
  assert.notEqual(result.status, 'passed', 'silently omitted files must not produce a passing current-project claim');
});

test('J6 complete source hash covers files beyond model limits without sending their contents to the model', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Fuldt filgrundlag', description: 'Kun syntetiske lokale filer' });
  const dir = join(f.directory, 'projects', project.slug);
  for (let i = 0; i < 55; i++) await writeFile(join(dir, `file-${String(i).padStart(2, '0')}.js`), `const value = ${i};`);
  const large = join(dir, 'large.js');
  await writeFile(large, `const original = true;\n/*${'x'.repeat(46000)}*/`);
  const view = await f.agent.inspect(project.id);
  assert.equal(view.sourceInventory.length, 56);
  assert.ok(view.files.length <= 50);
  assert.equal(view.files.some(file => file.path === 'large.js'), false);
  assert.equal((await f.agent.testSnapshot(project.id)).files.length, 56);
  await writeFile(join(dir, 'file-54.js'), 'const changedOutsideModelContext = true;');
  const changed = await f.agent.sourceSnapshot(project.id);
  assert.notEqual(changed.sourceContentHash, view.sourceContentHash);
  assert.equal(changed.files.length, 0, 'hash-only reads do not expose file text');
});

test('J6 incomplete oversized test capture is unavailable, not a green truncated test', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Testgrænse', description: 'Kun syntetiske lokale filer' });
  await writeFile(join(f.directory, 'projects', project.slug, 'large.js'), `/*${'x'.repeat(2 * 1024 * 1024)}*/`);
  let calls = 0;
  const service = new DevelopmentService({ projectAgent: f.agent, save: async () => {},
    testRunner: async () => { calls++; return { status: 'passed' }; } });
  const report = await service.test(project.id);
  assert.equal(calls, 0);
  assert.equal(report.status, 'unavailable');
  assert.equal(report.reason, 'PROJECT_SNAPSHOT_INCOMPLETE');
  assert.equal(report.omittedFiles[0].path, 'large.js');
  assert.match(report.contentHash, /^[a-f0-9]{64}$/);
});

test('J6 a generated replacement cannot overwrite an existing file omitted from its model context', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Bevar uset indhold', description: 'Kun syntetiske lokale filer' });
  const file = join(f.directory, 'projects', project.slug, 'large.js');
  const original = `/*${'x'.repeat(46000)}*/`;
  await writeFile(file, original);
  f.agent.generate = async ({ project: context }) => {
    assert.equal(context.files.some(item => item.path === 'large.js'), false);
    return { summary: 'Ugyldig overskrivning', files: [{ path: 'large.js', content: 'const unseen = true;' }], packages: [] };
  };
  await assert.rejects(f.agent.develop(project.id, 'Ret projektet'), /uset|grundlag/);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(f.agent.get(project.id).revision, 0);
});

test('J6 changes to omitted source during generation invalidate the proposal before publication', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Ændret uset indhold', description: 'Kun syntetiske lokale filer' });
  const dir = join(f.directory, 'projects', project.slug);
  const file = join(dir, 'large.js');
  await writeFile(file, `/*${'x'.repeat(46000)}*/`);
  f.agent.generate = async () => {
    await writeFile(file, `/*${'y'.repeat(46000)}*/`);
    return { summary: 'Forældet forslag', files: [{ path: 'app.js', content: 'const stale = true;' }], packages: [] };
  };
  await assert.rejects(f.agent.develop(project.id, 'Ret projektet'), /ændret under genereringen/);
  await assert.rejects(readFile(join(dir, 'app.js')), error => error.code === 'ENOENT');
  assert.equal(f.agent.get(project.id).revision, 0);
});

test('J6 package approval binds omitted large source bytes as well as the project revision', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Pakkegrundlag', description: 'Kun syntetiske lokale filer' });
  const large = join(f.directory, 'projects', project.slug, 'large.js');
  await writeFile(large, `/*${'x'.repeat(46000)}*/`);
  f.agent.generate = async () => ({ summary: 'Pakkeforespørgsel', files: [{ path: 'app.js', content: 'const packageNeeded = true;' }], packages: ['alpha@1.0.0'] });
  await f.agent.develop(project.id, 'Ret projektet');
  let installations = 0;
  f.agent.installer = async () => { installations++; };
  await writeFile(large, `/*${'y'.repeat(46000)}*/`);
  await assert.rejects(f.agent.install(project.id, ['alpha@1.0.0'], 1), /indhold er ændret/);
  assert.equal(installations, 0);
});

test('R06 the same normalized package cannot appear twice with different versions', async () => {
  assert.equal(exactlyApprovedPackages(['alpha@1.0.0', 'alpha@2.0.0'], ['alpha@1.0.0', 'alpha@2.0.0']), false);
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Dobbelte pakker', description: 'Kun syntetiske lokale filer' });
  f.agent.generate = async () => ({ summary: 'Tvetydig pakkeforespørgsel',
    files: [{ path: 'app.js', content: 'const ambiguous = true;' }], packages: ['alpha@1.0.0', 'ALPHA@2.0.0'] });
  await assert.rejects(f.agent.develop(project.id, 'Ret projektet'), /én gang/);
  assert.equal(f.agent.get(project.id).revision, 0);
});

test('A1 a directory created by another writer after reservation is never treated as JARVIS-owned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-v5-create-race-'));
  const state = { projects: [] }; let raced = false;
  const root = join(directory, 'projects');
  const agent = new ProjectAgent({ root, backupRoot: join(directory, 'backups'), state,
    generate: async () => ({ files: [], packages: [], summary: 'må ikke ske' }),
    save: async () => {
      const project = state.projects[0];
      if (!raced && project?.operation?.kind === 'create' && project.operation.status === 'running') {
        raced = true;
        await mkdir(join(root, project.slug));
        await writeFile(join(root, project.slug, 'manual.txt'), 'Nyere brugerarbejde');
      }
    } });
  await assert.rejects(agent.create({ title: 'Samtidig mappe', description: 'Kun syntetiske lokale filer' }), error => error.code === 'EEXIST');
  const project = state.projects[0];
  assert.equal(project.directoryOwned, false);
  await assert.rejects(agent.archive(project.id), /ikke bekræftet/);
  await assert.rejects(agent.inspect(project.id), /ikke bekræftet/);
  assert.equal(await readFile(join(root, project.slug, 'manual.txt'), 'utf8'), 'Nyere brugerarbejde');
});

test('J6 restoration refuses an existing untracked directory even when it is empty', async () => {
  const f = await projectFixture();
  const project = await f.agent.create({ title: 'Gendan sikkert', description: 'Kun syntetiske lokale filer' });
  await f.agent.develop(project.id, 'Opret første version');
  await f.agent.archive(project.id);
  await mkdir(join(f.directory, 'projects', project.slug));
  await assert.rejects(f.agent.restore(project.id), /eksisterende mappe/);
  assert.equal(f.agent.archived().length, 1);
  assert.equal(await readFile(join(f.directory, 'projects', '.jarvis-archive', project.id, 'app.js'), 'utf8'), 'const revision = 1;');
});

test('J6 a finished project lock context cannot authorize later orphaned asynchronous work', async () => {
  const f = await projectFixture();
  let release; let later;
  const ready = new Promise(resolve => { release = resolve; });
  await f.agent.withLock(() => {
    later = ready.then(() => f.agent.create({ title: 'For sent', description: 'Må ikke køre i en afsluttet kontekst' }));
  });
  release();
  await assert.rejects(later, /afsluttet projektoperation/);
  assert.equal(f.state.projects.length, 0);
});

test('A1 caught nested transaction failure cannot smuggle its failed mutation into an outer commit', async () => {
  let disk;
  const store = new DurableState({ initial: { outer: [], inner: [] }, write: async contents => { disk = JSON.parse(contents); } });
  await store.initialize();
  let failed = false;
  try {
    await store.transact(['outer'], async () => {
      store.state.outer.push('Requested outer change');
      try {
        await store.transact(['inner'], async () => {
          store.state.inner.push('Failed inner change');
          await store.save();
          throw new Error('Syntetisk fejl efter indre ændring');
        });
      } catch { /* Caller may handle the error, but the failed change is not a successful save. */ }
      await store.save();
    });
  } catch { failed = true; }
  assert.deepEqual(store.state.inner, []);
  assert.deepEqual(disk.inner, []);
  assert.deepEqual(store.state.outer, failed ? [] : ['Requested outer change']);
});

test('A1 a post-publication configuration callback failure is not reported as an unapplied write', async () => {
  let disk;
  const store = new DurableState({ initial: { items: [] }, write: async contents => { disk = JSON.parse(contents); } });
  await store.initialize();
  await assert.rejects(store.transact(['items'], async () => {
    store.state.items.push('Durably published');
    store.stageFile('private-settings.json', '{}', () => { throw new Error('Syntetisk runtime-konfigurationsfejl'); });
    await store.save();
  }), error => error.statePublished === true);
  assert.deepEqual(disk.items, ['Durably published']);
  assert.deepEqual(store.state.items, ['Durably published']);
  assert.equal(store.snapshot().ready, false);
});
