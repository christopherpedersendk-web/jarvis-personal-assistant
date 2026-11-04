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
