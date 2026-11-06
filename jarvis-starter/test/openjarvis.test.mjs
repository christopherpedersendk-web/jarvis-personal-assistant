import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenJarvis } from '../openjarvis.mjs';
const env = { OPENJARVIS_ENABLED: 'yes', OPENJARVIS_GATEWAY_TOKEN: 'synthetic-secret' };
const control = { controlled: fn => fn(new AbortController().signal) };
test('disabled bridge has no external capability', async () => {
 const bridge = createOpenJarvis({ env: {}, control });
 assert.equal(bridge.status().enabled, false); await assert.rejects(bridge.search('test'));
});
test('gateway cannot be redirected to an external host or credential-bearing URL', () => {
 for (const url of ['http://evil.org', 'http://localhost', 'http://user@127.0.0.1', 'http://127.0.0.1/?x=1'])
 assert.throws(() => createOpenJarvis({ env: { ...env, OPENJARVIS_GATEWAY_URL: url }, control }));
});
test('search forwards only a fixed read tool, with no history or personal state', async () => {
 let calls = 0;
 const bridge = createOpenJarvis({ env, control, fetcher: async (url, options) => {
 calls++; assert.equal(url.pathname, '/tools/invoke'); assert.equal(options.redirect, 'error');
 assert.deepEqual(JSON.parse(options.body), { tool: 'web_search', args: { query: 'restaurant', count: 5 } });
 return new Response(JSON.stringify({ ok: true, result: { content: [{ type: 'text', text: 'Result' }] } }));
 } });
 assert.equal((await bridge.search('restaurant')).provider, 'openclaw'); assert.equal(calls, 1);
 await assert.rejects(bridge.search(env.OPENJARVIS_GATEWAY_TOKEN)); assert.equal(calls, 1);
});
test('upstream errors are not echoed or retried', async () => {
 let calls=0;
 const bridge = createOpenJarvis({env, control, fetcher:async()=>{calls++;return new Response('private secret', {status:403});}});
 await assert.rejects(bridge.search('test'), /403/);assert.equal(calls,1);
});
