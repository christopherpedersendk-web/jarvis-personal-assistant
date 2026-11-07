import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

// Recipe URLs are untrusted input. DNS is checked, then pinned to the checked
// address for the actual TLS connection. Every redirect repeats these checks.
// Never pass a cookie, account token, environment proxy or caller headers here.
export const MAX_RECIPE_IMAGE_BYTES = 2_000_000;
const MAX_HTML_BYTES = 1_000_000;
const IPV4_BLOCKED = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
  IPV4_BLOCKED.addSubnet(address, prefix, 'ipv4');
}
const IPV6_GLOBAL = new BlockList(); IPV6_GLOBAL.addSubnet('2000::', 3, 'ipv6');
const IPV6_BLOCKED = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  IPV6_BLOCKED.addSubnet(address, prefix, 'ipv6');
}
const SNOWFLAKE = /^\d{15,22}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MEDIA_TYPES = new Set([...IMAGE_TYPES, 'video/mp4', 'video/webm']);

export class RecipeFetchError extends Error {
  constructor(code, message) { super(message); this.name = 'RecipeFetchError'; this.code = code; }
}

export function publicInternetAddress(address) {
  const kind = isIP(address);
  if (kind === 4) return !IPV4_BLOCKED.check(address, 'ipv4');
  if (kind === 6) return IPV6_GLOBAL.check(address, 'ipv6') && !IPV6_BLOCKED.check(address, 'ipv6');
  return false;
}

export function recipeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new RecipeFetchError('blocked', 'Linket er ugyldigt eller for langt.');
  let url;
  try { url = new URL(value); } catch { throw new RecipeFetchError('blocked', 'Linket er ikke en gyldig URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new RecipeFetchError('blocked', 'Brug kun offentlige HTTPS-links uden loginoplysninger eller særlige porte.');
  }
  if ([...url.searchParams.keys()].some(key => /^(?:token|access_token|refresh_token|api_?key|password|passwd|secret|authorization|signature)$/i.test(key))) {
    throw new RecipeFetchError('blocked', 'Links med loginoplysninger eller hemmelige adgangsparametre gemmes ikke.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url;
}

function publicHost(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || /\.$/.test(host) || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host) ||
    (!isIP(host) && !host.includes('.')) || (isIP(host) && !publicInternetAddress(host))) {
    throw new RecipeFetchError('blocked', 'Private, lokale og reserverede netværksadresser må ikke hentes.');
  }
  return host;
}

export function discordImageAttachment(value, { channelId } = {}) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '');
  const extension = String(value.filename || '').match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
  const fallbackType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[extension] || '';
  // content_type is optional in Discord's schema. A filename hint is accepted
  // only provisionally; the HTTP MIME and image magic must still match later.
  const contentType = String(value.contentType || value.content_type || fallbackType).split(';')[0].trim().toLowerCase();
  const size = Number(value.size);
  if (!SNOWFLAKE.test(id) || !IMAGE_TYPES.has(contentType) || !Number.isInteger(size) || size < 1 || size > MAX_RECIPE_IMAGE_BYTES) return null;
  let url;
  try { url = new URL(value.url); } catch { return null; }
  const path = url.pathname.match(/^\/attachments\/(\d{15,22})\/(\d{15,22})\/[^/]+$/);
  let filename;
  try { filename = decodeURIComponent(url.pathname.split('/').at(-1)); } catch { return null; }
  if (url.href.length > 2048 || /[\\/\u0000]/.test(filename) || url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || !path || path[2] !== id ||
    (channelId && path[1] !== channelId)) return null;
  // The signed URL is only used for downloading now; it is never persisted.
  return { id, url: url.href, filename: String(value.filename || 'opskrift').replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 120), contentType, size };
}

function timeoutPromise(ms, code = 'unavailable') {
  let timer;
  const promise = new Promise((_, reject) => { timer = setTimeout(() => reject(new RecipeFetchError(code, 'Hentning tog for lang tid.')), ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function resolvePublic(host, lookup, remaining, signal) {
  signal?.throwIfAborted();
  if (isIP(host)) return { address: host, family: isIP(host) };
  const timeout = timeoutPromise(remaining);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  let addresses;
  try { addresses = await Promise.race([lookup(host, { all: true, verbatim: true }), timeout.promise, aborted]); }
  catch (error) { if (error instanceof RecipeFetchError) throw error; throw new RecipeFetchError('unavailable', 'Hjemmesiden kunne ikke findes.'); }
  finally { timeout.cancel(); signal?.removeEventListener('abort', onAbort); }
  signal?.throwIfAborted();
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(record => !publicInternetAddress(record.address))) {
    throw new RecipeFetchError('blocked', 'Hjemmesidens netværksadresse er ikke tilladt.');
  }
  return { address: addresses[0].address, family: isIP(addresses[0].address) };
}

function requestPinned(url, address, { request, remaining, maxBytes, kind, signal }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let req;
    const timer = setTimeout(() => finish(null, new RecipeFetchError('unavailable', 'Hentning tog for lang tid.')), remaining);
    const finish = (result, error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (error) { req?.destroy(); reject(error); } else resolve(result);
    };
    const onAbort = () => finish(null, new RecipeFetchError('cancelled', 'Hentningen blev stoppet.'));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const pinnedLookup = (requestedHost, options, callback) => {
      if (requestedHost !== host) return callback(new Error('Unexpected hostname'));
      if (options?.all) return callback(null, [address]);
      return callback(null, address.address, address.family);
    };
    try {
      req = request(url, { method: 'GET', agent: false, family: address.family, lookup: pinnedLookup,
        ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: true,
        headers: { Accept: kind === 'media' ? [...MEDIA_TYPES].join(',') : kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity', 'User-Agent': 'JARVIS-RecipeMemory/4.9' } }, response => {
        if (finished) { response.destroy(); return; }
        const status = response.statusCode;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (typeof location !== 'string') return finish(null, new RecipeFetchError('unavailable', 'Hjemmesiden gav en ugyldig viderestilling.'));
          finish({ redirect: location }); return;
        }
        if (status !== 200) { response.destroy(); finish(null, new RecipeFetchError('unavailable', 'Hjemmesiden tillod ikke hentning.')); return; }
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
        const allowed = kind === 'media' ? MEDIA_TYPES.has(contentType) : kind === 'image' ? IMAGE_TYPES.has(contentType) : (kind === 'browser'
          ? ['text/html','application/xhtml+xml','text/css','text/javascript','application/javascript','application/json']
          : ['text/html','application/xhtml+xml']).includes(contentType);
        const declaredLength = Number(response.headers['content-length']);
        if (!allowed || encoding !== 'identity' || (Number.isFinite(declaredLength) && declaredLength > maxBytes)) {
          response.destroy(); finish(null, new RecipeFetchError('unavailable', 'Filtypen, kodningen eller størrelsen er ikke understøttet.')); return;
        }
        const chunks = []; let length = 0;
        response.on('data', chunk => {
          if (finished) return;
          length += chunk.length;
          if (length > maxBytes) { response.destroy(); finish(null, new RecipeFetchError('unavailable', 'Filen er for stor.')); return; }
          chunks.push(Buffer.from(chunk));
        });
        response.on('error', () => finish(null, new RecipeFetchError('unavailable', 'Hentning blev afbrudt.')));
        response.on('aborted', () => finish(null, new RecipeFetchError('unavailable', 'Hentning blev afbrudt.')));
        response.on('end', () => finish({ buffer: Buffer.concat(chunks), contentType, url: url.href }));
      });
      req.on('error', () => finish(null, new RecipeFetchError('unavailable', 'En sikker forbindelse kunne ikke oprettes.')));
      req.end();
    } catch { finish(null, new RecipeFetchError('unavailable', 'En sikker forbindelse kunne ikke oprettes.')); }
  });
}

export async function fetchRecipeResource(value, { kind = 'html', lookup = dnsLookup, request = httpsRequest,
  timeoutMs = 10_000, maxBytes = kind === 'image' ? MAX_RECIPE_IMAGE_BYTES : MAX_HTML_BYTES, allowUrl = () => true, signal } = {}) {
  if (!['html', 'image', 'browser', 'media'].includes(kind)) throw new RecipeFetchError('blocked', 'Ukendt ressourcetype.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RecipeFetchError('blocked', 'Ugyldig størrelsesgrænse.');
  const deadline = Date.now() + Math.max(50, Math.min(15_000, timeoutMs));
  let url = recipeUrl(value);
  for (let redirects = 0; redirects <= 2; redirects++) {
    signal?.throwIfAborted();
    const host = publicHost(url);
    if (!allowUrl(url)) throw new RecipeFetchError('blocked', 'Viderestillingen er ikke tilladt.');
    if (Date.now() >= deadline) throw new RecipeFetchError('unavailable', 'Hentning tog for lang tid.');
    const address = await resolvePublic(host, lookup, Math.max(1, deadline - Date.now()), signal);
    if (Date.now() >= deadline) throw new RecipeFetchError('unavailable', 'Hentning tog for lang tid.');
    const result = await requestPinned(url, address, { request, remaining: deadline - Date.now(),
      maxBytes: Math.min(maxBytes, kind === 'media' ? 30 * 1024 * 1024 : kind === 'image' ? MAX_RECIPE_IMAGE_BYTES : MAX_HTML_BYTES), kind, signal });
    if (!result.redirect) return result;
    url = recipeUrl(new URL(result.redirect, url).href);
  }
  throw new RecipeFetchError('unavailable', 'For mange viderestillinger.');
}

export function imageMatchesType(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_RECIPE_IMAGE_BYTES) return false;
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (contentType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
