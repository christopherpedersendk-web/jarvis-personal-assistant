import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { LocalSemanticProvider } from '../local-semantic-provider.mjs';
import { IncrementalSemanticIndex } from '../semantic-index.mjs';
import { PersonalKnowledge, indexPersonalKnowledge, HYBRID_RETRIEVAL_STRATEGY } from '../personal-knowledge.mjs';
import { LOCAL_SEMANTIC_MODEL } from '../semantic-model-manifest.mjs';
import { DANISH_MEMORY_QUESTIONS, DANISH_MEMORY_SAFETY_QUESTIONS, EVALUATION_NOW,
  EVALUATION_VERSION, makeDanishMemoryEvaluationState } from './fixtures/danish-memory-evaluation.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] || 0;
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const directory = arg('--model-directory') || process.env.JARVIS_LOCAL_EMBEDDING_DIR;
const output = arg('--output');
const provider = directory ? new LocalSemanticProvider({ directory: resolve(directory), requestTimeoutMs: 30_000 }) : null;
const lag = monitorEventLoopDelay({ resolution: 10 });
let report;

try {
  if (!provider) throw new Error('Den ægte modeltest mangler --model-directory. Den må ikke tælles som bestået via en mock.');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const candidateCommit = git(['rev-parse', 'HEAD']);
  const applicationTree = git(['rev-parse', 'HEAD:jarvis-starter']);
  const workingTreeDirty = Boolean(git(['status', '--porcelain', '--untracked-files=no']));
  assert.equal(workingTreeDirty, false, 'Den bindende modelmåling skal køres på en committet kandidat.');
  const datasetSha256 = createHash('sha256').update(await readFile(new URL('./fixtures/danish-memory-evaluation.mjs', import.meta.url))).digest('hex');
  assert.equal(DANISH_MEMORY_QUESTIONS.length, 80);
  assert.equal(DANISH_MEMORY_SAFETY_QUESTIONS.length, 16);
  const state = makeDanishMemoryEvaluationState();
  const now = () => new Date(EVALUATION_NOW);
  const index = new IncrementalSemanticIndex({ embedBatch: provider.embedBatch.bind(provider) });
  let scores = {};
  const knowledge = new PersonalKnowledge({ state, now,
    semanticScorer: async (...args) => (scores = await index.score(...args)) });
  lag.enable();
  const startRss = process.memoryUsage().rss;
  let peakSampledRss = startRss;
  const started = performance.now();
  // Exercise the application's real default deadline before any explicit
  // warm-up. Cold startup may honestly fall back, but it must recover to a
  // normal-deadline warm read without changing the retrieval acceptance set.
  const coldIndex = new IncrementalSemanticIndex({ embedBatch: provider.embedBatch.bind(provider) });
  const coldKnowledge = new PersonalKnowledge({ state, now, semanticScorer: coldIndex.score.bind(coldIndex) });
  const coldReadAt = performance.now();
  const coldPending = coldKnowledge.retrieve('fredslilje', { limit: 5 });
  await Promise.resolve(); // Let the query itself initiate the lazy worker.
  const initialReady = provider.prepare().then(() => ({ at: performance.now() }), error => ({ error }));
  const coldResult = await coldPending;
  const coldReadMs = performance.now() - coldReadAt;
  const stateAfterColdRead = provider.stats().status;
  const ready = await initialReady;
  if (ready.error) throw ready.error;
  assert.ok(['local-hybrid', 'local-lexical'].includes(coldResult.mode));
  assert.ok(coldResult.matches.some(doc => doc.id === 'memory:plant'), 'En kold model må ikke ødelægge den lokale ordsøgning.');
  if (coldResult.mode === 'local-lexical') assert.equal(coldResult.semantic.status, 'timeout');
  const coldLoadMs = ready.at - started;
  await provider.prepare();
  const defaultWarmAt = performance.now();
  const defaultWarm = await coldKnowledge.retrieve('fredslilje', { limit: 5 });
  const defaultWarmReadMs = performance.now() - defaultWarmAt;
  assert.equal(defaultWarm.mode, 'local-hybrid', 'En klargjort ægte model skal virke med normal 1500 ms deadline.');
  assert.equal(provider.stats().network, 'disabled');
  coldIndex.cache.clear();
  const documents = indexPersonalKnowledge(state, { now: now() });
  const indexStarted = performance.now();
  await index.score('Klargør den syntetiske test', documents.map(doc => ({ id: doc.id, text: doc.text, revision: doc.source.revision || 0 })));
  const initialIndexMs = performance.now() - indexStarted;
  const originalIndexCount = index.stats().embeddedDocuments;
  const cases = [], latencies = [];
  for (const entry of [...DANISH_MEMORY_QUESTIONS, ...DANISH_MEMORY_SAFETY_QUESTIONS]) {
    const lexicalIds = knowledge.search(entry.question, { limit: 5 }).map(doc => doc.id);
    const begin = performance.now();
    const retrieved = await knowledge.retrieve(entry.question, { limit: 5, semanticTimeoutMs: 10_000 });
    latencies.push(performance.now() - begin);
    peakSampledRss = Math.max(peakSampledRss, process.memoryUsage().rss);
    assert.equal(retrieved.mode, 'local-hybrid', `Ægte semantisk søgning var utilgængelig for ${entry.id}: ${retrieved.semantic.status}`);
    assert.equal(retrieved.answerability, 'sources-only', 'Søgning er kilder, ikke en automatisk påstand om et svar.');
    const hybridIds = retrieved.matches.map(doc => doc.id);
    const vectorIds = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([id]) => id);
    const leaked = hybridIds.filter(id => entry.forbidden?.includes(id));
    cases.push({ id: entry.id, category: entry.category, question: entry.question,
      relevant: entry.relevant, lexicalTop5: lexicalIds, vectorTop5: vectorIds, hybridTop5: hybridIds,
      lexicalHit: entry.relevant.length ? entry.relevant.some(id => lexicalIds.includes(id)) : null,
      vectorHit: entry.relevant.length ? entry.relevant.some(id => vectorIds.includes(id)) : null,
      hybridHit: entry.relevant.length ? entry.relevant.some(id => hybridIds.includes(id)) : null,
      invalidSourceLeaks: leaked,
    });
  }
  assert.equal(index.stats().embeddedDocuments, originalIndexCount, 'Uændrede dokumenter må ikke genindekseres for hvert spørgsmål.');
  const relevant = cases.filter(entry => entry.relevant.length);
  const count = field => relevant.filter(entry => entry[field]).length;
  // Exercise correction and forgetting with the real model, not only a stub.
  const corrected = state.memories.find(item => item.id === 'commute');
  corrected.text = 'Jeg pendler nu med sporvogn til kontoret og tager ikke længere cyklen.';
  corrected.revision++;
  const changed = await knowledge.retrieve('Hvordan kommer jeg normalt hen på arbejde?', { limit: 5, semanticTimeoutMs: 10_000 });
  assert.ok(changed.matches.some(doc => doc.id === 'memory:commute' && doc.source.revision === 2 && doc.text === corrected.text));
  assert.equal(index.stats().embeddedDocuments, originalIndexCount + 1, 'En rettelse genindekserer kun den ændrede kilde.');
  corrected.archived = true;
  assert.ok(!(await knowledge.searchHybrid('Hvordan kommer jeg på arbejde?', { semanticTimeoutMs: 10_000 })).some(doc => doc.id === 'memory:commute'));
  assert.ok(!index.cache.has('memory:commute'));
  const beforeFallback = provider.stats();
  await provider.close();
  const fallback = await knowledge.retrieve('fredslilje', { limit: 5, semanticTimeoutMs: 50 });
  assert.equal(fallback.mode, 'local-lexical');
  assert.ok(fallback.matches.some(doc => doc.id === 'memory:plant'));
  lag.disable();
  report = {
    status: count('hybridHit') / relevant.length >= 0.9 && cases.every(entry => !entry.invalidSourceLeaks.length) ? 'passed' : 'failed',
    candidateCommit, applicationTree, workingTreeDirty, datasetVersion: EVALUATION_VERSION, datasetSha256,
    runtime: process.version, embeddingRuntime: `${LOCAL_SEMANTIC_MODEL.runtime}@${LOCAL_SEMANTIC_MODEL.runtimeVersion}`,
    model: LOCAL_SEMANTIC_MODEL.id, modelRevision: LOCAL_SEMANTIC_MODEL.revision, modelFiles: LOCAL_SEMANTIC_MODEL.files,
    synthetic: true, externalPersonalDataProcessing: false, remoteModelCalls: 0,
    metric: 'correct-source-retrieval@5; ikke måling af genererede svars faktuelle korrekthed',
    threshold: 0.9, fusionStrategy: HYBRID_RETRIEVAL_STRATEGY, relevantQuestions: relevant.length, safetyQuestions: cases.length - relevant.length,
    lexicalHits: count('lexicalHit'), vectorHits: count('vectorHit'), hybridHits: count('hybridHit'),
    lexicalRecallAt5: count('lexicalHit') / relevant.length,
    vectorRecallAt5: count('vectorHit') / relevant.length,
    hybridRecallAt5: count('hybridHit') / relevant.length,
    invalidSourceLeaks: cases.flatMap(entry => entry.invalidSourceLeaks).length,
    missingEvidencePolicy: 'Spørgsmål uden gyldig kilde indgår ikke i recall. Kandidater er ikke bekræftede svar; ugyldige/konfliktende kilder må aldrig genopstå.',
    correction: 'passed', forgetting: 'passed', providerUnavailableFallback: 'passed',
    defaultDeadline: { budgetMs: 1500, coldMode: coldResult.mode, coldSemanticStatus: coldResult.semantic.status,
      coldReadMs, providerStateAfterColdRead: stateAfterColdRead, warmMode: defaultWarm.mode, warmReadMs: defaultWarmReadMs },
    measurements: { documents: documents.length, coldLoadMs, initialIndexMs,
      warmRetrievalP50Ms: percentile(latencies, 0.5), warmRetrievalP95Ms: percentile(latencies, 0.95),
      eventLoopP95Ms: lag.percentile(95) / 1e6, startRssBytes: startRss, peakSampledRssBytes: peakSampledRss,
      totalMs: performance.now() - started },
    index: index.stats(), provider: beforeFallback, cases,
  };
  if (report.status !== 'passed') process.exitCode = 1;
} catch (error) {
  report = { status: 'failed', reason: error.message, genuineModelAcceptance: 'not-established' };
  process.exitCode = 1;
} finally {
  lag.disable(); await provider?.close();
}

if (output) {
  const target = resolve(output); await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
const { cases, ...summary } = report;
console.log(JSON.stringify({ ...summary, failingCases: cases?.filter(entry => entry.hybridHit === false || entry.invalidSourceLeaks.length) }, null, 2));
