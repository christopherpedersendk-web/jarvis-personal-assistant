import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadBundledSkills, SkillsRegistry } from '../skills-registry.mjs';
import { TaskEngine } from '../task-engine.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Golden values captured before H1 v1.1.0 work. These must never be updated to
// bless an in-place rewrite: a changed historical procedure is a new version.
const historical = {
  'daily-briefing': { file: '9e49dd04448539eea1ca887d4a68fc83e525ca063016e947451b250045f14486', body: '0a10aae12055772e6e9d27027b477947d78f6c6f4f86f874f8bcbbd8eb3eeb83' },
  'personal-follow-up': { file: '837c519d5ce7ebfd9301435e5465907b88535d0122cc596b6d5bce7fc8d12da2', body: '848d095c5925ea16f56666789305c055d77c05ecdf75d3c52cefb50a28fafa68' },
  'gift-planning': { file: '7e88158bedf6d78b7ea24cafc64af5e6ce2194cdb6885c5bc221e510bcef3e02', body: 'e557de0883037b052fbbad7720441224ab658ab768bb7d3e2c6641f174c6383c' },
  'meal-planning': { file: '2c5082586734f46550f1428b92f10ef6b446580c32a985d69a73a2f4c6d2ac42', body: 'b73afe2040ae2ccf63cd96fc1b54fb90fed5f040fbeacd8d8e0534c62d6a00cc' },
};
const sha = value => createHash('sha256').update(value).digest('hex');

test('H1 historical 1.0.0 files and existing job hashes remain byte-for-byte unchanged', async () => {
  const registry = await loadBundledSkills(root);
  for (const [name, hashes] of Object.entries(historical)) {
    assert.equal(sha(await readFile(join(root, 'skills', name, 'SKILL.md'))), hashes.file, `${name}: historical file bytes`);
    const old = registry.detail(name, '1.0.0');
    assert.equal(old.contentHash, hashes.body, `${name}: persisted historical job binding`);
    assert.equal(old.current, false); assert.equal(old.contract, undefined);
    assert.equal(registry.current(name).version, '1.1.0');
  }
  assert.equal(registry.catalog().length, 12);
});

test('H1 four current procedures have complete immutable hash-bound contracts, synthetic examples and existing test references', async () => {
  const registry = await loadBundledSkills(root);
  for (const name of Object.keys(historical)) {
    const skill = registry.resolve(name, '1.1.0'), detail = registry.detail(name, '1.1.0'), contract = detail.contract;
    assert.equal(detail.current, true); assert.notEqual(detail.contentHash, historical[name].body);
    assert.equal(contract.schemaVersion, 1);
    for (const field of ['purpose', 'unknownPolicy']) assert.ok(contract[field].length > 30, `${name}/${field}`);
    for (const field of ['inputs', 'outputs', 'sources', 'tools']) assert.ok(contract[field].length >= 2, `${name}/${field}`);
    assert.ok(contract.examples.length >= 2); assert.equal(contract.budget.authority, 'reviewed-job-policy');
    assert.equal(contract.budget.defaults.maxRunsPerDay, 1); assert.equal(skill.permissions, 'existing-authorized-tools-only');
    assert.match(skill.body, /ingen|Ingen/); assert.match(skill.body, /ukendt|Ukendt|unknown/);
    const serialized = skill.body.match(/^## Kontrakt\n\n```json\n([\s\S]*?)\n```/m)[1];
    assert.deepEqual(JSON.parse(serialized), contract, 'displayed contract comes from the complete hashed body');
    for (const path of contract.tests) assert.ok((await readFile(join(root, path), 'utf8')).includes('test('), `${name}: ${path}`);
    assert.throws(() => { skill.contract.budget.defaults.maxRunsPerDay = 99; }, TypeError,
      'derived runtime defaults cannot drift independently of the immutable procedure body');
    detail.contract.budget.defaults.maxRunsPerDay = 99;
    assert.equal(registry.detail(name, '1.1.0').contract.budget.defaults.maxRunsPerDay, 1, 'detail is an independent read copy');
  }
});

test('H1 old job resumes with its exact historical procedure while new reviewed versions use their own defaults', async () => {
  const registry = await loadBundledSkills(root), oldRegistry = new SkillsRegistry([registry.resolve('daily-briefing', '1.0.0')]);
  const state = {}, executions = [];
  const original = new TaskEngine({ state, save: async () => {}, skillsRegistry: oldRegistry,
    now: () => new Date('2026-11-05T10:00:00Z'), runTask: async () => assert.fail('Original paused job must not run') });
  const old = await original.create({ title: 'Gemt historisk job', prompt: 'Syntetisk læsning', activation: 'paused',
    skillId: 'daily-briefing', skillVersion: '1.0.0' });
  const restored = new TaskEngine({ state, save: async () => {}, skillsRegistry: registry,
    now: () => new Date('2026-11-05T10:00:00Z'), runTask: async task => { executions.push(task.execution); return 'Syntetisk resultat'; } });
  const fresh = await restored.create({ title: 'Ny version', prompt: 'Kun syntetisk læsning', activation: 'paused',
    skillId: 'personal-follow-up', skillVersion: '1.1.0' });
  assert.deepEqual(fresh.budget, { maxRunsPerDay: 1, maxOutputTokens: 2500 });
  assert.deepEqual(state.tasks.find(task => task.id === old.id).budget, { maxRunsPerDay: 10, maxOutputTokens: 3500 });
  await restored.action(old.id, 'resume', { expectedRevision: old.revision }); await restored.tick();
  assert.equal(executions.length, 1); assert.equal(executions[0].skillVersion, '1.0.0');
  assert.equal(executions[0].skillContentHash, historical['daily-briefing'].body);
  assert.equal(executions[0].skill.body, registry.detail('daily-briefing', '1.0.0').body);
  assert.equal(state.tasks.find(task => task.id === fresh.id).status, 'paused');
  assert.deepEqual(executions[0].permissions, ['web.search']);
  await assert.rejects(restored.create({ title: 'Ingen eskalering', prompt: 'Kun test', activation: 'paused',
    skillId: 'meal-planning', skillVersion: '1.1.0', permissions: ['basket.write'] }), /tilladelser/);
});

test('H1 new explicit budgets override recommendations without mutating an existing policy or granting extra tools', async () => {
  const registry = await loadBundledSkills(root);
  const engine = new TaskEngine({ state: {}, save: async () => {}, skillsRegistry: registry, runTask: async () => assert.fail('No activation') });
  const task = await engine.create({ title: 'Valgt budget', prompt: 'Syntetisk', activation: 'paused',
    skillId: 'daily-briefing', skillVersion: '1.1.0', budget: { maxRunsPerDay: 2, maxOutputTokens: 1000 } });
  assert.deepEqual(task.budget, { maxRunsPerDay: 2, maxOutputTokens: 1000 });
  assert.deepEqual(task.permissions, ['web.search']); await engine.tick(); assert.equal(task.status, 'paused');
  await assert.rejects(engine.create({ title: 'Ugyldigt budget', prompt: 'Syntetisk', activation: 'paused',
    skillId: 'daily-briefing', skillVersion: '1.1.0', budget: null }), /budget/);
});

test('H1 current context selects only one version per procedure and never truncates a selected body', async () => {
  const registry = await loadBundledSkills(root), query = 'madplan gave fødselsdag jul denne uge';
  const relevant = registry.relevant(query, 3);
  assert.ok(relevant.every(skill => skill.version === '1.1.0'));
  assert.equal(new Set(relevant.map(skill => skill.name)).size, relevant.length);
  const context = registry.context(query); assert.ok(context.length <= 12000);
  for (const skill of relevant) if (context.includes(`## Procedure: ${skill.name} · version ${skill.version}`)) assert.ok(context.includes(skill.body));
  assert.equal(context.includes('## Procedure: daily-briefing\n'), false);
});

test('H1 malformed or path-mismatched current contracts fail closed rather than weakening a procedure definition', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'jarvis-v5-contract-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await cp(join(root, 'skills'), join(folder, 'skills'), { recursive: true });
  const file = join(folder, 'skills', 'daily-briefing', 'versions', '1.1.0', 'SKILL.md');
  const original = await readFile(file, 'utf8');
  for (const changed of [original.replace('"schemaVersion": 1', '"schemaVersion": 2'),
    original.replace('"maxRunsPerDay":1', '"maxRunsPerDay":0'), original.replace('"purpose":', '"unknownPermission":'),
    original.replace('version: 1.1.0', 'version: 1.0.0'), original.replace('contract: 1', 'contract: 99')]) {
    await writeFile(file, changed);
    await assert.rejects(loadBundledSkills(folder), /kontrakt|manifest/);
  }
});

test('H1 release-pinned UI template fallback matches the current bundled version without replacing legacy choices', async () => {
  const source = await readFile(join(root, 'public', 'job-policy.js'), 'utf8');
  const jobs = vm.runInNewContext(source + '\nJarvisJobs;', { Intl, Date });
  const registry = await loadBundledSkills(root);
  for (const name of Object.keys(historical)) assert.equal(jobs.currentSkillVersion, registry.current(name).version);
  const values = jobs.valuesFromTask({ title: 'Historisk', prompt: 'Kun test', skillId: 'daily-briefing', skillVersion: '1.0.0',
    budget: { maxRunsPerDay: 8, maxOutputTokens: 2000 } });
  assert.equal(values['task-skill'], 'daily-briefing@1.0.0'); assert.equal(values['task-budget-runs'], '8');
});
