import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storageReadiness } from '../system-health.mjs';

test('readiness is distinct from process liveness and an unusable path is not reported as healthy', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-ready-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await storageReadiness(dir)).ready, true);
  assert.ok(!(await readdir(dir)).some(name => name.startsWith('.jarvis-ready-')));
  const file = join(dir, 'not-a-directory');
  await writeFile(file, 'preserved');
  const result = await storageReadiness(file);
  assert.equal(result.ready, false);
  assert.match(result.reason, /Lager kan ikke/);
});
