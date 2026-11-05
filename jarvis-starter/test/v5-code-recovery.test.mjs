import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodeAgent } from '../code-agent.mjs';
import { atomicStateWrite, durableExclusiveBackup } from '../state-schema.mjs';

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-code-recovery-'));
  const target = join(root, 'persona.md');
  await writeFile(target, 'Oprindelig syntetisk tekst');
  const state = { codeProposals: [] };
  const code = new CodeAgent({ root, backupRoot: join(root, 'backups'), state, save: async () => {},
    propose: async () => ({ summary: 'Syntetisk ændring', content: 'Gennemgået syntetisk ændring' }), ...options });
  return { root, target, state, code, create: () => code.create({ file: 'persona.md', request: 'Gennemgå syntetisk ændring' }) };
}

test('A1/J6 code backup must finish durable publication before writing active code', async () => {
  const operations = [];
  const f = await fixture({ backupWriter: async (...args) => { operations.push('backup'); await durableExclusiveBackup(...args); operations.push('backup-durable'); },
    publish: async (...args) => { operations.push('publish'); return atomicStateWrite(...args); } });
  const proposal = await f.create(); await f.code.action(proposal.id, 'apply');
  assert.deepEqual(operations, ['backup', 'backup-durable', 'publish']);
  assert.equal(f.code.inspect(proposal.id).status, 'applied');
  assert.equal(await readFile(join(f.root, 'backups', proposal.id, 'persona.md'), 'utf8'), 'Oprindelig syntetisk tekst');
});

test('A1/J6 backup durability failure reports failure and never writes active code', async () => {
  let writes = 0;
  const failure = new Error('Syntetisk backup fsync-fejl');
  const f = await fixture({ backupWriter: async (...args) => {
    await durableExclusiveBackup(...args, { syncDirectory: async () => { throw failure; } });
  }, publish: async () => { writes++; } });
  const proposal = await f.create();
  await assert.rejects(f.code.action(proposal.id, 'apply'), error => error === failure);
  assert.equal(writes, 0); assert.equal(f.code.inspect(proposal.id).status, 'pending');
  assert.equal(await readFile(f.target, 'utf8'), 'Oprindelig syntetisk tekst');
  f.code.backupWriter = durableExclusiveBackup;
  f.code.publish = atomicStateWrite;
  await f.code.action(proposal.id, 'apply');
  assert.equal(f.code.inspect(proposal.id).status, 'applied');
});

test('L3 code rollback rejects manual changes made while checkpointing its intent', async () => {
  const f = await fixture(); const proposal = await f.create(); await f.code.action(proposal.id, 'apply');
  f.code.save = async () => { if (f.code.inspect(proposal.id).status === 'rollingback') await writeFile(f.target, 'Nyere manuel rettelse'); };
  await assert.rejects(f.code.action(proposal.id, 'rollback'), /ændret inden tilbagerulning/);
  assert.equal(await readFile(f.target, 'utf8'), 'Nyere manuel rettelse');
  assert.equal(f.code.inspect(proposal.id).status, 'unknown');
  await assert.rejects(f.code.action(proposal.id, 'rollback'), /Kun installerede/);
});

test('A2/J6 code publication with failed outcome persistence is not replayed on restart', async () => {
  let writes = 0;
  const f = await fixture({ publish: async (...args) => { writes++; return atomicStateWrite(...args); } });
  const proposal = await f.create();
  f.code.save = async () => { if (f.code.inspect(proposal.id).status === 'applied') throw new Error('Syntetisk slut-checkpoint fejlede'); };
  await assert.rejects(f.code.action(proposal.id, 'apply'), /slut-checkpoint/);
  assert.equal(await readFile(f.target, 'utf8'), 'Gennemgået syntetisk ændring');
  assert.equal(f.code.inspect(proposal.id).status, 'applying');
  const restarted = new CodeAgent({ root: f.root, backupRoot: join(f.root, 'backups'), state: f.state, save: async () => {},
    publish: async () => { writes++; }, propose: f.code.propose });
  assert.equal(restarted.inspect(proposal.id).status, 'unknown');
  await assert.rejects(restarted.action(proposal.id, 'apply'), /ikke længere/);
  assert.equal(writes, 1);
});

test('J6/L3 a symlink or changed backup cannot supply rollback content', async () => {
  const f = await fixture(); const proposal = await f.create();
  const backup = join(f.root, 'backups', proposal.id, 'persona.md');
  await mkdir(join(f.root, 'backups', proposal.id), { recursive: true });
  await symlink(f.target, backup);
  await assert.rejects(f.code.action(proposal.id, 'apply'), /link/);
  assert.equal(await readFile(f.target, 'utf8'), 'Oprindelig syntetisk tekst');
  assert.equal(f.code.inspect(proposal.id).status, 'pending');
});

test('A2 code history retention never drops an older unknown outcome', async () => {
  const f = await fixture();
  f.state.codeProposals.push({ id: 'unresolved-old', status: 'unknown', summary: 'Bevar til manuel gennemgang' });
  for (let i = 0; i < 25; i++) {
    const proposal = await f.create(); await f.code.action(proposal.id, 'reject');
  }
  assert.equal(f.code.inspect('unresolved-old').status, 'unknown');
  assert.ok(f.state.codeProposals.filter(item => item.status === 'rejected').length <= 21);
});

test('A3 code unresolved cap rejects new work before invoking a model', async () => {
  let modelCalls = 0;
  const f = await fixture({ propose: async () => { modelCalls++; throw new Error('Må ikke kaldes'); } });
  f.state.codeProposals = Array.from({ length: 20 }, (_, i) => ({ id: String(i), status: 'unknown' }));
  await assert.rejects(f.create(), /uafklarede kodehandlinger/);
  assert.equal(modelCalls, 0);
});
