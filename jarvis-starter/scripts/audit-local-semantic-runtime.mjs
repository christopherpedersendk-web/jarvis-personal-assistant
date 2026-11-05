// Run in isolated CI or an explicitly prepared development runtime, never on
// application startup. npm audit sends public package metadata, not user data.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(app, 'local-semantic-runtime');
const outputIndex = process.argv.indexOf('--output');
const output = resolve(app, outputIndex >= 0 ? process.argv[outputIndex + 1] : 'artifacts/v5-dependency-audit.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = args => {
  const result = spawnSync(npm, args, { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 12 * 1024 * 1024 });
  let json;
  try { json = JSON.parse(result.stdout || '{}'); } catch { json = { error: 'npm returned non-JSON output' }; }
  return { exitCode: result.status, errorCode: result.error?.code || null, data: json };
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = run(['ls', '--all', '--json']);
const audit = run(['audit', '--json', '--omit=dev']);
const lock = await readFile(resolve(directory, 'package-lock.json')).catch(() => null);
const vulnerabilities = audit.data.metadata?.vulnerabilities;
const high = vulnerabilities?.high, critical = vulnerabilities?.critical;
const complete = Boolean(lock && vulnerabilities && Number.isInteger(high) && Number.isInteger(critical)
  && inventory.exitCode === 0 && [0, 1].includes(audit.exitCode) && !audit.data.error && !audit.errorCode);
const report = {
  status: !complete ? 'unavailable' : high + critical > 0 ? 'blocked' : 'passed-high-critical-gate',
  candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim(),
  applicationTree: execFileSync('git', ['rev-parse', 'HEAD:jarvis-starter'], { cwd: app, encoding: 'utf8' }).trim(),
  node: process.version, npm: execFileSync(npm, ['--version'], { cwd: directory, encoding: 'utf8' }).trim(),
  runtimeManifestSha256: hash(await readFile(resolve(directory, 'package.json'))), lockSha256: lock ? hash(lock) : null,
  policy: 'No unreviewed high or critical dependency finding may pass the release gate. Audit success is not proof of absence of every vulnerability.',
  exactInstalledInventory: inventory, audit,
  personalDataSent: false, productionRuntimeModified: false,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ...report, exactInstalledInventory: { exitCode: inventory.exitCode }, audit: {
  exitCode: audit.exitCode, vulnerabilities, findings: Object.keys(audit.data.vulnerabilities || {}), error: audit.data.error || audit.errorCode } }, null, 2));
if (report.status !== 'passed-high-critical-gate') process.exitCode = 1;
