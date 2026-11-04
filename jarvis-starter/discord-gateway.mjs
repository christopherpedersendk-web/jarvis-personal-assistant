// Discord Gateway v10. Ingen eksterne npm-afhængigheder (Node.js 22+).
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discordImageAttachment } from './recipe-fetch.mjs';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const SNOWFLAKE = /^\d{15,22}$/;
const DEDUPE_LIMIT = 2000;
const DEFAULT_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

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
  if (userId && !SNOWFLAKE.test(userId)) throw new Error('Discord User ID skal være et numerisk Discord-ID.');
  if (guildId && !SNOWFLAKE.test(guildId)) throw new Error('Discord Server ID skal være et numerisk Discord-ID.');
  if (guildId && !userId) throw new Error('Angiv først dit Discord User ID.');
  return { userId, guildId };
}

export function authorizedDiscordMessage(event, config) {
  if (!config.userId || event?.author?.id !== config.userId || event?.author?.bot) return false;
  if (!SNOWFLAKE.test(String(event.channel_id || '')) || !SNOWFLAKE.test(String(event.id || '')) || event.webhook_id) return false;
  if (event.guild_id && (!config.guildId || event.guild_id !== config.guildId)) return false;
  if (typeof event.content !== 'string' || event.content.trim().length > 5000) return false;
  return Boolean(event.content.trim()) || discordMessageMetadata(event).attachments.length > 0;
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
  constructor({ onMessage, fetcher = fetch, socketFactory = url => new WebSocket(url),
    dataDirectory = process.env.JARVIS_DATA_DIR || DEFAULT_DATA_DIR,
    scheduleRetry = (callback, ms) => setTimeout(callback, ms) }) {
    this.onMessage = onMessage;
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.scheduleRetry = scheduleRetry;
    this.dedupePath = join(dataDirectory, 'discord-received.json');
    this.status = 'disabled';
    this.config = {};
    this.generation = 0;
    this.lastError = '';
    this.seen = new Map();
    this.incomingQueue = Promise.resolve();
    this.dedupeEnabled = false;
    this.dedupeReady = Promise.resolve();
    this.awaitingHeartbeatAck = false;
    this.lastHeartbeatSentAt = null;
    this.lastHeartbeatAckAt = null;
    this.lastConnectedAt = null;
    this.lastMessageAt = null;
  }

  snapshot() {
    return { status: this.status, lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt, lastHeartbeatSentAt: this.lastHeartbeatSentAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt, awaitingHeartbeatAck: this.awaitingHeartbeatAck,
      lastMessageAt: this.lastMessageAt, reconnectAttempts: this.retryCount || 0,
      dedupeStatus: this.dedupeEnabled ? (this.dedupeFailure ? 'error' : 'active') : 'inactive',
      unknownMessageCount: [...this.seen.values()].filter(item => item.status === 'unknown').length };
  }

  clearHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.awaitingHeartbeatAck = false;
  }

  stop() {
    this.generation++;
    this.clearHeartbeat();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.status = 'disabled';
  }

  start(config) {
    this.stop();
    this.config = { ...config };
    this.lastError = '';
    this.retryCount = 0;
    this.sequence = null;
    this.sessionId = null;
    this.resumeGateway = '';
    this.botId = null;
    this.dedupeFailure = false;
    this.seen = new Map();
    this.incomingQueue = Promise.resolve();
    this.dedupeEnabled = Boolean(config.enabled && config.token && config.userId);
    const generation = this.generation;
    this.dedupeReady = this.dedupeEnabled ? this.loadSeen(generation).catch(error => {
      if (generation !== this.generation) return;
      this.dedupeFailure = true;
      this.lastError = 'Discord-indbakken kan ikke åbnes sikkert. Genstart efter kontrol af lagring.';
      this.status = 'error';
      console.error('Discord-indbakke:', error.message);
    }) : Promise.resolve();
    if (!config.enabled || !config.token || !config.userId) return;
    this.connect(this.generation);
  }

  connect(generation) {
    if (generation !== this.generation) return;
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
    this.sessionId = null;
    this.sequence = null;
    this.resumeGateway = '';
  }

  forceReconnect(reason, generation = this.generation) {
    if (generation !== this.generation) return;
    this.lastError = reason;
    const socket = this.socket;
    this.socket = null;
    this.clearHeartbeat();
    try { socket?.close(); } catch { /* reconnect still needed */ }
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
    if (generation !== this.generation || this.retryTimer) return;
    this.status = 'reconnecting';
    const pause = Math.min(30_000, 1000 * (2 ** Math.min(this.retryCount++, 5)));
    this.retryTimer = this.scheduleRetry(() => {
      this.retryTimer = null;
      this.connect(generation);
    }, pause);
    this.retryTimer.unref?.();
  }

  handleGatewayMessage(event, generation) {
    if (generation !== this.generation) return;
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (Number.isSafeInteger(packet.s) && packet.s >= 0) this.sequence = packet.s;
    if (packet.op === 10) {
      this.clearHeartbeat();
      const interval = packet.d?.heartbeat_interval;
      if (!Number.isFinite(interval) || interval < 1000 || interval > 120_000) {
        this.forceReconnect('Discord sendte et ugyldigt heartbeat-interval.', generation);
        return;
      }
      this.heartbeat = setInterval(() => this.sendHeartbeat(), interval);
      this.heartbeat.unref?.();
      this.sendGateway(this.sessionId && this.sequence !== null
        ? { op: 6, d: { token: this.config.token, session_id: this.sessionId, seq: this.sequence } }
        : { op: 2, d: { token: this.config.token, intents: INTENTS, properties: { os: 'windows', browser: 'jarvis', device: 'jarvis' } } });
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
      this.sessionId = typeof packet.d?.session_id === 'string' ? packet.d.session_id : null;
      this.resumeGateway = safeResumeGateway(packet.d?.resume_gateway_url);
      this.botId = packet.d?.user?.id;
      this.retryCount = 0;
      this.status = this.dedupeFailure ? 'error' : 'connected';
      if (!this.dedupeFailure) this.lastError = '';
      this.lastConnectedAt = new Date().toISOString();
    } else if (packet.op === 0 && packet.t === 'RESUMED') {
      this.status = this.dedupeFailure ? 'error' : 'connected';
      this.retryCount = 0;
      if (!this.dedupeFailure) this.lastError = '';
      this.lastConnectedAt = new Date().toISOString();
    } else if (packet.op === 0 && packet.t === 'MESSAGE_CREATE') {
      this.handleIncoming(packet.d, generation).catch(error => {
        this.lastError = 'Discord-indbakken kunne ikke behandle beskeden.';
        console.error('Discord-indbakke:', error.message);
      });
    }
  }

  async sendReply(channelId, text, generation) {
    if (generation !== this.generation) return;
    for (const content of splitDiscordMessage(text)) {
      if (generation !== this.generation) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.fetcher(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST', headers: { Authorization: `Bot ${this.config.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(20_000),
        });
        if (response.ok) break;
        if (response.status === 429 && attempt < 2) {
          const delay = Math.min(10_000, Math.max(500, Number((await response.json()).retry_after || 1) * 1000));
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`Discord kunne ikke modtage svaret (${response.status}).`);
      }
    }
  }

  async notifyOwner(text) {
    if (this.status !== 'connected' || !this.config.userId || !this.config.token) return false;
    const generation = this.generation;
    const response = await this.fetcher('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: this.config.userId }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Discord DM kunne ikke åbnes (${response.status}).`);
    const channel = await response.json();
    if (!SNOWFLAKE.test(String(channel.id || ''))) throw new Error('Discord returnerede ugyldig DM-kanal.');
    await this.sendReply(channel.id, String(text).slice(0, 3800), generation);
    return true;
  }

  async loadSeen(generation) {
    let saved;
    try { saved = JSON.parse(await readFile(this.dedupePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (generation !== this.generation) return;
    if (saved?.schema !== 1 || !Array.isArray(saved.messages))
      throw new Error('Discord-modtagelsesjournalen har et ukendt format.');
    if (!saved.messages.every(item =>
      SNOWFLAKE.test(String(item?.id || '')) &&
      ['received', 'completed', 'unknown'].includes(item?.status)))
      throw new Error('Discord-modtagelsesjournalen indeholder ugyldige poster.');
    const entries = saved.messages.slice(-DEDUPE_LIMIT);
    const interrupted = entries.some(item => item.status === 'received');
    this.seen = new Map(entries.map(item => [item.id, {
      id: item.id, status: item.status === 'received' ? 'unknown' : item.status,
      at: String(item.at || '').slice(0, 35),
      channelId: String(item.channelId || '').slice(0, 25),
    }]));
    // Work interrupted by a restart cannot be assumed completed or replayed.
    if (interrupted && generation === this.generation) await this.persistSeen();
  }

  async persistSeen() {
    if (!this.dedupeEnabled) return;
    await mkdir(dirname(this.dedupePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.dedupePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ schema: 1, messages: [...this.seen.values()].slice(-DEDUPE_LIMIT) }),
        { flag: 'wx', mode: 0o600 });
      await rename(tmp, this.dedupePath);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
  }

  handleIncoming(event, generation = this.generation) {
    if (generation !== this.generation || !authorizedDiscordMessage(event, this.config) || event.author.id === this.botId)
      return Promise.resolve(false);
    // Serialize duplicate checks and their write-ahead records. A replay
    // arriving during a long-running handler must never invoke it twice.
    const operation = this.incomingQueue.then(async () => {
      await this.dedupeReady;
      if (generation !== this.generation) return false;
      if (this.dedupeFailure) throw new Error('Discords modtagelsesjournal er ikke tilgængelig.');
      if (this.seen.has(event.id)) return false;
      const received = { id: event.id, channelId: event.channel_id, status: 'received',
        at: new Date().toISOString() };
      this.seen.set(event.id, received);
      while (this.seen.size > DEDUPE_LIMIT) this.seen.delete(this.seen.keys().next().value);
      try { await this.persistSeen(); }
      catch (error) {
        this.seen.delete(event.id);
        this.dedupeFailure = true;
        this.status = 'error';
        this.lastError = 'Discord-beskeden blev ikke modtaget sikkert, fordi lagring fejlede.';
        throw error;
      }
      try {
        const answer = await this.onMessage(event.content.trim(), discordMessageMetadata(event));
        if (generation !== this.generation) return true; // Already processed; never reply from an old session.
        await this.sendReply(event.channel_id, answer, generation);
        received.status = 'completed';
        this.lastMessageAt = new Date().toISOString();
      } catch (error) {
        // The handler or Discord delivery might have had a partial effect.
        // Preserve the message ID and require a new user decision to retry.
        received.status = 'unknown';
        this.lastError = 'Discord-beskeden havde et ukendt eller delvist resultat. Se serverloggen.';
        console.error('Discord-beskedfejl:', error.message);
        if (generation === this.generation) {
          try { await this.sendReply(event.channel_id,
            'Beklager, jeg kunne ikke bekræfte resultatet. Kontroller venligst JARVIS, før du sender handlingen igen.',
            generation); } catch { /* delivery itself may be unknown */ }
        }
      }
      try { await this.persistSeen(); }
      catch (error) {
        this.dedupeFailure = true;
        this.status = 'error';
        this.lastError = 'Discords modtagelsesjournal kunne ikke opdateres. Udfaldet er ukendt.';
        console.error('Discord-indbakke:', error.message);
      }
      return true;
    });
    this.incomingQueue = operation.catch(() => {});
    return operation;
  }
}
