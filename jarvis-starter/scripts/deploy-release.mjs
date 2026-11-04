#!/usr/bin/env node
// Install this script into a ROOT-OWNED directory. Never run it from the writable application checkout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename, symlink, lstat, realpath, cp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const VERSION = /^v\d+\.\d+\.\d+$/;
const SHA = /^[a-f0-9]{40}$/;

export async function atomicLink(target, path, fs = { symlink, rename }) {
  const temporary = `${path}.new-${process.pid}`;
  await fs.symlink(target, temporary);
  await fs.rename(temporary, path);
}

export function validatedApproval(state) {
  const candidate = state?.approved;
  if (!candidate || !VERSION.test(candidate.version || '') || !SHA.test(candidate.sha || '') ||
      candidate.version !== state.staged?.version || candidate.sha !== state.staged?.sha ||
      !candidate.testedAt || !candidate.approvedAt) return null;
  return { version: candidate.version, sha: candidate.sha };
}

async function healthCheck(url, { fetcher = fetch, attempts = 12, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch { /* Wait until server is ready. */ }
    if (i + 1 < attempts) await delay(intervalMs);
  }
  return false;
}

export async function deployRelease(config, dependencies = {}) {
  const run = dependencies.run || exec;
  const fetcher = dependencies.fetcher || fetch;
  const fs = dependencies.fs || { readFile, writeFile, mkdir, rename, symlink, lstat, realpath, cp };
  const root = resolve(config.root);
  const data = resolve(config.data);
  const staging = resolve(config.staging);
  const releases = resolve(config.releases);
  const current = resolve(config.current);
  const audit = resolve(config.audit);
  if (!root.startsWith('/home/') || !data.startsWith('/home/') || !staging.startsWith(root + '/') ||
      !releases.startsWith(root + '/') || current !== join(root, 'current') || !audit.startsWith('/var/lib/jarvis-deployer/'))
    throw new Error('Deployment-stier er ikke godkendt.');

  const state = JSON.parse(await fs.readFile(join(data, 'update-state.json'), 'utf8'));
  const approval = validatedApproval(state);
  if (!approval) return { status: 'no-approval' };
  let prior = {};
  try { prior = JSON.parse(await fs.readFile(audit, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior.sha === approval.sha && prior.version === approval.version) return { status: 'already-applied' };

  const source = join(staging, approval.version);
  const destination = join(releases, approval.version);
  const sourceReal = await fs.realpath(source);
  if (sourceReal !== source || (await fs.lstat(source)).isSymbolicLink()) throw new Error('Usikker staging-mappe.');
  // Git reads repository-controlled configuration. Run it unprivileged even though the deployer is root.
  const git = async args => run('/usr/sbin/runuser', ['-u', 'administrator', '--', '/usr/bin/git',
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: source, timeout: 8000 });
  const { stdout } = await git(['rev-parse', 'HEAD']);
  if (stdout.trim() !== approval.sha) throw new Error('Commit-SHA er ændret siden godkendelsen.');
  const clean = await git(['status', '--porcelain', '--untracked-files=all']);
  if (clean.stdout.trim()) throw new Error('Staging er ændret efter test og godkendelse.');
  if ((await fs.lstat(join(source, 'jarvis-starter'))).isSymbolicLink()) throw new Error('Kode-mappen må ikke være et link.');

  // Back up BEFORE touching the live symlink. The backup unit is root-owned.
  await run('/usr/bin/systemctl', ['start', 'jarvis-backup.service'], { timeout: 180000 });
  await fs.mkdir(releases, { recursive: true, mode: 0o755 });
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true,
    filter: path => !path.split('/').includes('.git') });
  // Root's systemd UMask=0077 must not make the code unreadable to the unprivileged JARVIS service.
  await run('/usr/bin/chmod', ['-R', 'a+rX', destination], { timeout: 15000 });
  const app = join(destination, 'jarvis-starter');
  await fs.symlink(join(root, 'shared', '.env'), join(app, '.env'));
  await fs.symlink(join(root, 'shared', 'data'), join(app, 'data'));

  const oldTarget = await fs.realpath(current);
  if (!oldTarget.startsWith(releases + '/')) throw new Error('Aktiv release er ikke under den godkendte releases-mappe.');
  let switched = false;
  try {
    await atomicLink(destination, current, fs);
    switched = true;
    await run('/usr/bin/systemctl', ['restart', 'jarvis.service'], { timeout: 30000 });
    if (!await healthCheck('http://127.0.0.1:8787/health', { fetcher, intervalMs: 2000 }))
      throw new Error('Ny release bestod ikke healthcheck.');
    await fs.mkdir(dirname(audit), { recursive: true, mode: 0o700 });
    await fs.writeFile(audit, JSON.stringify({ ...approval, status: 'installed', at: new Date().toISOString() }), { mode: 0o600 });
    await writeResult(fs, data, { version: approval.version, status: 'installed', at: new Date().toISOString() });
    return { status: 'installed', version: approval.version };
  } catch (error) {
    if (switched) {
      await atomicLink(oldTarget, current, fs);
      await run('/usr/bin/systemctl', ['restart', 'jarvis.service'], { timeout: 30000 });
      if (!await healthCheck('http://127.0.0.1:8787/health', { fetcher, intervalMs: 2000 }))
        throw new Error(`Rollback udført, men gammel release svarer ikke: ${error.message}`);
    }
    const result = { ...approval, status: 'rolled-back', at: new Date().toISOString(), reason: String(error.message).slice(0, 180) };
    await fs.mkdir(dirname(audit), { recursive: true, mode: 0o700 });
    await fs.writeFile(audit, JSON.stringify(result), { mode: 0o600 });
    await writeResult(fs, data, result);
    return { status: 'rolled-back', version: approval.version };
  }
}

async function writeResult(fs, data, result) {
  const directory = await fs.lstat(data);
  const file = join(data, 'deployment-result.json');
  await fs.writeFile(file, JSON.stringify(result), { mode: 0o600 });
  if (fs.chown) await fs.chown(file, directory.uid, directory.gid);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const configuration = {
    root: '/home/administrator/jarvis',
    data: '/home/administrator/jarvis/shared/data',
    staging: '/home/administrator/jarvis/update-staging',
    releases: '/home/administrator/jarvis/releases',
    current: '/home/administrator/jarvis/current',
    audit: '/var/lib/jarvis-deployer/last-result.json',
  };
  deployRelease(configuration).then(result => console.log(`JARVIS deployment: ${JSON.stringify(result)}`))
    .catch(error => { console.error(`JARVIS deployment-fejl: ${error.message}`); process.exitCode = 1; });
}
