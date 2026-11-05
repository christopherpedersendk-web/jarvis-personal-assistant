import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NemligShopping } from '../nemlig-connector.mjs';
import { GoogleCalendarReadOnly } from '../google-calendar.mjs';

const now = () => new Date('2026-11-04T12:00:00Z');
function fixture({ lines = [], result, state = {}, validateSourcePlan, validateSourceDraft } = {}) {
  const writes = [];
  const shop = new NemligShopping({ state, now, validateSourcePlan, validateSourceDraft, callTool: async (name, args) => {
    if (name === 'get_basket') return { Lines: lines };
    if (name === 'search_products') return [{ Id: '123', Name: 'Ris' }, { Id: '456', Name: 'Tomat' }];
    if (name === 'set_basket_quantities') { writes.push(args); return result || { results: args.items.map(x => ({ product_id: x.product_id, status: 'ok' })) }; }
    throw new Error(`Unexpected tool ${name}`);
  } });
  return { shop, writes, state };
}

test('ambiguous duplicate and fractional basket quantities fail closed before proposal', async () => {
  for (const lines of [[{ Id: '123', Quantity: 2 }, { Id: '123', Quantity: 3 }], [{ Id: '123', Quantity: 1.5 }], [{ Id: '123', Quantity: 1e12 }]]) {
    const f = fixture({ lines }); await f.shop.search('ris');
    await assert.rejects(f.shop.propose([{ productId: '123', quantity: 1 }]), /Ingen ændringer/);
    assert.equal(f.writes.length, 0);
  }
});

test('completion requires exact unique result IDs and matching returned basket targets', async () => {
  for (const result of [
    { results: [{ product_id: '123', status: 'ok' }, { product_id: '123', status: 'ok' }] },
    { results: [{ product_id: '999', status: 'ok' }, { product_id: '456', status: 'ok' }] },
    { results: [{ product_id: '123', status: 'ok' }, { product_id: '456', status: 'ok' }], basket: { Lines: [{ Id: '123', Quantity: 0 }, { Id: '456', Quantity: 1 }] } },
  ]) {
    const f = fixture({ result }); await f.shop.search('ris');
    const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }, { productId: '456', quantity: 1 }]);
    assert.equal((await f.shop.approve(proposal.id, true, 1)).status, 'partial');
    await assert.rejects(f.shop.approve(proposal.id, true, 1), /allerede/);
    assert.equal(f.writes.length, 1);
  }
});

test('interrupted applying proposal recovers as unknown and cannot be replayed', async () => {
  const id = randomUUID();
  const f = fixture({ state: { nemligProposals: [{ id, status: 'applying', revision: 1 }] } });
  assert.equal(f.shop.status().proposals[0].status, 'unknown');
  await assert.rejects(f.shop.approve(id, true, 1), /allerede/);
  assert.equal(f.writes.length, 0);
});

test('live recipe validation is checked again after an asynchronous approval save', async () => {
  const plan = { id: randomUUID(), revision: 1, status: 'shopping_ready' };
  let recipeChanged = false;
  const f = fixture({ state: { mealPlans: [plan] }, validateSourcePlan: () => { if (recipeChanged) throw new Error('Recipe changed'); } });
  await f.shop.search('ris');
  const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }], { sourcePlan: { id: plan.id, revision: 1 } });
  f.shop.save = async () => { if (proposal.status === 'applying') recipeChanged = true; };
  await assert.rejects(f.shop.approve(proposal.id, true, 1), /Recipe changed/);
  assert.equal(proposal.status, 'superseded'); assert.equal(f.writes.length, 0);
});

test('G1 a retained proposal with newly unresolved manual requirements cannot write the basket', async () => {
  const plan = { id: randomUUID(), revision: 1, status: 'shopping_ready', shoppingNeedsReview: false };
  const f = fixture({ state: { mealPlans: [plan] } }); await f.shop.search('ris');
  const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }], { sourcePlan: { id: plan.id, revision: 1 } });
  plan.shoppingNeedsReview = true;
  await assert.rejects(f.shop.approve(proposal.id, true, 1), /gennemgang/);
  assert.equal(f.writes.length, 0); assert.equal(proposal.status, 'pending');
});

test('G3 retained source drafts are revalidated even without a sourcePlan field and before effects', async () => {
  const draft = { id: randomUUID(), revision: 1 };
  let valid = true, checked = 0;
  const f = fixture({ state: { shoppingDrafts: [draft] }, validateSourceDraft: (actual, source) => {
    assert.equal(actual.id, draft.id); assert.equal(source.sourceDraft.id, draft.id); checked++;
    if (!valid) throw new Error('Aktuel ingredienskonflikt');
  } });
  await f.shop.search('ris');
  const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }], { sourceDraft: { id: draft.id, revision: 1 } });
  assert.ok(checked >= 3); valid = false;
  await assert.rejects(f.shop.approve(proposal.id, true, 1), /ingredienskonflikt/);
  assert.equal(f.writes.length, 0); assert.equal(proposal.status, 'pending');
});

test('G3 a changed ingredient constraint during intent persistence supersedes the proposal with no write', async () => {
  const draft = { id: randomUUID(), revision: 1 }; let valid = true;
  const f = fixture({ state: { shoppingDrafts: [draft] }, validateSourceDraft: () => {
    if (!valid) throw new Error('Aktuel ingredienskonflikt');
  } });
  await f.shop.search('ris');
  const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }], { sourceDraft: { id: draft.id, revision: 1 } });
  f.shop.save = async () => { if (proposal.status === 'applying') valid = false; };
  await assert.rejects(f.shop.approve(proposal.id, true, 1), /ingredienskonflikt/);
  assert.equal(proposal.status, 'superseded'); assert.equal(f.writes.length, 0);
});

test('proposal edit may change quantities or remove rows but not introduce unseen replacement items', async () => {
  const f = fixture(); await f.shop.search('ris');
  const proposal = await f.shop.propose([{ productId: '123', quantity: 1 }]);
  await assert.rejects(f.shop.revise(proposal.id, { expectedRevision: 1, items: [{ productId: '456', quantity: 1 }] }), /Vælg nye varer/);
  assert.equal(proposal.revision, 1); assert.equal(f.writes.length, 0);
});

test('Google read-only calendar follows bounded pages and retains free-event markers', async () => {
  const pages = [];
  const calendar = new GoogleCalendarReadOnly({ refreshToken: 'synthetic-only', now: () => now().getTime(), fetcher: async url => {
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'synthetic-only', expires_in: 3600 }));
    const next = new URL(url).searchParams.get('pageToken'); pages.push(next);
    return new Response(JSON.stringify(next ? { items: [{ id: 'second', transparency: 'transparent', start: { dateTime: '2026-11-05T18:00:00+01:00' }, end: { dateTime: '2026-11-05T19:00:00+01:00' } }] }
      : { items: [{ id: 'first', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } }], nextPageToken: 'page2' }));
  } });
  const events = await calendar.upcoming(7);
  assert.deepEqual(pages, [null, 'page2']); assert.equal(events.length, 2); assert.equal(events[1].transparency, 'transparent');
});

test('Google repeated pagination refuses an incomplete calendar instead of treating unseen days as free', async () => {
  const calendar = new GoogleCalendarReadOnly({ refreshToken: 'synthetic-only', fetcher: async url => new Response(JSON.stringify(String(url).includes('oauth2.googleapis.com')
    ? { access_token: 'synthetic-only', expires_in: 3600 } : { items: [], nextPageToken: 'repeat' })) });
  await assert.rejects(calendar.upcoming(7), /fuldstændigt/);
});
