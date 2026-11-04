import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNestEventMessage } from '../nest-events.mjs';

test('Nest SDM Pub/Sub parser recognizes chime without storing personal camera data', () => {
  const message = { resourceUpdate: { name: 'enterprises/project/devices/door', events: { 'sdm.devices.events.DoorbellChime.Chime': { eventId: 'event1', eventSessionId: 'private-session' } } }, timestamp: '2026-11-04T13:00:00Z' };
  const parsed = parseNestEventMessage({ message: { data: Buffer.from(JSON.stringify(message)).toString('base64') } });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kind, 'doorbell');
  assert.equal(parsed[0].eventId, 'event1');
  assert.equal(JSON.stringify(parsed).includes('private-session'), false);
});

test('Nest SDM parser drops unrelated and malformed messages', () => {
  assert.deepEqual(parseNestEventMessage({ message: { data: 'not-base64-json' } }), []);
  assert.deepEqual(parseNestEventMessage({ resourceUpdate: { events: { 'unknown': {} } } }), []);
});
