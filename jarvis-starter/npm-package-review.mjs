import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, lstat, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cleanProcessEnvironment, runBoundedProcess } from './subprocess-safety.mjs';
import { atomicStateWrite } from './state-schema.mjs';

const REGISTRY = 'https://registry.npmjs.org/';
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const UNSUPPORTED = ['workspaces', 'overrides', 'resolutions', 'bundledDependencies', 'bundleDependencies', 'publishConfig'];
const hash = text => createHash('sha256').update(text).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function problem(code, message) { return Object.assign(new Error(message), { code }); }
function reviewError(review) {
  return Object.assign(new Error(`Dependency-review påkrævet: ${review.reasons.map(item => item.message).join(' ')}`), {
    code: 'DEPENDENCY_REVIEW_REQUIRED', status: 409, installationNotStarted: true, dependencyReview: review,
  });
}
export function requireNpmReview(review) { if (review.status !== 'ready') throw reviewError(review); return review; }

function directSet(manifest) {
  const found = new Map();
  for (const section of SECTIONS) {
    if (manifest[section] === undefined) continue;
    if (!object(manifest[section])) throw problem('MANIFEST_DEPENDENCIES', `${section} skal være et objekt med præcise versioner.`);
    for (const [name, version] of Object.entries(manifest[section])) {
      if (!NAME.test(name) || typeof version !== 'string' || !VERSION.test(version))
        throw problem('UNPINNED_DIRECT_DEPENDENCY', 'Alle direkte pakker skal have almindelige navne og præcise x.y.z-versioner, ikke ranges, alias, Git, URL eller filstier.');
      if (found.has(name)) throw problem('DUPLICATE_DIRECT_DEPENDENCY', 'Samme direkte pakke står i flere dependency-felter. Gennemgå det entydige sæt.');
      found.set(name, version);
    }
  }
  return [...found].map(([name, version]) => `${name}@${version}`).sort();
}

function approvedSet(packages) {
  if (!Array.isArray(packages) || !packages.length || packages.length > 8) throw problem('APPROVED_SET', 'Gennemgå 1–8 direkte npm-pakker med præcise versioner.');
  const found = new Set();
  return packages.map(spec => {
    if (typeof spec !== 'string') throw problem('APPROVED_SET', 'Det godkendte npm-sæt er ugyldigt.');
    const position = spec.lastIndexOf('@'); const name = spec.slice(0, position).toLowerCase(); const version = spec.slice(position + 1);
    if (position <= 0 || !NAME.test(name) || !VERSION.test(version)) throw problem('UNPINNED_APPROVAL', 'De viste npm-pakker skal have præcise x.y.z-versioner; ingen implicit latest.');
    if (found.has(name)) throw problem('DUPLICATE_APPROVAL', 'Gentagne npm-pakker kan ikke godkendes.');
    found.add(name); return `${name}@${version}`;
  }).sort();
}

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function boundText(path, limit, label) {
  let handle;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw problem('UNSAFE_FILE', `${label} skal være en almindelig fil inden for reviewgrænsen.`);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw problem('UNSAFE_FILE', `${label} blev erstattet eller overskred reviewgrænsen.`);
    const chunks = []; const buffer = Buffer.alloc(64 * 1024); let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - size), null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw problem('FILE_CHANGED', `${label} voksede over reviewgrænsen.`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const bytes = Buffer.concat(chunks); const after = await handle.stat({ bigint: true });
    if (bytes.length > limit || before.size !== after.size || BigInt(bytes.length) !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw problem('FILE_CHANGED', `${label} blev ændret under review. Opdater grundlaget.`);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw problem('INVALID_TEXT', `${label} skal være UTF-8 JSON.`);
    return { text, hash: hash(bytes) };
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('MISSING_FILE', `${label} mangler. Opret og gennemgå filen først.`);
    throw error;
  } finally { await handle?.close(); }
}

function publicTarball(value) {
  try {
    const url = new URL(value);
    return url.origin === REGISTRY.slice(0, -1) && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('.tgz');
  } catch { return false; }
}

function integrity(value) {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return false;
  const digest = value.slice(7); const bytes = Buffer.from(digest, 'base64');
  return bytes.length === 64 && bytes.toString('base64') === digest;
}

function installedDependency(packages, source, name) {
  let directory = source;
  for (;;) {
    const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return packages[candidate];
    if (!directory) return null;
    const index = directory.lastIndexOf('/node_modules/'); directory = index < 0 ? '' : directory.slice(0, index);
  }
}

function validateLock(lock, manifest, requested) {
  if (!object(lock) || lock.lockfileVersion !== 3 || Object.hasOwn(lock, 'dependencies') || !object(lock.packages) || !object(lock.packages['']))
    throw problem('LOCK_FORMAT', 'package-lock.json skal være et fuldstændigt lockfileVersion 3-grundlag med packages. Ældre lockformater kræver ny review.');
  const entries = Object.entries(lock.packages);
  if (entries.length < 2 || entries.length > 3001) throw problem('LOCK_SIZE', 'Lockfilen skal beskrive 1–3.000 installerede pakker.');
  const root = lock.packages[''];
  if (JSON.stringify(directSet(root)) !== JSON.stringify(requested)) throw problem('LOCK_DIRECT_SET', 'Lockfilens direkte pakker matcher ikke præcis det gennemgåede manifest og godkendte sæt.');
  for (const section of SECTIONS) if (JSON.stringify(Object.entries(root[section] || {}).sort()) !== JSON.stringify(Object.entries(manifest[section] || {}).sort()))
    throw problem('LOCK_DIRECT_SECTION', 'Lockfilens dependency-felter er ikke identiske med package.json.');
  if (root.name !== manifest.name || root.version !== manifest.version) throw problem('LOCK_IDENTITY', 'Manifestets navn/version matcher ikke lockfilens projektrod.');
  for (const [path, item] of entries) {
    if (!object(item) || UNSUPPORTED.some(field => Object.hasOwn(item, field))) throw problem('LOCK_UNSUPPORTED', 'Lockfilen indeholder et ukendt workspace, override eller bundle-grundlag.');
    if (path) {
      if (path.length > 1000 || !/^node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)*$/.test(path) ||
          item.link || item.inBundle || !VERSION.test(item.version || '') || !publicTarball(item.resolved))
        throw problem('LOCK_PRIVATE_SOURCE', 'Alle låste pakker skal være versionspinnede tarballs fra https://registry.npmjs.org; private kilder, links, bundles og fil/Git-URL’er kræver separat review.');
      if (!integrity(item.integrity)) throw problem('LOCK_INTEGRITY', 'Mindst én låst pakke mangler en gyldig SHA-512-integritetsbinding.');
    }
    for (const section of path ? ['dependencies', 'optionalDependencies', 'peerDependencies'] : SECTIONS) {
      if (item[section] === undefined) continue;
      if (!object(item[section])) throw problem('LOCK_GRAPH', 'Lockfilens dependency-graf er ugyldig.');
      for (const [name, range] of Object.entries(item[section])) {
        if (!NAME.test(name) || typeof range !== 'string' || range.length > 160 || !/^[0-9A-Za-z*^~<>=|.+ -]+$/.test(range) || !/[0-9*]/.test(range))
          throw problem('LOCK_PRIVATE_REFERENCE', 'En indirekte dependency bruger en ukendt eller privat reference. Gennemgå grafen før installation.');
        if (!installedDependency(lock.packages, path, name) && !(section === 'peerDependencies' && item.peerDependenciesMeta?.[name]?.optional === true))
          throw problem('LOCK_INCOMPLETE', 'Lockfilen mangler en påkrævet direkte eller indirekte pakke. Ingen implicit opløsning tilladt.');
      }
    }
  }
  for (const spec of requested) {
    const split = spec.lastIndexOf('@');
    if (lock.packages[`node_modules/${spec.slice(0, split)}`]?.version !== spec.slice(split + 1))
      throw problem('LOCK_DIRECT_VERSION', 'En direkte pakke er låst til en anden version end den godkendte.');
  }
  return entries.length - 1;
}

async function inspectNpmReview(projectDir, packages) {
  const requested = approvedSet(packages); const directory = resolve(projectDir);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw problem('PROJECT_PATH', 'Projektmappen skal være en almindelig lokal mappe.');
  for (const filename of ['.npmrc', 'npm-shrinkwrap.json', 'yarn.lock']) if (await exists(join(directory, filename)))
    throw problem('PROJECT_CONFIG', `${filename} kræver særskilt review; JARVIS læser eller anvender ikke denne private/alternative konfiguration.`);
  const modules = await exists(join(directory, 'node_modules'));
  if (modules && (!modules.isDirectory() || modules.isSymbolicLink())) throw problem('MODULES_PATH', 'Eksisterende node_modules er ikke en almindelig mappe. Ingen erstatning tilladt.');
  const manifestFile = await boundText(join(directory, 'package.json'), 128 * 1024, 'package.json');
  const lockFile = await boundText(join(directory, 'package-lock.json'), 2 * 1024 * 1024, 'package-lock.json');
  let manifest, lock;
  try { manifest = JSON.parse(manifestFile.text); lock = JSON.parse(lockFile.text); }
  catch { throw problem('INVALID_JSON', 'Manifest eller lockfil indeholder ugyldig JSON.'); }
  if (!object(manifest) || typeof manifest.name !== 'string' || !NAME.test(manifest.name) || !VERSION.test(manifest.version || '') || UNSUPPORTED.some(field => Object.hasOwn(manifest, field)))
    throw problem('MANIFEST_UNSUPPORTED', 'Manifestet kræver almindeligt navn/version og ingen workspace, override, bundle eller publish-konfiguration.');
  if (JSON.stringify(directSet(manifest)) !== JSON.stringify(requested))
    throw problem('MANIFEST_DIRECT_SET', 'Alle direkte dependencies i package.json skal være præcis det viste og godkendte pakkesæt, også tidligere installerede pakker.');
  const dependencyCount = validateLock(lock, manifest, requested);
  return { review: { status: 'ready', reasons: [], directPackages: requested, registry: REGISTRY,
    manifestHash: manifestFile.hash, lockHash: lockFile.hash, dependencyCount, scripts: 'not-executed',
    mode: 'reviewed-lockfile-ci', checkedAt: new Date().toISOString() }, manifestFile, lockFile };
}

export async function reviewNpmPackages(projectDir, packages) {
  try { return (await inspectNpmReview(projectDir, packages)).review; }
  catch (error) { return { status: 'dependency-review-required', reasons: [{ code: error.code || 'REVIEW_UNAVAILABLE',
    message: ['EACCES', 'EPERM'].includes(error.code) ? 'Manifest eller lockfil kunne ikke læses sikkert.' : error.message }],
    directPackages: Array.isArray(packages) ? packages.filter(item => typeof item === 'string').slice(0, 8) : [], checkedAt: new Date().toISOString() }; }
}

export function npmStagingDirectory(projectDir, operationId) {
  if (!/^[a-f0-9-]{36}$/i.test(operationId || '')) throw new Error('Pakkeinstallationen mangler et journalført operations-ID.');
  return join(dirname(resolve(projectDir)), `.jarvis-npm-${operationId}`);
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
  finally { await handle.close(); }
}

export async function installNpmPackages(projectDir, packages, { operationId, expectedContentHash, verifyBasis,
  environment = process.env, spawnProcess = spawn, platform = process.platform } = {}) {
  let published = false; let workspace;
  try {
    if (environment.JARVIS_ALLOW_NPM_INSTALL !== 'yes') throw problem('INSTALLATION_DISABLED', 'Installation er slået fra. En særskilt sikkerhedsvurdering og administratorens konfiguration kræves.');
    const inspected = await inspectNpmReview(projectDir, packages);
    workspace = npmStagingDirectory(projectDir, operationId);
    await mkdir(workspace, { mode: 0o700 }); // Exclusive: never reuse an earlier install attempt.
    const staging = join(workspace, 'candidate'); await mkdir(staging, { mode: 0o700 });
    const journal = { operationId, expectedContentHash, ...inspected.review, status: 'preparing' };
    await atomicStateWrite(join(workspace, 'review.json'), JSON.stringify(journal));
    for (const [name, text] of [['package.json', inspected.manifestFile.text], ['package-lock.json', inspected.lockFile.text]])
      await atomicStateWrite(join(staging, name), text);
    for (const name of ['user.npmrc', 'global.npmrc']) await atomicStateWrite(join(workspace, name), '');
    await verifyBasis?.();
    const windows = platform === 'win32';
    const program = windows ? process.execPath : 'npm';
    const prefix = windows ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] : [];
    const result = await runBoundedProcess(program, [...prefix, 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
      '--workspaces=false', '--update-notifier=false', '--fetch-retries=0', '--fetch-timeout=30000',
      `--registry=${REGISTRY}`, `--prefix=${staging}`, `--userconfig=${join(workspace, 'user.npmrc')}`,
      `--globalconfig=${join(workspace, 'global.npmrc')}`, `--cache=${join(workspace, 'cache')}`], {
      cwd: staging, environment: cleanProcessEnvironment(environment), timeoutMs: 120_000, maxOutputBytes: 4096, spawnProcess,
    });
    if (!result.ok) throw problem('INSTALLATION_PREPARATION_FAILED', result.timedOut
      ? 'Klargøring af pakker overskred tidsgrænsen. Projektets node_modules er ikke ændret.'
      : 'Klargøring af den låste pakkeplan fejlede. Projektets node_modules er ikke ændret; npm-output videresendes ikke.');
    const after = await inspectNpmReview(projectDir, packages);
    if (after.review.manifestHash !== inspected.review.manifestHash || after.review.lockHash !== inspected.review.lockHash)
      throw problem('REVIEW_CHANGED', 'Manifest eller lockfil blev ændret under klargøring. Ingen projektpakker publiceret.');
    const candidateManifest = await boundText(join(staging, 'package.json'), 128 * 1024, 'Klargjort manifest');
    const candidateLock = await boundText(join(staging, 'package-lock.json'), 2 * 1024 * 1024, 'Klargjort lockfil');
    if (candidateManifest.hash !== inspected.review.manifestHash || candidateLock.hash !== inspected.review.lockHash)
      throw problem('CANDIDATE_CHANGED', 'Npm ændrede det låste grundlag. Ingen projektpakker publiceret.');
    const modules = join(projectDir, 'node_modules'); const candidate = join(staging, 'node_modules');
    const info = await lstat(candidate);
    if (!info.isDirectory() || info.isSymbolicLink()) throw problem('CANDIDATE_PATH', 'Npm leverede ikke en almindelig node_modules-mappe.');
    await verifyBasis?.();
    await atomicStateWrite(join(workspace, 'review.json'), JSON.stringify({ ...journal, status: 'publishing' }));
    const previous = await exists(modules);
    if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw problem('MODULES_PATH', 'node_modules blev ændret til en usikker filtype. Ingen erstatning tilladt.');
    published = true; // From here, any failure needs explicit recovery/review.
    if (previous) await rename(modules, join(workspace, 'previous-node_modules'));
    await rename(candidate, modules);
    await syncDirectory(projectDir); await syncDirectory(workspace);
    await atomicStateWrite(join(workspace, 'review.json'), JSON.stringify({ ...journal, status: 'completed',
      previousModulesPreserved: !!previous, finishedAt: new Date().toISOString() }));
    return { status: 'completed', stagingDirectory: workspace, previousModulesPreserved: !!previous,
      manifestHash: inspected.review.manifestHash, lockHash: inspected.review.lockHash };
  } catch (error) {
    // Staging may have downloaded public bytes, but it has not changed any
    // project file. Do not misreport a known pre-publication failure as unknown.
    if (!published) error.installationNotStarted = true;
    if (workspace) error.stagingDirectory = workspace;
    if (error.installationNotStarted && !error.status) error.status = 409;
    throw error;
  }
}

installNpmPackages.preflight = reviewNpmPackages;
installNpmPackages.stagingDirectory = npmStagingDirectory;
installNpmPackages.enabled = () => process.env.JARVIS_ALLOW_NPM_INSTALL === 'yes';
