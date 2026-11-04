import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, lstat, stat, unlink, rename } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';

const fileTypes = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.svg', '.py', '.txt']);
const slugPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const packagePattern = /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:@[0-9][\w.+-]*)?$/i;
const MAX_FILES = 12;
const MAX_FILE_SIZE = 45_000;
const MAX_PROJECT_FILES = 50;

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
    if (new Set(required).size !== required.length || new Set(requested).size !== requested.length) return false;
    const expected = new Set(required);
    return requested.every(spec => expected.has(spec));
  } catch { return false; }
}

function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 140 || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path)) return false;
  const segments = path.split('/');
  if (segments.some(x => !x || x === '.' || x === '..' || x.startsWith('.') || x === 'node_modules')) return false;
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
  constructor({ root, backupRoot, state, save, generate, installer = null }) {
    Object.assign(this, { root, backupRoot, state, save, generate, installer });
    this.state.projects ||= [];
    this.busy = false;
  }

  list() { return this.state.projects.map(({ id, slug, title, description, revision, updatedAt, lastSummary, pendingPackages, packageInstallAttempt, lastRollbackableRevision, lastTest }) => ({ id, slug, title, description, revision, updatedAt, lastSummary, pendingPackages, packageInstallAttempt, lastRollbackableRevision, lastTest })); }

  archived() { return (this.state.archivedProjects || []).map(({ id, title, slug, archivedAt }) => ({ id, title, slug, archivedAt })); }

  async archive(id) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    const project = this.get(id);
    if (!slugPattern.test(project.slug)) throw new Error('Ugyldigt projektnavn.');
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Projektroden må ikke være et symbolsk link.');
    const source = join(this.root, project.slug);
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    const trash = join(this.root, '.jarvis-archive');
    await mkdir(trash, { recursive: true, mode: 0o700 });
    if ((await lstat(trash)).isSymbolicLink()) throw new Error('Arkivmappen må ikke være et symbolsk link.');
    const destination = join(trash, project.id);
    await rename(source, destination);
    this.state.projects = this.state.projects.filter(p => p.id !== id);
    this.state.archivedProjects ||= [];
    this.state.archivedProjects.push({ ...project, archivedAt: new Date().toISOString() });
    await this.save();
    return { id, archived: true };
  }

  async restore(id) {
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    const entry = (this.state.archivedProjects || []).find(p => p.id === id);
    if (!entry) throw new Error('Arkiveret projekt findes ikke.');
    if (!slugPattern.test(entry.slug)) throw new Error('Ugyldigt projektnavn.');
    if ((await lstat(this.root)).isSymbolicLink() || (await lstat(join(this.root, '.jarvis-archive'))).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    if (this.state.projects.some(p => p.slug === entry.slug)) throw new Error('Et aktivt projekt bruger allerede mappenavnet.');
    const source = join(this.root, '.jarvis-archive', id);
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Symbolske links er ikke tilladt.');
    await rename(source, join(this.root, entry.slug));
    this.state.archivedProjects = this.state.archivedProjects.filter(p => p.id !== id);
    const { archivedAt, ...project } = entry;
    this.state.projects.push(project);
    await this.save();
    return project;
  }

  async create({ title, description }) {
    if (typeof title !== 'string' || title.trim().length < 2 || title.length > 80) throw new Error('Titel skal være 2–80 tegn.');
    if (typeof description !== 'string' || description.trim().length < 5 || description.length > 1500) throw new Error('Beskriv projektet med 5–1.500 tegn.');
    if (this.state.projects.length >= 30) throw new Error('Højst 30 projekter i denne version.');
    const slugBase = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';
    let slug = slugBase;
    let i = 2;
    while (this.state.projects.some(p => p.slug === slug)) slug = `${slugBase}-${i++}`;
    if (!slugPattern.test(slug)) throw new Error('Ugyldigt projektnavn.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Projektroden må ikke være et symbolsk link.');
    const dir = join(this.root, slug);
    await mkdir(dir, { recursive: false, mode: 0o700 });
    const project = { id: randomUUID(), slug, title: title.trim(), description: description.trim(), revision: 0,
      updatedAt: new Date().toISOString(), lastSummary: 'Projektmappe oprettet. Klar til kodning.', pendingPackages: [] };
    this.state.projects.unshift(project);
    await this.save();
    return project;
  }

  get(id) {
    const project = this.state.projects.find(p => p.id === id);
    if (!project) throw new Error('Projektet findes ikke.');
    return project;
  }

  async files(id) {
    const project = this.get(id);
    const dir = join(this.root, project.slug);
    if ((await lstat(this.root)).isSymbolicLink() || (await lstat(dir)).isSymbolicLink()) throw new Error('Projektmapper må ikke være symbolske links.');
    const found = [];
    async function walk(relative = '', depth = 0) {
      if (depth > 5) return;
      for (const item of await readdir(join(dir, relative), { withFileTypes: true })) {
        if (item.name.startsWith('.') || item.name === 'node_modules') continue;
        const name = [...(relative ? [relative] : []), item.name].join('/');
        if (item.isDirectory()) await walk(name, depth + 1);
        else if (item.isFile() && allowedPath(name)) found.push(name);
        if (found.length >= MAX_PROJECT_FILES) return;
      }
    }
    await walk();
    return found;
  }

  async inspect(id) {
    const project = this.get(id);
    const paths = await this.files(id);
    const contents = [];
    for (const path of paths) {
      const safe = await safePath(join(this.root, project.slug), path);
      const details = await stat(safe);
      if (details.size > MAX_FILE_SIZE) continue;
      contents.push({ path, content: await readFile(safe, 'utf8') });
    }
    return { ...project, files: contents };
  }

  async develop(id, request) {
    const project = this.get(id);
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    if (typeof request !== 'string' || request.trim().length < 4 || request.length > 3000) throw new Error('Beskriv udviklingsopgaven med 4–3.000 tegn.');
    this.busy = true;
    try {
      const current = await this.inspect(id);
      const proposed = await this.generate({ project: current, request });
      if (!Array.isArray(proposed.files) || !proposed.files.length || proposed.files.length > MAX_FILES) throw new Error('Modellen returnerede et ugyldigt antal filer.');
      if (typeof proposed.summary !== 'string' || !proposed.summary.trim()) throw new Error('Forslaget mangler beskrivelse.');
      const seen = new Set();
      for (const file of proposed.files) {
        if (!allowedPath(file.path) || seen.has(file.path)) throw new Error('Modellen foreslog en ugyldig eller gentaget filsti.');
        seen.add(file.path);
        if (typeof file.content !== 'string' || file.content.length > MAX_FILE_SIZE) throw new Error('En fil er for stor eller ugyldig.');
        if (file.path.endsWith('.js') || file.path.endsWith('.mjs')) await checkJavaScript(file.content);
        if (file.path.endsWith('.json')) JSON.parse(file.content);
        await safePath(join(this.root, project.slug), file.path);
      }
      const packageList = Array.isArray(proposed.packages) ? proposed.packages : [];
      if (packageList.length > 8 || packageList.some(p => typeof p !== 'string' || !packagePattern.test(p))) throw new Error('Modellen foreslog ugyldige npm-pakker.');
      const revision = project.revision + 1;
      const backupDir = join(this.backupRoot, project.id, String(revision));
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      const before = [];
      for (const file of proposed.files) {
        const target = await safePath(join(this.root, project.slug), file.path);
        let content = null;
        try { content = await readFile(target, 'utf8'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        before.push({ path: file.path, existed: content !== null });
        if (content !== null) {
          const backup = join(backupDir, ...file.path.split('/'));
          await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
          await writeFile(backup, content, { flag: 'wx', mode: 0o600 });
        }
      }
      for (const file of proposed.files) {
        const target = await safePath(join(this.root, project.slug), file.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, file.content, { mode: 0o600 });
      }
      await writeFile(join(backupDir, 'revision.json'), JSON.stringify({ before, after: proposed.files.map(f => ({ path: f.path, content: f.content })) }), { flag: 'wx', mode: 0o600 });
      project.revision = revision;
      project.lastRollbackableRevision = revision;
      project.lastSummary = proposed.summary.slice(0, 1500);
      project.updatedAt = new Date().toISOString();
      project.pendingPackages = [...new Set([...(project.pendingPackages || []), ...packageList])];
      await this.save();
      return { project, changedFiles: proposed.files.map(f => f.path), packagesAwaitingApproval: project.pendingPackages };
    } finally { this.busy = false; }
  }

  async rollback(id) {
    const project = this.get(id);
    if (this.busy) throw new Error('Kodeagenten arbejder allerede.');
    if (!project.lastRollbackableRevision) throw new Error('Ingen automatisk tilbagerulning er tilgængelig.');
    this.busy = true;
    try {
      const rev = project.lastRollbackableRevision;
      const backupDir = join(this.backupRoot, project.id, String(rev));
      const snapshot = JSON.parse(await readFile(join(backupDir, 'revision.json'), 'utf8'));
      const projectDir = join(this.root, project.slug);
      for (const file of snapshot.after) {
        const target = await safePath(projectDir, file.path);
        const actual = await readFile(target, 'utf8');
        if (actual !== file.content) throw new Error(`${file.path} er ændret siden sidste revision. Automatisk rollback er ikke sikker.`);
      }
      for (const file of snapshot.before) {
        const target = await safePath(projectDir, file.path);
        if (file.existed) {
          const old = await readFile(join(backupDir, ...file.path.split('/')), 'utf8');
          await writeFile(target, old, { mode: 0o600 });
        } else await unlink(target);
      }
      project.lastRollbackableRevision = null;
      project.pendingPackages = [];
      project.lastSummary = `Revision ${rev} blev rullet tilbage til tidligere filer.`;
      project.updatedAt = new Date().toISOString();
      await this.save();
      return project;
    } finally { this.busy = false; }
  }

  async install(id, approved, expectedRevision) {
    const project = this.get(id);
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
      const attempt = { id: randomUUID(), revision: expectedRevision, packages: [...pending], status: 'running',
        at: new Date().toISOString() };
      project.packageInstallAttempt = attempt;
      try { await this.save(); }
      catch (error) {
        delete project.packageInstallAttempt; // Installer was never called.
        throw error;
      }
      try {
        await this.installer(join(this.root, project.slug), pending);
      } catch (error) {
        attempt.status = 'unknown';
        attempt.finishedAt = new Date().toISOString();
        attempt.note = 'Pakkeinstallationen kan være delvist gennemført. Kontrollér projektet.';
        await this.save().catch(() => {}); // The durable running record blocks unsafe retry.
        throw error;
      }
      attempt.status = 'completed';
      attempt.finishedAt = new Date().toISOString();
      project.pendingPackages = [];
      project.updatedAt = new Date().toISOString();
      await this.save();
      return project;
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
