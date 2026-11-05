import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dockerProcessEnvironment, localDockerEndpoint, runBoundedProcess } from './subprocess-safety.mjs';

// No host shell, no mounted secrets, no network, no write access to project sources.
const nodeScript = String.raw`
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
let files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p);
  }
}
walk('/workspace');
let failed = false;
for (const p of files.filter(x => /\.(?:js|mjs)$/.test(x))) {
  const r = cp.spawnSync(process.execPath, ['--check', p], { encoding: 'utf8', timeout: 6000 });
  if (r.status !== 0) { console.error('SYNTAKS:', path.relative('/workspace', p), r.stderr); failed = true; }
}
for (const p of files.filter(x => x.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error('JSON:', p, e.message); failed = true; }
}
const tests = files.filter(p => /(?:^|\/)(?:test|tests)\/.*\.test\.[cm]?js$|\.test\.[cm]?js$/.test(p));
if (tests.length) {
  const r = cp.spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', timeout: 22000, maxBuffer: 1024*1024 });
  process.stdout.write((r.stdout || '').slice(-6000));
  process.stderr.write((r.stderr || '').slice(-2000));
  if (r.status !== 0) failed = true;
} else console.log('Ingen JavaScript-unit-tests fundet; syntaks og JSON kontrolleret.');
process.exit(failed ? 1 : 0);
`;

function checkedSnapshot(files) {
  if (!Array.isArray(files) || files.length > 300) throw new Error('Testsnapshot er for stort eller ugyldigt.');
  const names = new Set(); let total = 0;
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || file.path.length > 140 || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(file.path) ||
        file.path.split('/').some(segment => !segment || segment.startsWith('.') || segment === 'node_modules') ||
        names.has(file.path.toLowerCase()) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 2 * 1024 * 1024)
      throw new Error('Testsnapshot har en usikker, gentaget eller for stor fil. Ingen kode blev kørt.');
    names.add(file.path.toLowerCase()); total += Buffer.byteLength(file.content);
    if (total > 8 * 1024 * 1024) throw new Error('Testsnapshot overstiger 8 MiB. Ingen kode blev kørt.');
  }
  return files;
}

export async function dockerTest(files, { runner, environment = process.env } = {}) {
  const childEnvironment = dockerProcessEnvironment(environment);
  runner ||= (binary, args, timeoutMs) => runBoundedProcess(binary, args, { environment: childEnvironment, timeoutMs });
  const supported = checkedSnapshot(files).filter(file => /\.(?:html|css|js|mjs|json|py|md|svg|txt)$/.test(file.path));
  if (!supported.length) return { status: 'skipped', summary: 'Ingen understøttede tekstfiler at teste.' };
  const hasNode = supported.some(file => /\.(?:js|mjs|json)$/.test(file.path));
  const hasPython = supported.some(file => file.path.endsWith('.py'));
  const scripts = [];
  if (hasNode) scripts.push({ image: 'node:22-alpine', args: ['node', '-e', nodeScript] });
  if (hasPython) scripts.push({ image: 'python:3.12-alpine', args: ['sh', '-c', 'python -B -c "import ast,pathlib; [ast.parse(p.read_text(),filename=str(p)) for p in pathlib.Path(\"/workspace\").rglob(\"*.py\")]" && if find /workspace -name "test_*.py" | grep -q .; then cd /workspace && python -B -m unittest discover -v; fi'] });
  if (!scripts.length) return { status: 'skipped', summary: 'Kun HTML/CSS – ingen eksekverbare tests. Gennemgå projektet i browseren.' };
  const endpoint = await localDockerEndpoint(runner, { environment });
  if (!endpoint.ok) return { status: 'unavailable', summary: endpoint.reason };
  const local = (args, timeoutMs) => runner('docker', ['--host', endpoint.host, ...args], timeoutMs);
  for (const { image } of scripts) {
    const check = await local(['image', 'inspect', image], 12_000);
    if (!check.ok) return { status: 'unavailable', summary: `Docker eller image ${image} mangler. Installér Docker Desktop og hent image manuelt med docker pull ${image}. Ingen kode blev kørt på Windows.` };
  }
  const temporary = await mkdtemp(join(tmpdir(), 'jarvis-test-'));
  await chmod(temporary, 0o755);
  const reports = [];
  try {
    for (const file of supported) {
      const destination = join(temporary, ...file.path.split('/'));
      await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
      await writeFile(destination, file.content, { mode: 0o644 });
    }
    for (const { image, args } of scripts) {
      const containerName = `jarvis-test-${randomUUID()}`;
      const result = await local([
        'run', '--rm', '--pull', 'never', '--name', containerName, '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64',
        '--memory', '256m', '--cpus', '1', '--user', '65534:65534',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
        '--mount', `type=bind,source=${temporary},target=/workspace,readonly`,
        '--workdir', '/workspace', image, ...args,
      ], 40_000);
      let cleanup;
      if (!result.ok) {
        try { cleanup = await local(['rm', '-f', containerName], 8_000); }
        catch { cleanup = { ok: false }; }
      }
      reports.push({ image, ok: result.ok, output: result.output.slice(-7000),
        ...(cleanup ? { containerName, cleanupVerified: cleanup.ok === true } : {}) });
      if (!result.ok) break;
    }
    const passed = reports.every(x => x.ok);
    const cleanupUnknown = reports.some(report => report.cleanupVerified === false);
    return { status: passed ? 'passed' : 'failed', summary: passed ? 'Alle tilgængelige isolerede tests bestod.'
      : cleanupUnknown ? 'Test fejlede, og oprydning af testcontaineren kunne ikke verificeres. Kontrollér det viste containernavn manuelt.'
        : 'Mindst én isoleret test fejlede.', reports };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
