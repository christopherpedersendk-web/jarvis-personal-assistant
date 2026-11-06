import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordGateway, validateDiscordConfig } from '../discord-gateway.mjs';
import { ActionJournal } from '../action-journal.mjs';
const guildId = '223456789012345678', userId = '123456789012345678', reportChannelId = '323456789012345678', botId = '423456789012345678';
const config = { enabled: true, guildId, userId, reportChannelId, token: 'synthetic-bot-key' };
function fixture(fetcher) { const gateway = new DiscordGateway({ onMessage: async () => '', fetcher }); gateway.config = { ...config }; gateway.status = 'connected'; return gateway; }

test('report channel config requires a valid server and channel ID', () => {
  assert.equal(validateDiscordConfig(config).reportChannelId, reportChannelId);
  assert.throws(() => validateDiscordConfig({ ...config, guildId: '' }));
  assert.throws(() => validateDiscordConfig({ ...config, reportChannelId: 'invalid' }));
});
test('long report goes to configured channel, without DM or mentions, across readable chunks', async () => {
  const sent = [];
  const gateway = fixture(async (url, options) => {
    sent.push({ url, options });
    return { ok: true, json: async () => ({ id: reportChannelId, guild_id: guildId, type: 0 }) };
  });
  assert.equal(await gateway.notifyReport('Rapport\n' + ('En kilde: https://example.org\n').repeat(180)), true);
  assert.ok(sent.length > 2);
  assert.ok(sent.every(r => r.url.includes(`/channels/${reportChannelId}`)));
  for (const entry of sent.filter(r => r.options.method === 'POST')) {
    const body = JSON.parse(entry.options.body); assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.ok(body.content.length <= 1900);
  }
});
test('wrong server or non-text destination never receives a report', async () => {
  for (const wrong of [{ guild_id: '923456789012345678', type: 0 }, { guild_id: guildId, type: 2 }]) {
    let posts = 0;
    const gateway = fixture(async (url, options) => { if (options.method === 'POST') posts++; return { ok: true, json: async () => ({ id: reportChannelId, ...wrong }) }; });
    await assert.rejects(gateway.notifyReport('Private report'), /ikke en tekstkanal/); assert.equal(posts, 0);
  }
});
test('channel creation explicitly hides everyone and allows only owner/bot overrides', async () => {
  let payload;
  const gateway = fixture(async (url, options) => {
    if (url.endsWith('/users/@me')) return { ok: true, json: async () => ({ id: botId }) };
    if (!options.method) return { ok: true, json: async () => [] };
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: reportChannelId, guild_id: guildId, type: 0 }) };
  });
  await gateway.createReportChannel();
  assert.equal(payload.name, 'jarvis-rapporter'); assert.equal(payload.type, 0);
  assert.deepEqual(payload.permission_overwrites.map(o => o.id), [guildId, userId, botId]);
  assert.equal(payload.permission_overwrites[0].deny, '1024');
});
test('an existing named report channel is never duplicated or silently adopted', async () => {
  let posts = 0;
  const gateway = fixture(async (url, options) => { if (options.method) posts++; return { ok: true, json: async () => url.endsWith('/users/@me') ? { id: botId } : [{ name: 'jarvis-rapporter' }] }; });
  await assert.rejects(gateway.createReportChannel(), /findes allerede/); assert.equal(posts, 0);
});
test('uncertain channel creation is durably blocked from replay', async () => {
  let posts = 0;
  const gateway = fixture(async (url, options) => {
    if (options.method === 'POST') { posts++; throw new Error('Lost response'); }
    return { ok: true, json: async () => url.endsWith('/users/@me') ? { id: botId } : [] };
  });
  const journal = new ActionJournal({ state: {}, save: async () => {} });
  const call = { name: 'create_discord_report_channel', call_id: `reports:${guildId}:${userId}` };
  await assert.rejects(journal.invoke(call, { guildId, userId }, () => gateway.createReportChannel(), 'owner-settings'));
  await assert.rejects(journal.invoke(call, { guildId, userId }, () => gateway.createReportChannel(), 'owner-settings'), /uafklaret/);
  assert.equal(posts, 1);
});
