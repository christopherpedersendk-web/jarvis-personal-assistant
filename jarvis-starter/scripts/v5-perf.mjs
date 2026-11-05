// Same synthetic fixture/runtime/benchmark for exact baseline and candidate.
// No credentials inherited, no real integration requests, no real jobs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const app = resolve(arg('--app') || fileURLToPath(new URL('../', import.meta.url)));
const label = arg('--label') || 'candidate', output = arg('--output');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
const binding = () => ({ commit: git(['rev-parse', 'HEAD']), applicationTree: git(['rev-parse', 'HEAD:jarvis-starter']),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)artifacts', ':(exclude)node_modules'])) });
const before = binding();
assert.equal(before.dirty, false, 'Performance evidence requires a clean, committed application. Use a separate verification worktree.');
const preload = fileURLToPath(new URL('./perf-network.mjs', import.meta.url));
const benchmarkSha256 = hash(Buffer.concat([await readFile(fileURLToPath(import.meta.url)), await readFile(preload)]));
const fixed = '2026-11-05T09:00:00.000Z';
const token = 'synthetic-v5-performance-token-32-chars';
const state = { preferences: 'Syntetiske målepunkter uden personoplysninger',
  history: Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user',
    text: `Syntetisk historik ${i}: ` + 'Et fast lokalt målepunkt uden persondata. '.repeat(4), channel: 'text', at: fixed })),
  tasks: [], projects: [], organizer: Array.from({ length: 2 }, (_, n) => ({
    id: `synthetic-dates-${n}`, title: `Syntetiske datoer ${n}`, type: 'dates', archived: false, updatedAt: fixed,
    items: Array.from({ length: 200 }, (_, i) => ({ id: `datum-${n}-${i}`, text: `Begivenhed ${n * 200 + i}`, notes: '', done: false,
      date: `2027-${String(Math.floor(i / 28) % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`, updatedAt: fixed })) })),
  memories: Array.from({ length: 200 }, (_, i) => ({ id: `memory-${i}`, revision: 1,
    text: `Verificeret dansk syntetisk hukommelse om akvarel ${i}`, status: 'confirmed', confirmed: true,
    source: { kind: 'user', channel: 'manual' }, createdAt: fixed, updatedAt: fixed })),
  usage: { day: '', started: 0 }, inbox: [], approvals: [],
  settings: { remindersEnabled: false, discordAlertsEnabled: false,
    proactive: { dailyEnabled: false, weeklyEnabled: false, discordEnabled: false } } };
const fixtureText = JSON.stringify(state), fixtureSha256 = hash(fixtureText);
const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-perf-'));
await writeFile(join(dir, 'state.json'), fixtureText, { mode: 0o600 });
await mkdir(join(dir, 'projects'));
const probe = createServer();
await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const environment = {
  ...Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
  TZ: 'Europe/Copenhagen', JARVIS_HOST: '127.0.0.1', JARVIS_PORT: String(port), JARVIS_ACCESS_TOKEN: token,
  JARVIS_DATA_DIR: dir, JARVIS_PROJECT_ROOT: join(dir, 'projects'), JARVIS_UPDATE_STAGING: join(dir, 'stage'),
  JARVIS_UPDATE_REPO: '', OPENAI_API_KEY: 'sk-synthetic-performance-not-a-real-credential',
  NEMLIG_ENABLE_LIVE: 'no', NEMLIG_MCP_DIR: '', GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
  PUSHOVER_APP_TOKEN: '', PUSHOVER_USER_KEY: '', JARVIS_ALLOW_NPM_INSTALL: 'no',
  JARVIS_SYNTHETIC_PERF: 'yes', JARVIS_SYNTHETIC_WAIT_MS: '200',
};
const child = spawn(process.execPath, ['--import', preload, 'server.mjs'], { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const exited = new Promise(resolve => child.once('exit', resolve));
let errors = '', peakRss = 0, activeSimulations = 0;
const simulatedCalls = [], unexpectedNetwork = [];
child.stdout.resume(); child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
child.on('message', event => {
  if (event.type === 'perf-unexpected-network') unexpectedNetwork.push(event.destination);
  if (event.type === 'perf-model-start') { activeSimulations++; simulatedCalls.push({ ...event }); }
  if (event.type === 'perf-model-end') { activeSimulations--; Object.assign(simulatedCalls.find(x => x.number === event.number), event); }
});
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] || 0;
const round = value => Math.round(value * 1000) / 1000;
function summarize(samples) { return { requests: samples.length, p50Ms: round(percentile(samples.map(x => x.ms), 0.5)),
  p95Ms: round(percentile(samples.map(x => x.ms), 0.95)), responseBytesMedian: percentile(samples.map(x => x.bytes), 0.5) }; }
async function rss() {
  try { const status = await readFile(`/proc/${child.pid}/status`, 'utf8'); const bytes = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024;
    peakRss = Math.max(peakRss, bytes); return bytes; } catch { return null; }
}
async function request(method, path, body, allowMissing = false) {
  const started = performance.now(), response = await fetch(origin + path, { method, headers: {
    Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
  const raw = await response.text(), ms = performance.now() - started;
  if (allowMissing && response.status === 404) return null;
  assert.equal(response.ok, true, `${path}: HTTP ${response.status}: ${raw.slice(0, 200)}`);
  await rss(); return { ms, bytes: Buffer.byteLength(raw), data: JSON.parse(raw) };
}
async function sample(method, path, body, repetitions = 40, warmup = 5) {
  for (let i = 0; i < warmup; i++) await request(method, path, body?.(-i - 1));
  const values = [];
  for (let i = 0; i < repetitions; i++) values.push(await request(method, path, body?.(i)));
  return { ...summarize(values), warmupRequests: warmup };
}
let report;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(origin + '/health', { signal: AbortSignal.timeout(500) })).ok; if (ready) break; } catch { /* startup */ }
    if (child.exitCode !== null) break; await delay(50);
  }
  assert.equal(ready, true, `Synthetic server failed: ${errors}`);
  const startRssBytes = await rss();
  const fullState = await sample('GET', '/api/state');
  const bootstrapProbe = await request('GET', '/api/state?scope=bootstrap');
  const hasBoundedBootstrap = Boolean(bootstrapProbe.data.historyPagination);
  const bootstrap = hasBoundedBootstrap ? await sample('GET', '/api/state?scope=bootstrap') : null;
  const overviewProbe = await request('GET', '/api/overview', undefined, true);
  const overview = overviewProbe ? await sample('GET', '/api/overview') : null;
  const retrieval = await sample('POST', '/api/knowledge/search', () => ({ query: 'akvarel 42' }));
  const writes = await sample('POST', '/api/preferences', i => ({ text: `Syntetisk måleændring ${i}` }), 30);
  const jobsBefore = await request('GET', '/api/jobs', undefined, true);
  const activeReadRoute = hasBoundedBootstrap ? '/api/state?scope=bootstrap' : '/api/state';
  let finished = false;
  const burst = Promise.all(Array.from({ length: 3 }, (_, i) => request('POST', '/api/message', { message: `Syntetisk forespørgsel om akvarel ${i}` })))
    .finally(() => { finished = true; });
  const readsDuringBurst = []; let readsDuringModelWait = 0;
  while (!finished && readsDuringBurst.length < 240) {
    if (activeSimulations) readsDuringModelWait++;
    readsDuringBurst.push(await request('GET', activeReadRoute)); await delay(5);
  }
  const messages = await burst;
  const jobs = await request('GET', '/api/jobs', undefined, true);
  const queue = jobs?.data.jobs.filter(job => !jobsBefore.data.jobs.some(prior => prior.id === job.id)) || [];
  assert.equal(simulatedCalls.length, 3, 'No hidden model retry or additional indexing provider may run.');
  assert.equal(activeSimulations, 0); assert.deepEqual(unexpectedNetwork, [], 'All external network must be blocked.');
  if (jobs) { assert.equal(queue.length, 3); assert.ok(queue.every(job => job.state === 'completed')); }
  assert.deepEqual(binding(), before, 'Candidate changed during benchmark. Do not use these timings as evidence.');
  report = { status: 'measured', label, candidate: before, benchmarkSha256, node: process.version,
    platform: platform(), architecture: arch(), logicalCpuCount: cpus().length,
    fixture: { version: 'da-local-performance-v2', sha256: fixtureSha256, bytes: Buffer.byteLength(fixtureText),
      organizerCollections: 2, organizerItems: 400, memories: 200, historyEntries: 200, realPersonalData: false },
    methodology: 'Same fixture; five warmups per endpoint; p95 nearest-rank. Sequential local requests plus a three-message burst with strictly synthetic 200 ms model wait. No real provider latency, billing or physical-device performance is inferred.',
    fullState, bootstrap, overview, retrieval, writes,
    concurrentReads: { route: activeReadRoute, ...summarize(readsDuringBurst), samplesDuringSimulatedModelWait: readsDuringModelWait },
    syntheticModelBurst: { concurrencyRequested: 3, simulatedWaitPerCallMs: 200, messageLatency: summarize(messages),
      queueMeasured: Boolean(jobs), queue: queue.map(({ state, queuedMs, runMs }) => ({ state, queuedMs, runMs })),
      queueP95Ms: jobs ? percentile(queue.map(job => job.queuedMs), 0.95) : null,
      runP95Ms: jobs ? percentile(queue.map(job => job.runMs), 0.95) : null,
      measuredSimulatedWaitP95Ms: round(percentile(simulatedCalls.map(call => call.measuredWaitMs), 0.95)) },
    resources: { startRssBytes, peakSampledRssBytes: peakRss, memoryMetric: 'Sampled RSS, not an allocation peak or server sizing guarantee.' },
    usage: { realModelCalls: 0, syntheticModelCalls: simulatedCalls.length, toolCalls: 0, activatedRecurringJobs: 0,
      realBasketWrites: 0, unexpectedNetworkAttempts: unexpectedNetwork.length,
      modelInputCharacters: simulatedCalls.map(({ number, inputCharacters, instructionCharacters }) => ({ number, inputCharacters, instructionCharacters })),
      actualModelTokens: null, actualModelTokensReason: 'No paid model was used; characters are not tokens. Real local semantic model/provider measurements are separate.' } };
} finally {
  child.kill('SIGTERM'); await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  await rm(dir, { recursive: true, force: true });
}
if (output) { const path = resolve(output); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
console.log(JSON.stringify(report, null, 2));
