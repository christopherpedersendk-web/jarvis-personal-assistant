import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordGateway } from '../discord-gateway.mjs';

const userId = '123456789012345678';
const channelId = '223456789012345678';
const config = { enabled: true, token: 'synthetic-test-bot-token', userId };

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  emit(name, value) { for (const callback of this.listeners.get(name) || []) callback(value); }
  packet(value) { this.emit('message', { data: JSON.stringify(value) }); }
  send(content) { this.sent.push(JSON.parse(content)); }
  close(code = 1000) {
    this.readyState = 3;
    this.emit('close', { code });
  }
}

async function protocolFixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-discord-'));
  const sockets = [];
  const scheduled = [];
  const gateway = new DiscordGateway({
    onMessage: async () => 'Synthetic answer',
    fetcher: async () => ({ ok: true }),
    socketFactory: url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    scheduleRetry: (callback, ms) => {
      const timer = { callback, ms, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    dataDirectory: root,
    ...extra,
  });
  t.after(() => gateway.stop());
  gateway.start(config);
  await gateway.dedupeReady;
  return { root, sockets, scheduled, gateway };
}

function message(id = '323456789012345678') {
  return { id, author: { id: userId }, channel_id: channelId, content: 'Gem det som en note' };
}

test('R12 heartbeat ACK watchdog, immediate server-requested heartbeat and visible reconnect', async t => {
  const { gateway, sockets, scheduled } = await protocolFixture(t);
  const socket = sockets[0];
  socket.packet({ op: 10, d: { heartbeat_interval: 1000 }, s: null });
  assert.equal(socket.sent[0].op, 2, 'HELLO must identify without a prior session');

  socket.packet({ op: 1, d: null, s: null });
  assert.equal(socket.sent.at(-1).op, 1, 'OP 1 must be answered immediately');
  assert.equal(gateway.snapshot().awaitingHeartbeatAck, true);
  socket.packet({ op: 11, d: null, s: null });
  assert.equal(gateway.snapshot().awaitingHeartbeatAck, false);
  assert.ok(gateway.snapshot().lastHeartbeatAckAt);

  gateway.sendHeartbeat();
  assert.equal(gateway.snapshot().awaitingHeartbeatAck, true);
  gateway.sendHeartbeat();
  assert.equal(gateway.snapshot().status, 'reconnecting');
  assert.match(gateway.snapshot().lastError, /heartbeat.*ikke kvitteret/i);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 1000);
  scheduled.shift().callback();
  assert.equal(sockets.length, 2, 'a missing ACK must establish a fresh socket');
  sockets[1].packet({ op: 10, d: { heartbeat_interval: 1000 }, s: null });
  assert.equal(sockets[1].sent[0].op, 2);
});

test('R12 resumes a verified Discord session and identifies after invalid-session recovery', async t => {
  const { gateway, sockets, scheduled } = await protocolFixture(t);
  const original = sockets[0];
  original.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  original.packet({ op: 0, t: 'READY', s: 42, d: {
    session_id: 'synthetic-session', user: { id: '923456789012345678' },
    resume_gateway_url: 'wss://gateway-us-east1-b.discord.gg',
  } });
  assert.equal(gateway.snapshot().status, 'connected');
  original.packet({ op: 7, d: null });
  scheduled.shift().callback();
  const resumed = sockets[1];
  assert.match(resumed.url, /^wss:\/\/gateway-us-east1-b\.discord\.gg/);
  resumed.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(resumed.sent[0].op, 6);
  assert.deepEqual(resumed.sent[0].d, {
    token: config.token, session_id: 'synthetic-session', seq: 42,
  });
  resumed.packet({ op: 0, t: 'RESUMED', s: 43, d: {} });
  assert.equal(gateway.snapshot().status, 'connected');

  resumed.packet({ op: 9, d: false });
  scheduled.shift().callback();
  const identified = sockets[2];
  identified.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(identified.sent[0].op, 2, 'a non-resumable session must identify again');

  // Late packets from the obsolete socket must not modify the active state.
  original.packet({ op: 0, t: 'READY', s: 999, d: { session_id: 'stale' } });
  assert.equal(gateway.sequence, null);
});

test('R12 durable receipt deduplicates concurrent delivery and replay after restart', async t => {
  let calls = 0;
  const { root, gateway } = await protocolFixture(t, {
    onMessage: async () => { calls += 1; return 'Test answer'; },
  });
  const incoming = message();
  const results = await Promise.all([
    gateway.handleIncoming(incoming),
    gateway.handleIncoming(incoming),
  ]);
  assert.deepEqual(results, [true, false]);
  assert.equal(calls, 1);
  let saved = JSON.parse(await readFile(join(root, 'discord-received.json'), 'utf8'));
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].status, 'completed');
  assert.equal(saved.messages[0].id, incoming.id);
  assert.equal(JSON.stringify(saved).includes(incoming.content), false,
    'message text must not be stored in the deduplication journal');

  gateway.stop();
  const replay = await protocolFixture(t, {
    dataDirectory: root,
    onMessage: async () => { calls += 1; return 'Again'; },
  });
  assert.equal(await replay.gateway.handleIncoming(incoming), false);
  assert.equal(calls, 1);
  assert.equal(await replay.gateway.handleIncoming(message('423456789012345678')), true);
  assert.equal(calls, 2);
  saved = JSON.parse(await readFile(join(root, 'discord-received.json'), 'utf8'));
  assert.equal(saved.messages.length, 2);
});

test('R12 failed receipt persistence blocks processing and reports degraded state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-broken-discord-'));
  await mkdir(join(root, 'discord-received.json'));
  let calls = 0;
  const { gateway } = await protocolFixture(t, {
    dataDirectory: root,
    onMessage: async () => { calls += 1; return 'Not allowed'; },
  });
  assert.equal(gateway.snapshot().dedupeStatus, 'error');
  assert.equal(gateway.snapshot().status, 'error');
  await assert.rejects(gateway.handleIncoming(message()), /journal|journalen|journal/i);
  assert.equal(calls, 0, 'no tool or recipe handler may run before durable receipt');
  await rmdir(join(root, 'discord-received.json'));
});

test('R12 restart marks interrupted work unknown without repeating its effects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-v5-interrupted-discord-'));
  const id = '523456789012345678';
  await writeFile(join(root, 'discord-received.json'), JSON.stringify({
    schema: 1, messages: [{ id, channelId, status: 'received', at: '2026-11-04T12:00:00.000Z' }],
  }));
  let calls = 0;
  const { gateway } = await protocolFixture(t, {
    dataDirectory: root, onMessage: async () => { calls += 1; return 'Repeated'; },
  });
  assert.equal(gateway.snapshot().unknownMessageCount, 1);
  assert.equal(await gateway.handleIncoming(message(id)), false);
  assert.equal(calls, 0);
  const durable = JSON.parse(await readFile(join(root, 'discord-received.json'), 'utf8'));
  assert.equal(durable.messages[0].status, 'unknown');
});


test('Discord DM-only setup omits privileged guild intents; explicit server chat retains Message Content', async t => {
  const { gateway, sockets } = await protocolFixture(t);
  sockets[0].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(sockets[0].sent[0].d.intents, 1 << 12);
  gateway.start({ ...config, userId: ' ' + userId + ' ', guildId: ' 523456789012345678 ', token: ' ' + config.token + ' ' });
  await gateway.dedupeReady;
  sockets[1].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(sockets[1].sent[0].d.intents, (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15));
  assert.equal(gateway.config.userId, userId); assert.equal(gateway.config.guildId, '523456789012345678');
  assert.equal(sockets[1].sent[0].d.token, config.token);
});
