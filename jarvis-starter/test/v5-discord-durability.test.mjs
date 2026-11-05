import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordGateway } from '../discord-gateway.mjs';
import { atomicStateWrite } from '../state-schema.mjs';

const userId = '123456789012345678';
const channelId = '223456789012345678';
const config = { enabled: true, token: 'synthetic-discord-secret-token', userId };
const id = number => (323456789012345678n + BigInt(number)).toString();
const message = (number = 0, content = `Syntetisk besked ${number}`) =>
  ({ id: id(number), author: { id: userId }, channel_id: channelId, content });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Syntetisk kontrolpunkt blev ikke nået.');
}

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); this.sent = []; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  packet(value) { for (const callback of this.listeners.get('message') || []) callback({ data: JSON.stringify(value) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000) {
    this.closeCode = code; this.readyState = 3;
    for (const callback of this.listeners.get('close') || []) callback({ code });
  }
}

async function fixture(t, options = {}) {
  const root = options.dataDirectory || await mkdtemp(join(tmpdir(), 'jarvis-discord-durable-'));
  const sockets = [], retries = [], heartbeats = [], sent = [];
  const gateway = new DiscordGateway({
    dataDirectory: root,
    onMessage: async () => 'Syntetisk svar',
    fetcher: async (url, request) => { sent.push({ url, request }); return { ok: true }; },
    socketFactory: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduleRetry: (callback, ms) => { const timer = { callback, ms, unref() {} }; retries.push(timer); return timer; },
    scheduleHeartbeat: (callback, ms) => { const timer = { callback, ms, unref() {} }; heartbeats.push(timer); return timer; },
    random: () => 0.5,
    ...options,
  });
  t.after(async () => {
    gateway.stop();
    await gateway.journalQueue;
    if (!options.dataDirectory) await rm(root, { recursive: true, force: true });
  });
  gateway.start(config);
  await gateway.dedupeReady;
  return { root, gateway, sockets, retries, heartbeats, sent,
    journal: async () => JSON.parse(await readFile(join(root, 'discord-received.json'), 'utf8')) };
}

test('Discord receipt and processing checkpoints publish durably before any handler or send', async t => {
  const processing = deferred();
  let blocked = false, calls = 0, gateway;
  const fixtureData = await fixture(t, {
    writeJournal: async (path, contents) => {
      const record = JSON.parse(contents).messages.find(item => item.status === 'received' && item.phase === 'processing');
      if (record) { blocked = true; await processing.promise; }
      await atomicStateWrite(path, contents);
    },
    onMessage: async () => {
      calls++;
      const saved = await fixtureData.journal();
      assert.equal(saved.messages[0].phase, 'processing');
      assert.equal(gateway.seen.get(id(0)).phase, 'processing');
      return 'Færdig';
    },
  });
  ({ gateway } = fixtureData);
  const action = gateway.handleIncoming(message());
  await until(() => blocked);
  assert.equal(calls, 0);
  assert.equal(fixtureData.sent.length, 0);
  assert.equal(gateway.seen.get(id(0)).phase, 'waiting', 'unpublished drafts must not be visible');
  assert.equal((await fixtureData.journal()).messages[0].phase, 'waiting');
  processing.resolve();
  assert.equal(await action, true);
  assert.equal(calls, 1);
  assert.equal((await fixtureData.journal()).messages[0].status, 'completed');
  assert.equal((await stat(join(fixtureData.root, 'discord-received.json'))).mode & 0o777, 0o600);
});

test('Discord rename failure rejects the original receipt failure without effects or false memory publication', async t => {
  const diskError = Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
  let calls = 0;
  const data = await fixture(t, {
    onMessage: async () => { calls++; return 'Må ikke køre'; },
    writeJournal: (path, contents) => JSON.parse(contents).messages.length
      ? atomicStateWrite(path, contents, { renameFile: async () => { throw diskError; } })
      : atomicStateWrite(path, contents),
  });
  await assert.rejects(data.gateway.handleIncoming(message()), error => error === diskError);
  assert.equal(calls, 0);
  assert.equal(data.sent.length, 0);
  assert.equal(data.gateway.seen.size, 0);
  assert.deepEqual((await data.journal()).messages, []);
  assert.equal(data.gateway.snapshot().dedupeStatus, 'error');
});

test('Discord directory fsync uncertainty retains published receipt, blocks effects and restart never replays it', async t => {
  let failSync = true, calls = 0;
  const data = await fixture(t, {
    onMessage: async () => { calls++; return 'Må ikke køre'; },
    writeJournal: (path, contents) => JSON.parse(contents).messages.length && failSync
      ? atomicStateWrite(path, contents, { syncDirectory: async () => { throw Object.assign(new Error('synthetic dir fsync'), { code: 'EIO' }); } })
      : atomicStateWrite(path, contents),
  });
  await assert.rejects(data.gateway.handleIncoming(message()), error => error.code === 'STATE_DURABILITY_UNKNOWN' && error.statePublished);
  assert.equal(data.gateway.seen.get(id(0)).status, 'received');
  assert.equal((await data.journal()).messages[0].status, 'received');
  assert.equal(calls, 0);
  failSync = false;
  data.gateway.start(config);
  await data.gateway.dedupeReady;
  assert.equal(data.gateway.seen.get(id(0)).status, 'unknown');
  assert.equal(await data.gateway.handleIncoming(message()), false);
  assert.equal(calls, 0);
});

test('Discord result persistence failure is not reported as completed and never repeats a performed handler', async t => {
  let calls = 0, failResult = true;
  const data = await fixture(t, {
    onMessage: async () => { calls++; return 'Udført'; },
    writeJournal: (path, contents) => failResult && JSON.parse(contents).messages.some(item => item.status === 'completed')
      ? Promise.reject(Object.assign(new Error('synthetic result disk failure'), { code: 'ENOSPC' }))
      : atomicStateWrite(path, contents),
  });
  await assert.rejects(data.gateway.handleIncoming(message()), { code: 'ENOSPC' });
  assert.equal(calls, 1);
  assert.equal(data.sent.length, 1);
  assert.equal(data.gateway.seen.get(id(0)).status, 'received');
  assert.equal((await data.journal()).messages[0].status, 'received');
  assert.equal(data.gateway.snapshot().unknownMessageCount, 1);
  assert.equal(await data.gateway.handleIncoming(message()), false);
  failResult = false;
  data.gateway.start(config);
  await data.gateway.dedupeReady;
  assert.equal((await data.journal()).messages[0].status, 'unknown');
  assert.equal(await data.gateway.handleIncoming(message()), false);
  assert.equal(calls, 1);
});

test('Discord ingress is bounded before async work, deduplicates pending IDs and persists waiting receipts', async t => {
  const finish = deferred();
  let calls = 0;
  const data = await fixture(t, { maxWaiting: 1,
    onMessage: async () => { calls++; if (calls === 1) await finish.promise; return 'Svar'; },
  });
  const first = data.gateway.handleIncoming(message(1));
  await until(() => calls === 1);
  const second = data.gateway.handleIncoming(message(2));
  await until(() => data.gateway.workQueue.waiting.length === 1);
  assert.equal(await data.gateway.handleIncoming(message(1)), false);
  assert.equal(await data.gateway.handleIncoming(message(2)), false);
  const flood = Array.from({ length: 50 }, (_, index) => data.gateway.handleIncoming(message(index + 3)));
  const results = await Promise.allSettled(flood);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'DISCORD_QUEUE_FULL'));
  assert.equal(data.gateway.pendingMessages.size, 2);
  assert.deepEqual(data.gateway.snapshot().incoming, { running: 1, waiting: 1, capacity: 2, paused: false,
    rejected: 50, lastRejectedAt: data.gateway.snapshot().incoming.lastRejectedAt });
  assert.deepEqual((await data.journal()).messages.map(item => item.phase), ['processing', 'waiting']);
  finish.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls, 2);
  assert.equal(data.gateway.pendingMessages.size, 0);
});

test('Discord gateway overflow applies resumable backpressure before the unaccepted dispatch', async t => {
  const finish = deferred();
  let calls = 0;
  const data = await fixture(t, { maxWaiting: 0,
    onMessage: async () => { calls++; if (calls === 1) await finish.promise; return 'Svar'; },
  });
  const socket = data.sockets[0];
  socket.packet({ op: 0, t: 'READY', s: 40, d: { session_id: 'synthetic-session', resume_gateway_url: 'wss://gateway.discord.gg' } });
  socket.packet({ op: 0, t: 'MESSAGE_CREATE', s: 41, d: message(1) });
  await until(() => calls === 1);
  socket.packet({ op: 0, t: 'MESSAGE_CREATE', s: 42, d: message(2) });
  await until(() => data.gateway.ingressPaused);
  assert.equal(socket.closeCode, 4000, 'normal close would invalidate the session');
  assert.equal(data.gateway.snapshot().status, 'paused');
  assert.equal(data.retries.length, 0, 'no reconnect loop while the owner handler still occupies the only slot');
  assert.equal((await data.journal()).messages.length, 1);
  finish.resolve();
  await until(() => data.retries.length === 1);
  data.retries.shift().callback();
  data.sockets[1].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(data.sockets[1].sent[0].op, 6);
  assert.equal(data.sockets[1].sent[0].d.seq, 41);
  data.sockets[1].packet({ op: 0, t: 'MESSAGE_CREATE', s: 42, d: message(2) });
  data.sockets[1].packet({ op: 0, t: 'RESUMED', s: 43, d: {} });
  await until(() => calls === 2 && data.gateway.pendingMessages.size === 0);
  await until(() => data.gateway.snapshot().ingressGap?.status === 'recovered' && !data.gateway.gapCheckpoint);
  assert.equal((await data.journal()).messages.length, 2);
  assert.equal((await data.journal()).ingressGap.status, 'recovered');
});

test('Discord resume rejection and restart preserve a visible durable gap instead of claiming all messages arrived', async t => {
  const finish = deferred();
  let calls = 0;
  const data = await fixture(t, { maxWaiting: 0,
    onMessage: async () => { calls++; await finish.promise; return 'Svar'; },
  });
  const socket = data.sockets[0];
  socket.packet({ op: 0, t: 'READY', s: 40, d: { session_id: 'synthetic-session', resume_gateway_url: 'wss://gateway.discord.gg' } });
  socket.packet({ op: 0, t: 'MESSAGE_CREATE', s: 41, d: message(1) });
  await until(() => calls === 1);
  socket.packet({ op: 0, t: 'MESSAGE_CREATE', s: 42, d: message(2) });
  await until(() => data.gateway.snapshot().ingressGap?.status === 'awaiting_resume' && !data.gateway.gapCheckpoint);
  assert.equal((await data.journal()).ingressGap.firstMessageId, id(2));
  finish.resolve();
  await until(() => data.retries.length === 1);
  data.retries.shift().callback();
  data.sockets[1].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  data.sockets[1].packet({ op: 9, d: false });
  await until(() => data.gateway.snapshot().ingressGap?.status === 'requires_review' && !data.gateway.gapCheckpoint);
  assert.equal((await data.journal()).ingressGap.reason, 'resume_unavailable');
  data.gateway.start(config);
  await data.gateway.dedupeReady;
  data.sockets.at(-1).packet({ op: 0, t: 'READY', s: 1, d: { session_id: 'new-session' } });
  assert.equal(data.gateway.snapshot().ingressGap.status, 'requires_review');
  assert.match(data.gateway.snapshot().lastError, /ikke bekræfte alle beskeder/);
  assert.equal(calls, 1, 'missing work is never invented or marked completed');
});

test('Discord unknown receipts are retained while completed history evicts behind a durable replay watermark', async t => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const data = await fixture(t, { maxJournalEntries: 3,
    onMessage: async text => { calls++; if (text === 'Ukendt') throw new Error('synthetic partial action'); return 'Svar'; },
  });
  await data.gateway.handleIncoming(message(1, 'Ukendt'));
  await data.gateway.handleIncoming(message(2));
  await data.gateway.handleIncoming(message(3));
  await data.gateway.handleIncoming(message(4));
  let journal = await data.journal();
  assert.equal(journal.schema, 2);
  assert.equal(journal.messages.length, 3);
  assert.equal(journal.messages.find(item => item.id === id(1)).status, 'unknown');
  assert.equal(journal.messages.some(item => item.id === id(2)), false);
  assert.equal(journal.retentionFloor, id(2));
  data.gateway.start(config);
  await data.gateway.dedupeReady;
  assert.equal(await data.gateway.handleIncoming(message(1)), false);
  assert.equal(await data.gateway.handleIncoming(message(2)), false);
  assert.equal(await data.gateway.handleIncoming(message(0, 'Forsinket ældre besked')), false);
  assert.match(data.gateway.snapshot().lastError, /replay-grænsen/);
  assert.equal(calls, 4);
  journal = await data.journal();
  assert.equal(journal.retentionFloor, id(2));
});

test('Discord full unknown history stops visibly instead of evicting evidence and replaying effects', async t => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const data = await fixture(t, { maxJournalEntries: 2,
    onMessage: async () => { calls++; throw new Error('synthetic uncertain outcome'); },
  });
  await data.gateway.handleIncoming(message(1));
  await data.gateway.handleIncoming(message(2));
  await assert.rejects(data.gateway.handleIncoming(message(3)), { code: 'DISCORD_JOURNAL_FULL' });
  assert.equal(data.gateway.snapshot().status, 'error');
  assert.equal(data.gateway.snapshot().unknownMessageCount, 2);
  assert.equal(calls, 2);
  assert.deepEqual((await data.journal()).messages.map(item => item.id), [id(1), id(2)]);
});

test('Discord start during an old handler cancels waiting work and never overwrites new generation receipts or sends old replies', async t => {
  const finish = deferred();
  const calls = [];
  const data = await fixture(t, { onMessage: async text => {
    calls.push(text);
    if (text === 'Gammel kører') await finish.promise;
    return `Svar: ${text}`;
  } });
  const first = data.gateway.handleIncoming(message(1, 'Gammel kører'));
  await until(() => calls.length === 1);
  const second = data.gateway.handleIncoming(message(2, 'Gammel venter'));
  await until(() => data.gateway.workQueue.waiting.length === 1);
  data.gateway.start({ ...config, token: 'synthetic-replacement-token' });
  await data.gateway.dedupeReady;
  await second;
  const third = data.gateway.handleIncoming(message(3, 'Ny session'));
  await until(() => data.gateway.workQueue.waiting.length === 1);
  finish.resolve();
  assert.deepEqual(await Promise.all([first, third]), [true, true]);
  assert.deepEqual(calls, ['Gammel kører', 'Ny session']);
  assert.equal(data.sent.length, 1);
  assert.equal(data.sent[0].request.headers.Authorization, 'Bot synthetic-replacement-token');
  assert.deepEqual((await data.journal()).messages.map(item => [item.id, item.status]),
    [[id(1), 'unknown'], [id(2), 'unknown'], [id(3), 'completed']]);
});

test('Discord failed POST transport is unknown, makes no second POST and sanitizes handler/log/reply boundaries', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...parts) => logs.push(parts.join(' ')));
  let passed, sends = 0;
  const data = await fixture(t, {
    onMessage: async text => { passed = text; return `Svaret indeholder ${config.token} api_key=sk-test123456789123456789`; },
    fetcher: async (_url, request) => {
      sends++;
      assert.equal(request.body.includes(config.token), false);
      assert.equal(request.body.includes('sk-test123456789123456789'), false);
      throw new Error(`synthetic transport failure ${config.token}`);
    },
  });
  assert.equal(await data.gateway.handleIncoming(message(1, `Gem aldrig ${config.token}`)), true);
  assert.equal(passed.includes(config.token), false);
  assert.equal(sends, 1, 'no blind POST retry, including no automatic follow-up error message');
  assert.equal((await data.journal()).messages[0].status, 'unknown');
  assert.equal(JSON.stringify(logs).includes(config.token), false);
  assert.equal((await readFile(join(data.root, 'discord-received.json'), 'utf8')).includes('Gem aldrig'), false);
});

test('Discord notification interrupted while opening a DM returns not delivered, not false success', async t => {
  const opened = deferred();
  let calls = 0;
  const data = await fixture(t, { fetcher: async () => {
    calls++;
    await opened.promise;
    return { ok: true, json: async () => ({ id: channelId }) };
  } });
  data.gateway.status = 'connected';
  const notification = data.gateway.notifyOwner('Syntetisk status');
  await until(() => calls === 1);
  data.gateway.stop();
  opened.resolve();
  assert.equal(await notification, false);
  assert.equal(calls, 1, 'no old-generation message POST');
});

test('Discord multi-part reply reports partial delivery and never sends the next chunk after a generation change', async t => {
  let gateway, calls = 0;
  const data = await fixture(t, { fetcher: async () => {
    calls++;
    gateway.stop();
    return { ok: true };
  } });
  gateway = data.gateway;
  await assert.rejects(gateway.sendReply(channelId, 'A'.repeat(3000), gateway.generation),
    error => error.code === 'DISCORD_SESSION_CHANGED' && error.partialOutcome && error.sentChunks === 1);
  assert.equal(calls, 1);
});

test('Discord rate-limit retries honor the longest known delay, remain bounded and never shorten long Retry-After', async t => {
  const delays = [];
  let calls = 0, long = false;
  const data = await fixture(t, {
    waitForRetry: async ms => { delays.push(ms); },
    fetcher: async () => {
      calls++;
      if (!long && calls > 1) return { ok: true };
      return { ok: false, status: 429, headers: { get: () => long ? '30' : '2' }, json: async () => ({ retry_after: 1.5 }) };
    },
  });
  assert.deepEqual(await data.gateway.sendReply(channelId, 'Svar', data.gateway.generation), { sentChunks: 1, complete: true });
  assert.deepEqual(delays, [2000]);
  long = true;
  await assert.rejects(data.gateway.sendReply(channelId, 'Nyt svar', data.gateway.generation),
    error => error.code === 'DISCORD_RATE_LIMITED' && error.retryAfterMs === 30_000 && error.deliveryNotAttempted);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000], 'must not retry a 30-second rate limit after only 10 seconds');
});

test('Discord heartbeat uses initial jitter, answers server requests and closes missing ACK sessions with resumable code', async t => {
  const data = await fixture(t);
  const socket = data.sockets[0];
  socket.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(data.heartbeats[0].ms, 500);
  socket.packet({ op: 1 });
  assert.equal(socket.sent.at(-1).op, 1);
  socket.packet({ op: 11 });
  data.heartbeats[0].callback();
  assert.equal(socket.sent.at(-1).op, 1);
  data.gateway.sendHeartbeat();
  assert.equal(socket.closeCode, 4000);
  assert.equal(data.retries.length, 1);
});

test('Discord obsolete retry and heartbeat callbacks cannot clear or replace current generation timers', async t => {
  const data = await fixture(t);
  const first = data.sockets[0];
  first.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  const oldHeartbeat = data.heartbeats[0];
  first.packet({ op: 7 });
  const oldRetry = data.retries[0];
  data.gateway.start(config);
  await data.gateway.dedupeReady;
  const current = data.sockets.at(-1);
  current.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  const newHeartbeat = data.gateway.firstHeartbeat;
  oldHeartbeat.callback();
  assert.equal(data.gateway.firstHeartbeat, newHeartbeat);
  current.packet({ op: 7 });
  const newRetry = data.gateway.retryTimer;
  oldRetry.callback();
  assert.equal(data.gateway.retryTimer, newRetry);
  assert.equal(data.sockets.length, 2);
  assert.doesNotThrow(() => data.gateway.handleGatewayMessage({ data: 'null' }, data.gateway.generation));
});

test('Discord journal rejects newer schemas, duplicate records and symlinks without overwriting them', async t => {
  t.mock.method(console, 'error', () => {});
  const root = await mkdtemp(join(tmpdir(), 'jarvis-discord-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'discord-received.json');
  for (const saved of [
    { schema: 99, messages: [] },
    { schema: 2, retentionFloor: '0', messages: Array(2).fill({ id: id(0), channelId, status: 'unknown' }) },
  ]) {
    const raw = JSON.stringify(saved);
    await writeFile(path, raw);
    const data = await fixture(t, { dataDirectory: root });
    assert.equal(data.gateway.snapshot().dedupeStatus, 'error');
    assert.equal(await readFile(path, 'utf8'), raw);
    data.gateway.stop();
  }
  await rm(path);
  const target = join(root, 'synthetic-other-file');
  const raw = JSON.stringify({ schema: 2, retentionFloor: '0', messages: [] });
  await writeFile(target, raw);
  await symlink(target, path);
  const data = await fixture(t, { dataDirectory: root });
  assert.equal(data.gateway.snapshot().dedupeStatus, 'error');
  assert.equal(await readFile(target, 'utf8'), raw);
});
