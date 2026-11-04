// Reproducible synthetic, local-only benchmark. Run once against the exact
// v4.9.1 archive and once against the v5 candidate; no external credentials.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const app = resolve(process.argv.includes('--app')
  ? process.argv[process.argv.indexOf('--app') + 1] : new URL('../', import.meta.url).pathname);
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'candidate';
const token = 'synthetic-v5-performance-token-32-chars';
const dir = await mkdtemp(join(tmpdir(), 'jarvis-v5-perf-'));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const organizer = [{ id: 'synthetic-dates', title: 'Kildedata', type: 'dates', archived: false,
  items: Array.from({ length: 400 }, (_, i) => ({ id: `datum-${i}`, text: `Begivenhed ${i}`,
    date: `2027-${String(Math.floor(i / 28) % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}` })) }];
const state = { preferences: 'syntetiske målepunkter', history: [], tasks: [], projects: [],
  organizer, memories: Array.from({ length: 200 }, (_, i) => ({ id: `memory-${i}`, text: `Verificeret dansk syntetisk hukommelse om akvarel ${i}`,
    status: 'confirmed', confirmed: true, source: { kind: 'user', channel: 'manual' } })),
  usage: { day: '', started: 0 }, inbox: [], approvals: [], settings: {} };
await writeFile(join(dir, 'state.json'), JSON.stringify(state), { mode: 0o600 });
await mkdir(join(dir, 'projects'));
const env = {
  ...Object.fromEntries(['PATH','TMPDIR','TEMP','TMP'].filter(x => process.env[x]).map(x => [x, process.env[x]])),
  TZ: 'Europe/Copenhagen', JARVIS_HOST: '127.0.0.1', JARVIS_PORT: String(port), JARVIS_ACCESS_TOKEN: token,
  JARVIS_DATA_DIR: dir, JARVIS_PROJECT_ROOT: join(dir, 'projects'), JARVIS_UPDATE_STAGING: join(dir, 'stage'),
  JARVIS_UPDATE_REPO: '', OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OWN_KEY', NEMLIG_ENABLE_LIVE: 'no',
  GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', PUSHOVER_APP_TOKEN: '', JARVIS_ALLOW_NPM_INSTALL: 'no',
};
const child = spawn(process.execPath, ['server.mjs'], { cwd: app, env, stdio: ['ignore','pipe','pipe'] });
let stderr = ''; child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-1000); });
const sorted = values => [...values].sort((a, b) => a - b);
const p95 = values => sorted(values)[Math.ceil(values.length * 0.95) - 1];
async function sample(method, path, body, repetitions) {
  const times = [], sizes = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    const response = await fetch(origin + path, { method, headers: {
      Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body(i)) } : {}), signal: AbortSignal.timeout(4000) });
    const contents = await response.text();
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${contents.slice(0, 160)}`);
    times.push(performance.now() - started);
    sizes.push(Buffer.byteLength(contents));
  }
  return { requests: repetitions, p95Ms: Number(p95(times).toFixed(2)), medianMs: Number(sorted(times)[Math.floor(times.length / 2)].toFixed(2)),
    responseBytesMedian: sorted(sizes)[Math.floor(sizes.length / 2)] };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(origin + '/health')).ok; if (ready) break; } catch { /* server startup */ }
    if (child.exitCode !== null) break;
    await delay(50);
  }
  if (!ready) throw new Error(`Server not ready: ${stderr}`);
  const fullState = await sample('GET', '/api/state', null, 30);
  let overview = null;
  const probe = await fetch(origin + '/api/overview', { headers: { Authorization: `Bearer ${token}` } });
  if (probe.ok) overview = await sample('GET', '/api/overview', null, 30);
  const retrieval = await sample('POST', '/api/knowledge/search', () => ({ query: 'akvarel 42' }), 30);
  const writes = await sample('POST', '/api/preferences', i => ({ text: `syntetisk ændring ${i}` }), 12);
  const memory = await readFile(`/proc/${child.pid}/status`, 'utf8');
  const rssKiB = Number(memory.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0);
  console.log(JSON.stringify({ label, app, node: process.version, fixture: { organizerItems: 400, memories: 200 },
    fullState, overview, retrieval, writes, processRssMiB: Number((rssKiB / 1024).toFixed(1)),
    externalWait: 'not measured; all integrations disabled', modelCalls: 0 }, null, 2));
} finally { child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
