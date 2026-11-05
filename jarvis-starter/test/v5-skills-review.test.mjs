import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillsRegistry, loadBundledSkills, skillContentHash } from '../skills-registry.mjs';
import { TaskEngine } from '../task-engine.mjs';

const sample = version => ({ name: 'synthetic-procedure', version, description: 'Syntetisk gennemgang',
  triggers: ['syntetisk'], permissions: 'existing-authorized-tools-only', body: `# Syntetisk version ${version}\nLæs kun syntetiske kilder.` });

test('H2 exact skill details expose the entire matching procedure without version fallback or granting permissions', () => {
  const first = sample('1.0.0'), second = sample('2.0.0'), registry = new SkillsRegistry([first, second]);
  const detail = registry.detail(first.name, first.version);
  assert.equal(detail.body, first.body); assert.notEqual(detail.body, second.body);
  assert.equal(detail.sourceId, 'skill:synthetic-procedure:1.0.0');
  assert.equal(detail.permissions, 'existing-authorized-tools-only');
  assert.equal(detail.contentHash, registry.catalog().find(skill => skill.version === first.version).contentHash);
  assert.throws(() => registry.detail(first.name, '9.0.0'), { status: 404, code: 'SKILL_NOT_FOUND' });
  for (const [id, version] of [['../synthetic-procedure', '1.0.0'], [first.name, 'latest'], [first.name, null],
    [first.name, '1.0.0/../../'], [first.name, '1'.repeat(33) + '.0.0']])
    assert.throws(() => registry.detail(id, version), { status: 400, code: 'VALIDATION_ERROR' });
  detail.triggers.push('skal ikke ændre kataloget'); detail.body = 'Ændret klientkopi';
  assert.deepEqual(first.triggers, ['syntetisk']); assert.notEqual(registry.detail(first.name, first.version).body, detail.body);
  registry.catalog()[0].triggers.push('heller ikke'); assert.deepEqual(first.triggers, ['syntetisk']);
});

test('H2 displayed skill hash is byte-compatible with existing job bindings and changes with permissions or the complete body', async () => {
  const registry = await loadBundledSkills(fileURLToPath(new URL('../', import.meta.url)));
  const detail = registry.detail('daily-briefing', '1.0.0');
  const previousHash = createHash('sha256').update(JSON.stringify({ name: detail.name, version: detail.version,
    permissions: detail.permissions, body: detail.body })).digest('hex');
  assert.equal(detail.contentHash, previousHash);
  const engine = new TaskEngine({ state: {}, save: async () => {}, skillsRegistry: registry,
    runTask: async () => { assert.fail('Reading a skill must never run a job.'); } });
  const task = await engine.create({ title: 'Syntetisk pauset procedure', prompt: 'Kun test', activation: 'paused',
    skillId: detail.name, skillVersion: detail.version });
  await engine.tick();
  assert.equal(task.skillContentHash, detail.contentHash); assert.equal(task.status, 'paused');
  assert.notEqual(skillContentHash({ ...detail, permissions: 'changed' }), detail.contentHash);
  assert.notEqual(skillContentHash({ ...detail, body: detail.body + '\nEkstra sidste trin.' }), detail.contentHash);
});

test('H2 duplicate exact versions are not reviewable or executable as an arbitrary first match', async () => {
  const registry = new SkillsRegistry([sample('1.0.0'), { ...sample('1.0.0'), body: 'Andet indhold' }]);
  assert.throws(() => registry.detail('synthetic-procedure', '1.0.0'), { status: 409, code: 'SKILL_VERSION_CONFLICT' });
  assert.throws(() => registry.resolve('synthetic-procedure', '1.0.0'), /tvetydig/);
  const engine = new TaskEngine({ state: {}, save: async () => {}, skillsRegistry: registry, runTask: async () => assert.fail('No run') });
  await assert.rejects(engine.create({ title: 'Tvetydig', prompt: 'Kun test', activation: 'paused',
    skillId: 'synthetic-procedure', skillVersion: '1.0.0' }), /tvetydig/);
});

test('H2 oversized bundled procedure bodies are rejected instead of silently truncating the reviewed version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-v5-skills-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'skills', 'daily-briefing'); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), `---\nname: daily-briefing\nversion: 1.0.0\ndescription: Syntetisk\ntriggers: test\n---\n${'a'.repeat(8501)}`);
  await assert.rejects(loadBundledSkills(directory), /skill-felter/);
});
