import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalClaims } from '../personal-claims.mjs';
import { PersonalKnowledge, indexPersonalKnowledge } from '../personal-knowledge.mjs';

const now = new Date('2026-11-05T12:00:00.000Z');
test('M4/M6 retrieval identifies one active plan without losing or promoting historical meal records',async()=>{
 const meal=id=>({id,startDate:'2026-11-05',revision:1,status:'draft',dishes:[{date:'2026-11-05',title:'Syntetisk grød'}]});
 const state={mealPlans:[meal('new'),meal('old')]},before=JSON.stringify(state);
 let documents=indexPersonalKnowledge(state).filter(x=>x.type==='meal-plan');
 assert.deepEqual(documents.map(x=>[x.source.id,x.source.isActive]),[['new',true],['old',false]]);
 assert.match(documents[1].text,/må ikke bruges som den aktuelle plan/);
 assert.equal(JSON.stringify(state),before,'retrieval never rewrites stored plans');
 const context=await new PersonalKnowledge({state}).contextAsync('Syntetisk grød');
 assert.match(context,/Historisk madplan/);assert.match(context,/ikke bevis for spiste/);
 state.mealPlans.unshift({...meal('unreviewed'),recipeStale:true});
 documents=indexPersonalKnowledge(state).filter(x=>x.type==='meal-plan');
 assert.equal(documents.some(x=>x.source.isActive),false,'an unsafe current plan cannot promote an older plan to current');
});
async function fixture(category = 'planned', options = {}) {
  const state = {}, claims = new PersonalClaims({ state, now: () => now });
  const proposed = await claims.propose({ subject: 'syntetisk_middag', value: 'Middag på Syntetisk Bistro den 7. november.', category,
    source: { kind: 'user', channel: 'manual', id: 'organizer:synthetic:reviewed-note' },
    validFrom: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' });
  const claim = await claims.decision(proposed.id, proposed.revision, 'confirm');
  const knowledge = new PersonalKnowledge({ state, now: () => now, ...options });
  return { state, claims, claim, knowledge };
}

test('B1/B4 actual model context preserves a confirmed plan as planned, never as evidence of completion', async () => {
  const f = await fixture();
  const text = await f.knowledge.contextAsync('Middag Bistro');
  assert.match(text, /Planlagt/); assert.match(text, /ikke.*udført/i);
  assert.match(text, /Gyldig fra: 2026-11-01T00:00:00\.000Z/);
  assert.match(text, /Udløber: 2026-12-01T00:00:00\.000Z/);
  assert.match(text, /Kilde: user\/manual/); assert.match(text, /organizer:synthetic:reviewed-note/);
  assert.match(text, new RegExp(`claim:${f.claim.id}`)); assert.match(text, /revision 2/);
  assert.doesNotMatch(text, /Bekræftet oplysning/);
});

test('B1/B4 categories remain distinct in synchronous, hybrid and timeout-fallback context', async () => {
  for (const [category, expected] of [['preference', /Præference/], ['temporary', /Midlertidig/],
    ['completed', /Brugerbekræftet udført handling/], ['fact', /Bekræftet oplysning/]]) {
    const f = await fixture(category, { semanticScorer: async (_query, documents) => ({ [documents[0].id]: 0.9 }) });
    assert.match(f.knowledge.context('Bistro'), expected);
    assert.match(await f.knowledge.contextAsync('Bistro'), expected);
    f.knowledge.semanticScorer = () => new Promise(() => {});
    assert.match(await f.knowledge.contextAsync('Bistro', { semanticTimeoutMs: 50 }), expected);
  }
});

test('B1/B2 category corrections propagate immediately; invalidation removes the whole source from model context', async () => {
  const f = await fixture();
  await f.knowledge.contextAsync('Bistro');
  const proposed = await f.claims.propose({ subject: f.claim.subject, value: f.claim.value, category: 'completed',
    source: { kind: 'user', channel: 'manual' }, correctsId: f.claim.id, correctsRevision: 2 });
  const corrected = await f.claims.decision(proposed.id, 1, 'confirm', { supersedesId: f.claim.id, supersedesRevision: 2 });
  const text = await f.knowledge.contextAsync('Bistro');
  assert.match(text, /Brugerbekræftet udført handling/); assert.doesNotMatch(text, /Planlagt/);
  assert.doesNotMatch(text, new RegExp(`claim:${f.claim.id}`));
  await f.claims.decision(corrected.id, 2, 'invalidate');
  assert.equal(await f.knowledge.contextAsync('Bistro'), '');
});

test('B1/B4 retained legacy memory also carries category, source and validity rather than becoming a fact', async () => {
  const state = { memories: [{ id: 'legacy-plan', text: 'Planlagt syntetisk middag', category: 'planned',
    confirmed: true, source: { kind: 'user', channel: 'discord' }, revision: 3,
    createdAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' }] };
  const knowledge = new PersonalKnowledge({ state, now: () => now });
  const text = await knowledge.contextAsync('middag');
  assert.match(text, /Planlagt.*ikke.*udført/); assert.match(text, /Kilde: user\/discord/);
  assert.match(text, /Udløber: 2026-12-01/); assert.match(text, /revision 3/);
});

test('B4 bounded model context never truncates a source into a misleading partial statement', async () => {
  const f = await fixture();
  const documents = Array.from({ length: 6 }, (_, i) => ({ id: `memory:full-${i}`, label: 'Hukommelse',
    source: { kind: 'memory', id: `full-${i}`, revision: 1, category: 'planned' },
    text: `${'Syntetisk tekst. '.repeat(75)}MARKER-SLUT-${i}` }));
  const text = f.knowledge.formatContext(documents);
  assert.ok(text.length <= 5200); assert.match(text, /Flere kilder.*udeladt/i);
  for (let i = 0; i < documents.length; i++)
    assert.equal(text.includes(`memory:full-${i}`), text.includes(`MARKER-SLUT-${i}`), 'source identity and complete text remain inseparable');
});
