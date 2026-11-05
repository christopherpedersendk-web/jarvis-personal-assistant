// Candidate identity for GUI verification. This records code, not credentials.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = resolve(appRoot, '..');
const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function publicAssetHashes() {
  const directory = join(appRoot, 'public');
  const files = (await readdir(directory)).filter(name => /\.(?:html|css|js)$/.test(name)).sort();
  return Object.fromEntries(await Promise.all(files.map(async name => [name, sha256(await readFile(join(directory, name)))])));
}

export async function guiIdentity() {
  const commit = git('rev-parse', 'HEAD');
  const expected = process.env.GUI_EXPECTED_CANDIDATE || null;
  if (expected && (!/^[0-9a-f]{40}$/i.test(expected) || expected.toLowerCase() !== commit))
    throw new Error(`Expected exact GUI candidate ${expected}; checked out ${commit}.`);
  const fixture = new URL('./fixtures/gui-redesign.mjs', import.meta.url);
  const fixtureHash = await readFile(fixture).then(sha256).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return {
    recordedAt: new Date().toISOString(), candidateCommit: commit,
    candidateTree: git('rev-parse', 'HEAD^{tree}'), applicationTree: git('rev-parse', 'HEAD:jarvis-starter'),
    expectedCandidate: expected, trackedChanges: git('status', '--porcelain', '--untracked-files=no'),
    nodeVersion: process.version, platform: process.platform, architecture: process.arch,
    workflowEvent: process.env.GITHUB_EVENT_NAME || null, workflowRun: process.env.GITHUB_RUN_ID || null,
    workflowSha: process.env.GITHUB_SHA || null, publicAssetHashes: await publicAssetHashes(), fixtureHash,
    fixtureKind: 'Synthetic GUI data; no actual user accounts or live integrations.',
  };
}

export async function writeGuiIdentity(path) {
  const identity = await guiIdentity();
  if (process.env.CI && identity.trackedChanges)
    throw new Error(`Tracked code was changed after checkout; not an exact candidate: ${identity.trackedChanges}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const position = process.argv.indexOf('--output');
  const output = position >= 0 ? process.argv[position + 1] : 'artifacts/gui/candidate.json';
  if (!output) throw new Error('--output requires a path.');
  const identity = await writeGuiIdentity(output);
  console.log(JSON.stringify({ candidateCommit: identity.candidateCommit, candidateTree: identity.candidateTree,
    nodeVersion: identity.nodeVersion, trackedChanges: identity.trackedChanges, output }));
}
