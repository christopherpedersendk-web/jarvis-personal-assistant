// Test-only preload: no OpenAI, Discord or other account is contacted.
// The parent receives timings, never request contents or credentials.
import { setTimeout as delay } from 'node:timers/promises';
if (process.env.JARVIS_SYNTHETIC_PERF !== 'yes') throw new Error('Performance preload requires explicit synthetic mode.');
let calls = 0;
globalThis.fetch = async (target, options = {}) => {
  const url = String(target);
  if (url !== 'https://api.openai.com/v1/responses' || options.method !== 'POST') {
    process.send?.({ type: 'perf-unexpected-network', destination: new URL(url).origin });
    throw new Error('Network disabled by synthetic performance test.');
  }
  const number = ++calls, body = JSON.parse(options.body || '{}'), started = performance.now();
  process.send?.({ type: 'perf-model-start', number,
    inputCharacters: JSON.stringify(body.input || []).length, instructionCharacters: String(body.instructions || '').length });
  const simulatedWaitMs = Number(process.env.JARVIS_SYNTHETIC_WAIT_MS || 200);
  await delay(simulatedWaitMs, undefined, options.signal ? { signal: options.signal } : {});
  process.send?.({ type: 'perf-model-end', number, simulatedWaitMs, measuredWaitMs: performance.now() - started });
  return new Response(JSON.stringify({ id: `synthetic-perf-${number}`, status: 'completed', output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Syntetisk målesvar uden værktøjskald eller ekstern behandling.' }] },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
globalThis.WebSocket = class {
  constructor() { process.send?.({ type: 'perf-unexpected-network', destination: 'WebSocket' }); throw new Error('WebSocket disabled in synthetic performance test.'); }
};
