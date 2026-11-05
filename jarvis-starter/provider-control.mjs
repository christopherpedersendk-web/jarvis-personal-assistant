import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const fail = (code, message) => Object.assign(new Error(message), { code, noActionTaken: true });
const unresolved = e => ['reserved', 'unknown', 'pending'].includes(e.status) || e.outputTokens === null;
const day = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
function limit(value, fallback, max) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Ugyldig API-forbrugsgrænse.');
  return n;
}

/** Server-side Responses admission, not an invoice or a Realtime token meter.
 * Reserve BEFORE sending. Missing usage/timeouts keep the entire reservation,
 * including across restart and midnight. No prompt, credential or raw error is stored.
 */
export class ProviderControl {
  constructor({ state, transact, save, now = () => new Date(), env = {}, isTransactionActive = () => false }) {
    this.state = state; this.transact = transact; this.save = save; this.now = now;
    this.isTransactionActive = isTransactionActive;
    this.context = new AsyncLocalStorage(); this.active = new Set();
    this.limits = {
      callsPerDay: limit(env.JARVIS_API_CALLS_PER_DAY, 200, 10000),
      outputTokensPerDay: limit(env.JARVIS_API_OUTPUT_TOKENS_PER_DAY, 300000, 10000000),
      inputBytesPerCall: limit(env.JARVIS_API_INPUT_BYTES, 512000, 2000000),
      outputTokensPerCall: limit(env.JARVIS_API_OUTPUT_TOKENS_PER_CALL, 22000, 100000),
    };
  }
  settings() { return this.state.providerControl || { stopped: false, generation: 0, entries: [] }; }
  scope() { return { requestId: randomUUID(), generation: this.settings().generation }; }
  run(fn, scope = this.scope()) { return this.context.run(scope, fn); }
  current() { return this.context.getStore() || this.scope(); }
  assertAllowed(scope = this.current()) {
    if (this.settings().stopped || scope.generation !== this.settings().generation)
      throw fail('ASSISTANT_STOPPED', 'Assistenten er stoppet. Gennemgå igangværende handlinger før genoptagelse.');
  }
  async stop(stopped) {
    if (typeof stopped !== 'boolean') throw new Error('Angiv stop eller genoptagelse.');
    await this.transact(['providerControl'], async () => {
      const old = this.settings();
      this.state.providerControl = { ...old, stopped, generation: old.generation + 1 };
      await this.save();
    });
    if (stopped) for (const controller of this.active) controller.abort();
    return this.snapshot();
  }
  snapshot() {
    const s = this.settings(), today = day(this.now());
    const entries = s.entries.filter(e => e.day === today || unresolved(e));
    const charge = e => Number.isSafeInteger(e.outputTokens) ? e.outputTokens : e.reservedOutput;
    return { stopped: s.stopped, day: today, limits: this.limits,
      calls: entries.length, reservedOrUsedOutputTokens: entries.reduce((n, e) => n + charge(e), 0),
      unresolved: entries.filter(e => unresolved(e)).length,
      coverage: 'Responses API; Realtime audio usage is not included. Not a currency budget.',
      recent: s.entries.slice(-30).map(e => ({ ...e })) };
  }
  async reserve(body, scope = this.current()) {
    this.assertAllowed(scope);
    if (this.isTransactionActive()) throw fail('API_TRANSACTION_SCOPE', 'Modelkald må ikke starte inde i en ugemt datatransaktion.');
    const reservedOutput = body.max_output_tokens ?? 3500;
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    if (!Number.isSafeInteger(reservedOutput) || reservedOutput < 1 || reservedOutput > this.limits.outputTokensPerCall || inputBytes > this.limits.inputBytesPerCall)
      throw fail('API_REQUEST_LIMIT', 'Anmodningen overstiger den konfigurerede størrelse eller outputgrænse.');
    return this.transact(['providerControl'], async () => {
      this.assertAllowed(scope);
      const summary = this.snapshot();
      if (summary.calls >= this.limits.callsPerDay || summary.reservedOrUsedOutputTokens + reservedOutput > this.limits.outputTokensPerDay)
        throw fail('API_BUDGET_LIMIT', 'Dagens API-grænse er nået. Uafklarede kald tæller fortsat med.');
      const s = this.settings();
      const retained = s.entries.filter(e => unresolved(e) || e.day >= day(new Date(this.now().getTime() - 30 * 86400000)));
      if (retained.length >= 5000) throw fail('API_LEDGER_FULL', 'Forbrugsjournalen kræver gennemgang før nye kald.');
      const record = { id: randomUUID(), requestId: scope.requestId, day: day(this.now()),
        model: String(body.model || '').slice(0, 100), inputBytes, reservedOutput, inputTokens: null, outputTokens: null,
        status: 'reserved', startedAt: this.now().toISOString(), durationMs: null, responseId: null };
      this.state.providerControl = { ...s, entries: [...retained, record] };
      await this.save();
      return record.id;
    });
  }
  async settle(id, result, status = 'completed') {
    await this.transact(['providerControl'], async () => {
      const record = this.settings().entries.find(e => e.id === id);
      if (!record) throw new Error('API-reservationen findes ikke.');
      record.status = status;
      record.durationMs = Math.max(0, this.now().getTime() - Date.parse(record.startedAt));
      if (typeof result?.id === 'string' && /^resp_[A-Za-z0-9_-]{1,200}$/.test(result.id)) record.responseId = result.id;
      if (['completed', 'failed', 'cancelled', 'incomplete'].includes(status)) {
        for (const [target, key] of [['inputTokens', 'input_tokens'], ['outputTokens', 'output_tokens']])
          if (Number.isSafeInteger(result?.usage?.[key]) && result.usage[key] >= 0) record[target] = result.usage[key];
      }
      await this.save();
    });
  }
  async request(path, options, send) {
    const scope = this.current(); this.assertAllowed(scope);
    const creates = path === '/responses' && options.method === 'POST';
    const body = creates ? { ...options.body, max_output_tokens: options.body?.max_output_tokens ?? 3500 } : options.body;
    const id = creates ? await this.reserve(body, scope) : null;
    const controller = new AbortController(); this.active.add(controller);
    try {
      this.assertAllowed(scope);
      const result = await send(path, { ...options, body, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
      const recordId = id || this.settings().entries.find(e => e.responseId && path === `/responses/${e.responseId}`)?.id;
      if (recordId) await this.settle(recordId, result, ['queued', 'in_progress'].includes(result.status) ? 'pending' : result.status || 'completed');
      return result;
    } catch (error) {
      if (id) await this.settle(id, null, 'unknown').catch(() => {});
      error.requestId = scope.requestId;
      throw error;
    } finally { this.active.delete(controller); }
  }
}
