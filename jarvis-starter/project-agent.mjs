import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, lstat, unlink, rename, open } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { atomicStateWrite } from './state-schema.mjs';
import { createJobTransitions } from './job-state-transition.mjs';

export function projectContentHash(files) {
  return createHash('sha256').update(JSON.stringify(files.map(({ path, content }) => [path, content])
    .sort((a, b) => comparePath(a[0], b[0])))).digest('hex');
}

function comparePath(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

const fileTypes = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.svg', '.py', '.txt']);
const slugPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const packagePattern = /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:@[0-9][\w.+-]*)?$/i;
const MAX_FILES = 12;
const MAX_FILE_SIZE = 45_000;
const MAX_PROJECT_FILES = 50;
const HASH_FILE_LIMIT = 16 * 1024 * 1024;
const HASH_TOTAL_LIMIT = 64 * 1024 * 1024;
const HASH_ENTRY_LIMIT = 2000;
const TEST_FILE_LIMIT = 2 * 1024 * 1024;
const TEST_TOTAL_LIMIT = 8 * 1024 * 1024;
const TEST_FILE_COUNT = 300;
const SOURCE_HASH_KIND = 'source-tree-v1';
const PRIVATE_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|private-settings\.json|(?:secrets|credentials)(?:\.[a-z0-9_-]+)?\.json)$/i;
const EXECUTABLE_PATH = /\.(?:[cm]?js|jsx|tsx?|json|py|sh|bash|ps1|rb|php|go|rs|c|cpp|java|swift)$/i;
const OMITTED_DIRECTORIES = new Set(['.git', '.svn', '.hg', 'node_modules', '__pycache__']);
const digest = value => createHash('sha256').update(value).digest('hex');

function packageName(spec) {
  const normalized = canonicalPackage(spec);
  const separator = normalized.lastIndexOf('@');
  return separator > 0 ? normalized.slice(0, separator) : normalized;
}

function checkedPackageList(packages) {
  if (!Array.isArray(packages) || packages.length > 8) throw new Error('Modellen foreslog ugyldige npm-pakker.');
  const normalized = packages.map(canonicalPackage);
  if (new Set(normalized.map(packageName)).size !== normalized.length) throw new Error('Samme npm-pakke må kun optræde én gang, også når versionerne er forskellige.');
  return normalized;
}

function completeSourceHash(entries) {
  return digest(JSON.stringify({ kind: SOURCE_HASH_KIND, excluded: ['vcs', 'node_modules', 'private-config'],
    files: entries.map(({ path, size, sha256 }) => [path, size, sha256]).sort((a, b) => comparePath(a[0], b[0])) }));
}

async function readBoundFile(path, captureLimit = 0) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(HASH_FILE_LIMIT)) throw new Error('En projektfil er ikke almindelig eller overstiger hashgrænsen på 16 MiB. Ingen ufuldstændig projektbinding anvendt.');
    const bytes = Buffer.alloc(64 * 1024);
    const chunks = [];
    const capture = captureLimit > 0 && before.size <= BigInt(captureLimit);
    const hash = createHash('sha256');
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > HASH_FILE_LIMIT) throw new Error('Projektfilen voksede over den sikre hashgrænse.');
      const chunk = bytes.subarray(0, bytesRead);
      hash.update(chunk);
      if (capture) chunks.push(Buffer.from(chunk));
    }
    const after = await handle.stat({ bigint: true });
    if (before.size !== after.size || BigInt(size) !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw new Error('En projektfil blev ændret under læsningen. Opdater og prøv igen.');
    const raw = capture ? Buffer.concat(chunks) : null;
    const text = raw?.toString('utf8');
    const content = raw && Buffer.from(text, 'utf8').equals(raw) ? text : undefined;
    return { size, sha256: hash.digest('hex'), ...(content !== undefined ? { content } : {}) };
  } finally { await handle.close(); }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
  finally { await handle.close(); }
}

async function durableUnlink(path) {
  await unlink(path);
  try { await syncDirectory(dirname(path)); }
  catch (error) { throw Object.assign(new Error('Projektfilen blev fjernet, men varigheden er uafklaret.', { cause: error }), { statePublished: true }); }
}

async function backupDirectory(root, projectId, operationId, create = false) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('Backupidentiteten er ugyldig. Manuel gennemgang kræves.');
  const projectRoot = join(root, projectId);
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Backuproden må ikke være et symbolsk link.');
  if (create) {
    try { await mkdir(projectRoot, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  for (const path of [root, projectRoot]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backupmapper skal være almindelige private mapper.');
  }
  const directory = join(projectRoot, operationId);
  if (create) await mkdir(directory, { mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backupmappen må ikke være et symbolsk link.');
  return directory;
}

async function checkedRollbackManifest(root, project) {
  if (!/^[a-f0-9]{64}$/.test(project.lastRollbackManifestHash || ''))
    throw new Error('Denne ældre backup har ingen bundet manifestkontrolsum. Gennemgå den manuelt; ingen automatisk rollback udført.');
  const directory = await backupDirectory(root, project.id, project.lastRollbackManifest);
  const file = await readBoundFile(join(directory, 'revision.json'), HASH_FILE_LIMIT);
  if (file.sha256 !== project.lastRollbackManifestHash || file.content === undefined)
    throw new Error('Backupmanifestet matcher ikke den registrerede revision og kontrolsum.');
  const snapshot = JSON.parse(file.content);
  if (snapshot.version !== 1 || snapshot.projectId !== project.id || snapshot.operationId !== project.lastRollbackManifest ||
      snapshot.revision !== project.lastRollbackableRevision || snapshot.parentRevision !== snapshot.revision - 1 ||
      !Array.isArray(snapshot.before) || !Array.isArray(snapshot.after) || !snapshot.before.length ||
      snapshot.before.length !== snapshot.after.length || snapshot.before.length > MAX_FILES)
    throw new Error('Backupmanifestets identitet eller filgrundlag er ugyldigt.');
  const afterNames = snapshot.after.map(item => item.path);
  if (new Set(afterNames).size !== afterNames.length || new Set(snapshot.before.map(item => item.path)).size !== afterNames.length ||
      snapshot.before.some(item => !afterNames.includes(item.path))) throw new Error('Backupmanifestets før- og efterfiler er forskellige.');
  for (const item of snapshot.after) if (!allowedPath(item.path) || typeof item.content !== 'string' ||
      Buffer.byteLength(item.content) > MAX_FILE_SIZE || digest(item.content) !== item.sha256)
    throw new Error('Backupmanifestets efterindhold er ugyldigt.');
  if (projectContentHash(snapshot.after) !== snapshot.changeHash) throw new Error('Backupmanifestets ændringskontrolsum er ugyldig.');
  const originals = new Map();
  for (const item of snapshot.before) {
    if (!allowedPath(item.path) || typeof item.existed !== 'boolean' ||
        item.existed && (typeof item.content !== 'string' || Buffer.byteLength(item.content) > MAX_FILE_SIZE || digest(item.content) !== item.sha256) ||
        !item.existed && (item.content !== null || item.sha256 !== null)) throw new Error('Backupmanifestets originalindhold er ugyldigt.');
    if (!item.existed) continue;
    const saved = await readBoundFile(await safePath(directory, item.path), MAX_FILE_SIZE);
    if (saved.sha256 !== item.sha256 || saved.content !== item.content) throw new Error('Backupfilens indhold matcher ikke den gennemgåede original.');
    originals.set(item.path, saved.content);
  }
  return { snapshot, originals };
}

function canonicalPackage(spec) {
  if (typeof spec !== 'string' || !packagePattern.test(spec)) throw new Error('Ugyldig npm-pakke.');
  // Package names are case-insensitive; preserve the exact requested version.
  const versionSeparator = spec.lastIndexOf('@');
  if (versionSeparator > 0) return `${spec.slice(0, versionSeparator).toLowerCase()}${spec.slice(versionSeparator)}`;
  return spec.toLowerCase();
}

export function exactlyApprovedPackages(pending, approved) {
  if (!Array.isArray(pending) || !Array.isArray(approved) ||
      pending.length === 0 || pending.length !== approved.length) return false;
  try {
    const required = pending.map(canonicalPackage);
    const requested = approved.map(canonicalPackage);
    if (new Set(required.map(packageName)).size !== required.length || new Set(requested.map(packageName)).size !== requested.length) return false;
    const expected = new Set(required);
    return requested.every(spec => expected.has(spec));
  } catch { return false; }
}

function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 140 || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path)) return false;
  const segments = path.split('/');
  if (segments.some(x => !x || x === '.' || x === '..' || x.startsWith('.') || x === 'node_modules' || PRIVATE_NAME.test(x))) return false;
  const suffix = path.slice(path.lastIndexOf('.'));
  return fileTypes.has(suffix.toLowerCase()) && segments.length <= 5;
}

async function safePath(projectDir, name) {
  if (!allowedPath(name)) throw new Error(`Filnavnet er ikke tilladt: ${String(name).slice(0, 100)}`);
  if ((await lstat(projectDir)).isSymbolicLink()) throw new Error('Projektmappen må ikke være et symbolsk link.');
  const target = resolve(projectDir, ...name.split('/'));
  if (!target.startsWith(resolve(projectDir) + sep)) throw new Error('Ugyldig projektsti.');
  let current = projectDir;
  for (const segment of name.split('/')) {
    current = join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt i projektmapper.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

async function checkJavaScript(source) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', '--input-type=module'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errorText = '';
    const timeout = setTimeout(() => child.kill(), 8000);
    child.stderr.on('data', data => { errorText += data.toString().slice(0, 600); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      code === 0 ? resolve() : reject(new Error(`JavaScript-syntaksfejl: ${errorText.slice(0, 400)}`));
    });
    child.stdin.end(source);
  });
}

export class ProjectAgent {
  constructor({ root, backupRoot, state, save, transact, generate, installer = null }) {
    Object.assign(this, { root, backupRoot, state, save, generate, installer });
    this.transact = transact || createJobTransitions(state);
    this.state.projects ||= [];
    for (const project of [...this.state.projects, ...(this.state.archivedProjects || [])]) {
      if (project.operation?.status === 'running') project.operation.status = 'unknown';
      if (project.packageInstallAttempt?.status === 'running') project.packageInstallAttempt.status = 'unknown';
    }
    this.busy = false;
    this.lockContext = new AsyncLocalStorage(); this.locked = false;
    for (const name of ['create', 'archive', 'restore', 'develop', 'rollback', 'install']) {
      const original = this[name].bind(this);
      this[name] = (...args) => this.withLock(() => original(...args));
    }
  }

  async withLock(action) {
    const inherited = this.lockContext.getStore();
    if (inherited) {
      if (!inherited.active) throw new Error('En afsluttet projektoperation må ikke genbruges af baggrundsarbejde.');
      return action();
    }
    if (this.locked) throw new Error('Projektet behandles allerede. Vent til ændring, test eller installation er afsluttet.');
    this.locked = true;
    const context = { active: true };
    try { return await this.lockContext.run(context, action); }
    finally { context.active = false; this.locked = false; }
  }

  assertOwned(project) {
    if (project.directoryOwned === false || project.operation?.kind === 'create' && project.operation.status !== 'completed')
      throw new Error('Projektmappen blev ikke bekræftet oprettet af JARVIS. Eksisterende filer må ikke læses, flyttes eller ændres gennem dette forslag.');
  }

  assertSettled(project) {
    this.assertOwned(project);
    if (['running', 'unknown'].includes(project.operation?.status) || ['running', 'unknown'].includes(project.packageInstallAttempt?.status))
      throw new Error('En tidligere projektændring har ukendt udfald. Kontrollér manifest og filer før nye ændringer.');
  }

  async checkpoint(id, change) {
    return this.transact(['projects', 'archivedProjects'], async () => {
      const project = this.get(id); change(project); await this.save(); return project;
    });
  }

  list() { return this.state.projects.map(({ id, slug, title, description, revision, updatedAt, lastSummary, pendingPackages, packageInstallAttempt, operation, contentHash, lastRollbackableRevision, lastTest }) => ({ id, slug, title, description, revision, updatedAt, lastSummary, pendingPackages, packageInstallAttempt, operation, contentHash, lastRollbackableRevision, lastTest })); }

  archived() { return (this.state.archivedProjects || []).map(({ id, title, slug, archivedAt }) => ({ id, title, slug, archivedAt })); }

  async archive(id) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    const project = this.get(id);
    this.assertSettled(project);
    if (!slugPattern.test(project.slug)) throw new Error('Ugyldigt projektnavn.');
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Projektroden må ikke være et symbolsk link.');
    const source = join(this.root, project.slug);
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    const trash = join(this.root, '.jarvis-archive');
    await mkdir(trash, { recursive: true, mode: 0o700 });
    if ((await lstat(trash)).isSymbolicLink()) throw new Error('Arkivmappen må ikke være et symbolsk link.');
    const destination = join(trash, project.id);
    try { await lstat(destination); throw new Error('Arkivmålet findes allerede. Ingen eksisterende mappe må erstattes.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.checkpoint(id, current => { current.operation = { id: randomUUID(), kind: 'archive', status: 'running', at: new Date().toISOString() }; });
    try { await rename(source, destination); }
    catch (error) { await this.checkpoint(id, current => { current.operation.status = 'failed'; }).catch(() => {}); throw error; }
    await this.transact(['projects', 'archivedProjects'], async () => {
      const current = this.get(id);
      this.state.projects = this.state.projects.filter(p => p.id !== id);
      this.state.archivedProjects ||= [];
      this.state.archivedProjects.push({ ...current, operation: { ...current.operation, status: 'completed' }, archivedAt: new Date().toISOString() });
      await this.save();
    });
    return { id, archived: true };
  }

  async restore(id) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    const entry = (this.state.archivedProjects || []).find(p => p.id === id);
    if (!entry) throw new Error('Arkiveret projekt findes ikke.');
    this.assertSettled(entry);
    if (!slugPattern.test(entry.slug)) throw new Error('Ugyldigt projektnavn.');
    if ((await lstat(this.root)).isSymbolicLink() || (await lstat(join(this.root, '.jarvis-archive'))).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    if (this.state.projects.some(p => p.slug === entry.slug)) throw new Error('Et aktivt projekt bruger allerede mappenavnet.');
    const source = join(this.root, '.jarvis-archive', id);
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    const destination = join(this.root, entry.slug);
    try { await lstat(destination); throw new Error('En eksisterende mappe optager projektets tidligere sti. Ingen brugerfiler overskrevet.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.transact(['archivedProjects'], async () => {
      this.state.archivedProjects.find(p => p.id === id).operation = { id: randomUUID(), kind: 'restore', status: 'running', at: new Date().toISOString() };
      await this.save();
    });
    await rename(source, destination);
    return this.transact(['projects', 'archivedProjects'], async () => {
      const current = this.state.archivedProjects.find(p => p.id === id);
      this.state.archivedProjects = this.state.archivedProjects.filter(p => p.id !== id);
      const { archivedAt, ...project } = current;
      project.operation = { ...current.operation, status: 'completed' };
      this.state.projects.push(project); await this.save(); return project;
    });
  }

  async create({ title, description }) {
    if (typeof title !== 'string' || title.trim().length < 2 || title.length > 80) throw new Error('Titel skal være 2–80 tegn.');
    if (typeof description !== 'string' || description.trim().length < 5 || description.length > 1500) throw new Error('Beskriv projektet med 5–1.500 tegn.');
    if (this.state.projects.length >= 30) throw new Error('Højst 30 projekter i denne version.');
    const slugBase = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Projektroden må ikke være et symbolsk link.');
    let slug = slugBase;
    let i = 2;
    for (;;) {
      let exists = this.state.projects.some(p => p.slug === slug);
      if (!exists) {
        try { await lstat(join(this.root, slug)); exists = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (!exists) break;
      if (i > 1000) throw new Error('Kunne ikke finde et ledigt projektnavn. Vælg et andet navn.');
      slug = `${slugBase}-${i++}`;
    }
    if (!slugPattern.test(slug)) throw new Error('Ugyldigt projektnavn.');
    const dir = join(this.root, slug);
    const project = { id: randomUUID(), slug, title: title.trim(), description: description.trim(), revision: 0,
      directoryOwned: false,
      updatedAt: new Date().toISOString(), lastSummary: 'Projektmappe oprettes.', pendingPackages: [],
      operation: { id: randomUUID(), kind: 'create', status: 'running', at: new Date().toISOString() } };
    await this.transact(['projects'], async () => { this.state.projects.unshift(project); await this.save(); });
    try { await mkdir(dir, { recursive: false, mode: 0o700 }); }
    catch (error) {
      await this.checkpoint(project.id, current => { current.operation.status = 'failed'; current.lastSummary = 'Projektmappen kunne ikke oprettes.'; }).catch(() => {});
      throw error;
    }
    return this.checkpoint(project.id, current => { current.operation.status = 'completed'; current.directoryOwned = true;
      current.lastSummary = 'Projektmappe oprettet. Klar til kodning.'; });
  }

  get(id) {
    const project = this.state.projects.find(p => p.id === id);
    if (!project) throw new Error('Projektet findes ikke.');
    return project;
  }

  async files(id) {
    return (await this.capture(id, { purpose: 'hash' })).sourceInventory.map(file => file.path).filter(allowedPath);
  }

  // Source hashes cover the entire bounded source tree, independently of what
  // fits a model prompt or the isolated test snapshot. VCS, node_modules and
  // private configuration are explicit exclusions, never copied to a model.
  async capture(id, { purpose = 'model' } = {}) {
    if (!['model', 'test', 'hash'].includes(purpose)) throw new Error('Ukendt projektvisning.');
    const project = this.get(id);
    this.assertOwned(project);
    const dir = join(this.root, project.slug);
    if ((await lstat(this.root)).isSymbolicLink() || (await lstat(dir)).isSymbolicLink()) throw new Error('Projektmapper må ikke være symbolske links.');
    const sourceInventory = [];
    const files = [];
    const omittedFiles = [];
    let totalBytes = 0; let capturedBytes = 0; let entryCount = 0;
    const maxFileBytes = purpose === 'test' ? TEST_FILE_LIMIT : MAX_FILE_SIZE;
    const maxCaptureBytes = purpose === 'test' ? TEST_TOTAL_LIMIT : MAX_FILE_SIZE * 4;
    const maxCaptureFiles = purpose === 'test' ? TEST_FILE_COUNT : MAX_PROJECT_FILES;
    async function walk(relative = '', depth = 0) {
      if (depth > 16) throw new Error('Projekttræet er for dybt til en fuldstændig, sikker binding.');
      const entries = await readdir(join(dir, relative), { withFileTypes: true });
      for (const item of entries.sort((a, b) => comparePath(a.name, b.name))) {
        if (++entryCount > HASH_ENTRY_LIMIT) throw new Error('Projektet har for mange filer til en fuldstændig binding. Ingen delvis hash anvendt.');
        if (OMITTED_DIRECTORIES.has(item.name) || PRIVATE_NAME.test(item.name)) continue;
        const name = [...(relative ? [relative] : []), item.name].join('/');
        if (item.isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt i den bundne projektkilde.');
        if (item.isDirectory()) { await walk(name, depth + 1); continue; }
        if (!item.isFile()) throw new Error('Projektkilden indeholder en filtype, som ikke kan bindes sikkert.');
        const safeForCapture = purpose !== 'hash' && allowedPath(name);
        const record = await readBoundFile(join(dir, relative, item.name), safeForCapture ? maxFileBytes : 0);
        totalBytes += record.size;
        if (totalBytes > HASH_TOTAL_LIMIT) throw new Error('Projektet overstiger hashgrænsen på 64 MiB. Ingen ufuldstændig binding anvendt.');
        sourceInventory.push({ path: name, size: record.size, sha256: record.sha256 });
        if (safeForCapture && record.content !== undefined && files.length < maxCaptureFiles && capturedBytes + record.size <= maxCaptureBytes) {
          files.push({ path: name, content: record.content }); capturedBytes += record.size;
        } else if (purpose !== 'hash' && (allowedPath(name) || EXECUTABLE_PATH.test(name))) {
          omittedFiles.push({ path: name, size: record.size, reason: !safeForCapture ? 'unsupported-path'
            : record.size > maxFileBytes ? 'file-size' : record.content === undefined ? 'not-utf8' : 'snapshot-limit' });
        }
      }
    }
    await walk();
    return { ...project, files, sourceInventory, sourceContentHash: completeSourceHash(sourceInventory),
      sourceHashKind: SOURCE_HASH_KIND, captureComplete: omittedFiles.length === 0, omittedFiles,
      sourceScope: 'Projektkilde uden versionsstyringsmapper, node_modules og privat konfiguration.', totalSourceBytes: totalBytes };
  }

  async inspect(id) { return this.capture(id, { purpose: 'model' }); }
  async testSnapshot(id) { return this.capture(id, { purpose: 'test' }); }
  async sourceSnapshot(id) { return this.capture(id, { purpose: 'hash' }); }

  async develop(id, request) {
    const project = this.get(id);
    this.assertSettled(project);
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    if (typeof request !== 'string' || request.trim().length < 4 || request.length > 3000) throw new Error('Beskriv udviklingsopgaven med 4–3.000 tegn.');
    this.busy = true;
    try {
      const current = await this.inspect(id);
      const beforeHash = current.sourceContentHash;
      const proposed = await this.generate({ project: current, request });
      if (!Array.isArray(proposed.files) || !proposed.files.length || proposed.files.length > MAX_FILES) throw new Error('Modellen returnerede et ugyldigt antal filer.');
      if (typeof proposed.summary !== 'string' || !proposed.summary.trim()) throw new Error('Forslaget mangler beskrivelse.');
      const seen = new Set();
      for (const file of proposed.files) {
        if (!allowedPath(file.path) || seen.has(file.path)) throw new Error('Modellen foreslog en ugyldig eller gentaget filsti.');
        seen.add(file.path);
        if (typeof file.content !== 'string' || Buffer.byteLength(file.content) > MAX_FILE_SIZE) throw new Error('En fil er for stor eller ugyldig.');
        if (current.sourceInventory.some(item => item.path === file.path) && !current.files.some(item => item.path === file.path))
          throw new Error('En eksisterende fil var ikke med i modellens afgrænsede grundlag. Ingen overskrivning af uset indhold.');
        if (file.path.endsWith('.js') || file.path.endsWith('.mjs')) await checkJavaScript(file.content);
        if (file.path.endsWith('.json')) JSON.parse(file.content);
        await safePath(join(this.root, project.slug), file.path);
      }
      const packageList = checkedPackageList(proposed.packages === undefined ? [] : proposed.packages);
      const packages = new Map(checkedPackageList(project.pendingPackages || []).map(spec => [packageName(spec), spec]));
      for (const spec of packageList) packages.set(packageName(spec), spec);
      if (packages.size > 8) throw new Error('Der kan højst afvente otte npm-pakker ad gangen.');
      if (this.get(id).revision !== project.revision || (await this.sourceSnapshot(id)).sourceContentHash !== beforeHash)
        throw new Error('Projektets filer er ændret under genereringen. Ingen foreslåede ændringer publiceret.');
      const revision = project.revision + 1;
      const operationId = randomUUID();
      const backupDir = await backupDirectory(this.backupRoot, project.id, operationId, true);
      const before = [];
      for (const file of proposed.files) {
        const target = await safePath(join(this.root, project.slug), file.path);
        let content = null;
        try { content = await readFile(target, 'utf8'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (content !== (current.files.find(item => item.path === file.path)?.content ?? null))
          throw new Error('En projektfil blev ændret efter modellens grundlag. Ingen foreslåede ændringer publiceret.');
        before.push({ path: file.path, existed: content !== null, content, sha256: content === null ? null : digest(content) });
        if (content !== null) {
          const backup = join(backupDir, ...file.path.split('/'));
          await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
          await atomicStateWrite(backup, content);
        }
      }
      const after = proposed.files.map(({ path, content }) => ({ path, content, sha256: digest(content) }));
      const manifest = { version: 1, projectId: project.id, operationId, parentRevision: project.revision,
        before, after, beforeHash, changeHash: projectContentHash(after), revision };
      const manifestText = JSON.stringify(manifest);
      const manifestHash = digest(manifestText);
      // All files and original bytes are described durably before publishing
      // any of the set. A stopped process leaves a reviewable operation ID.
      await atomicStateWrite(join(backupDir, 'revision.json'), manifestText);
      await this.checkpoint(id, item => { item.operation = { id: operationId, kind: 'develop', status: 'running',
        revision, beforeHash, changeHash: manifest.changeHash, manifestHash, at: new Date().toISOString() }; });
      const applied = [];
      try {
        for (const file of after) {
          const target = await safePath(join(this.root, project.slug), file.path);
          const expected = before.find(item => item.path === file.path).content;
          let actual = null;
          try { actual = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (actual !== expected) throw new Error('En projektfil blev ændret før publicering.');
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          try { await atomicStateWrite(target, file.content); }
          catch (error) { if (error.statePublished) applied.push(file); throw error; }
          applied.push(file);
        }
      } catch (error) {
        let recovered = true;
        for (const file of [...applied].reverse()) {
          try {
            const target = await safePath(join(this.root, project.slug), file.path);
            if (await readFile(target, 'utf8') !== file.content) throw new Error('Nyere fil må ikke overskrives.');
            const original = before.find(item => item.path === file.path);
            if (original.existed) await atomicStateWrite(target, original.content);
            else await durableUnlink(target);
          } catch { recovered = false; }
        }
        await this.checkpoint(id, item => { item.operation.status = recovered ? 'failed' : 'unknown';
          item.operation.note = recovered ? 'Publicering fejlede; de hidtil publicerede filer blev gendannet.' : 'Delvis ændring. Gennemgå manifest og filer; ingen automatisk gentagelse.';
        }).catch(() => {});
        throw error;
      }
      const published = await this.sourceSnapshot(id);
      if (after.some(file => published.sourceInventory.find(item => item.path === file.path)?.sha256 !== file.sha256)) {
        await this.checkpoint(id, item => { item.operation.status = 'unknown'; item.operation.note = 'Projektfiler blev ændret under publiceringen. Gennemgå manifest og aktuelt indhold.'; });
        throw new Error('Projektindholdet blev ændret under publiceringen; udfaldet skal gennemgås.');
      }
      const contentHash = published.sourceContentHash;
      const updated = await this.checkpoint(id, item => {
        item.revision = revision; item.lastRollbackableRevision = revision; item.lastRollbackManifest = operationId;
        item.lastRollbackManifestHash = manifestHash;
        item.lastSummary = proposed.summary.slice(0, 1500); item.updatedAt = new Date().toISOString();
        item.pendingPackages = [...packages.values()];
        item.operation.status = 'completed'; item.contentHash = contentHash; item.contentHashKind = SOURCE_HASH_KIND;
        item.lastTest = null;
      });
      return { project: updated, changedFiles: proposed.files.map(f => f.path), packagesAwaitingApproval: updated.pendingPackages };
    } finally { this.busy = false; }
  }

  async rollback(id) {
    const project = this.get(id);
    this.assertSettled(project);
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    if (!project.lastRollbackableRevision) throw new Error('Ingen automatisk tilbagerulning er tilgængelig.');
    this.busy = true;
    try {
      const rev = project.lastRollbackableRevision;
      const { snapshot, originals } = await checkedRollbackManifest(this.backupRoot, project);
      const projectDir = join(this.root, project.slug);
      for (const file of snapshot.after) {
        const target = await safePath(projectDir, file.path);
        const actual = await readFile(target, 'utf8');
        if (actual !== file.content) throw new Error(`${file.path} er ændret siden sidste revision. Automatisk rollback er ikke sikker.`);
      }
      await this.checkpoint(id, current => { current.operation = { id: randomUUID(), kind: 'rollback', status: 'running',
        revision: project.revision, manifestId: project.lastRollbackManifest,
        manifestHash: project.lastRollbackManifestHash, at: new Date().toISOString() }; });
      let published = false;
      try {
        for (const file of snapshot.before) {
          const target = await safePath(projectDir, file.path);
          const expected = snapshot.after.find(item => item.path === file.path).content;
          if (await readFile(target, 'utf8') !== expected) throw new Error('En nyere projektændring må ikke overskrives af rollback.');
          if (file.existed) await atomicStateWrite(target, originals.get(file.path));
          else await durableUnlink(target);
          published = true;
        }
      } catch (error) {
        await this.checkpoint(id, current => { current.operation.status = published || error.statePublished ? 'unknown' : 'failed';
          current.operation.note = 'Rollback blev afbrudt. Bevar manifest og filer; ingen automatisk gentagelse.';
        }).catch(() => {});
        throw error;
      }
      const contentHash = (await this.sourceSnapshot(id)).sourceContentHash;
      return this.checkpoint(id, current => {
        current.revision++; current.lastRollbackableRevision = null; current.lastRollbackManifest = null;
        current.lastRollbackManifestHash = null;
        current.pendingPackages = []; current.lastTest = null; current.contentHash = contentHash;
        current.contentHashKind = SOURCE_HASH_KIND;
        current.lastSummary = `Revision ${rev} blev rullet tilbage til tidligere filer.`;
        current.updatedAt = new Date().toISOString(); current.operation.status = 'completed';
      });
    } finally { this.busy = false; }
  }

  async install(id, approved, expectedRevision) {
    const project = this.get(id);
    this.assertSettled(project);
    if (!this.installer) throw new Error('Installation er ikke tilgængelig.');
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    const pending = project.pendingPackages || [];
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== project.revision)
      throw new Error('Projektet er ændret efter godkendelsesvisningen. Opdater og gennemgå pakkerne igen.');
    if (!exactlyApprovedPackages(pending, approved)) throw new Error('Godkend præcis de viste npm-pakker.');
    if (project.packageInstallAttempt?.revision === expectedRevision)
      throw new Error('En tidligere pakkeinstallation har allerede haft effekt eller ukendt udfald. Kontrollér projektet før ny godkendelse.');
    this.busy = true;
    try {
      if ((await lstat(this.root)).isSymbolicLink() || (await lstat(join(this.root, project.slug))).isSymbolicLink())
        throw new Error('Projektmapper må ikke være symbolske links.');
      const approvedContentHash = (await this.sourceSnapshot(id)).sourceContentHash;
      if (project.contentHashKind !== SOURCE_HASH_KIND || !project.contentHash)
        throw new Error('Pakkegrundlaget mangler en fuldstændig kildehash. Opret og gennemgå en ny projektrevision før installation.');
      if (project.contentHash !== approvedContentHash)
        throw new Error('Projektets indhold er ændret efter den viste revision. Ny gennemgang kræves før pakkeinstallation.');
      const attempt = { id: randomUUID(), revision: expectedRevision, packages: [...pending], status: 'running',
        contentHash: approvedContentHash, at: new Date().toISOString() };
      await this.checkpoint(id, current => { current.packageInstallAttempt = attempt; });
      try {
        if (this.get(id).revision !== expectedRevision || (await this.sourceSnapshot(id)).sourceContentHash !== attempt.contentHash)
          throw new Error('Projektets indhold er ændret efter godkendelsen.');
        await this.installer(join(this.root, project.slug), pending);
      } catch (error) {
        await this.checkpoint(id, current => {
          current.packageInstallAttempt.status = 'unknown'; current.packageInstallAttempt.finishedAt = new Date().toISOString();
          current.packageInstallAttempt.note = 'Pakkeinstallationen kan være delvist gennemført. Kontrollér projektet.';
        }).catch(() => {}); // Durable running record blocks unsafe retry.
        throw error;
      }
      const contentHash = (await this.sourceSnapshot(id)).sourceContentHash;
      return this.checkpoint(id, current => {
        current.packageInstallAttempt.status = 'completed'; current.packageInstallAttempt.finishedAt = new Date().toISOString();
        current.pendingPackages = []; current.updatedAt = new Date().toISOString(); current.lastTest = null;
        current.contentHash = contentHash;
      });
    } finally { this.busy = false; }
  }
}

export async function installNpmPackages(projectDir, packages) {
  if (process.env.JARVIS_ALLOW_NPM_INSTALL !== 'yes') throw new Error('Installation er slået fra. Sæt JARVIS_ALLOW_NPM_INSTALL=yes i .env og genstart efter sikkerhedsvurdering.');
  await new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const executable = windows ? process.execPath : 'npm';
    const args = windows ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] : [];
    const child = spawn(executable,
      [...args, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--', ...packages],
      { cwd: projectDir, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.stderr.on('data', data => { output += data.toString().slice(0, 250); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`npm-installation fejlede (${code}): ${output.slice(0, 500)}`)); });
  });
}
