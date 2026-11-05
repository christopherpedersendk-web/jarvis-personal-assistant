import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMonitorAnswer } from '../monitor-observation.mjs';

const observation = value => JSON.stringify({ summary: `Prisen er ${value} DKK.`, observation: {
  subject: 'Mærkevare', variant: '500 g', value, unit: 'DKK', source: 'https://example.com/produkt/123' } });

test('monitor comparison is deterministic and the first source observation is an unknown baseline', () => {
  const first = reviewMonitorAnswer(observation(20));
  assert.equal(first.observation.status, 'unknown');
  const unchanged = reviewMonitorAnswer(observation(20), first.observation);
  assert.equal(unchanged.observation.status, 'unchanged');
  const changed = reviewMonitorAnswer(observation(99), unchanged.observation);
  assert.equal(changed.observation.status, 'changed');
  assert.equal(changed.observation.value, 99);
  assert.equal(changed.observation.source, 'https://example.com/produkt/123');
});

test('monitor failures, missing prices, missing URLs and unstructured model text cannot claim no change', () => {
  const known = reviewMonitorAnswer(observation(20)).observation;
  for (const content of ['NO_CHANGE: fejlet netværkskald', '', '{}',
    JSON.stringify({ summary: 'Ingen kildedata', observation: { subject: 'Mærkevare', source: '', value: null } }),
    JSON.stringify({ summary: 'Ingen kilde', observation: { subject: 'Mærkevare', source: 'ikke-verificeret', value: 20 } })]) {
    const result = reviewMonitorAnswer(content, known);
    assert.equal(result.observation.status, 'unknown');
  }
});
