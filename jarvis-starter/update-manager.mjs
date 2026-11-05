import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { schemaVersion, atomicStateWrite, readPrivateStateText } from './state-schema.mjs';
import { DurableState } from './durable-state.mjs';
import { dockerProcessEnvironment, localDockerEndpoint } from './subprocess-safety.mjs';
import { checkedReleaseCheckout, prepareReleaseStaging, readReleasePackage } from './release-checkout.mjs';

const exec = promisify(execFile);
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const REPO = /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const SHA = /^[0-9a-f]{40}$/;
const initialState = () => ({ updateStateSchemaVersion: 1, available: null, staged: null, approved: null,
  lastCheck: null, error: '', checkOperation: null, stageOperation: null });
const conflict = message => Object.assign(new Error(message), { code: 'UPDATE_REVIEW_CONFLICT' });

export function compareVersions(a, b) {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) throw new Error('Ugyldigt versionsnummer.');
  for (let i = 1; i < 4; i++) {
    const difference = Number(x[i]) - Number(y[i]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function validateReleasePackage(content, expectedVersion) {
  if (!VERSION.test(expectedVersion)) throw new Error('Ugyldigt release-tag.');
  let metadata;
  try { metadata = JSON.parse(content); }
  catch { throw new Error('Releasens package.json er ugyldig.'); }
  const requiredVersion = expectedVersion.slice(1);
  if (!metadata || metadata.version !== requiredVersion)
    throw new Error(`Releasens package.json matcher ikke ${expectedVersion}.`);
  if (Number(VERSION.exec(expectedVersion)[1]) >= 5 &&
      (!Number.isInteger(metadata.jarvisSchemaVersion) || metadata.jarvisSchemaVersion < 1 ||
        !Number.isInteger(metadata.jarvisReadableSchemaFrom) || metadata.jarvisReadableSchemaFrom < 0 ||
        metadata.jarvisReadableSchemaFrom > metadata.jarvisSchemaVersion))
    throw new Error('Releasens version 5+ mangler kompatibel erklæring om dataskema.');
  return requiredVersion;
}

export class UpdateManager {
  constructor({ dataDirectory, stagingDirectory, repository, currentVersion = 'v4.6.0', command = exec,
    readPackage = readReleasePackage, environment = process.env, writeState = atomicStateWrite,
    readState = readPrivateStateText }) {
    this.stateFile = join(dataDirectory, 'update-state.json');
    this.stagingDirectory = resolve(stagingDirectory);
    this.repository = repository;
    this.currentVersion = currentVersion;
    this.command = command;
    this.readPackage = readPackage;
    this.environment = environment;
    this.writeState = writeState;
    this.readState = readState;
    this.loaded = false;
    this.loadAttempted = false;
    this.checkPromise = null;
    this.stagePromise = null;
    this.setStore(initialState());
  }

  setStore(initial) {
    this.store = new DurableState({ initial, write: contents => this.writeState(this.stateFile, contents) });
    this.state = this.store.state;
  }

  async load() {
    if (this.loadAttempted) throw new Error('Updateren er allerede indlæst eller afbrudt. Genstart og kontrollér lageret.');
    this.loadAttempted = true;
    let stored = {};
    try { stored = JSON.parse(await this.readState(this.stateFile)); }
    catch (error) { if (error.code !== 'ENOENT') { this.startupError = error; throw error; } }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) ||
        !Number.isInteger(stored.updateStateSchemaVersion ?? 0) || (stored.updateStateSchemaVersion ?? 0) < 0 ||
        (stored.updateStateSchemaVersion ?? 0) > 1 ||
        !Number.isSafeInteger(stored.stateRevision ?? 0) || (stored.stateRevision ?? 0) < 0)
      throw new Error('Updaterens tilstandsfil har ugyldigt eller nyere skema; filen er ikke omskrevet.');
    const initial = { ...initialState(), ...stored, updateStateSchemaVersion: 1 };
    if (initial.checkOperation?.status === 'running') initial.checkOperation = { ...initial.checkOperation,
      status: 'failed', finishedAt: new Date().toISOString(), error: 'Versionskontrollen blev afbrudt. En ny læsekontrol kan vælges.' };
    if (initial.stageOperation?.status === 'running') {
      initial.stageOperation = { ...initial.stageOperation, status: 'unknown', finishedAt: new Date().toISOString(),
        error: 'Staging blev afbrudt. Kontrollér checkout og eventuel testcontainer før et nyt, særskilt forsøg.' };
      initial.staged = null;
      initial.approved = null;
      initial.error = initial.stageOperation.error;
    }
    this.setStore(initial);
    try { await this.store.initialize(); }
    catch (error) { this.startupError = error; throw error; }
    this.loaded = true;
    return this;
  }

  snapshot() {
    return { ...structuredClone({ ...this.state }), configured: REPO.test(this.repository || ''), currentVersion: this.currentVersion,
      storage: { ...this.store.snapshot(), ready: this.loaded && !this.store.uncertain,
        ...(!this.loaded && this.startupError ? { lastError: { code: this.startupError.code || 'UPDATE_LOAD_FAILED' } } : {}) },
      publicationUnknown: this.store.uncertain || Boolean(this.startupError?.statePublished),
      busy: { check: this.state.checkOperation?.status === 'running' && Boolean(this.checkPromise),
        stage: this.state.stageOperation?.status === 'running' && Boolean(this.stagePromise) } };
  }

  assertReady() {
    if (!this.loaded || this.store.uncertain) {
      const error = new Error(this.store.uncertain
        ? 'Updaterlagerets seneste udfald er ukendt. Genstart og kontrollér lageret før nye ændringer.'
        : 'Updaterlageret er ikke klar. Genstart og kontrollér lageret før nye ændringer.');
      error.code = this.store.uncertain ? 'UPDATE_STORAGE_UNKNOWN' : 'UPDATE_STORAGE_UNAVAILABLE';
      throw error;
    }
  }

  async commit(action) {
    this.assertReady();
    return this.store.transact(['update-state'], async () => {
      const result = await action(this.state);
      await this.store.save();
      return result;
    });
  }

  async check() {
    this.assertReady();
    if (!REPO.test(this.repository || '')) throw new Error('Privat GitHub-kilde er ikke konfigureret.');
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.runCheck();
    try { return await this.checkPromise; }
    finally { this.checkPromise = null; }
  }

  async runCheck() {
    const id = randomUUID();
    await this.commit(state => { state.checkOperation = { id, status: 'running', startedAt: new Date().toISOString() }; });
    let latest;
    try {
      const { stdout } = await this.command('git', ['ls-remote', '--tags', '--refs', this.repository], { timeout: 25_000 });
      const candidates = stdout.split('\n').map(line => {
        const match = /^([0-9a-f]{40})\s+refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line);
        return match ? { sha: match[1], version: match[2] } : null;
      }).filter(Boolean).sort((a, b) => compareVersions(b.version, a.version));
      latest = candidates.find(entry => compareVersions(entry.version, this.currentVersion) > 0) || null;
    } catch (error) {
      const message = 'Kunne ikke kontrollere GitHub. Kontrollér den skrivebeskyttede deploy key.';
      await this.commit(state => {
        if (state.checkOperation?.id !== id) throw conflict('Versionskontrollens grundlag er ændret.');
        state.checkOperation = { ...state.checkOperation, status: 'failed', finishedAt: new Date().toISOString(), error: message };
        state.error = message;
      });
      throw new Error(message, { cause: error });
    }
    // A storage failure is not a Git failure and must not trigger a second
    // write of the draft. Only this local checkpoint is serialized.
    await this.commit(state => {
      if (state.checkOperation?.id !== id) throw conflict('Versionskontrollens grundlag er ændret.');
      state.available = latest;
      state.lastCheck = new Date().toISOString();
      state.checkOperation = { ...state.checkOperation, status: 'completed', finishedAt: state.lastCheck };
      state.error = state.stageOperation?.status === 'unknown' ? state.stageOperation.error : '';
    });
    return this.snapshot();
  }

  async stage(expectedVersion, expectedSha) {
    this.assertReady();
    if (this.stagePromise) throw new Error('En staging er allerede igangværende.');
    this.stagePromise = this.runStage(expectedVersion, expectedSha);
    try { return await this.stagePromise; }
    finally { this.stagePromise = null; }
  }

  async assertCheckoutUnmodified(folder, expectedSha, message) {
    const head = await this.command('git', ['rev-parse', 'HEAD'], { cwd: folder, timeout: 5000 });
    const status = await this.command('git', ['status', '--porcelain', '--untracked-files=all', '--ignored=matching'], { cwd: folder, timeout: 5000 });
    if (head.stdout.trim() !== expectedSha || status.stdout.trim()) throw conflict(message);
  }

  async runStage(expectedVersion, expectedSha) {
    let release; const id = randomUUID();
    await this.commit(state => {
      if (!REPO.test(this.repository || '')) throw new Error('Privat GitHub-kilde er ikke konfigureret.');
      if (['running', 'unknown'].includes(state.stageOperation?.status))
        throw new Error('En tidligere staging er uafsluttet eller ukendt. Genstart og foretag eksplicit gennemgang før et nyt forsøg.');
      if (!state.available || !VERSION.test(state.available.version) || !SHA.test(state.available.sha))
        throw new Error('Ingen verificeret opdatering tilgængelig.');
      if (expectedVersion !== undefined || expectedSha !== undefined) {
        if (!VERSION.test(expectedVersion || '') || !SHA.test(expectedSha || '') ||
            state.available.version !== expectedVersion || state.available.sha !== expectedSha)
          throw conflict('Det viste versions-/commitgrundlag er ændret. Gennemgå den præcise opdatering igen.');
      }
      release = structuredClone(state.available);
      state.stageOperation = { id, status: 'running', ...release, startedAt: new Date().toISOString() };
      state.staged = null;
      state.approved = null;
      state.error = '';
    });
    const folder = join(this.stagingDirectory, release.version);
    let evidence;
    try {
      await prepareReleaseStaging(this.stagingDirectory);
      await this.command('git', ['clone', '--depth', '1', '--branch', release.version, '--single-branch', this.repository, folder], { timeout: 90_000 });
      await checkedReleaseCheckout(this.stagingDirectory, folder);
      const { stdout } = await this.command('git', ['rev-parse', 'HEAD'], { cwd: folder, timeout: 5000 });
      if (stdout.trim() !== release.sha) throw new Error('Tag og forventet commit matcher ikke.');
      const reviewedPaths = await checkedReleaseCheckout(this.stagingDirectory, folder, { scanTree: false });
      const packageContent = await this.readPackage(reviewedPaths.packagePath, 'utf8');
      await checkedReleaseCheckout(this.stagingDirectory, folder, { scanTree: false });
      const candidateVersion = validateReleasePackage(packageContent, release.version);
      const releaseMetadata = JSON.parse(packageContent);
      const candidateSchema = releaseMetadata.jarvisSchemaVersion ?? 0;
      const readableFrom = releaseMetadata.jarvisReadableSchemaFrom ?? 0;
      let activeSchema = 0;
      try { activeSchema = schemaVersion(JSON.parse(await readFile(join(resolve(this.stateFile, '..'), 'state.json'), 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (activeSchema > candidateSchema || activeSchema < readableFrom)
        throw new Error('Kandidatens dataskema er ikke kompatibelt med den nuværende tilstand.');
      await this.assertCheckoutUnmodified(folder, release.sha, 'Releasekandidaten er ændret eller indeholder ignoreret/ikke-sporet input efter checkout.');
      // Untrusted release tests must never run directly as the JARVIS host user.
      const dockerEnv = dockerProcessEnvironment(this.environment);
      const endpoint = await localDockerEndpoint(async (program, args, timeout) => {
        try { const result = await this.command(program, args, { timeout, env: dockerEnv, maxBuffer: 9000 }); return { ok: true, output: result.stdout }; }
        catch { return { ok: false, output: '' }; }
      }, { environment: this.environment });
      if (!endpoint.ok) throw new Error(endpoint.reason);
      const docker = (args, options) => this.command('docker', ['--host', endpoint.host, ...args], { ...options, env: dockerEnv });
      await docker(['image', 'inspect', 'node:22-alpine'], { timeout: 10_000 });
      const mountPaths = await checkedReleaseCheckout(this.stagingDirectory, folder);
      await this.assertCheckoutUnmodified(folder, release.sha, 'Releasekandidaten er ændret eller indeholder ignoreret/ikke-sporet input før test.');
      await checkedReleaseCheckout(this.stagingDirectory, folder, { scanTree: false });
      const containerName = `jarvis-release-test-${randomUUID()}`;
      try {
        await docker([
          'run', '--rm', '--pull', 'never', '--name', containerName, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
          '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '384m', '--cpus', '1',
          '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
          '--mount', `type=bind,source=${mountPaths.application},target=/workspace,readonly`,
          '--workdir', '/workspace', 'node:22-alpine', 'node', '--test',
        ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        // Killing a Docker CLI does not necessarily stop its container. Only
        // this call's unguessable name is eligible for bounded cleanup.
        try { await docker(['rm', '-f', containerName], { timeout: 8000, maxBuffer: 9000 }); }
        catch { throw Object.assign(new Error(`Test og containeroprydning kunne ikke verificeres. Kontrollér ${containerName} på det gennemgåede lokale Docker-endpoint.`, { cause: error }), { code: 'RELEASE_CONTAINER_UNKNOWN' }); }
        throw error;
      }
      await checkedReleaseCheckout(this.stagingDirectory, folder);
      await this.assertCheckoutUnmodified(folder, release.sha, 'Releasekandidaten blev ændret eller fik ignoreret/ikke-sporet input under test.');
      await checkedReleaseCheckout(this.stagingDirectory, folder, { scanTree: false });
      evidence = { ...release, packageVersion: candidateVersion, schemaVersion: candidateSchema,
        readableFrom, currentSchemaAtTest: activeSchema, testedSha: release.sha,
        testedAt: new Date().toISOString() };
    } catch (error) {
      const message = `Staging fejlede: ${String(error.message).slice(0, 240)}`;
      await this.commit(state => {
        if (state.stageOperation?.id !== id) throw conflict('Stagingens grundlag er ændret.');
        state.stageOperation = { ...state.stageOperation, status: error.code === 'RELEASE_CONTAINER_UNKNOWN' ? 'unknown' : 'failed',
          finishedAt: new Date().toISOString(), error: message };
        state.error = message;
      });
      throw Object.assign(new Error(message, { cause: error }), { code: error.code || 'UPDATE_STAGE_FAILED' });
    }
    // Return successful evidence only after the exact still-current basis is
    // durably published. External work never holds the local commit queue.
    let stale = false;
    await this.commit(state => {
      if (state.stageOperation?.id !== id) throw conflict('Stagingens grundlag er ændret.');
      stale = state.available?.version !== release.version || state.available?.sha !== release.sha;
      if (stale) {
        state.error = 'Releasegrundlaget er ændret under testen. Den forældede test er ikke godkendelsesgrundlag.';
        state.stageOperation = { ...state.stageOperation, status: 'failed', finishedAt: new Date().toISOString(), error: state.error };
        return;
      }
      state.staged = evidence;
      state.approved = null;
      state.error = '';
      state.stageOperation = { ...state.stageOperation, status: 'completed', finishedAt: evidence.testedAt };
    });
    if (stale) throw conflict('Releasegrundlaget er ændret under testen. Gennemgå den præcise nye revision.');
    return this.snapshot();
  }

  async approve(version, expectedSha, expectedTestedAt) {
    await this.commit(state => {
      // Bind the reviewed test inside the same durable transaction as the
      // existing version/SHA checks. A queued request cannot approve a retest.
      if (expectedTestedAt !== undefined &&
          (typeof expectedTestedAt !== 'string' || !Number.isFinite(Date.parse(expectedTestedAt)) || state.staged?.testedAt !== expectedTestedAt))
        throw conflict('Den gennemgåede testrevision er ændret. Hent status og gennemgå den aktuelle målversion igen.');
      if (!VERSION.test(version || '') || ['running', 'unknown'].includes(state.stageOperation?.status) ||
          !state.staged || state.staged.version !== version || !SHA.test(state.staged.sha || '') ||
          state.staged.packageVersion !== version.slice(1) ||
          !Number.isInteger(state.staged.schemaVersion) || state.staged.schemaVersion < 0 ||
          !Number.isInteger(state.staged.readableFrom) || state.staged.readableFrom < 0 || state.staged.readableFrom > state.staged.schemaVersion ||
          state.staged.testedSha !== state.staged.sha || !state.staged.testedAt ||
          state.available?.sha !== state.staged.sha || state.available?.version !== state.staged.version ||
          expectedSha !== undefined && (!SHA.test(expectedSha) || expectedSha !== state.staged.sha))
        throw conflict('Kun den præcise, verificerede og testede revision kan godkendes. Gennemgå ændret grundlag igen.');
      // Repeating a known identical approval is a no-op, not a fresh consent.
      if (state.approved?.version === version && state.approved.sha === state.staged.sha &&
          state.approved.testedAt === state.staged.testedAt) return;
      state.approved = { ...state.staged, approvedAt: new Date().toISOString() };
    });
    return this.snapshot();
  }
}
