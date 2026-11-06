import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeProvider } from '../scripts/provider-contract-probe.mjs';
import { verifyRestoredData } from '../scripts/verify-restored-data.mjs';
test('offline contract probe never uses API or pretends verification', async () => {
  const report = await probeProvider({ model: 'synthetic', request: () => assert.fail('no network') });
  assert.equal(report.status, 'not_run'); assert.ok(report.toolCount > 40); assert.equal(report.catalogHash.length, 64);
});
test('live probe uses synthetic input, closed execution and the full exported catalogue', async () => {
  const report = await probeProvider({ model: 'synthetic', apiKey: 'sk-synthetic-probe', live: true, request: async (url, opts) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(opts.body); assert.equal(body.tool_choice, 'none'); assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 128); assert.ok(body.tools.some(t => t.name === 'get_recipe'));
    return { ok: true, status: 200, json: async () => ({ id: 'resp_synthetic', output: [] }) };
  } });
  assert.equal(report.status, 'accepted'); assert.doesNotMatch(JSON.stringify(report), /sk-synthetic/);
});
test('provider schema rejection exposes no raw error or secret', async () => {
  const report = await probeProvider({ model: 'synthetic', apiKey: 'sk-synthetic-probe', live: true, request: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'SECRET_SENTINEL' } }) }) });
  assert.equal(report.status, 'rejected'); assert.doesNotMatch(JSON.stringify(report), /SECRET_SENTINEL/);
});
test('unexpected function call is not accepted or dispatched', async () => {
  const report = await probeProvider({ model: 'synthetic', apiKey: 'sk-synthetic-probe', live: true, request: async () => ({ ok: true, status: 200, json: async () => ({ id: 'resp_synthetic', output: [{ type: 'function_call', name: 'create_personal_task' }] }) }) });
  assert.equal(report.status, 'rejected');
});
async function data(t) {
  const root = await mkdtemp(join(tmpdir(), 'v51-restore-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'backup'), restored = join(root, 'restored'); await mkdir(source);
  await writeFile(join(source, 'state.json'), '{"synthetic":true}', { mode: 0o600 });
  await writeFile(join(source, 'private-settings.json'), '{"synthetic":"PRIVATE_TEST_SENTINEL"}', { mode: 0o600 });
  await mkdir(join(source, 'media')); await writeFile(join(source, 'media', 'example.bin'), new Uint8Array([1, 2, 3]));
  await cp(source, restored, { recursive: true }); return { source, restored };
}
test('restore verification covers media and private settings without printing contents', async t => {
  const { source, restored } = await data(t); const report = await verifyRestoredData(source, restored);
  assert.equal(report.ok, true); assert.equal(report.files, 3); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TEST_SENTINEL/);
});
test('restore rejects omissions, corruption and widened private permissions', async t => {
  const { source, restored } = await data(t);
  await writeFile(join(restored, 'media', 'example.bin'), 'corrupt'); await chmod(join(restored, 'private-settings.json'), 0o644);
  const report = await verifyRestoredData(source, restored); assert.equal(report.ok, false);
  assert.ok(report.problems.some(e => e.reason === 'private-settings-permissions'));
  await rm(join(restored, 'private-settings.json'));
  assert.ok((await verifyRestoredData(source, restored)).problems.some(e => e.reason === 'required-file-missing'));
});
test('restore refuses self-comparison and symlinks', async t => {
  const { source, restored } = await data(t); await assert.rejects(verifyRestoredData(source, source));
  await symlink(join(source, 'state.json'), join(restored, 'linked')); await assert.rejects(verifyRestoredData(source, restored), /Symlinks/);
});
