import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecipeMemory, extractJsonLdRecipe, isRecipeCaptureRequest, recipeCaptureInput } from '../recipe-memory.mjs';
import { discordImageAttachment, fetchRecipeResource, imageMatchesType, publicInternetAddress, recipeUrl } from '../recipe-fetch.mjs';
import { DiscordGateway, authorizedDiscordMessage, discordMessageMetadata } from '../discord-gateway.mjs';

const now = () => new Date('2026-11-04T18:00:00.000Z');
const userId = '123456789012345678';
const channelId = '323456789012345678';
const messageId = '423456789012345678';
const attachmentId = '523456789012345678';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFzoAAAAASUVORK5CYII=', 'base64');
const attachment = { id: attachmentId, filename: 'tacos.png', content_type: 'image/png', size: png.length,
  url: `https://cdn.discordapp.com/attachments/${channelId}/${attachmentId}/tacos.png?ex=aaa&is=bbb&hm=PRIVATE_SIGNATURE` };
const source = { channel: 'discord', messageId, channelId };
const recipeData = { title: 'Bønnetacos', text: 'Brugerens egen opskrift', instructions: 'Varm bønnerne.', diet: 'vegan', minutes: 25, servings: 2,
  themes: ['child_friendly'], ingredients: [{ name: 'sorte bønner', quantity: 400, unit: 'g' }, { name: 'tortillas', quantity: 6, unit: 'stk' }] };
const recipeHtml = `<html><script>throw new Error('never execute this');</script><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org',
  '@graph': [{ '@type': 'WebPage', name: 'Homepage' }, { '@type': 'Recipe', name: 'Bønnetacos', totalTime: 'PT25M', recipeYield: '2 portioner',
    suitableForDiet: 'https://schema.org/VeganDiet', recipeIngredient: ['400 g sorte bønner', '6 stk tortillas'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Varm bønnerne.' }] }] })}</script></html>`;

function mockTransport(fixtures) {
  const calls = [];
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      const next = fixtures.shift();
      calls.push({ url: String(url), options });
      if (!next) { req.emit('error', new Error('No fixture')); return; }
      response.statusCode = next.status ?? 200;
      response.headers = { 'content-type': 'text/html', ...(next.headers || {}) };
      callback(response);
      if (!response.destroyed) response.end(next.buffer || Buffer.from(next.body || '<html></html>'));
    });
    return req;
  };
  return { calls, request };
}
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('recipe fetch blocks private/reserved IPs, malformed links and credential-bearing URLs before network access', async () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '172.16.2.3', '192.168.1.4', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '192.0.2.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(publicInternetAddress(address), false, address);
  assert.equal(publicInternetAddress('1.1.1.1'), true);
  assert.equal(publicInternetAddress('2606:4700:4700::1111'), true);
  let requested = 0;
  for (const url of ['http://recipe.example.org/a', 'file:///etc/passwd', 'https://user:password@recipe.example.org/',
    'https://localhost/a', 'https://test.local/a', 'https://127.1/', 'https://2130706433/', 'https://[::ffff:127.0.0.1]/', 'https://recipe.example.org:8787/',
    'https://recipe.example.org/?access_token=secret']) {
    await assert.rejects(fetchRecipeResource(url, { request: () => { requested++; }, lookup }), /offentlige|gyldig|Private|hemmelige/);
  }
  assert.equal(requested, 0);
  assert.equal(recipeUrl('https://recipe.example.org/a?utm_source=tracking&id=12#comments').href, 'https://recipe.example.org/a?id=12');
});

test('recipe fetch pins validated DNS and validates redirects and every resolved address', async () => {
  const transport = mockTransport([{ body: recipeHtml }]);
  let lookups = 0;
  const result = await fetchRecipeResource('https://recipe.example.org/tacos', { request: transport.request,
    lookup: async () => { lookups++; return lookups === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]; } });
  assert.match(result.buffer.toString(), /Bønnetacos/);
  assert.equal(lookups, 1);
  const options = transport.calls[0].options;
  await new Promise((resolve, reject) => options.lookup('recipe.example.org', { all: true }, (error, records) => {
    if (error) return reject(error); assert.deepEqual(records, [{ address: '93.184.216.34', family: 4 }]); resolve();
  }));
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Cookie, undefined);
  const redirect = mockTransport([{ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }]);
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/tacos', { request: redirect.request, lookup }), /Private/);
  assert.equal(redirect.calls.length, 1);
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/tacos', { request: transport.request,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] }), /netværksadresse/);
});

test('recipe fetch enforces streamed byte caps, MIME types, compression and timeout', async () => {
  const large = mockTransport([{ body: 'A'.repeat(100) }]);
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/', { lookup, request: large.request, maxBytes: 10 }), /stor/);
  const compressed = mockTransport([{ headers: { 'content-encoding': 'gzip' } }]);
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/', { lookup, request: compressed.request }), /kodningen/);
  const wrongType = mockTransport([{ headers: { 'content-type': 'image/svg+xml' } }]);
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/', { kind: 'image', lookup, request: wrongType.request }), /Filtypen/);
  let destroyed = false;
  await assert.rejects(fetchRecipeResource('https://recipe.example.org/', { lookup, timeoutMs: 50, request: () => {
    const req = new EventEmitter(); req.end = () => {}; req.destroy = () => { destroyed = true; }; return req;
  } }), /lang tid/);
  assert.equal(destroyed, true);
});

test('only static Recipe JSON-LD fields are extracted as untrusted draft data', () => {
  const extracted = extractJsonLdRecipe(recipeHtml);
  assert.equal(extracted.title, 'Bønnetacos');
  assert.equal(extracted.minutes, 25);
  assert.equal(extracted.servings, 2);
  assert.equal(extracted.diet, 'vegan');
  assert.deepEqual(extracted.ingredients, recipeData.ingredients);
  assert.equal(extractJsonLdRecipe('<script>process.exit(1)</script>'), null);
  assert.equal(extractJsonLdRecipe('<script type="application/ld+json">broken</script>'), null);
  assert.equal(extractJsonLdRecipe('a'.repeat(1_000_001)), null);
});

test('recipe capture is inbox-first, provenance-aware and deduplicated, and only owner-reviewed recipes are usable', async () => {
  const state = {}; let saves = 0; let network = 0;
  const memory = new RecipeMemory({ state, save: async () => { saves++; }, now,
    fetchResource: async () => { network++; return { buffer: Buffer.from(recipeHtml), contentType: 'text/html' }; } });
  const [recipe, replay] = await Promise.all([memory.capture({ text: 'https://recipe.example.org/tacos', source }),
    memory.capture({ text: 'https://recipe.example.org/tacos', source })]);
  assert.equal(network, 1); assert.equal(state.recipes.length, 1);
  assert.equal(saves, 3, 'durable received, processing and review checkpoints; replay creates no extra save');
  assert.equal(replay.id, recipe.id); assert.equal(replay.duplicate, true);
  assert.equal(recipe.status, 'inbox'); assert.equal(recipe.confirmed, false); assert.deepEqual(memory.usable(), []);
  assert.equal(recipe.source.messageId, messageId); assert.equal(recipe.links[0].status, 'extracted');
  assert.equal(recipe.extraction.status, 'draft-extracted');
  await assert.rejects(memory.update(recipe.id, { expectedRevision: 2, confirmed: true }), /ændret/);
  const approved = await memory.update(recipe.id, { expectedRevision: 1, ...recipeData, confirmed: true });
  assert.equal(approved.status, 'confirmed'); assert.equal(approved.revision, 2);
  assert.equal(memory.usable()[0].sourceRef.id, recipe.id);
  assert.equal(memory.usable()[0].sourceRef.revision, 2);
  assert.equal(memory.usable()[0].text, undefined);
  const edited = await memory.update(recipe.id, { expectedRevision: 2, title: 'Ny titel', confirmed: false });
  assert.equal(edited.status, 'inbox'); assert.equal(memory.usable().length, 0);
  await memory.update(recipe.id, { expectedRevision: 3, confirmed: true });
  await memory.archive(recipe.id);
  assert.equal(memory.list().length, 0); assert.equal(memory.usable().length, 0);
  assert.throws(() => memory.get(recipe.id), /findes ikke/);
});

test('blocked/private and unavailable links remain honest bookmarks, without fictional extracted content', async () => {
  const memory = new RecipeMemory({ state: {}, now, fetchResource: async () => { const error = new Error('network'); error.code = 'blocked'; throw error; } });
  const recipe = await memory.capture({ text: 'En idé', urls: ['https://127.0.0.1/opskrift'] });
  assert.equal(recipe.links[0].status, 'blocked');
  assert.equal(recipe.status, 'inbox'); assert.equal(recipe.ingredients.length, 0);
  assert.match(recipe.extraction.messages.join(' '), /uden hentning/);
  await assert.rejects(memory.capture({ text: 'password=do-not-store-me' }), /adgangskoder/);
  await assert.rejects(memory.capture({ text: 'https://recipe.example.org/?api_key=secret' }), /adgangsparametre|adgangskoder/);
  await assert.rejects(memory.update(recipe.id, { expectedRevision: 1, confirmed: true }), /Gennemgå/);
});

test('an injected extractor never grants confirmation or action permissions', async () => {
  const memory = new RecipeMemory({ state: {}, now, extractor: async input => {
    assert.equal(input.signal instanceof AbortSignal, true);
    assert.deepEqual(input.images, []);
    return { ...recipeData, id: 'forged', confirmed: true, status: 'confirmed', permissions: ['place_order'] };
  } });
  const recipe = await memory.capture({ text: 'Gem min opskrift med bønner.' });
  assert.notEqual(recipe.id, 'forged'); assert.equal(recipe.status, 'inbox'); assert.equal(recipe.confirmed, false);
  assert.equal(recipe.permissions, undefined); assert.equal(memory.usable().length, 0);
  assert.equal(recipe.ingredients.length, 2);
});

test('Discord recipe images are stored privately, survive expired CDN signatures and require exact channel provenance', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'jarvis-recipes-'));
  let imageSeen = false;
  const memory = new RecipeMemory({ state: {}, dataDirectory, now, fetchResource: async (_url, options) => {
    assert.equal(options.kind, 'image');
    assert.equal(options.allowUrl(new URL(attachment.url)), true);
    assert.equal(options.allowUrl(new URL('https://evil.example.org/attachments/1/2/x.png')), false);
    return { buffer: png, contentType: 'image/png' };
  }, extractor: async ({ images }) => { imageSeen = Buffer.isBuffer(images[0]?.buffer); return recipeData; } });
  const recipe = await memory.capture({ text: 'Bønnetacos', source, attachments: [attachment] });
  assert.equal(imageSeen, true);
  assert.equal(recipe.media.length, 1); assert.equal(recipe.status, 'inbox');
  assert.equal(JSON.stringify(recipe).includes('PRIVATE_SIGNATURE'), false);
  assert.equal(JSON.stringify(recipe).includes(png.toString('base64')), false);
  const loaded = await memory.media(recipe.id, recipe.media[0].id);
  assert.deepEqual(loaded.buffer, png); assert.equal(loaded.contentType, 'image/png');
  const file = join(dataDirectory, 'recipe-media', `${recipe.media[0].id}.png`);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dataDirectory, 'recipe-media'))).mode & 0o777, 0o700);
  await assert.rejects(memory.media(recipe.id, '../../etc/passwd'), /Ugyldigt/);
  await assert.rejects(memory.capture({ text: 'Billede', source: { ...source, channelId: '623456789012345678' }, attachments: [attachment] }), /godkendte Discord/);
  await assert.rejects(memory.capture({ text: 'Billede', source: { channel: 'web' }, attachments: [attachment] }), /godkendte Discord/);
});

test('wrong image type, oversized attachments and symlinked media directories cannot expose local files', async () => {
  assert.equal(imageMatchesType(png, 'image/svg+xml'), false);
  assert.equal(imageMatchesType(Buffer.from('<script>bad</script>'), 'image/png'), false);
  assert.equal(discordImageAttachment({ ...attachment, size: 2_000_001 }, { channelId }), null);
  assert.equal(discordImageAttachment({ ...attachment, content_type: undefined }, { channelId }).contentType, 'image/png');
  assert.equal(discordImageAttachment({ ...attachment, url: attachment.url.replace('tacos.png', 'tacos%2Fother.png') }, { channelId }), null);
  assert.equal(discordImageAttachment({ ...attachment, url: `https://cdn.discordapp.com.evil.org/attachments/${channelId}/${attachmentId}/a.png` }, { channelId }), null);
  const dataDirectory = await mkdtemp(join(tmpdir(), 'jarvis-recipes-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'jarvis-recipe-outside-'));
  await writeFile(join(outside, 'untouched.txt'), 'private');
  await symlink(outside, join(dataDirectory, 'recipe-media'));
  const memory = new RecipeMemory({ state: {}, now, dataDirectory,
    fetchResource: async () => ({ buffer: png, contentType: 'image/png' }) });
  const recipe = await memory.capture({ text: 'Tacos', source, attachments: [attachment] });
  assert.equal(recipe.media.length, 0);
  assert.match(recipe.extraction.messages.join(' '), /ikke gemmes sikkert/);
});

test('Discord metadata passes only validated owner image attachments and explicit capture commands', async () => {
  const event = { id: messageId, author: { id: userId }, channel_id: channelId, content: '', attachments: [attachment] };
  assert.equal(authorizedDiscordMessage(event, { userId }), true);
  assert.equal(authorizedDiscordMessage({ ...event, author: { id: '999999999999999999' } }, { userId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, webhook_id: '777777777777777777' }, { userId }), false);
  assert.equal(authorizedDiscordMessage({ ...event, attachments: [{ ...attachment, content_type: 'image/svg+xml' }] }, { userId }), false);
  const metadata = discordMessageMetadata({ ...event, attachments: [{ ...attachment, secret: 'not passed' }] });
  assert.equal(metadata.attachments[0].secret, undefined);
  assert.equal(isRecipeCaptureRequest('Gem opskrift: min tacos'), true);
  assert.equal(isRecipeCaptureRequest('Husk opskriften https://recipe.example.org'), true);
  assert.equal(isRecipeCaptureRequest('opskrift: min tacos'), true);
  assert.equal(isRecipeCaptureRequest('Hvad kan jeg lave af dette?'), false);
  assert.equal(recipeCaptureInput('Gem opskrift: min tacos', metadata).text, 'min tacos');
  let seen;
  const gateway = new DiscordGateway({ onMessage: async (text, meta) => { seen = { text, meta }; return 'Send Gem opskrift: med billedet for at gemme det.'; }, fetcher: async () => ({ ok: true }) });
  gateway.config = { userId, token: 'not-a-real-token' };
  assert.equal(await gateway.handleIncoming(event), true);
  assert.equal(seen.text, ''); assert.equal(seen.meta.attachments.length, 1);
  assert.equal(await gateway.handleIncoming(event), false);
});
