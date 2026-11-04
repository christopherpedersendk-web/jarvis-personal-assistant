import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const REPO = /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;

export function compareVersions(a, b) {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) throw new Error('Ugyldigt versionsnummer.');
  for (let i = 1; i < 4; i++) {
    const difference = Number(x[i]) - Number(y[i]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export class UpdateManager {
  constructor({ dataDirectory, stagingDirectory, repository, currentVersion = 'v4.6.0', command = exec }) {
    this.stateFile = join(dataDirectory, 'update-state.json');
    this.stagingDirectory = resolve(stagingDirectory);
    this.repository = repository;
    this.currentVersion = currentVersion;
    this.command = command;
    this.state = { available: null, staged: null, approved: null, lastCheck: null, error: '' };
  }

  async load() {
    try { this.state = { ...this.state, ...JSON.parse(await readFile(this.stateFile, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }

  snapshot() {
    return { configured: REPO.test(this.repository || ''), currentVersion: this.currentVersion, ...this.state };
  }

  async persist() {
    await mkdir(resolve(this.stateFile, '..'), { recursive: true, mode: 0o700 });
    const temporary = this.stateFile + '.tmp';
    await writeFile(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await rename(temporary, this.stateFile);
  }

  async check() {
    if (!REPO.test(this.repository || '')) throw new Error('Privat GitHub-kilde er ikke konfigureret.');
    try {
      const { stdout } = await this.command('git', ['ls-remote', '--tags', '--refs', this.repository], { timeout: 25_000 });
      const candidates = stdout.split('\n').map(line => {
        const match = /^([0-9a-f]{40})\s+refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line);
        return match ? { sha: match[1], version: match[2] } : null;
      }).filter(Boolean).sort((a, b) => compareVersions(b.version, a.version));
      const latest = candidates.find(entry => compareVersions(entry.version, this.currentVersion) > 0) || null;
      this.state.available = latest;
      this.state.lastCheck = new Date().toISOString();
      this.state.error = '';
      await this.persist();
      return this.snapshot();
    } catch (error) {
      this.state.error = 'Kunne ikke kontrollere GitHub. Kontrollér den skrivebeskyttede deploy key.';
      await this.persist();
      throw new Error(this.state.error, { cause: error });
    }
  }

  async stage() {
    const release = this.state.available;
    if (!release || !VERSION.test(release.version) || !/^[0-9a-f]{40}$/.test(release.sha)) throw new Error('Ingen verificeret opdatering tilgængelig.');
    const folder = join(this.stagingDirectory, release.version);
    await mkdir(this.stagingDirectory, { recursive: true, mode: 0o700 });
    try {
      await this.command('git', ['clone', '--depth', '1', '--branch', release.version, '--single-branch', this.repository, folder], { timeout: 90_000 });
      const { stdout } = await this.command('git', ['rev-parse', 'HEAD'], { cwd: folder, timeout: 5000 });
      if (stdout.trim() !== release.sha) throw new Error('Tag og forventet commit matcher ikke.');
      // Untrusted release tests must never run directly as the JARVIS host user.
      await this.command('docker', ['image', 'inspect', 'node:22-alpine'], { timeout: 10_000 });
      await this.command('docker', [
        'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '384m', '--cpus', '1',
        '--user', '65534:65534', '--tmpfs', '/tmp:rw,nosuid,size=32m',
        '--mount', `type=bind,source=${join(folder, 'jarvis-starter')},target=/workspace,readonly`,
        '--workdir', '/workspace', 'node:22-alpine', 'node', '--test',
      ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
      this.state.staged = { ...release, testedAt: new Date().toISOString() };
      this.state.approved = null;
      this.state.error = '';
      await this.persist();
      return this.snapshot();
    } catch (error) {
      this.state.error = `Staging fejlede: ${String(error.message).slice(0, 160)}`;
      await this.persist();
      throw new Error(this.state.error);
    }
  }

  async approve(version) {
    if (!this.state.staged || this.state.staged.version !== version) throw new Error('Kun en testet version kan godkendes.');
    this.state.approved = { ...this.state.staged, approvedAt: new Date().toISOString() };
    await this.persist();
    return this.snapshot();
  }
}
