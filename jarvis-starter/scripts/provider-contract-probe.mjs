import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assistantTools, voiceExtraTools } from '../assistant-tools.mjs';

export async function probeProvider({ model, apiKey, live = false, request = fetch, now = () => new Date() } = {}) {
  if (typeof model !== 'string' || !model || model.length > 100) throw new Error('Angiv den konfigurerede tekstmodel.');
  const tools = [...assistantTools, ...voiceExtraTools].map(t => ({ ...t, strict: false }));
  const catalogHash = createHash('sha256').update(JSON.stringify(tools)).digest('hex');
  const report = { at: now().toISOString(), model, catalogHash, toolCount: tools.length, live, status: 'not_run',
    scope: 'Responses schema acceptance only; no tool handler, private context or Realtime session is executed.' };
  if (!live) return report;
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-') || apiKey.includes('REPLACE')) throw new Error('API-nøgle mangler; ingen prøve udført.');
  const started = Date.now();
  const response = await request('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model, input: 'Svar kort: OK. Dette er en syntetisk formatprøve.', tools, tool_choice: 'none', max_output_tokens: 128, store: false }),
  });
  const result = await response.json().catch(() => ({}));
  // Fixed error reporting: never print upstream bodies, headers or credentials.
  return { ...report, status: response.ok && typeof result.id === 'string' && !result.error &&
    !result.output?.some(item => item.type === 'function_call') ? 'accepted' : 'rejected',
    httpStatus: response.status, durationMs: Date.now() - started };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await probeProvider({ model: process.env.OPENAI_TEXT_MODEL, apiKey: process.env.OPENAI_API_KEY, live: process.argv.includes('--live') });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'rejected') process.exitCode = 1;
  } catch { console.error('Formatprøven kunne ikke gennemføres. Kontrollér model, API-adgang og forbindelse. Ingen automatisk gentagelse.'); process.exitCode = 1; }
}
