import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectAgent } from '../project-agent.mjs';
import { DevelopmentService } from '../development-service.mjs';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-reviewed-basis-'));
  let models = 0, tests = 0;
  const agent = new ProjectAgent({ root: join(dir, 'projects'), backupRoot: join(dir, 'backups'), state: {}, save: async () => {},
    generate: async () => { models++; return { summary: 'Syntetisk fil', files: [{ path: 'a.js', content: 'const safe = true;' }], packages: [] }; } });
  const service = new DevelopmentService({ projectAgent: agent, save: async () => {}, testRunner: async () => { tests++; return { status: 'passed' }; } });
  const project = await agent.create({ title: 'Syntetisk grundlag', description: 'En lokalt afgrænset kontrakttest.' });
  return { agent, service, project, dir, counters: () => ({ models, tests }) };
}

const conflict = error => error.code === 'REVISION_CONFLICT' && error.status === 409;
test('R03/J6 stale owner revision blocks develop, isolated test, rollback and archive before side effects', async () => {
  const f = await fixture(); const wrong = { expectedRevision: 9 };
  await assert.rejects(f.service.developAndRepair(f.project.id, 'Syntetisk udvikling', wrong), conflict);
  await assert.rejects(f.service.test(f.project.id, wrong), conflict);
  await assert.rejects(f.agent.rollback(f.project.id, wrong), conflict);
  await assert.rejects(f.agent.archive(f.project.id, wrong), conflict);
  assert.deepEqual(f.counters(), { models: 0, tests: 0 });
  assert.equal(f.agent.get(f.project.id).revision, 0);
});

test('J6 reviewed complete source hash detects an external edit without a revision increment', async () => {
  const f = await fixture(); const original = await f.agent.sourceSnapshot(f.project.id);
  const file = join(f.dir, 'projects', f.project.slug, 'manual.txt');
  await writeFile(file, 'Nyere manuel tekst');
  const wrong = { expectedRevision: 0, expectedContentHash: original.sourceContentHash };
  await assert.rejects(f.service.developAndRepair(f.project.id, 'Syntetisk udvikling', wrong), conflict);
  await assert.rejects(f.service.test(f.project.id, wrong), conflict);
  await assert.rejects(f.agent.archive(f.project.id, wrong), conflict);
  assert.deepEqual(f.counters(), { models: 0, tests: 0 });
  assert.equal(await readFile(file, 'utf8'), 'Nyere manuel tekst');
});

test('J6 valid owner basis works under the same lock and a stale second request cannot reuse it', async () => {
  const f = await fixture(); const original = await f.agent.sourceSnapshot(f.project.id);
  const basis = { expectedRevision: 0, expectedContentHash: original.sourceContentHash };
  const result = await f.service.developAndRepair(f.project.id, 'Syntetisk udvikling', basis);
  assert.equal(result.project.revision, 1); assert.equal(result.test.status, 'passed');
  await assert.rejects(f.service.developAndRepair(f.project.id, 'Syntetisk udvikling', basis), conflict);
  assert.deepEqual(f.counters(), { models: 1, tests: 1 });
  const current = await f.agent.sourceSnapshot(f.project.id);
  await f.agent.rollback(f.project.id, { expectedRevision: 1, expectedContentHash: current.sourceContentHash });
  assert.equal(f.agent.get(f.project.id).revision, 2);
});

test('J6 malformed approval basis does not fall back to current unreviewed code', async () => {
  const f = await fixture();
  for (const basis of [{ expectedRevision: '0' }, { expectedRevision: null }, { expectedContentHash: '' }, { expectedContentHash: null }])
    await assert.rejects(f.agent.archive(f.project.id, basis), conflict);
  assert.deepEqual(f.counters(), { models: 0, tests: 0 });
});
