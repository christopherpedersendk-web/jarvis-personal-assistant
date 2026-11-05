import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PersonalClaims, currentClaim } from '../personal-claims.mjs';
import { Element } from './helpers/dom-contract.mjs';

const source = await readFile(new URL('../public/v5-plan.js', import.meta.url), 'utf8');
const ClaimsUI = vm.runInNewContext(`${source}\nJarvisClaims;`, { Intl, Date });
const draftKey = 'jarvis:v5:memory-claim-draft';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Executable DOM contract double. Browser acceptance remains a separate run.
// Detaching a focused subtree blurs it, so restoring text after replacement
// cannot masquerade as preserving the actual field, selection and focus.

function harness({ state = {}, saved = new Map(), authenticated = true, storageBlocked = false } = {}) {
  const claims = new PersonalClaims({ state });
  const document = { activeElement: null, focusDetachments: 0 };
  document.createElement = tag => new Element(document, tag); document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => { const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean); return walk(document.body) || null; };
  const add = (tag, id, parent = document.body) => { const node = document.createElement(tag); node.id = id; parent.append(node); return node; };
  const mode = add('select', 'memory-editor-mode');
  for (const value of ['note', 'claim']) { const option = add('option', '', mode); option.value = value; }
  add('form', 'memory-workbench-form'); const form = add('form', 'personal-claim-form');
  add('input', 'claim-subject', form); add('textarea', 'claim-value', form); const category = add('select', 'claim-category', form);
  for (const value of ['fact', 'preference', 'temporary', 'planned', 'completed']) { const option = add('option', '', category); option.value = value; }
  add('button', 'claim-submit', form).type = 'submit'; add('p', 'claim-status'); add('div', 'claim-list');
  const h = { document, state, claims, saved, calls: [], sources: [], confirmations: [], token: authenticated ? 'synthetic-owner-token' : null,
    hold: null, failure: null };
  const ui = ClaimsUI.attach({ document, storage: { getItem: key => saved.get(key) || null,
    setItem: (key, value) => { if (storageBlocked) throw new Error('Blocked storage'); saved.set(key, value); }, removeItem: key => saved.delete(key) },
    getOwner: () => h.token, confirm: message => { h.confirmations.push(message); return true; }, onSource: id => h.sources.push(id),
    api: async (path, options = {}) => {
      const call = { path, method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }; h.calls.push(call);
      if (h.failure) { const error = h.failure(call); if (error) throw error; }
      if (call.method !== 'GET' && h.hold) { const gate = h.hold; h.hold = null; await gate.promise; }
      try {
        if (path === '/api/personal-claims' && call.method === 'GET') return { claims: claims.list(), conflicts: claims.conflicts() };
        if (path === '/api/personal-claims' && call.method === 'POST') return { claim: await claims.propose({ ...call.body,
          source: { kind: 'user', channel: 'manual', ...(call.body.sourceId !== undefined ? { id: call.body.sourceId } : {}) } }) };
        const [, , , id, action] = path.split('/');
        if (call.method === 'PATCH') return { claim: await claims.update(id, call.body) };
        return { claim: await claims.decision(id, call.body.expectedRevision, action, call.body) };
      } catch (error) { error.status ||= error.code === 'conflict' ? 409 : 400; throw error; }
    } });
  Object.assign(h, { ui, field: id => document.getElementById(id),
    card: id => document.getElementById('claim-list').children.find(card => card.dataset.claimId === id),
    button: (root, text) => root.querySelectorAll('button').find(button => button.textContent === text),
    writes: () => h.calls.filter(call => call.method !== 'GET'),
    async fill(id, value) { const input = document.getElementById(id); input.value = value; await input.emit(input.tagName === 'SELECT' ? 'change' : 'input'); },
    submit: () => form.emit('submit') });
  return h;
}
async function record(h, overrides = {}) {
  return h.claims.propose({ subject: 'syntetisk_praeference', value: 'Jeg foretrækker den blå mappe.',
    source: { kind: 'user', channel: 'manual', id: 'organizer:synthetic:note' }, ...overrides });
}
async function confirmed(h, overrides) { const claim = await record(h, overrides); return h.claims.decision(claim.id, claim.revision, 'confirm'); }

test('B/K structured memory works independently, labels source/validity and performs no startup mutation', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); await h.ui.refresh();
  assert.deepEqual(h.calls.map(call => [call.method, call.path]), [['GET', '/api/personal-claims']]);
  for (const id of ['claim-source-id', 'claim-valid-from', 'claim-expires-at', 'claim-repeated-time', 'claim-show-history'])
    assert.ok(h.document.body.querySelectorAll('label').some(label => label.htmlFor === id), id);
  assert.equal(h.field('personal-claim-form').querySelectorAll('form').length, 0);
});

test('B1/K structured creation stores explicit source and Copenhagen validity only as a proposal', async () => {
  const h = harness(); await h.fill('claim-subject', 'syntetisk_dato'); await h.fill('claim-value', 'Aftalen er foreløbig.');
  await h.fill('claim-category', 'temporary'); await h.fill('claim-source-id', 'organizer:synthetic:note');
  await h.fill('claim-valid-from', '2030-11-06T09:00'); await h.fill('claim-expires-at', '2030-11-07T09:00'); await h.submit();
  assert.deepEqual(h.writes()[0].body, { subject: 'syntetisk_dato', value: 'Aftalen er foreløbig.', category: 'temporary',
    sourceId: 'organizer:synthetic:note', validFrom: '2030-11-06T08:00:00.000Z', expiresAt: '2030-11-07T08:00:00.000Z' });
  assert.equal(h.state.personalClaims[0].status, 'proposed'); assert.equal(h.writes().length, 1);
  assert.equal(h.field('claim-value').value, ''); assert.match(h.field('claim-status').textContent, /gemt, men ikke bekræftet/);
});

test('B1/K an optional empty source uses the actual HTTP contract and remains a proposed user-origin claim', async () => {
  const h = harness(); await h.fill('claim-subject', 'syntetisk_uden_kildereference');
  await h.fill('claim-value', 'En oplysning jeg selv har skrevet uden en ekstern kilde.'); await h.submit();
  assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].body.sourceId, '');
  assert.equal(h.state.personalClaims.length, 1); assert.equal(h.state.personalClaims[0].status, 'proposed');
  assert.deepEqual(h.state.personalClaims[0].source, { kind: 'user', channel: 'manual' });
  assert.match(h.field('claim-status').textContent, /gemt, men ikke bekræftet/);
  assert.ok(h.card(h.state.personalClaims[0].id));
});

test('B1/K explicitly clearing an optional source is a revision-bound proposal edit, not a null provenance', async () => {
  const h = harness(), claim = await record(h); await h.ui.refresh();
  await h.button(h.card(claim.id), 'Redigér forslag').emit('click'); await h.fill('claim-source-id', ''); await h.submit();
  assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].method, 'PATCH');
  assert.equal(h.writes()[0].body.expectedRevision, 1); assert.equal(h.writes()[0].body.sourceId, '');
  assert.equal(h.state.personalClaims[0].revision, 2); assert.equal(h.state.personalClaims[0].status, 'proposed');
  assert.deepEqual(h.state.personalClaims[0].source, { kind: 'user', channel: 'manual' });
  assert.equal(h.state.personalClaims[0].revisions[0].source.id, 'organizer:synthetic:note');
});

test('B1/R03 proposed edits use exact revision and retain an ambiguous stored DST instant unchanged', async () => {
  const h = harness(), claim = await record(h, { validFrom: '2026-10-25T01:30:12Z' }); await h.ui.refresh();
  await h.button(h.card(claim.id), 'Redigér forslag').emit('click');
  assert.equal(h.field('memory-editor-mode').value, 'claim'); assert.equal(h.field('claim-subject').readOnly, true);
  await h.fill('claim-value', 'En rettet blå mappe.'); await h.submit();
  assert.equal(h.writes()[0].method, 'PATCH'); assert.equal(h.writes()[0].body.expectedRevision, 1);
  assert.equal(h.writes()[0].body.validFrom, '2026-10-25T01:30:12.000Z');
  assert.equal(h.state.personalClaims[0].status, 'proposed'); assert.equal(h.state.personalClaims[0].revision, 2);
});

test('R03/K5 claim polling keeps actual focused draft fields; reload retains stale revision and blocks overwrite', async () => {
  const h = harness(), claim = await record(h); await h.ui.refresh(); await h.button(h.card(claim.id), 'Redigér forslag').emit('click');
  await h.fill('claim-value', 'Min ufuldførte rettelse'); const field = h.field('claim-value'); field.focus(); field.selectionStart = 3; field.selectionEnd = 9;
  await record(h, { subject: 'nabo', value: 'Et uafhængigt forslag.' }); await h.ui.refresh();
  assert.equal(h.field('claim-value'), field); assert.equal(h.document.activeElement, field); assert.equal(h.document.focusDetachments, 0);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [3, 9]);
  await h.claims.update(claim.id, { expectedRevision: 1, value: 'En samtidig rettelse.' }); await h.ui.refresh();
  assert.match(h.field('claim-draft-status').textContent, /Ændret et andet sted.*revision 1/);
  assert.equal(h.field('claim-submit').disabled, true); await h.submit(); assert.equal(h.writes().length, 0);
  const next = harness({ state: h.state, saved: h.saved }); await next.ui.refresh();
  assert.equal(next.field('claim-value').value, 'Min ufuldførte rettelse'); assert.equal(next.field('claim-submit').disabled, true);
  await next.button(next.field('personal-claim-form'), 'Hent nyeste oplysning og kassér kladde').emit('click');
  assert.equal(next.field('claim-value').value, 'En samtidig rettelse.'); assert.equal(next.field('claim-submit').disabled, false);
  assert.equal(JSON.parse(next.saved.get(draftKey)).edit.revision, 2);
});

test('B1/B4 confirmed correction preserves original until explicit exact replacement confirmation', async () => {
  const h = harness(), original = await confirmed(h); await h.ui.refresh(); await h.button(h.card(original.id), 'Ret oplysning').emit('click');
  await h.fill('claim-value', 'Jeg foretrækker nu den grønne mappe.'); await h.submit();
  const proposal = h.state.personalClaims.find(item => item.id !== original.id);
  assert.equal(h.state.personalClaims[0].status, 'confirmed'); assert.equal(proposal.status, 'proposed');
  assert.equal(h.writes()[0].body.correctsId, original.id); assert.equal(h.writes()[0].body.correctsRevision, 2);
  const confirmButton = h.button(h.card(proposal.id), 'Bekræft oplysning'); assert.equal(confirmButton.disabled, true);
  await confirmButton.emit('click'); assert.equal(h.writes().length, 1);
  await h.fill(`claim-replaces-${proposal.id}`, original.id); assert.equal(confirmButton.disabled, false); confirmButton.focus(); await confirmButton.emit('click');
  assert.deepEqual(h.writes()[1].body, { expectedRevision: 1, supersedesId: original.id, supersedesRevision: 2 });
  assert.equal(h.state.personalClaims[0].status, 'superseded'); assert.equal(proposal.status, 'confirmed');
  assert.match(h.card(proposal.id).textContent, /Bekræftet af dig/); assert.equal(h.document.activeElement, h.card(proposal.id));
  h.field('claim-show-history').checked = true; await h.field('claim-show-history').emit('change');
  assert.match(h.card(original.id).textContent, /Erstattet — kun historik/); assert.equal(currentClaim(h.state.personalClaims[0]), false);
});

test('B4 replacement review captures both revisions and cannot silently retarget a changed original', async () => {
  const h = harness(), original = await confirmed(h); await h.ui.refresh(); await h.button(h.card(original.id), 'Ret oplysning').emit('click');
  await h.fill('claim-value', 'Rettelsesforslag.'); await h.submit(); const proposed = h.state.personalClaims[1];
  await h.fill(`claim-replaces-${proposed.id}`, original.id);
  await h.claims.decision(original.id, original.revision, 'invalidate'); await h.ui.refresh();
  const action = h.button(h.card(proposed.id), 'Bekræft oplysning'); assert.equal(action.disabled, true); await action.emit('click');
  assert.equal(h.writes().length, 1); assert.equal(proposed.status, 'proposed');
  assert.match(h.card(proposed.id).textContent, /original er ændret|oprindeligt gennemgåede/);
});

test('B1/B4 states distinguish proposals, conflicts, future/expired facts, invalidation and history', async () => {
  const h = harness(), first = await confirmed(h), second = await confirmed(h, { value: 'Jeg foretrækker den røde mappe.' });
  const future = await confirmed(h, { subject: 'fremtid', validFrom: '2099-01-01T00:00:00Z' });
  const expired = await confirmed(h, { subject: 'udloebet', expiresAt: '2020-01-01T00:00:00Z' }); await h.ui.refresh();
  assert.match(h.card(first.id).textContent, /Modstridende bekræftede/); assert.match(h.card(second.id).textContent, /Modstridende bekræftede/);
  assert.match(h.card(future.id).textContent, /endnu ikke gældende/); assert.match(h.card(expired.id).textContent, /Udløbet/);
  await h.button(h.card(first.id), 'Markér ugyldig').emit('click'); assert.equal(h.writes()[0].body.expectedRevision, 2);
  assert.equal(h.card(first.id), undefined); assert.equal(currentClaim(h.state.personalClaims[0]), false);
  h.ui.pin(first.id); await h.ui.refresh(); assert.match(h.card(first.id).textContent, /Ugyldig — bruges ikke/);
  await h.button(h.card(first.id), 'Åbn oprindelig kilde').emit('click'); assert.deepEqual(h.sources, ['organizer:synthetic:note']);
  assert.equal(h.writes().length, 1);
});

test('R03 new text and subject typed while a claim save is in flight remain a separate unsent draft', async () => {
  const h = harness(); await h.fill('claim-subject', 'foerste_emne'); await h.fill('claim-value', 'Sendt forslag');
  const gate = deferred(); h.hold = gate; const pending = h.submit();
  await h.fill('claim-subject', 'andet_emne'); await h.fill('claim-value', 'Senere tekst'); gate.resolve(); await pending;
  assert.equal(h.field('claim-subject').value, 'andet_emne'); assert.equal(h.field('claim-value').value, 'Senere tekst');
  assert.equal(h.state.personalClaims[0].subject, 'foerste_emne'); assert.equal(h.writes().length, 1);
  const next = harness({ saved: h.saved, state: h.state }); assert.equal(next.field('claim-value').value, 'Senere tekst');
});

test('A/R03 a confirmed save followed by a read failure stays saved and does not duplicate the mutation', async () => {
  const h = harness(); await h.fill('claim-subject', 'syntetisk'); await h.fill('claim-value', 'Gem kun én gang');
  h.failure = call => call.method === 'GET' ? new Error('Syntetisk læsefejl') : null; await h.submit();
  assert.equal(h.state.personalClaims.length, 1); assert.equal(h.writes().length, 1);
  assert.equal(h.field('claim-value').value, ''); assert.match(h.field('claim-status').textContent, /Ændringen er gemt, men oversigten/);
  assert.equal(h.field('claim-submit').disabled, false);
});

test('A/K unknown claim outcome survives reload and requires a read plus explicit review, never automatic retry', async () => {
  const h = harness(); await h.fill('claim-subject', 'ukendt'); await h.fill('claim-value', 'Bevar mig');
  h.failure = call => call.method === 'POST' ? new Error('Forbindelsen forsvandt') : null; await h.submit();
  assert.equal(h.field('claim-submit').disabled, true); await h.submit(); assert.equal(h.writes().length, 1);
  const next = harness({ state: h.state, saved: h.saved }); await next.ui.refresh();
  assert.equal(next.field('claim-submit').disabled, true); const form = next.field('personal-claim-form');
  const review = next.button(form, 'Bekræft gennemgået gemningsudfald'); assert.equal(review.disabled, true);
  await next.button(form, 'Hent status efter usikkert udfald').emit('click'); assert.equal(review.disabled, false); await review.emit('click');
  assert.equal(next.field('claim-value').value, 'Bevar mig'); assert.equal(next.field('claim-submit').disabled, false);
  assert.equal(next.writes().length, 0); assert.match(next.field('claim-status').textContent, /ingen handling er gentaget/);
});

test('I/R03 logout removes private claim drafts and guards a late successful response', async () => {
  const h = harness(); await h.fill('claim-subject', 'syntetisk'); await h.fill('claim-value', 'Privat syntetisk kladde');
  const gate = deferred(); h.hold = gate; const pending = h.submit(); h.token = null; h.ui.clear(); gate.resolve(); await pending;
  assert.equal(h.field('claim-value').value, ''); assert.equal(h.field('claim-list').children.length, 0);
  assert.equal(h.saved.has(draftKey), false); assert.equal(h.field('claim-status').textContent, '');
  const second = harness({ saved: new Map([[draftKey, JSON.stringify({ subject: 'old', value: 'not restored' })]]), authenticated: false });
  assert.equal(second.field('claim-value').value, ''); assert.equal(second.saved.has(draftKey), false);
});

test('K/I legacy claim drafts migrate without losing values; secret-like drafts remain only in RAM with a warning', async () => {
  const saved = new Map([[draftKey, JSON.stringify({ subject: 'gammel', value: 'Kladde fra tidligere version', category: 'preference' })]]);
  const h = harness({ saved }); assert.equal(h.field('claim-value').value, 'Kladde fra tidligere version');
  await h.fill('claim-source-id', 'syntetisk-kilde'); assert.equal(JSON.parse(saved.get(draftKey)).version, 2);
  assert.equal(JSON.stringify([...saved.values()]).includes('synthetic-owner-token'), false);
  await h.fill('claim-value', 'password: syntetiskhemmelighed'); assert.equal(saved.has(draftKey), false);
  assert.equal(h.ui.hasUnrecoverableDraft(), true); assert.match(h.field('claim-draft-status').textContent, /kan ikke gendanne/);
  assert.equal(h.writes().length, 0);
});

test('B/K invalid dates and missing/repeated DST hours are rejected before a mutation', async () => {
  const h = harness(); await h.fill('claim-subject', 'dato'); await h.fill('claim-value', 'Syntetisk');
  for (const value of ['2026-02-30T12:00', '2026-03-29T02:30', '2026-10-25T02:30']) {
    await h.fill('claim-valid-from', value); await h.submit(); assert.equal(h.writes().length, 0);
    assert.match(h.field('claim-status').textContent, /findes ikke|forekommer to gange/);
  }
  await h.fill('claim-repeated-time', 'later'); await h.submit();
  assert.equal(h.writes()[0].body.validFrom, '2026-10-25T01:30:00.000Z');
});
