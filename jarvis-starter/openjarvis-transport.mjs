// Shared bounded transport; never echoes upstream bodies, retries, or follows redirects.
export class OpenJarvisError extends Error {
  constructor(code, message, outcome = 'not_started') {
    super(message); this.code = code; this.outcome = outcome; this.retryable = false;
  }
}
export function localEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('OpenJarvis kræver en lokal 127.0.0.1 gateway uden URL-parametre.');
  return url;
}
export async function boundedJson(fetcher, url, options, {signal, timeoutMs = 20000, maxBytes = 100000} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let response;
  try {
    combined.throwIfAborted();
    response = await fetcher(url, {...options, redirect:'error', signal:combined});
    if (!response.ok) {
      await response.body?.cancel();
      const code = response.status === 401 ? 'AUTH_REJECTED' : [403,404].includes(response.status) ? 'TOOL_FORBIDDEN' : response.status===429 ? 'GATEWAY_RATE_LIMIT' : 'GATEWAY_REJECTED';
      throw new OpenJarvisError(code, code==='GATEWAY_RATE_LIMIT' ? 'OpenClaws forespørgselsgrænse er nået. Vent og prøv senere; der genforsøges ikke automatisk.' : `OpenClaw afviste anmodningen (${response.status}).`, 'rejected');
    }
    let size = 0; const chunks = [];
    if (!response.body) throw new OpenJarvisError('INVALID_RESPONSE','OpenClaw returnerede et tomt svar.', 'unknown');
    for await (const chunk of response.body) {
      combined.throwIfAborted();
      size += chunk.length;
      if (size > maxBytes) throw new OpenJarvisError('RESPONSE_TOO_LARGE','OpenClaw-svaret er for stort.', 'unknown');
      chunks.push(Buffer.from(chunk));
    }
    combined.throwIfAborted();
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
    catch { throw new OpenJarvisError('INVALID_RESPONSE','OpenClaw returnerede et ugyldigt svar.', 'unknown'); }
  } catch (error) {
    if (error instanceof OpenJarvisError) throw error;
    throw new OpenJarvisError(signal?.aborted ? 'STOPPED' : deadline.aborted ? 'TIMEOUT' : 'GATEWAY_UNAVAILABLE',
      'OpenJarvis-kaldet blev afbrudt eller kunne ikke bekræftes. Ingen automatisk gentagelse.', 'unknown');
  }
}
