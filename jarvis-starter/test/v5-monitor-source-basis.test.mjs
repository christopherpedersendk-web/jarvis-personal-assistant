import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMonitorAnswer } from '../monitor-observation.mjs';
import { TaskEngine } from '../task-engine.mjs';

const SOURCE = 'https://vendor-a.example.test/product/123?variant=500g';
const sample = (changes = {}) => ({ subject: 'Syntetisk kaffe', variant: '500 g', unit: 'DKK', value: 20,
  source: SOURCE, ...changes });
const answer = changes => JSON.stringify({ summary: 'Modeludtræk af den angivne kilde.', observation: sample(changes) });
const first = () => reviewMonitorAnswer(answer()).observation;

test('H3 a different vendor or precise product/variant URL creates an unknown basis, never unchanged', () => {
  for (const source of ['https://vendor-b.example.test/product/123?variant=500g',
    'https://vendor-a.example.test/product/999?variant=500g',
    'https://vendor-a.example.test/product/123?variant=1000g']) {
    const result = reviewMonitorAnswer(answer({ source }), first());
    assert.equal(result.observation.status, 'unknown');
    assert.equal(result.observation.value, 20, 'a usable current value is retained as a new, non-comparable baseline');
    assert.equal(result.observation.source, source);
    assert.match(result.summary, /[Kk]ild.*ændret/);
    assert.doesNotMatch(result.summary, /verificerbar|verificeret|bekræftet/, 'URL shape alone does not verify a source read');
    assert.equal(reviewMonitorAnswer(answer({ source }), result.observation).observation.status, 'unchanged');
  }
});

test('H3 a changed source cannot be called a price change even when its value differs', () => {
  const result = reviewMonitorAnswer(answer({ source: 'https://vendor-b.example.test/product/123', value: 99 }), first());
  assert.equal(result.observation.status, 'unknown');
  assert.equal(result.observation.value, 99);
  assert.match(result.summary, /grundlag|sammenlign/);
});

test('H3 same-source subject, variant, unit or value-type changes are explicitly non-comparable', () => {
  for (const change of [{ subject: 'Syntetisk te' }, { variant: '1000 g' }, { unit: 'EUR' }, { value: '20' }]) {
    const result = reviewMonitorAnswer(answer(change), first());
    assert.equal(result.observation.status, 'unknown');
    assert.match(result.summary, /[Gg]rundlag|[Ss]ammenlign/);
  }
  const same = reviewMonitorAnswer(answer(), first());
  assert.equal(same.observation.status, 'unchanged');
  assert.equal(reviewMonitorAnswer(answer({ value: 99 }), same.observation).observation.status, 'changed');
  assert.equal(reviewMonitorAnswer(answer({ value: 0 }), same.observation).observation.status, 'changed', 'zero is valid data, not a missing value');
});

test('H3 a malformed or missing previous value is not valid comparison evidence', () => {
  for (const previous of [{ ...first(), value: undefined }, { ...first(), value: null }, { ...first(), value: NaN },
    { ...first(), value: '' }, { ...first(), source: 'https://' }, { ...first(), source: 'https://user:secret@example.test' }]) {
    const result = reviewMonitorAnswer(answer(), previous);
    assert.equal(result.observation.status, 'unknown');
    assert.doesNotMatch(result.summary, /verificerbar|verificeret|bekræftet/);
  }
});

test('H3 missing, invalid or explicitly unknown current reads cannot carry an old value into a comparable baseline', () => {
  for (const change of [{ value: '' }, { value: '   ' }, { value: null }, { source: 'https://user:secret@example.test' },
    { subject: 'a'.repeat(241) }, { variant: 'b'.repeat(241) }, { unit: 'c'.repeat(41) },
    { value: 'd'.repeat(241) }, { source: `https://example.test/${'e'.repeat(1000)}` }, { status: 'unknown', value: 20 }]) {
    const result = reviewMonitorAnswer(answer(change), first());
    assert.equal(result.observation.status, 'unknown');
    assert.equal(result.observation.value ?? null, null);
    assert.match(result.summary, /ukendt/);
  }
  const modelClaim = reviewMonitorAnswer(answer({ status: 'unchanged', value: 99 }), first());
  assert.equal(modelClaim.observation.status, 'changed', 'model-written change labels never override deterministic comparison');
});

test('H3 changed-source unknown observations remain visible in job history and are not suppressed as unchanged', async () => {
  const state = {};
  let now = new Date('2026-11-05T10:00:00Z');
  let reads = 0;
  const notices = [];
  const secondSource = 'https://vendor-b.example.test/product/123?variant=500g';
  const engine = new TaskEngine({ state, save: async () => {}, now: () => now,
    runTask: async task => reviewMonitorAnswer(answer({ source: reads++ ? secondSource : SOURCE }),
      task.runs.find(run => run.observation?.value !== null)?.observation),
    notify: async (_task, status) => { notices.push(status); } });
  const task = await engine.create({ title: 'Syntetisk prisgrundlag', prompt: 'Læs syntetiske observationer',
    category: 'monitor', intervalMinutes: 60 });
  for (const hour of [10, 11, 12]) {
    now = new Date(`2026-11-05T${hour}:00:00Z`);
    await engine.tick();
  }
  assert.equal(reads, 3);
  assert.deepEqual(task.runs.map(run => run.observation.status), ['unchanged', 'unknown', 'unknown']);
  assert.equal(task.runs[1].observation.source, secondSource);
  assert.match(task.runs[1].result, /[Kk]ild.*ændret/);
  assert.deepEqual(notices, ['unknown', 'unknown']);
  assert.equal(task.runs[0].delivery.status, 'skipped');
  assert.equal(task.runs[1].delivery.status, 'delivered');
  assert.equal(task.status, 'scheduled', 'a new baseline is not a failed external write or a reason to disable recurrence');
});
