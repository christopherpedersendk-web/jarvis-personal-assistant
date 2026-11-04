// Discord Gateway v10. Ingen eksterne npm-afhængigheder (Node.js 22+).
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const SNOWFLAKE = /^\d{15,22}$/;

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
  if (!SNOWFLAKE.test(String(event.channel_id || ''))) return false;
  if (event.guild_id && (!config.guildId || event.guild_id !== config.guildId)) return false;
  return typeof event.content === 'string' && event.content.trim().length > 0 && event.content.trim().length <= 5000;
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
  constructor({ onMessage, fetcher = fetch, socketFactory = url => new WebSocket(url) }) {
    this.onMessage = onMessage;
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.status = 'disabled';
    this.config = {};
    this.generation = 0;
    this.lastError = '';
  }

  snapshot() { return { status: this.status, lastError: this.lastError }; }

  stop() {
    this.generation++;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
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
    this.botId = null;
    if (!config.enabled || !config.token || !config.userId) return;
    this.connect(this.generation);
  }

  connect(generation) {
    if (generation !== this.generation) return;
    this.status = this.retryCount ? 'reconnecting' : 'connecting';
    try {
      const socket = this.socketFactory('wss://gateway.discord.gg/?v=10&encoding=json');
      this.socket = socket;
      socket.addEventListener('message', event => this.handleGatewayMessage(event, generation));
      socket.addEventListener('close', event => {
        if (generation !== this.generation) return;
        clearInterval(this.heartbeat);
        if ([4004, 4013, 4014].includes(event.code)) {
          this.status = 'error';
          this.lastError = event.code === 4014 ? 'Message Content Intent mangler i Discord Developer Portal.' : `Discord afviste botten (kode ${event.code}).`;
          return;
        }
        this.reconnect(generation);
      });
      socket.addEventListener('error', () => {
        if (generation === this.generation) this.lastError = 'Forbindelsen til Discord fejlede.';
      });
    } catch {
      this.lastError = 'Kunne ikke etablere Discord-forbindelse.';
      this.reconnect(generation);
    }
  }

  sendGateway(payload) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(payload));
  }

  reconnect(generation) {
    if (generation !== this.generation || this.retryTimer) return;
    this.status = 'reconnecting';
    const pause = Math.min(30_000, 1000 * (2 ** Math.min(this.retryCount++, 5)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(generation);
    }, pause);
    this.retryTimer.unref?.();
  }

  handleGatewayMessage(event, generation) {
    if (generation !== this.generation) return;
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (packet.s !== null && packet.s !== undefined) this.sequence = packet.s;
    if (packet.op === 10) {
      clearInterval(this.heartbeat);
      const interval = packet.d.heartbeat_interval;
      if (!Number.isFinite(interval) || interval < 1000) return;
      this.heartbeat = setInterval(() => this.sendGateway({ op: 1, d: this.sequence }), interval);
      this.heartbeat.unref?.();
      this.sendGateway(this.sessionId && this.sequence !== null
        ? { op: 6, d: { token: this.config.token, session_id: this.sessionId, seq: this.sequence } }
        : { op: 2, d: { token: this.config.token, intents: INTENTS, properties: { os: 'windows', browser: 'jarvis', device: 'jarvis' } } });
    } else if (packet.op === 7) {
      this.socket?.close();
    } else if (packet.op === 9) {
      this.sessionId = null;
      this.sequence = null;
      this.socket?.close();
    } else if (packet.op === 0 && packet.t === 'READY') {
      this.sessionId = packet.d?.session_id;
      this.botId = packet.d?.user?.id;
      this.retryCount = 0;
      this.status = 'connected';
      this.lastError = '';
    } else if (packet.op === 0 && packet.t === 'RESUMED') {
      this.status = 'connected';
      this.retryCount = 0;
    } else if (packet.op === 0 && packet.t === 'MESSAGE_CREATE') {
      this.handleIncoming(packet.d, generation).catch(() => {});
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

  async handleIncoming(event, generation = this.generation) {
    if (generation !== this.generation || !authorizedDiscordMessage(event, this.config) || event.author.id === this.botId) return false;
    // Undgå dobbeltbehandling efter Gateway-resume.
    if (!this.seen) this.seen = new Set();
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    if (this.seen.size > 500) this.seen.clear();
    try {
      const answer = await this.onMessage(event.content.trim());
      await this.sendReply(event.channel_id, answer, generation);
    } catch (error) {
      this.lastError = 'Discord-beskeden kunne ikke behandles. Se serverloggen.';
      console.error('Discord-beskedfejl:', error.message);
      try { await this.sendReply(event.channel_id, 'Beklager, jeg kunne ikke behandle beskeden lige nu.', generation); } catch { /* intet svar muligt */ }
    }
    return true;
  }
}
