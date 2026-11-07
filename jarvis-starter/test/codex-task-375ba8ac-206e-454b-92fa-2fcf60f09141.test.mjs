import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLabel } from './fixtures/codex-bridge-probe.mjs';

test('compactLabel returns an empty string for null', () => {
  assert.equal(compactLabel(null), '');
});

test('compactLabel returns an empty string for undefined', () => {
  assert.equal(compactLabel(undefined), '');
});
