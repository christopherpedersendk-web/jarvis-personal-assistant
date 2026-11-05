import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SettingsReview, checkedHttpsUrl } from '../settings-review.mjs';
import { redactSecrets } from '../privacy.mjs';

const settings = () => ({ maxRunsPerDay: 10, remindersEnabled: true, discordAlertsEnabled: false,
  httpsUrl: 'https://synthetic.invalid', pushToken: 'synthetic-private-push-token', pushUser: 'synthetic-private-user-key' });
const discord = () => ({ enabled: false, token: 'synthetic-private-bot-token', userId: '123456789012345678', guildId: '' });
const inputFor = (review, scope, current, patch) => ({ patch,
  expectedBasis: Object.fromEntries(Object.keys(patch).map(field => [field, review.basis(scope, current)[field]])) });
const fails = (operation, code = 'VALIDATION_ERROR', status = 400) => assert.throws(operation,
  error => error.code === code && error.status === status);

test('R02 settings review uses field- and scope-bound HMAC wrappers, not exposed secret hashes', () => {
  const review = new SettingsReview(Buffer.alloc(32, 7)), values = settings();
  const basis = review.basis('settings', values);
  for (const [field, token] of Object.entries(basis)) {
    assert.deepEqual(Object.keys(token), ['digest']);
    assert.match(token.digest, /^[0-9a-f]{64}$/);
    assert.notEqual(token.digest, createHash('sha256').update(String(values[field])).digest('hex'));
  }
  assert.deepEqual(redactSecrets(basis, Object.values(values).filter(x => typeof x === 'string')), basis,
    'ordinary strict response redaction preserves wrapper objects, not plaintext secrets');
  assert.equal(redactSecrets({ pushToken: values.pushToken }).pushToken, '[hemmelighed skjult]');
  assert.notEqual(review.digest('settings', 'pushToken', 'same'), review.digest('settings', 'pushUser', 'same'));
  assert.notEqual(review.digest('settings', 'enabled', false), review.digest('discord', 'enabled', false));
  assert.equal(JSON.stringify(basis).includes(values.pushToken), false);
});

test('R02 stale disjoint field edits remain valid and never return a full stale settings object', () => {
  const review = new SettingsReview(), current = settings();
  const budget = inputFor(review, 'settings', current, { maxRunsPerDay: 7 });
  const url = inputFor(review, 'settings', current, { httpsUrl: 'https://second-synthetic.invalid' });
  Object.assign(current, review.patch('settings', current, budget));
  const checked = review.patch('settings', current, url);
  assert.deepEqual(checked, url.patch);
  Object.assign(current, checked);
  assert.equal(current.maxRunsPerDay, 7);
  assert.equal(current.pushToken, settings().pushToken);
  assert.equal(current.discordAlertsEnabled, false);
});

test('R02 same-field conflict rejects the entire patch without mutating current data', () => {
  const review = new SettingsReview(), current = settings();
  const input = inputFor(review, 'settings', current, { httpsUrl: 'https://replacement.invalid', maxRunsPerDay: 7 });
  current.maxRunsPerDay = 9;
  const before = structuredClone(current);
  fails(() => review.patch('settings', current, input), 'REVISION_CONFLICT', 409);
  assert.deepEqual(current, before);
});

test('R02 restart and changed secret invalidate old review without revealing either secret', () => {
  const first = new SettingsReview(), restarted = new SettingsReview(), current = discord();
  const input = inputFor(first, 'discord', current, { token: 'synthetic-new-bot-token' });
  fails(() => restarted.patch('discord', current, input), 'REVISION_CONFLICT', 409);
  current.token = 'synthetic-outside-bot-token';
  assert.throws(() => first.patch('discord', current, input), error => {
    assert.equal(error.status, 409);
    for (const secret of [current.token, input.patch.token, discord().token]) assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('R02 review requires exact patch/basis sets and correctly shaped, non-spoofed digests', () => {
  const review = new SettingsReview(), current = settings();
  const valid = inputFor(review, 'settings', current, { maxRunsPerDay: 7 });
  const cases = [null, [], {}, { ...valid, unexpected: true }, { patch: {}, expectedBasis: {} },
    { ...valid, expectedBasis: {} }, { ...valid, expectedBasis: { ...valid.expectedBasis, httpsUrl: {} } },
    { patch: { arbitraryPermission: true }, expectedBasis: { arbitraryPermission: { digest: '0'.repeat(64) } } },
    ...['', 'a'.repeat(63), 'G'.repeat(64), 'A'.repeat(64), 123, null,
      { digest: 'a'.repeat(64), extra: true }, { digest: 'a'.repeat(64), constructor: {} }]
      .map(value => ({ ...valid, expectedBasis: { maxRunsPerDay: value } })),
    JSON.parse('{"patch":{"__proto__":true},"expectedBasis":{"__proto__":{"digest":"' + 'a'.repeat(64) + '"}}}'),
  ];
  for (const input of cases) fails(() => review.patch('settings', current, input));
  fails(() => review.patch('settings', current, { ...valid, expectedBasis: { maxRunsPerDay: { digest: '0'.repeat(64) } } }), 'REVISION_CONFLICT', 409);
  assert.deepEqual(current, settings());
});

test('R02 review never coerces boolean activations or permits empty/newline-only credentials', () => {
  const review = new SettingsReview(), current = settings();
  for (const patch of [{ remindersEnabled: 'false' }, { discordAlertsEnabled: 1 }, { maxRunsPerDay: '7' },
    { maxRunsPerDay: 0 }, { maxRunsPerDay: 101 }, { maxRunsPerDay: 1.5 }, { pushToken: '' },
    { pushUser: '\n\t ' }, { pushToken: 'a'.repeat(201) }, { pushUser: {} }])
    fails(() => review.patch('settings', current, inputFor(review, 'settings', current, patch)));
  for (const patch of [{ enabled: 'true' }, { token: ' ' }, { token: 'a'.repeat(301) }, { userId: null }, { guildId: 'a'.repeat(26) }])
    fails(() => review.patch('discord', discord(), inputFor(review, 'discord', discord(), patch)));
  const patch = review.patch('discord', discord(), inputFor(review, 'discord', discord(), { token: '  synthetic-new-key  ' }));
  assert.deepEqual(patch, { token: 'synthetic-new-key' });
  assert.equal(Object.hasOwn(patch, 'enabled'), false, 'saving a credential is not an activation decision');
});

test('R02 HTTPS validation rejects user information, schemes, malformed and oversized URLs', () => {
  for (const value of ['http://synthetic.invalid', 'https://username:password@synthetic.invalid',
    'https://username@synthetic.invalid', 'https://%75ser@synthetic.invalid', 'https://synthetic.invalid/a b',
    'javascript:alert(1)', 'not a URL', 'https://' + 'a'.repeat(501), null, {}]) fails(() => checkedHttpsUrl(value));
  assert.equal(checkedHttpsUrl('  https://synthetic.invalid/path  '), 'https://synthetic.invalid/path');
  assert.equal(checkedHttpsUrl('  '), '');
});

test('H2/R02 proactive review binds only the seven policy fields, validates clocks and requires explicit booleans', () => {
  const review = new SettingsReview(), current = { dailyEnabled: false, weeklyEnabled: false, discordEnabled: false,
    dailyTime: '07:30', weeklyTime: '18:00', quietStart: '22:00', quietEnd: '07:00' };
  const input = inputFor(review, 'proactive', current, { dailyTime: '08:15' });
  assert.deepEqual(review.patch('proactive', current, input), { dailyTime: '08:15' });
  assert.equal(current.dailyEnabled, false); assert.equal(current.discordEnabled, false);
  for (const patch of [{ dailyTime: '8:15' }, { weeklyTime: '24:00' }, { quietEnd: '07:60' }, { quietStart: '22:00Z' },
    { dailyEnabled: 'true' }, { weeklyEnabled: 1 }, { discordEnabled: null }, { timeZone: 'UTC' }]) {
    fails(() => review.patch('proactive', current, inputFor(review, 'proactive', current, patch)));
  }
  current.weeklyTime = '19:00'; assert.deepEqual(review.patch('proactive', current, input), { dailyTime: '08:15' });
  current.dailyTime = '09:00'; fails(() => review.patch('proactive', current, input), 'REVISION_CONFLICT', 409);
});
