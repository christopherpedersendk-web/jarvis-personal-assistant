import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordGateway, authorizedDiscordMessage, splitDiscordMessage, validateDiscordConfig } from '../discord-gateway.mjs';

const userId = '123456789012345678';
const guildId = '223456789012345678';
const channelId = '323456789012345678';
const event = { id: '423456789012345678', author: { id: userId }, channel_id: channelId, content: 'Hvad står der på min indkøbsliste?' };

test('Discord adgang begrænses til ejer og eventuelt privat server', () => {
  assert.equal(authorizedDiscordMessage(event, { userId }), true);
  assert.equal(authorizedDiscordMessage({ ...event, author: { id: '999999999999999999' } }, { userId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, author: { id: userId, bot: true } }, { userId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, guild_id: guildId }, { userId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, guild_id: guildId }, { userId, guildId }), true);
  assert.equal(authorizedDiscordMessage({ ...event, guild_id: '999999999999999999' }, { userId, guildId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, content: ' ' }, { userId }), false);
  assert.throws(() => validateDiscordConfig({ userId: 'invalid' }));
});

test('Discord beskeder opdeles så Discords længdegrænse overholdes', () => {
  const parts = splitDiscordMessage('A'.repeat(4500));
  assert.deepEqual(parts.map(part => part.length), [1900, 1900, 700]);
});

test('Discord sender kun svar på en autoriseret besked og uden mentions', async () => {
  const sent = [];
  const gateway = new DiscordGateway({
    onMessage: async message => `Svar til: ${message}`,
    fetcher: async (url, options) => { sent.push({ url, ...options }); return { ok: true }; },
  });
  gateway.config = { userId, token: 'secret-test-bot-token' };
  assert.equal(await gateway.handleIncoming({ ...event, author: { id: '999999999999999999' } }), false);
  assert.equal(await gateway.handleIncoming(event), true);
  assert.equal(await gateway.handleIncoming(event), false, 'replay should be ignored');
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, new RegExp(`/channels/${channelId}/messages$`));
  assert.deepEqual(JSON.parse(sent[0].body).allowed_mentions, { parse: [] });
});


test('Discord rejected-message diagnostics explain owner/server/content mismatches without leaking message text', async () => {
  const gateway = new DiscordGateway({ onMessage: async () => { throw new Error('must not run'); } });
  gateway.config = { userId, guildId };
  for (const [incoming, reason] of [
    [{ ...event, author: { id: '999999999999999999' } }, 'user'],
    [{ ...event, guild_id: '999999999999999999' }, 'guild'],
    [{ ...event, content: '', guild_id: guildId }, 'empty'],
  ]) {
    assert.equal(await gateway.handleIncoming(incoming), false);
    assert.equal(gateway.snapshot().lastIncoming.reason, reason);
    assert.equal(gateway.snapshot().lastIncoming.accepted, false);
  }
  assert.equal(JSON.stringify(gateway.snapshot()).includes(event.content), false);
});

test('Discord assistant failure sends one useful warning, retains unknown outcome and never repeats the action', async () => {
  let calls = 0; const sent = [];
  const gateway = new DiscordGateway({
    onMessage: async () => { calls++; throw new Error('private upstream error'); },
    fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; }, logger: { error() {} },
  });
  gateway.config = { userId, token: 'synthetic-token' };
  assert.equal(await gateway.handleIncoming(event), true);
  assert.equal(sent.length, 1); assert.match(sent[0].content, /noget kan allerede være udført/);
  assert.equal(gateway.snapshot().lastFailure.stage, 'processing');
  assert.equal(JSON.stringify(gateway.snapshot()).includes('private upstream error'), false);
  assert.equal(gateway.seen.get(event.id).status, 'unknown');
  assert.equal(await gateway.handleIncoming(event), false); assert.equal(calls, 1);
});

test('Discord ambiguous delivery never sends a second warning or repeats the action', async () => {
  let calls = 0, sends = 0;
  const gateway = new DiscordGateway({ onMessage: async () => { calls++; return 'Svar'; },
    fetcher: async () => { sends++; throw new Error('ambiguous network failure'); }, logger: { error() {} } });
  gateway.config = { userId, token: 'synthetic-token' };
  assert.equal(await gateway.handleIncoming(event), true);
  assert.equal(sends, 1); assert.equal(gateway.snapshot().lastFailure.stage, 'delivery');
  assert.equal(await gateway.handleIncoming(event), false); assert.equal(calls, 1);
});

test('Discord empty assistant result is a visible failure instead of a false successful reply', async () => {
  const sent = [];
  const gateway = new DiscordGateway({ onMessage: async () => '  ',
    fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; }, logger: { error() {} } });
  gateway.config = { userId, token: 'synthetic-token' };
  await gateway.handleIncoming(event);
  assert.equal(sent.length, 1); assert.match(sent[0].content, /kunne ikke færdiggøre/);
  assert.equal(gateway.snapshot().lastFailure.code, 'DISCORD_EMPTY_REPLY');
  assert.equal(gateway.snapshot().lastMessageAt, null);
});


test('invalid saved Discord IDs remain a visible integration error without throwing during server startup', () => {
  let connections = 0;
  const gateway = new DiscordGateway({ socketFactory: () => { connections++; throw new Error('must not connect'); } });
  assert.doesNotThrow(() => gateway.start({ enabled: true, token: 'synthetic-token', userId: 'not-an-id' }));
  assert.equal(gateway.snapshot().status, 'error'); assert.match(gateway.snapshot().lastError, /User ID/);
  assert.equal(connections, 0); assert.equal(gateway.snapshot().dedupeStatus, 'inactive');
  gateway.stop();
});
