import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeAgent } from '../code-agent.mjs';

test('proposes, approves and rolls back a user-reviewed change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-code-'));
  await mkdir(join(root, 'public'));
  const target = join(root, 'public/styles.css');
  await writeFile(target, 'body { color: white; }');
  const state = { codeProposals: [] };
  const code = new CodeAgent({
    root, backupRoot: join(root, 'backups'), state, save: async () => {},
    propose: async () => ({ summary: 'Skift tekstfarve', content: 'body { color: blue; }' }),
  });
  const p = await code.create({ file: 'public/styles.css', request: 'Skift farve' });
  assert.equal(p.status, 'pending');
  assert.equal(await readFile(target, 'utf8'), 'body { color: white; }', 'proposal does not install itself');
  await code.action(p.id, 'apply');
  assert.equal(await readFile(target, 'utf8'), 'body { color: blue; }');
  await code.action(p.id, 'rollback');
  assert.equal(await readFile(target, 'utf8'), 'body { color: white; }');
});

test('rejects sensitive file paths and stale proposals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-code-'));
  await mkdir(join(root, 'public'));
  const target = join(root, 'persona.md');
  await writeFile(target, 'Original');
  const code = new CodeAgent({
    root, backupRoot: join(root, 'backups'), state: { codeProposals: [] }, save: async () => {},
    propose: async () => ({ summary: 'Beskrivelse', content: 'Ny tekst' }),
  });
  await assert.rejects(code.create({ file: '.env', request: 'Skriv nøgle' }), /kan ikke redigeres/);
  await assert.rejects(code.create({ file: '../server.mjs', request: 'ændr' }), /kan ikke redigeres/);
  const p = await code.create({ file: 'persona.md', request: 'ændr tone' });
  await writeFile(target, 'Ændret udenfor agenten');
  await assert.rejects(code.action(p.id, 'apply'), /ændret siden forslaget/);
});

test('rejects syntax-invalid JavaScript proposals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-code-'));
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'public/app.js'), 'const x = 1;');
  const code = new CodeAgent({
    root, backupRoot: join(root, 'backups'), state: { codeProposals: [] }, save: async () => {},
    propose: async () => ({ summary: 'Forkert kode', content: 'const = broken;' }),
  });
  await assert.rejects(code.create({ file: 'public/app.js', request: 'ændr' }), /syntaksfejl/);
});
