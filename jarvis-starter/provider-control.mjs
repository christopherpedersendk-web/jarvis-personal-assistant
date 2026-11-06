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
    this.context = new AsyncLocalStorage(); this.active = new Set(); this.activeScopes = new Map(); this.revokedScopes = new Set();
    this.limits = {
      hostedToolCallsPerDay: limit(env.JARVIS_HOSTED_TOOL_CALLS_PER_DAY, 100, 10000),
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
    if (this.revokedScopes.has(scope.requestId) || this.settings().stopped || scope.generation !== this.settings().generation)
      throw fail('ASSISTANT_STOPPED', 'Assistenten er stoppet. Gennemgå igangværende handlinger før genoptagelse.');
  }
  revoke(scope) {
    this.revokedScopes.add(scope.requestId);
    for(const [controller,id] of this.activeScopes) if(id===scope.requestId)controller.abort();
  }
  // Shared stop boundary for non-model reads. An old operation cannot publish
  // a result after stop/resume, even if its transport ignores cancellation.
  async controlled(operation, scope = this.current()) {
    this.assertAllowed(scope);
    const controller = new AbortController(); this.active.add(controller); this.activeScopes.set(controller,scope.requestId);
    try {
      const result = await operation(controller.signal);
      this.assertAllowed(scope);
      return result;
    } finally { this.active.delete(controller); this.activeScopes.delete(controller); }
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
      calls: entries.length, reservedHostedToolCalls: entries.reduce((n,e)=>n+(e.reservedHostedToolCalls||0),0), reservedOrUsedOutputTokens: entries.reduce((n, e) => n + charge(e), 0),
      unresolved: entries.filter(e => unresolved(e)).length,
      coverage: 'Responses and OpenClaw request admission; hosted tools use reserved invocation limits. Realtime and Discord voice have separate wall-clock reservations; Discord audio requests consume request slots. No measured audio tokens or currency budget.',
      recent: s.entries.slice(-30).map(e => ({ ...e })) };
  }
  async reserve(body, scope = this.current()) {
    this.assertAllowed(scope);
    if (this.isTransactionActive()) throw fail('API_TRANSACTION_SCOPE', 'Modelkald må ikke starte inde i en ugemt datatransaktion.');
    const reservedOutput = body.max_output_tokens ?? 3500;
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    const hosted = (body.tools || []).some(t => t.type !== 'function');
    const reservedHostedToolCalls = hosted ? body.max_tool_calls : 0;
    if (hosted && (!Number.isSafeInteger(reservedHostedToolCalls) || reservedHostedToolCalls < 1 || reservedHostedToolCalls > 10))
      throw fail('API_REQUEST_LIMIT', 'Hosted tools kræver en eksplicit grænse på 1–10 kald.');
    if (!Number.isSafeInteger(reservedOutput) || reservedOutput < 1 || reservedOutput > this.limits.outputTokensPerCall || inputBytes > this.limits.inputBytesPerCall)
      throw fail('API_REQUEST_LIMIT', 'Anmodningen overstiger den konfigurerede størrelse eller outputgrænse.');
    return this.transact(['providerControl'], async () => {
      this.assertAllowed(scope);
      const summary = this.snapshot();
      if (summary.reservedHostedToolCalls + reservedHostedToolCalls > this.limits.hostedToolCallsPerDay || summary.calls >= this.limits.callsPerDay || summary.reservedOrUsedOutputTokens + reservedOutput > this.limits.outputTokensPerDay)
        throw fail('API_BUDGET_LIMIT', 'Dagens API-grænse er nået. Uafklarede kald tæller fortsat med.');
      const s = this.settings();
      const retained = s.entries.filter(e => unresolved(e) || e.day >= day(new Date(this.now().getTime() - 30 * 86400000)));
      if (retained.length >= 5000) throw fail('API_LEDGER_FULL', 'Forbrugsjournalen kræver gennemgang før nye kald.');
      const record = { id: randomUUID(), requestId: scope.requestId, day: day(this.now()),
        model: String(body.model || '').slice(0, 100), inputBytes, reservedOutput, reservedHostedToolCalls, inputTokens: null, outputTokens: null,
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
  async externalSearch(operation) {
    const scope=this.current();
    const id=await this.reserve({model:'openclaw.web_search',max_output_tokens:1},scope);
    try {
      const result=await this.controlled(operation,scope);
      // The gateway does not report model tokens. Unknown is not measured zero.
      await this.settle(id,null,'completed');
      return result;
    } catch(error) { await this.settle(id,null,'unknown').catch(()=>{});throw error; }
  }
  async request(path, options, send) {
    const scope = this.current(); this.assertAllowed(scope);
    const creates = path === '/responses' && options.method === 'POST';
    const body = creates ? { ...options.body, max_output_tokens: options.body?.max_output_tokens ?? 3500 } : options.body;
    if (creates && (body.tools || []).some(t=>t.type !== 'function') && body.max_tool_calls === undefined) body.max_tool_calls=2;
    const id = creates ? await this.reserve(body, scope) : null;
    const controller = new AbortController(); this.active.add(controller); this.activeScopes.set(controller,scope.requestId);
    let settled=false;
    try {
      this.assertAllowed(scope);
      const result = await send(path, { ...options, body, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
      const recordId = id || this.settings().entries.find(e => e.responseId && path === `/responses/${e.responseId}`)?.id;
      if (recordId) await this.settle(recordId, result, ['queued', 'in_progress'].includes(result.status) ? 'pending' : result.status || 'completed');
      settled=true;this.assertAllowed(scope);
      return result;
    } catch (error) {
      if (id && !settled) await this.settle(id, null, 'unknown').catch(() => {});
      error.requestId = scope.requestId;
      throw error;
    } finally { this.active.delete(controller); this.activeScopes.delete(controller); }
  }
}
