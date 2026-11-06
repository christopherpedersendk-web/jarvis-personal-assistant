// Discord Gateway v10. Ingen eksterne npm-afhængigheder (Node.js 22+).
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discordImageAttachment } from './recipe-fetch.mjs';
import { atomicStateWrite } from './state-schema.mjs';
import { BoundedJobQueue } from './bounded-queue.mjs';
import { redactSecrets } from './privacy.mjs';
const DM_INTENTS = (1 << 12);
const GUILD_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const SNOWFLAKE = /^\d{15,22}$/;
const DEDUPE_LIMIT = 2000;
const JOURNAL_SCHEMA = 2;
const JOURNAL_MAX_BYTES = 1_000_000;
const MAX_REPLY_LENGTH = 12_000;
const DEFAULT_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

function discordError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function maximumId(left, right) { return BigInt(left) > BigInt(right) ? left : right; }

function trimCompleted(snapshot, limit) {
  while (snapshot.seen.size > limit) {
    const completed = [...snapshot.seen.values()].filter(item => item.status === 'completed')
      .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)[0];
    if (!completed) throw discordError('DISCORD_JOURNAL_FULL',
      'Discord-journalen er fuld af uafklarede beskeder. Gennemgå resultaterne før nye handlinger.');
    snapshot.seen.delete(completed.id);
    snapshot.retentionFloor = maximumId(snapshot.retentionFloor, completed.id);
  }
}

function safeResumeGateway(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' || !/^(?:[a-z0-9-]+\.)*discord\.gg$/i.test(parsed.hostname) ||
        parsed.username || parsed.password || parsed.port) return '';
    return `${parsed.origin}/?v=10&encoding=json`;
  } catch { return ''; }
}

export function validateDiscordConfig(config) {
  const userId = String(config.userId || '').trim();
  const guildId = String(config.guildId || '').trim();
  const reportChannelId = String(config.reportChannelId || '').trim();
  if (userId && !SNOWFLAKE.test(userId)) throw new Error('Discord User ID skal være et numerisk Discord-ID.');
  if (guildId && !SNOWFLAKE.test(guildId)) throw new Error('Discord Server ID skal være et numerisk Discord-ID.');
  if (guildId && !userId) throw new Error('Angiv først dit Discord User ID.');
  if (reportChannelId && (!guildId || !SNOWFLAKE.test(reportChannelId))) throw new Error('Rapportkanalen kræver et gyldigt kanal-ID og Server ID.');
  return { userId, guildId, reportChannelId };
}

export function discordMessageRejection(event, config) {
  if (event?.author?.bot || event?.webhook_id) return 'bot';
  if (!config.userId || event?.author?.id !== config.userId) return 'user';
  if (!SNOWFLAKE.test(String(event.channel_id || '')) || !SNOWFLAKE.test(String(event.id || ''))) return 'invalid';
  if (event.guild_id && (!config.guildId || event.guild_id !== config.guildId)) return 'guild';
  if (typeof event.content !== 'string' || event.content.length > 5000) return 'content';
  if (!event.content.trim() && !discordMessageMetadata(event).attachments.length) return 'empty';
  return null;
}

export function authorizedDiscordMessage(event, config) {
  return discordMessageRejection(event, config) === null;
}

// Only these metadata are passed to the recipe intake. In particular, never pass
// an entire Discord event, member profile, embed or bot token to extraction.
export function discordMessageMetadata(event) {
  return { messageId: String(event.id || ''), channelId: String(event.channel_id || ''),
    attachments: (Array.isArray(event.attachments) ? event.attachments : []).slice(0, 3)
      .map(item => discordImageAttachment(item, { channelId: String(event.channel_id || '') })).filter(Boolean) };
}

export function splitDiscordMessage(value, max = 1900) {
  const chunks = [];
  let text = String(value || '');
  while (text.length > max) {
    let index = text.lastIndexOf('\n', max);
    if (index < max / 2) index = max;
    chunks.push(text.slice(0, index));
    text = text.slice(index).replace(/^\n/, '');
  }
  if (text) chunks.push(text);
  return chunks;
}

export class DiscordGateway {
  constructor({ onMessage, onVoiceUnavailable = () => {}, voiceEnabled = false, fetcher = fetch, socketFactory = url => new WebSocket(url),
    dataDirectory = process.env.JARVIS_DATA_DIR || DEFAULT_DATA_DIR,
    scheduleRetry = (callback, ms) => setTimeout(callback, ms),
    scheduleHeartbeat = (callback, ms) => setTimeout(callback, ms), random = Math.random,
    waitForRetry = ms => new Promise(resolve => setTimeout(resolve, ms)),
    writeJournal = atomicStateWrite, maxWaiting = 8, maxJournalEntries = DEDUPE_LIMIT }) {
    if (!Number.isInteger(maxJournalEntries) || maxJournalEntries < 1 || maxJournalEntries > DEDUPE_LIMIT)
      throw new Error('Ugyldig grænse for Discord-journalen.');
    this.onMessage = onMessage; this.onVoiceUnavailable=onVoiceUnavailable; this.voiceEnabled=voiceEnabled;
    this.voiceAdapters=new Map(); this.voiceStates=new Map();
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.scheduleRetry = scheduleRetry;
    this.scheduleHeartbeat = scheduleHeartbeat;
    this.random = random;
    this.waitForRetry = waitForRetry;
    this.writeJournal = writeJournal;
    this.maxJournalEntries = maxJournalEntries;
    this.workQueue = new BoundedJobQueue({ concurrency: 1, maxWaiting });
    this.pendingMessages = new Map();
    this.journalQueue = Promise.resolve();
    this.retentionFloor = '0';
    this.ingressGap = null;
    this.pendingGap = null;
    this.gapCheckpoint = null;
    this.resumeConfirmed = null;
    this.rejectedMessageCount = 0;
    this.lastRejectedAt = null;
    this.ingressPaused = false;
    this.resumeSequence = null;
    this.dedupePath = join(dataDirectory, 'discord-received.json');
    this.status = 'disabled';
    this.config = {};
    this.generation = 0;
    this.lastError = '';
    this.seen = new Map();
    this.dedupeEnabled = false;
    this.dedupeLoaded = false;
    this.dedupeReady = Promise.resolve();
    this.awaitingHeartbeatAck = false;
    this.lastHeartbeatSentAt = null;
    this.lastHeartbeatAckAt = null;
    this.lastConnectedAt = null;
    this.lastMessageAt = null;
    this.lastIncoming = null;
    this.lastFailure = null;
  }

  snapshot() {
    return { status: this.status, lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt, lastHeartbeatSentAt: this.lastHeartbeatSentAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt, awaitingHeartbeatAck: this.awaitingHeartbeatAck,
      lastMessageAt: this.lastMessageAt, lastIncoming: this.lastIncoming, lastFailure: this.lastFailure, reconnectAttempts: this.retryCount || 0,
      dedupeStatus: this.dedupeEnabled ? (this.dedupeFailure ? 'error' : this.dedupeLoaded ? 'active' : 'loading') : 'inactive',
      unknownMessageCount: [...this.seen.values()].filter(item => item.status === 'unknown' ||
        (this.dedupeFailure && item.status === 'received' && item.phase === 'processing')).length,
      pendingMessageCount: [...this.seen.values()].filter(item => item.status === 'received').length,
      incoming: { running: this.workQueue.running,
        waiting: Math.max(0, this.pendingMessages.size - this.workQueue.running),
        capacity: this.workQueue.maxWaiting + 1, paused: this.ingressPaused,
        rejected: this.rejectedMessageCount, lastRejectedAt: this.lastRejectedAt },
      journal: { schema: JOURNAL_SCHEMA, records: this.seen.size, capacity: this.maxJournalEntries,
        retentionFloor: this.retentionFloor },
      ingressGap: this.ingressGap ? { ...this.ingressGap } : null };
  }

  voiceMembers(guildId,channelId) { return [...this.voiceStates.values()].filter(s=>s.guild_id===guildId&&s.channel_id===channelId).map(s=>s.user_id); }
  voiceAdapterCreator(guildId) {
    return methods=>{
      if(guildId!==this.config.guildId||!this.voiceEnabled||this.voiceAdapters.has(guildId))throw new Error('Discord voice adapter unavailable.');
      this.voiceAdapters.set(guildId,methods);
      return {sendPayload:payload=>this.status==='connected'&&payload.op===4&&payload.d?.guild_id===guildId&&this.sendGateway(payload),destroy:()=>this.voiceAdapters.delete(guildId)};
    };
  }
  stopVoiceTransport() {
    for(const adapter of this.voiceAdapters.values())adapter.destroy();
    this.voiceAdapters.clear();this.voiceStates.clear();
    Promise.resolve(this.onVoiceUnavailable()).catch(()=>{});
  }
  clearHeartbeat() {
    clearInterval(this.heartbeat);
    clearTimeout(this.firstHeartbeat);
    this.heartbeatToken = null;
    this.heartbeat = null;
    this.firstHeartbeat = null;
    this.awaitingHeartbeatAck = false;
  }

  stop() {
    this.stopVoiceTransport();
    this.generation++;
    this.resumeConfirmed = null;
    this.markResumeUnavailable('session_stopped');
    this.clearHeartbeat();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryToken = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* The generation guard already disables this socket. */ }
    this.status = 'disabled';
    this.ingressPaused = false;
    // A running handler may already have had effects. Only waiting work is
    // cancelled; its durable receipt remains and is closed as unknown below.
    for (const pending of this.pendingMessages.values()) {
      if (!pending.queueId) continue;
      const waiting = this.workQueue.snapshot().find(item => item.id === pending.queueId && item.state === 'queued');
      if (waiting) this.workQueue.cancel(pending.queueId);
    }
  }

  start(config) {
    this.stop();
    this.config = { ...config, token: String(config.token || '').trim() };
    this.lastError = '';
    this.retryCount = 0;
    this.sequence = null;
    this.resumeSequence = null;
    this.sessionId = null;
    this.resumeGateway = '';
    this.botId = null;
    this.dedupeFailure = false;
    this.dedupeLoaded = false;
    this.dedupeEnabled = false;
    this.dedupeReady = Promise.resolve();
    try { Object.assign(this.config, validateDiscordConfig(config)); }
    catch (error) {
      this.status = 'error'; this.lastError = error.message;
      return; // A bad saved integration must not prevent the web server starting.
    }
    this.dedupeEnabled = Boolean(this.config.enabled && this.config.token && this.config.userId);
    const generation = this.generation;
    if (this.dedupeEnabled) this.status = 'connecting';
    this.dedupeReady = this.dedupeEnabled ? this.loadSeen(generation).then(() => {
      if (generation !== this.generation) return;
      this.dedupeLoaded = true;
      this.connect(generation);
    }).catch(error => {
      if (generation !== this.generation) return;
      this.failJournal('Discord-indbakken kan ikke åbnes sikkert. Genstart efter kontrol af lagring.');
      this.logError('Discord-indbakke', error, config.token);
    }) : Promise.resolve();
  }

  connect(generation) {
    if (generation !== this.generation || this.ingressPaused || this.dedupeFailure) return;
    this.status = this.retryCount ? 'reconnecting' : 'connecting';
    try {
      const socket = this.socketFactory(this.sessionId && this.sequence !== null && this.resumeGateway
        ? this.resumeGateway : DEFAULT_GATEWAY);
      this.socket = socket;
      socket.addEventListener('message', event => {
        if (this.socket === socket) this.handleGatewayMessage(event, generation);
      });
      socket.addEventListener('close', event => {
        if (generation !== this.generation || this.socket !== socket) return;
        this.socket = null;
        this.stopVoiceTransport();
        this.clearHeartbeat();
        if ([4004, 4013, 4014].includes(event.code)) {
          this.status = 'error';
          this.lastError = event.code === 4014 ? 'Message Content Intent mangler i Discord Developer Portal.' : `Discord afviste botten (kode ${event.code}).`;
          return;
        }
        if ([4007, 4009].includes(event.code)) this.resetSession();
        this.reconnect(generation);
      });
      socket.addEventListener('error', () => {
        if (generation === this.generation && this.socket === socket)
          this.forceReconnect('Forbindelsen til Discord fejlede.', generation);
      });
    } catch {
      this.lastError = 'Kunne ikke etablere Discord-forbindelse.';
      this.reconnect(generation);
    }
  }

  sendGateway(payload) {
    if (this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(payload)); return true; }
    catch {
      this.forceReconnect('Kunne ikke sende data til Discord.', this.generation);
      return false;
    }
  }

  resetSession() {
    this.markResumeUnavailable('resume_unavailable');
    this.resumeConfirmed = null;
    this.sessionId = null;
    this.sequence = null;
    this.resumeSequence = null;
    this.resumeGateway = '';
  }

  forceReconnect(reason, generation = this.generation) {
    if (generation !== this.generation) return;
    this.lastError = reason;
    this.stopVoiceTransport();
    const socket = this.socket;
    this.socket = null;
    this.clearHeartbeat();
    // Codes 1000/1001 invalidate a resumable Discord session.
    try { socket?.close(4000); } catch { /* reconnect still needed */ }
    this.reconnect(generation);
  }

  sendHeartbeat({ requested = false } = {}) {
    if (!requested && this.awaitingHeartbeatAck) {
      this.forceReconnect('Discord-heartbeat blev ikke kvitteret. Forbinder igen.');
      return false;
    }
    if (!this.sendGateway({ op: 1, d: this.sequence })) return false;
    this.awaitingHeartbeatAck = true;
    this.lastHeartbeatSentAt = new Date().toISOString();
    return true;
  }

  reconnect(generation) {
    if (generation !== this.generation || this.retryTimer || this.ingressPaused || this.dedupeFailure) return;
    this.status = 'reconnecting';
    const pause = Math.min(30_000, 1000 * (2 ** Math.min(this.retryCount++, 5)));
    const retryToken = {};
    this.retryToken = retryToken;
    this.retryTimer = this.scheduleRetry(() => {
      if (this.retryToken !== retryToken || generation !== this.generation) return;
      this.retryToken = null;
      this.retryTimer = null;
      this.connect(generation);
    }, pause);
    this.retryTimer.unref?.();
  }

  handleGatewayMessage(event, generation) {
    if (generation !== this.generation) return;
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
    if (Number.isSafeInteger(packet.s) && packet.s >= 0) this.sequence = packet.s;
    if (packet.op === 10) {
      this.clearHeartbeat();
      const interval = packet.d?.heartbeat_interval;
      if (!Number.isFinite(interval) || interval < 1000 || interval > 120_000) {
        this.forceReconnect('Discord sendte et ugyldigt heartbeat-interval.', generation);
        return;
      }
      const socket = this.socket;
      const heartbeat = () => {
        if (generation === this.generation && this.socket === socket) this.sendHeartbeat();
      };
      const random = Number(this.random());
      const jitter = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
      const heartbeatToken = {};
      this.heartbeatToken = heartbeatToken;
      this.firstHeartbeat = this.scheduleHeartbeat(() => {
        if (generation !== this.generation || this.socket !== socket || this.heartbeatToken !== heartbeatToken) return;
        this.firstHeartbeat = null;
        heartbeat();
        if (this.socket !== socket) return;
        this.heartbeat = setInterval(heartbeat, interval);
        this.heartbeat.unref?.();
      }, Math.floor(interval * jitter));
      this.firstHeartbeat.unref?.();
      this.sendGateway(this.sessionId && this.sequence !== null
        ? { op: 6, d: { token: this.config.token, session_id: this.sessionId, seq: this.resumeSequence ?? this.sequence } }
        : { op: 2, d: { token: this.config.token, intents: DM_INTENTS | (this.config.guildId ? GUILD_INTENTS | (this.voiceEnabled ? 128 : 0) : 0), properties: { os: process.platform, browser: 'jarvis', device: 'jarvis' } } });
    } else if (packet.op === 1) {
      // Discord can request a heartbeat at any time. Respond immediately,
      // while keeping the pending-ACK watchdog active.
      this.sendHeartbeat({ requested: true });
    } else if (packet.op === 11) {
      this.awaitingHeartbeatAck = false;
      this.lastHeartbeatAckAt = new Date().toISOString();
    } else if (packet.op === 7) {
      this.forceReconnect('Discord anmodede om genforbindelse.', generation);
    } else if (packet.op === 9) {
      if (packet.d !== true) this.resetSession();
      this.forceReconnect('Discord afviste den tidligere session.', generation);
    } else if (packet.op === 0 && packet.t === 'READY') {
      if (this.resumeSequence !== null) this.markResumeUnavailable('resume_unavailable');
      this.resumeSequence = null;
      this.sessionId = typeof packet.d?.session_id === 'string' ? packet.d.session_id : null;
      this.resumeGateway = safeResumeGateway(packet.d?.resume_gateway_url);
      this.botId = packet.d?.user?.id;
      this.retryCount = 0;
      this.status = this.dedupeFailure ? 'error' : 'connected';
      if (!this.dedupeFailure) this.lastError = this.gapWarning();
      this.lastConnectedAt = new Date().toISOString();
    } else if (packet.op === 0 && packet.t === 'RESUMED') {
      const gap = this.pendingGap?.gap || this.ingressGap;
      if (gap?.status === 'awaiting_resume') this.resumeConfirmed = { id: gap.id, revision: gap.revision, generation };
      this.resumeSequence = null;
      this.status = this.dedupeFailure ? 'error' : 'connected';
      this.retryCount = 0;
      if (!this.dedupeFailure) this.lastError = this.gapWarning();
      this.lastConnectedAt = new Date().toISOString();
      this.finishResume();
    } else if (packet.op === 0 && this.voiceEnabled && packet.t === 'GUILD_CREATE' && packet.d?.id===this.config.guildId) {
      for(const member of packet.d.voice_states||[])this.voiceStates.set(member.user_id,{...member,guild_id:packet.d.id});
    } else if (packet.op === 0 && this.voiceEnabled && packet.t === 'VOICE_STATE_UPDATE' && packet.d?.guild_id===this.config.guildId) {
      const member=packet.d;this.voiceStates.set(member.user_id,member);
      if(member.user_id===this.botId)this.voiceAdapters.get(member.guild_id)?.onVoiceStateUpdate(member);
      const bot=this.voiceStates.get(this.botId);
      if(bot?.channel_id && (this.voiceStates.get(this.config.userId)?.channel_id!==bot.channel_id || this.voiceMembers(member.guild_id,bot.channel_id).some(id=>id!==this.botId&&id!==this.config.userId)))this.stopVoiceTransport();
    } else if (packet.op === 0 && this.voiceEnabled && packet.t === 'VOICE_SERVER_UPDATE' && packet.d?.guild_id===this.config.guildId) {
      this.voiceAdapters.get(packet.d.guild_id)?.onVoiceServerUpdate(packet.d);
    } else if (packet.op === 0 && packet.t === 'MESSAGE_CREATE') {
      this.handleIncoming(packet.d, generation).catch(error => {
        if (generation !== this.generation) return;
        if (error.code === 'DISCORD_QUEUE_FULL') {
          this.pauseIngress(packet.s, generation, packet.d);
          return;
        }
        if (error.code === 'DISCORD_JOURNAL_FULL') this.failJournal(error.message);
        else if (!this.dedupeFailure) this.lastError = 'Discord-indbakken kunne ikke behandle beskeden.';
        this.logError('Discord-indbakke', error);
      });
    }
  }

  logError(label, error, token = this.config.token) {
    console.error(`${label}:`, redactSecrets(String(error?.message || 'Ukendt fejl'), [token, this.config.token]).slice(0, 500));
  }

  failJournal(message) {
    this.dedupeFailure = true;
    this.status = 'error';
    this.lastError = message;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryToken = null;
    this.clearHeartbeat();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(4000); } catch { /* Storage failure remains visible. */ }
  }

  pauseIngress(sequence, generation, event) {
    if (generation !== this.generation || this.dedupeFailure) return;
    this.resumeConfirmed = null;
    const previousGap = this.pendingGap?.gap || this.ingressGap;
    const gap = previousGap && previousGap.status !== 'recovered' ? { ...previousGap } : {
      id: randomUUID(), revision: 0, status: 'awaiting_resume', reason: 'queue_capacity',
      firstMessageId: String(event?.id || ''), channelId: String(event?.channel_id || ''),
      since: new Date().toISOString(), count: 0,
    };
    gap.count = Math.min(1_000_000, gap.count + 1);
    this.checkpointGap(gap, generation);
    if (Number.isSafeInteger(sequence) && sequence > 0) {
      const previous = sequence - 1;
      this.resumeSequence = this.resumeSequence === null ? previous : Math.min(this.resumeSequence, previous);
    }
    this.ingressPaused = true;
    this.status = 'paused';
    this.lastError = 'Discord-køen er fuld. Forbindelsen genoptages, når der er plads; beskeden er ikke behandlet endnu.';
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryToken = null;
    const socket = this.socket;
    this.socket = null;
    this.clearHeartbeat();
    try { socket?.close(4000); } catch { /* Queue remains bounded. */ }
    this.resumeIngress();
  }

  resumeIngress() {
    if (!this.ingressPaused || this.dedupeFailure || this.pendingMessages.size >= this.workQueue.maxWaiting + 1) return;
    this.ingressPaused = false;
    this.reconnect(this.generation);
  }

  gapWarning() {
    const gap = this.pendingGap?.gap || this.ingressGap;
    return gap?.status === 'requires_review'
      ? 'Discord kunne ikke bekræfte alle beskeder efter en afbrydelse. Gennemgå JARVIS og send eventuelle manglende ønsker som nye beskeder.' : '';
  }

  markResumeUnavailable(reason) {
    const gap = this.pendingGap?.gap || this.ingressGap;
    if (gap?.status !== 'awaiting_resume') return;
    this.checkpointGap({ ...gap, status: 'requires_review', reason }, this.generation);
    this.lastError = this.gapWarning();
  }

  checkpointGap(gap, generation) {
    // Overflow bursts share one local checkpoint loop plus one pending value;
    // they must not create an unbounded second Promise queue of raw dispatches.
    this.pendingGap = { gap: { ...gap, revision: gap.revision + 1 }, generation, durable: this.dedupeEnabled };
    if (this.gapCheckpoint) return;
    this.gapCheckpoint = (async () => {
      while (this.pendingGap) {
        const next = this.pendingGap;
        await this.changeJournal(draft => {
          draft.ingressGap = { ...next.gap,
            ...(next.generation !== this.generation && next.gap.status === 'awaiting_resume'
              ? { status: 'requires_review', reason: 'session_stopped' } : {}) };
        }, { ...next, allowOldGeneration: true });
        if (this.pendingGap === next) this.pendingGap = null;
      }
    })().catch(error => {
      this.pendingGap = null;
      this.failJournal('Discords leveringshul kunne ikke journalføres sikkert. Kontroller lagring og beskeder før genstart.');
      this.logError('Discord-leveringshul', error);
    }).finally(() => { this.gapCheckpoint = null; this.finishResume(); });
  }

  finishResume() {
    if (!this.resumeConfirmed || this.pendingMessages.size || this.gapCheckpoint || this.dedupeFailure) return;
    const confirmed = this.resumeConfirmed;
    this.resumeConfirmed = null;
    const gap = this.ingressGap;
    if (confirmed.generation !== this.generation || gap?.id !== confirmed.id ||
        gap.revision !== confirmed.revision || gap.status !== 'awaiting_resume') return;
    this.checkpointGap({ ...gap, status: 'recovered', reason: 'resumed' }, this.generation);
  }

  sendVoiceReply(channelId, text) {
    if (!this.voiceEnabled) throw new Error('Discord-stemme er ikke aktiveret.');
    // Bind this delivery to the current gateway before the first async send.
    // Reuse the same guarded/redacted sender as ordinary Discord replies.
    return this.sendReply(channelId, text, this.generation);
  }

  async sendReply(channelId, text, generation) {
    if (!SNOWFLAKE.test(String(channelId || '')))
      throw discordError('DISCORD_CHANNEL_INVALID', 'Ugyldig Discord-kanal.', { deliveryNotAttempted: true });
    const token = this.config.token;
    let safeText = redactSecrets(String(text || ''), [token]);
    if (safeText.length > MAX_REPLY_LENGTH)
      safeText = `${safeText.slice(0, MAX_REPLY_LENGTH - 65)}\nSvaret er forkortet. Se resten i JARVIS.`;
    if (!safeText.trim()) throw discordError('DISCORD_EMPTY_REPLY', 'Assistenten returnerede intet svar.', { deliveryNotAttempted: true });
    let sentChunks = 0;
    const requireSession = () => {
      if (this.dedupeEnabled && this.dedupeFailure)
        throw discordError('DISCORD_JOURNAL_UNAVAILABLE', 'Discords journal er ikke klar til en ny levering.',
          { sentChunks, deliveryNotAttempted: sentChunks === 0, partialOutcome: sentChunks > 0 });
      if (generation !== this.generation || this.config.token !== token)
        throw discordError('DISCORD_SESSION_CHANGED', 'Discord-sessionen er ændret. Svaret blev ikke sendt færdigt.',
          { sentChunks, deliveryNotAttempted: sentChunks === 0, partialOutcome: sentChunks > 0 });
    };
    requireSession();
    for (const content of splitDiscordMessage(safeText)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        requireSession();
        let response;
        try {
          response = await this.fetcher(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(20_000),
          });
        } catch {
          // A failed POST transport does not establish whether Discord sent it.
          throw discordError('DISCORD_DELIVERY_UNKNOWN', 'Discord-svarets levering kunne ikke bekræftes.',
            { sentChunks, unknownOutcome: true, partialOutcome: sentChunks > 0 });
        }
        if (response.ok) { sentChunks++; break; }
        if (response.status === 429) {
          let body;
          try { body = await response.json(); } catch { /* Use a valid header, otherwise fail closed. */ }
          const header = response.headers?.get?.('Retry-After');
          const delays = [body?.retry_after, header].filter(value => value !== null && value !== undefined && value !== '')
            .map(Number).filter(value => Number.isFinite(value) && value >= 0);
          const delay = delays.length ? Math.max(500, ...delays.map(value => value * 1000)) : null;
          // Never shorten Discord's Retry-After. Long or unavailable delays are
          // visible failures, not a tight retry loop or an unbounded wait.
          if (attempt < 2 && delay !== null && delay <= 10_000) {
            await this.waitForRetry(delay);
            continue;
          }
          throw discordError('DISCORD_RATE_LIMITED', 'Discord begrænser svarhastigheden. Svaret blev ikke sendt færdigt.',
            { sentChunks, retryAfterMs: delay, deliveryNotAttempted: sentChunks === 0, partialOutcome: sentChunks > 0 });
        }
        const status = Number.isInteger(response.status) ? response.status : 0;
        throw discordError('DISCORD_DELIVERY_FAILED', `Discord kunne ikke modtage svaret (${status}).`,
          { sentChunks, unknownOutcome: status === 0 || status >= 500 || status === 408,
            partialOutcome: sentChunks > 0, deliveryNotAttempted: status >= 400 && status < 500 && status !== 408 && sentChunks === 0 });
      }
    }
    return { sentChunks, complete: true };
  }

  async reportApi(path, options = {}, config = this.config) {
    if (!config.token || !config.guildId || !config.userId) throw new Error('Gem bot, dit bruger-ID og Server ID først.');
    const response = await this.fetcher('https://discord.com/api/v10' + path, {
      ...options, headers: { Authorization: `Bot ${config.token}`, 'Content-Type': 'application/json' }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Discord rapportkanal fejlede (${Number(response.status) || 0}). Kontrollér botrettighederne.`);
    return response.json();
  }

  async createReportChannel(config = this.config, { signal, guard = () => {} } = {}) {
    const api = (path, options = {}) => { guard(); signal?.throwIfAborted(); return this.reportApi(path, { ...options, signal }, config); };
    const bot = await api('/users/@me');
    if (!SNOWFLAKE.test(String(bot.id || ''))) throw new Error('Ugyldigt bot-ID fra Discord.');
    const channels = await api(`/guilds/${config.guildId}/channels`);
    if (!Array.isArray(channels)) throw new Error('Ugyldig kanalliste fra Discord.');
    const existing = channels.filter(c => c.name === 'jarvis-rapporter');
    if (existing.length) throw new Error('Kanalen jarvis-rapporter findes allerede. Gennemgå dens adgang og gem kanal-ID; der oprettes ikke en dublet.');
    const channel = await api(`/guilds/${config.guildId}/channels`, { method: 'POST', body: JSON.stringify({
      name: 'jarvis-rapporter', type: 0, topic: 'JARVIS · planlagte rapporter og kildehenvisninger',
      permission_overwrites: [
        { id: config.guildId, type: 0, allow: '0', deny: '1024' },
        { id: config.userId, type: 1, allow: '68608', deny: '0' },
        { id: bot.id, type: 1, allow: '68608', deny: '0' },
      ],
    }) });
    if (!SNOWFLAKE.test(String(channel.id || '')) || channel.type !== 0 || channel.guild_id !== config.guildId)
      throw new Error('Kanalen kan være oprettet, men svaret kunne ikke bekræftes. Kontrollér Discord før et nyt forsøg.');
    return channel;
  }

  async notifyReport(text) {
    if (!this.config.reportChannelId) return this.notifyOwner(text);
    if (this.status !== 'connected') return false;
    const generation = this.generation, config = { ...this.config };
    const channel = await this.reportApi(`/channels/${config.reportChannelId}`, {}, config);
    if (channel.id !== config.reportChannelId || channel.guild_id !== config.guildId || channel.type !== 0)
      throw new Error('Rapportkanalen er ikke en tekstkanal på den gemte server. Ingen rapport sendt.');
    if (generation !== this.generation) return false;
    const delivery = await this.sendReply(channel.id, text, generation);
    if (!delivery.complete) throw Object.assign(new Error('Rapportlevering er uafklaret. Ingen automatisk genafsendelse.'), { unknownOutcome: true });
    return delivery.sentChunks > 0;
  }

  async notifyOwner(text) {
    if (this.status !== 'connected' || !this.config.userId || !this.config.token) return false;
    const generation = this.generation;
    const token = this.config.token;
    const safeText = redactSecrets(String(text || ''), [token]).slice(0, 3800);
    if (!safeText.trim()) return false;
    let response;
    try {
      response = await this.fetcher('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: this.config.userId }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw discordError('DISCORD_DM_UNKNOWN', 'Discord DM kunne ikke åbnes sikkert.', { unknownOutcome: true });
    }
    if (!response.ok) throw discordError('DISCORD_DM_FAILED', `Discord DM kunne ikke åbnes (${Number(response.status) || 0}).`);
    let channel;
    try { channel = await response.json(); }
    catch { throw discordError('DISCORD_DM_INVALID', 'Discord returnerede et ugyldigt DM-svar.'); }
    if (!SNOWFLAKE.test(String(channel.id || ''))) throw new Error('Discord returnerede ugyldig DM-kanal.');
    if (generation !== this.generation || this.config.token !== token) return false;
    const delivery = await this.sendReply(channel.id, safeText, generation);
    return delivery.sentChunks > 0;
  }

  async loadSeen(generation) {
    return this.serializeJournal(async () => {
      if (generation !== this.generation) return;
      let handle, saved;
      try {
        handle = await open(this.dedupePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const info = await handle.stat();
        if (!info.isFile() || info.size > JOURNAL_MAX_BYTES)
          throw discordError('DISCORD_JOURNAL_FORMAT', 'Discord-journalen er ikke en understøttet, afgrænset fil.');
        const buffer = Buffer.alloc(JOURNAL_MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > JOURNAL_MAX_BYTES) throw new Error('Discord-journalen er for stor.');
        try { saved = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
        catch { throw discordError('DISCORD_JOURNAL_FORMAT', 'Discord-journalen indeholder ugyldig JSON.'); }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (this.seen.size || this.ingressGap) throw new Error('En kendt Discord-journal mangler. Gendan ikke automatisk over tidligere resultater.');
        saved = { schema: JOURNAL_SCHEMA, messages: [], retentionFloor: '0' };
      } finally { await handle?.close(); }
      if (generation !== this.generation) return;
      if (![1, JOURNAL_SCHEMA].includes(saved?.schema) || !Array.isArray(saved.messages) || saved.messages.length > DEDUPE_LIMIT)
        throw new Error('Discord-modtagelsesjournalen har et ukendt format eller nyere skema.');
      if (!saved.messages.every(item => typeof item?.id === 'string' && SNOWFLAKE.test(item.id) &&
        typeof item.channelId === 'string' && SNOWFLAKE.test(item.channelId) && ['received', 'completed', 'unknown'].includes(item.status) &&
        (item.at === undefined || (typeof item.at === 'string' && item.at.length <= 35 && (!item.at || Number.isFinite(Date.parse(item.at))))) &&
        (item.phase === undefined || ['waiting', 'processing'].includes(item.phase))) ||
        new Set(saved.messages.map(item => item.id)).size !== saved.messages.length)
        throw new Error('Discord-modtagelsesjournalen indeholder ugyldige eller dobbelte poster.');
      const floor = saved.retentionFloor ?? '0';
      if (typeof floor !== 'string' || (floor !== '0' && !SNOWFLAKE.test(floor)))
        throw new Error('Discord-journalens replay-grænse er ugyldig.');
      const gap = saved.ingressGap;
      if (gap !== undefined && gap !== null && (!/^[0-9a-f-]{36}$/.test(gap.id || '') ||
        !Number.isSafeInteger(gap.revision) || gap.revision < 1 || !Number.isInteger(gap.count) || gap.count < 1 || gap.count > 1_000_000 ||
        !['awaiting_resume', 'requires_review', 'recovered'].includes(gap.status) ||
        !['queue_capacity', 'session_stopped', 'resume_unavailable', 'restart', 'resumed'].includes(gap.reason) ||
        !SNOWFLAKE.test(String(gap.firstMessageId || '')) || !SNOWFLAKE.test(String(gap.channelId || '')) ||
        typeof gap.since !== 'string' || gap.since.length > 35 || !Number.isFinite(Date.parse(gap.since))))
        throw new Error('Discord-journalens leveringshul har et ugyldigt format.');
      const recovered = { retentionFloor: floor, ingressGap: gap ? {
        id: gap.id, revision: gap.revision, count: gap.count, status: gap.status, reason: gap.reason,
        firstMessageId: String(gap.firstMessageId), channelId: String(gap.channelId), since: gap.since,
        ...(gap.status === 'awaiting_resume' ? { status: 'requires_review', reason: 'restart', revision: gap.revision + 1 } : {}),
      } : null, seen: new Map(saved.messages.map(item => [item.id, {
        id: item.id, status: item.status === 'received' ? 'unknown' : item.status,
        phase: item.phase || 'processing', at: String(item.at || '').slice(0, 35), channelId: item.channelId,
      }])) };
      trimCompleted(recovered, this.maxJournalEntries);
      try { await this.persistSeen(recovered, true); }
      catch (error) {
        if (error.statePublished) this.publishJournal(recovered);
        throw error;
      }
      this.publishJournal(recovered);
      this.lastError = this.gapWarning();
    });
  }

  serializeJournal(action) {
    const operation = this.journalQueue.then(action);
    this.journalQueue = operation.catch(() => {});
    return operation;
  }

  publishJournal(snapshot) {
    this.seen = snapshot.seen;
    this.retentionFloor = snapshot.retentionFloor;
    this.ingressGap = snapshot.ingressGap || null;
  }

  async persistSeen(snapshot, durable) {
    if (!durable) return;
    await this.writeJournal(this.dedupePath, JSON.stringify({ schema: JOURNAL_SCHEMA,
      retentionFloor: snapshot.retentionFloor, ingressGap: snapshot.ingressGap || null, messages: [...snapshot.seen.values()] }));
  }

  changeJournal(change, { generation, durable, allowOldGeneration = false }) {
    return this.serializeJournal(async () => {
      if (!allowOldGeneration && generation !== this.generation) return false;
      if (this.dedupeFailure) throw discordError('DISCORD_JOURNAL_UNAVAILABLE', 'Discords modtagelsesjournal er ikke tilgængelig.');
      const draft = { seen: new Map([...this.seen].map(([id, item]) => [id, { ...item }])), retentionFloor: this.retentionFloor,
        ingressGap: this.ingressGap ? { ...this.ingressGap } : null };
      let result;
      try { result = change(draft); }
      catch (error) {
        if (error.code === 'DISCORD_JOURNAL_FULL') this.failJournal(error.message);
        throw error;
      }
      if (result === false) return false;
      try { await this.persistSeen(draft, durable); }
      catch (error) {
        if (error.statePublished) this.publishJournal(draft);
        this.failJournal('Discord-journalen kunne ikke opdateres sikkert. Ingen nye beskeder behandles før kontrol og genstart.');
        throw error;
      }
      this.publishJournal(draft);
      return result ?? true;
    });
  }

  rejectMessage(message) {
    this.rejectedMessageCount++;
    this.lastRejectedAt = new Date().toISOString();
    this.lastError = message;
  }

  async closeReceipt(context, status) {
    return this.changeJournal(draft => {
      const record = draft.seen.get(context.id);
      if (!record) throw new Error('Discord-kontrolpunktet mangler en varigt modtaget besked.');
      record.status = context.generation === this.generation ? status : 'unknown';
    }, { ...context, allowOldGeneration: true });
  }

  async processMessage(context) {
    if (context.generation !== this.generation) {
      await this.closeReceipt(context, 'unknown');
      return { accepted: true, outcome: 'unknown' };
    }
    const started = await this.changeJournal(draft => {
      const record = draft.seen.get(context.id);
      if (record?.status !== 'received' || record.phase !== 'waiting') return false;
      record.phase = 'processing';
    }, context);
    if (!started || context.generation !== this.generation) {
      await this.closeReceipt(context, 'unknown');
      return { accepted: true, outcome: 'unknown' };
    }
    let outcome = 'completed';
    let replyAttempted = false;
    this.lastFailure = null;
    try {
      const answer = await this.onMessage(context.content, context.metadata);
      if (context.generation !== this.generation) outcome = 'unknown';
      else {
        if (!String(answer || '').trim()) throw discordError('DISCORD_EMPTY_REPLY', 'Assistenten returnerede intet svar.');
        replyAttempted = true; await this.sendReply(context.channelId, answer, context.generation);
      }
    } catch (error) {
      outcome = 'unknown';
      if (context.generation === this.generation)
        this.lastError = 'Discord-beskeden havde et ukendt eller delvist resultat. Kontroller JARVIS før en ny handling.';
      const stage = replyAttempted ? 'delivery' : 'processing';
      // Only fixed public messages/codes enter status; never API bodies or user text.
      if (context.generation === this.generation) this.lastFailure = { at: new Date().toISOString(), stage,
        code: error.chatFailure?.code || (/^DISCORD_[A-Z_]+$/.test(error.code || '') ? error.code : 'ASSISTANT_FAILED'),
        message: replyAttempted ? 'Svaret kunne ikke leveres til Discord. Kontrollér bottens adgang til kanalen og Send Messages.'
          : error.chatFailure?.message || 'Beskeden blev modtaget, men assistenten kunne ikke færdiggøre den. Kontrollér API-opsætning og serverlog.' };
      this.logError('Discord-beskedfejl', error, context.token);
      if (!replyAttempted && context.generation === this.generation && !this.dedupeFailure) {
        const diagnostic = error.chatFailure?.message ? error.chatFailure.message + ' ' : '';
        try { await this.sendReply(context.channelId, diagnostic + (error.chatFailure?.outcome === 'no_actions'
          ? 'JARVIS nåede ikke at udføre handlinger. Beskeden er ikke genforsøgt.'
          : 'Jeg modtog din besked, men kunne ikke færdiggøre den. Kontrollér JARVIS, før du gentager en handling; noget kan allerede være udført. Se Discord-status under Indstillinger → Integrationer.'), context.generation); }
        catch (deliveryError) { this.logError('Discord-fejlbesked', deliveryError, context.token); }
      }
      // Never retry a handler or send a second response after an attempted reply.
    }
    await this.closeReceipt(context, outcome);
    if (context.generation !== this.generation) outcome = 'unknown';
    if (outcome === 'completed') this.lastMessageAt = new Date().toISOString();
    return { accepted: true, outcome };
  }

  async admitMessage(context, pending) {
    await context.ready;
    if (context.generation !== this.generation) return false;
    const received = await this.changeJournal(draft => {
      if (draft.seen.has(context.id)) return false;
      if (BigInt(context.id) <= BigInt(draft.retentionFloor)) {
        this.rejectMessage('En gammel Discord-besked ligger før replay-grænsen og blev ikke behandlet. Send en ny besked, hvis handlingen stadig ønskes.');
        return false;
      }
      // Unknown/received records are never discarded to make room. Dropping a
      // known completed record advances a durable anti-replay watermark.
      trimCompleted(draft, this.maxJournalEntries - 1);
      draft.seen.set(context.id, { id: context.id, channelId: context.channelId,
        status: 'received', phase: 'waiting', at: new Date().toISOString() });
    }, context);
    if (!received) return false;
    if (context.generation !== this.generation) {
      await this.closeReceipt(context, 'unknown');
      return true;
    }
    const queued = this.workQueue.enqueue('Discord-besked', () => this.processMessage(context));
    pending.queueId = queued.id;
    try { return (await queued.promise).accepted; }
    catch (error) {
      if (error.code === 'JOB_CANCELLED') {
        await this.closeReceipt(context, 'unknown');
        return true;
      }
      throw error;
    }
  }

  handleIncoming(event, generation = this.generation) {
    if (generation !== this.generation || event?.author?.id === this.botId) return Promise.resolve(false);
    const reason = discordMessageRejection(event, this.config);
    if (reason === 'bot') return Promise.resolve(false);
    const messages = { user: 'Besked afvist: afsenderen matcher ikke Dit Discord User ID.',
      guild: 'Besked afvist: serveren matcher ikke Discord Server ID. Brug en direkte besked eller ret Server ID.',
      invalid: 'Besked afvist: ugyldige besked-/kanaldata.', content: 'Besked afvist: manglende tekst eller over 5.000 tegn.',
      empty: 'Besked uden læsbart indhold. Kontrollér Message Content Intent ved serverchat.' };
    this.lastIncoming = { at: new Date().toISOString(), accepted: !reason,
      reason: reason || 'accepted', message: messages[reason] || 'Besked modtaget fra den tilladte bruger.' };
    if (reason) return Promise.resolve(false);
    const id = String(event.id);
    // Reserve a bounded slot before any async wait. A replay must not consume
    // another slot or retain another complete event while the first is running.
    if (this.pendingMessages.has(id)) return Promise.resolve(false);
    if (this.seen.has(id)) return Promise.resolve(false);
    if (this.pendingMessages.size >= this.workQueue.maxWaiting + 1) {
      this.rejectMessage('Discord-køen er fuld. Beskeden blev ikke behandlet.');
      return Promise.reject(discordError('DISCORD_QUEUE_FULL', this.lastError));
    }
    const token = this.config.token;
    const context = { id, channelId: String(event.channel_id), generation, durable: this.dedupeEnabled,
      ready: this.dedupeReady, token, content: redactSecrets(event.content.trim(), [token]),
      metadata: { ...redactSecrets(discordMessageMetadata(event), [token]), guildId: event.guild_id || '', ownerId: event.author.id } };
    const pending = { queueId: null };
    this.pendingMessages.set(id, pending);
    const operation = this.admitMessage(context, pending).finally(() => {
      if (this.pendingMessages.get(id) === pending) this.pendingMessages.delete(id);
      this.resumeIngress();
      this.finishResume();
    });
    return operation;
  }
}
