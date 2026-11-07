// Protected acceptance for the bounded live Codex connection probe.
import test from 'node:test';import assert from 'node:assert/strict';
import {compactLabel} from './fixtures/codex-bridge-probe.mjs';
test('Codex probe normalizes whitespace without losing Danish text or prices',()=>{assert.equal(compactLabel('  Hvidt  kabel\n 57,00 kr.  '),'Hvidt kabel 57,00 kr.');assert.equal(compactLabel('æøå'),'æøå');assert.equal(compactLabel(''),'');});
