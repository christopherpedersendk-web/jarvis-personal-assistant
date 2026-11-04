import test from 'node:test';
import assert from 'node:assert/strict';
import { MealPlanner } from '../meal-planner.mjs';
import { NemligShopping, callLocalNemligMcp } from '../nemlig-connector.mjs';
import { GoogleCalendarReadOnly } from '../google-calendar.mjs';
import { indexPersonalKnowledge } from '../personal-knowledge.mjs';

const now = () => new Date('2026-11-04T10:00:00.000Z');

test('meal profile persists explicit user facts, respects diet, avoids ingredients and subtracts pantry without prices', async () => {
  const state = {}; let saved = 0;
  const planner = new MealPlanner({ state, save: async () => { saved++; }, now });
  const profile = await planner.setProfile({ householdSize: 4, diet: 'vegan', budgetDkk: 800,
    avoid: ['æg', 'KYLLING'], pantry: [{ name: 'ris', quantity: 350, unit: 'g' }] });
  assert.equal(profile.source, 'user-entered');
  assert.equal(profile.avoid[1], 'kylling');
  const plan = await planner.createPlan({ startDate: '2026-11-05', days: 6 });
  assert.equal(plan.dishes.length, 6);
  assert.equal(plan.dishes.every(x => !x.ingredients.some(y => /^(æg|kylling)/.test(y.name))), true);
  assert.equal(plan.priceStatus, 'unknown-until-retailer-lookup');
  assert.equal(plan.budgetTargetDkk, 800);
  const comparison = new MealPlanner({ state: {}, now });
  await comparison.setProfile({ householdSize: 4, diet: 'vegan', budgetDkk: 800, avoid: ['æg', 'kylling'], pantry: [] });
  const withoutPantry = await comparison.createPlan({ startDate: '2026-11-05', days: 6 });
  assert.equal((plan.shoppingList.find(x => x.name === 'ris')?.quantity || 0),
    Math.max(0, (withoutPantry.shoppingList.find(x => x.name === 'ris')?.quantity || 0) - 350));
  assert.ok(saved >= 2);
  const docs = indexPersonalKnowledge(state);
  assert.ok(docs.some(x => x.type === 'meal-profile' && x.source.kind === 'meal-profile'));
  assert.ok(docs.some(x => x.type === 'meal-plan' && x.id === `meal-plan:${plan.id}`));
  assert.equal(docs.some(x => x.type === 'calendar'), false, 'private calendar data is not indexed');
});

test('meal preferences reject invalid amounts and unknown diets', async () => {
  const planner = new MealPlanner({ state: {}, now });
  await assert.rejects(planner.setProfile({ householdSize: 0, diet: 'vegan', avoid: [], pantry: [] }), /1–12/);
  await assert.rejects(planner.setProfile({ householdSize: 2, diet: 'fish-only', avoid: [], pantry: [] }), /vegansk mad/);
  await assert.rejects(planner.setProfile({ householdSize: 2, diet: 'vegan', avoid: [], pantry: [{ name: 'ris', quantity: -5, unit: 'g' }] }), /lager/);
});

function mockedNemlig() {
  const state = {};
  let saved = 0; let writes = 0;
  let basket = { Lines: [{ Id: '12345', Name: 'Havremælk', Quantity: 2 }], TotalPrice: 100, DeliveryAddress: 'SECRET ADDRESS' };
  const calls = [];
  const shopping = new NemligShopping({ state, save: async () => { saved++; }, now,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'search_products') return [{ Id: 12345, Name: 'Havremælk', Price: 12, SecretCard: 'NEVER' }, { Id: 99999, Name: 'Pasta', Price: 14 }];
      if (name === 'get_basket') return basket;
      if (name === 'set_basket_quantities') {
        writes++;
        basket = { ...basket, Lines: basket.Lines.map(x => x.Id === String(args.items[0].product_id) ? { ...x, Quantity: args.items[0].quantity } : x) };
        return { results: args.items.map(x => ({ product_id: x.product_id, status: 'ok' })), basket };
      }
      throw new Error('Unapproved tool');
    },
  });
  return { shopping, calls, state, get saved() { return saved; }, get writes() { return writes; },
    changeBasket: value => { basket = value; } };
}

test('Nemlig only reads before distinct explicit approval; absolute quantities add to existing basket and cannot order', async () => {
  const f = mockedNemlig();
  const results = await f.shopping.search('havremælk');
  assert.equal(results[0].SecretCard, undefined);
  assert.equal(f.writes, 0);
  const proposal = await f.shopping.propose([{ productId: '12345', quantity: 3 }]);
  assert.equal(f.writes, 0, 'creating a proposal must not mutate basket');
  assert.deepEqual(proposal.additions[0], { productId: '12345', name: 'Havremælk', add: 3, previous: 2, target: 5 });
  await assert.rejects(f.shopping.approve(proposal.id, false), /godkendelse/);
  await assert.rejects(f.shopping.approve(proposal.id, undefined), /godkendelse/);
  assert.equal(f.writes, 0);
  const approved = await f.shopping.approve(proposal.id, true);
  assert.equal(approved.status, 'completed');
  assert.equal(f.writes, 1);
  assert.deepEqual(f.calls.at(-1).args, { items: [{ product_id: '12345', quantity: 5 }] });
  assert.equal(f.calls.some(c => /order|checkout|payment|place/i.test(c.name)), false);
  assert.equal(JSON.stringify(approved).includes('SECRET ADDRESS'), false);
  await assert.rejects(f.shopping.approve(proposal.id, true), /allerede behandlet/);
  assert.equal(f.writes, 1, 'double approval must not write twice');
  assert.ok(f.saved >= 3);
});

test('Nemlig refuses unknown, duplicate and stale products, or basket changes before approval', async () => {
  const f = mockedNemlig();
  await assert.rejects(f.shopping.propose([{ productId: '12345', quantity: 1 }]), /Søg/);
  await f.shopping.search('havremælk');
  await assert.rejects(f.shopping.propose([{ productId: '12345', quantity: 1 }, { productId: '12345', quantity: 2 }]), /én gang/);
  await assert.rejects(f.shopping.propose([{ productId: '12345', quantity: 0 }]), /Ugyldigt/);
  const proposal = await f.shopping.propose([{ productId: '12345', quantity: 1 }]);
  f.changeBasket({ Lines: [{ Id: '12345', Quantity: 4 }] });
  await assert.rejects(f.shopping.approve(proposal.id, true), /ændret/);
  assert.equal(f.writes, 0);
  await f.shopping.decline(proposal.id);
  await assert.rejects(f.shopping.approve(proposal.id, true), /allerede behandlet/);
});

test('Nemlig marks partial and unknown outcomes as single-use and never auto-retries a write', async () => {
  const state = {}; let calls = 0;
  const m = new NemligShopping({ state, now, callTool: async (name) => {
    if (name === 'search_products') return [{ Id: '444', Name: 'Mel' }];
    if (name === 'get_basket') return { Lines: [] };
    if (name === 'set_basket_quantities') { calls++; throw new Error('API timeout after possible mutation'); }
    throw new Error('Unexpected');
  } });
  await m.search('mel');
  const proposal = await m.propose([{ productId: '444', quantity: 2 }]);
  const result = await m.approve(proposal.id, true);
  assert.equal(result.status, 'unknown');
  assert.match(result.result.message, /Kontroller/);
  await assert.rejects(m.approve(proposal.id, true), /allerede behandlet/);
  assert.equal(calls, 1);
});

test('MCP client exposes only a fixed local allowlist and refuses checkout', () => {
  assert.throws(() => callLocalNemligMcp('place_order'), /ikke godkendt/);
  assert.throws(() => callLocalNemligMcp('set_basket_quantity'), /ikke godkendt/);
  assert.throws(() => callLocalNemligMcp('search_products', { query: 'mel' }, { command: '/bin/false', directory: '/tmp' }), /ikke aktiveret/);
});

test('Google OAuth uses short-lived state, PKCE and read-only scope with no token in status', async () => {
  let nowMs = Date.parse('2026-11-04T10:00:00Z');
  let stored = ''; const requests = [];
  const calendar = new GoogleCalendarReadOnly({ clientId: 'myclient', clientSecret: 'client-secret',
    redirectUri: 'https://example.tailnet.ts.net/api/google/calendar/callback', now: () => nowMs,
    saveRefreshToken: async token => { stored = token; },
    fetcher: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.readonly' }), { status: 200 });
      return new Response(JSON.stringify({ items: [{ id: '1', summary: 'Familiefødselsdag', description: 'SECRET', location: 'ADDRESS', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } }] }), { status: 200 });
    },
  });
  assert.equal(calendar.configured(), true);
  const url = new URL(calendar.begin());
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state'));
  assert.equal(url.searchParams.get('client_secret'), null);
  await assert.rejects(calendar.exchange({ state: 'attacker', code: 'abc' }), /ugyldig/);
  const next = new URL(calendar.begin());
  await calendar.exchange({ state: next.searchParams.get('state'), code: 'authorized-code' });
  assert.equal(stored, 'refresh-secret');
  assert.equal(JSON.stringify(calendar.status()).includes('secret'), false);
  const events = await calendar.upcoming(7);
  assert.deepEqual(events, [{ id: '1', title: 'Familiefødselsdag', start: '2026-11-05', end: '2026-11-06', allDay: true }]);
  assert.ok(requests.some(x => x.url.includes('www.googleapis.com/calendar/v3/calendars/primary/events')));
  await calendar.disconnect();
  assert.equal(stored, '');
  assert.equal(calendar.status().connected, false);
  const expired = new URL(calendar.begin());
  nowMs += 11 * 60_000;
  await assert.rejects(calendar.exchange({ state: expired.searchParams.get('state'), code: 'abc' }), /udløbet/);
});
