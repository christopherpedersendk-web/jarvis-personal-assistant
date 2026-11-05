import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SecretaryCore, activePersonalMemory, MAX_MEMORY_HISTORY } from '../secretary-core.mjs';
import { PersonalKnowledge, indexPersonalKnowledge } from '../personal-knowledge.mjs';
import { DurableState } from '../durable-state.mjs';
import { loadVersionedState, atomicStateWrite } from '../state-schema.mjs';

const NOW = '2026-11-05T10:00:00.000Z';
const provenance = { kind: 'user', channel: 'discord', messageId: 'synthetic-source-123456789' };
async function fixture(initial = {}) {
  let fail = false, disk, writes = 0, time = new Date(NOW);
  const store = new DurableState({ initial, write: async text => {
    if (fail) throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
    disk = JSON.parse(text); writes++;
  } });
  const secretary = new SecretaryCore({ state: store.state, save: () => store.save(), now: () => time });
  const knowledge = new PersonalKnowledge({ state: store.state, now: () => time });
  await store.initialize();
  const call = (method, ...args) => store.transact(['memories'], () => secretary[method](...args));
  const remember = (text = 'Jeg foretrak zebrablomster.', extra = {}) => call('remember', text, null, { source: provenance, category: 'preference', ...extra });
  return { store, secretary, knowledge, call, remember, disk: () => structuredClone(disk), writes: () => writes,
    fail: value => { fail = value; }, advance: value => { time = new Date(value); } };
}

test('B1 legacy-note correction retains exact prior content, provenance and validity without nesting history', async () => {
  const f = await fixture(), original = await f.remember(undefined, { expiresAt: '2030-11-05T10:00:00+01:00' });
  f.advance('2026-11-05T11:00:00.000Z');
  const corrected = await f.call('updateMemory', original.id, { expectedRevision: 1, text: 'Jeg foretrækker solsikker.', category: 'food', expiresAt: null });
  assert.equal(corrected.historyCount, 1); assert.equal(corrected.revisionHistory, undefined);
  assert.deepEqual(corrected.originSource, provenance);
  const history = f.secretary.memoryHistory(original.id);
  assert.equal(history.id, original.id); assert.equal(history.revision, 2); assert.equal(history.earlierRevisionsUnavailable, false);
  assert.equal(history.history.length, 1); const snapshot = history.history[0];
  for (const key of ['text', 'category', 'expiresAt', 'status', 'confirmed', 'createdAt', 'updatedAt']) assert.deepEqual(snapshot[key], original[key], key);
  assert.deepEqual(snapshot.source, provenance); assert.equal(snapshot.change, 'update'); assert.equal(snapshot.historical, true);
  assert.equal(snapshot.replacedAt, '2026-11-05T11:00:00.000Z'); assert.equal(snapshot.revisionHistory, undefined);
  assert.equal(activePersonalMemory(snapshot, new Date(NOW)), false);
  snapshot.text = 'Mutating response'; snapshot.source.channel = 'voice';
  assert.equal(f.secretary.memoryHistory(original.id).history[0].text, original.text);
  assert.equal(f.secretary.memoryHistory(original.id).history[0].source.channel, 'discord');
  const second = await f.call('updateMemory', original.id, { expectedRevision: 2, category: 'fact' });
  assert.equal(second.historyCount, 2); assert.deepEqual(second.originSource, provenance);
  assert.equal(f.secretary.memoryHistory(original.id).history[1].originSource.channel, 'discord');
});

test('R01/B1 identical normalized note saves are no-ops after revision and metadata validation', async () => {
  const f = await fixture(), original = await f.remember(), before = f.disk(), writes = f.writes();
  const unchanged = await f.call('updateMemory', original.id, { expectedRevision: 1, text: ` ${original.text} `,
    category: original.category, expiresAt: null });
  assert.deepEqual(unchanged, original); assert.equal(unchanged.source.channel, 'discord', 'identical text does not invent a new manual source');
  assert.deepEqual(f.disk(), before); assert.equal(f.writes(), writes);
  await assert.rejects(f.call('updateMemory', original.id, { expectedRevision: 0, text: original.text }), /ændret/);
  await assert.rejects(f.call('updateMemory', original.id, { expectedRevision: 1, status: 'confirmed' }), /felter/);
  await assert.rejects(f.call('updateMemory', original.id, { expectedRevision: 1, expiresAt: '2026-02-30T10:00:00Z' }), /gyldigt/);
  assert.deepEqual(f.disk(), before); assert.equal(f.writes(), writes);
  const changedSource = await f.call('updateMemory', original.id, { expectedRevision: 1, source: { kind: 'user', channel: 'voice' } });
  assert.equal(changedSource.revision, 2); assert.equal(changedSource.historyCount, 1);
});

test('B1 editing a proposed note and retaining its history never substitutes for owner confirmation', async () => {
  const f = await fixture(), proposed = await f.call('proposeMemory', 'Måske foretrækker jeg kastanjeblomster.');
  const edited = await f.call('updateMemory', proposed.id, { expectedRevision: 1, text: 'Jeg foretrækker kastanjeblomster.' });
  assert.equal(edited.status, 'proposed'); assert.equal(edited.confirmed, false); assert.deepEqual(f.knowledge.search('kastanjeblomster'), []);
  assert.equal(f.secretary.memoryContext(), '');
  const confirmed = await f.call('confirmMemory', proposed.id, { expectedRevision: 2 });
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.historyCount, 2);
  const history = f.secretary.memoryHistory(proposed.id).history;
  assert.deepEqual(history.map(item => item.status), ['proposed', 'proposed']);
  assert.deepEqual(history.map(item => item.change), ['update', 'confirm']);
  assert.equal(history[0].source.kind, 'assistant'); assert.equal(history[1].source.kind, 'user');
  const before = f.disk(), writes = f.writes();
  await assert.rejects(f.call('confirmMemory', proposed.id, { expectedRevision: 3 }), /allerede/);
  assert.deepEqual(f.disk(), before); assert.equal(f.writes(), writes);
});

test('B1 archive appends one prior revision, remains readable and is a revision-bound no-op when repeated', async () => {
  const f = await fixture(), note = await f.remember();
  const archived = await f.call('archiveMemory', note.id, 1);
  assert.equal(archived.revision, 2); assert.equal(archived.historyCount, 1); assert.equal(archived.archived, true);
  const history = f.secretary.memoryHistory(note.id); assert.equal(history.archived, true);
  assert.equal(history.history[0].archived, false); assert.equal(history.history[0].change, 'archive');
  assert.equal(f.secretary.listMemories().length, 0); assert.equal(f.secretary.memoryContext(), '');
  const archivedSummary = f.secretary.listMemories({ includeArchived: true })[0];
  assert.equal(archivedSummary.id, note.id); assert.equal(archivedSummary.active, false);
  assert.equal(archivedSummary.historyCount, 1); assert.equal(archivedSummary.revisionHistory, undefined);
  assert.deepEqual(f.knowledge.search('zebrablomster'), []);
  const writes = f.writes(), before = f.disk();
  assert.deepEqual(await f.call('archiveMemory', note.id, 2), archived); assert.equal(f.writes(), writes);
  await assert.rejects(f.call('archiveMemory', note.id, 1), /ændret/); assert.deepEqual(f.disk(), before);
});

test('A1/B1 failed persistence publishes neither updated facts nor history and permits a later safe retry', async () => {
  for (const action of ['update', 'confirm', 'archive']) {
    const f = await fixture(), note = action === 'confirm' ? await f.call('proposeMemory', 'Syntetisk ikke-godkendt note') : await f.remember();
    const before = f.disk(), visible = f.secretary.listMemories(), call = () => action === 'update'
      ? f.call('updateMemory', note.id, { expectedRevision: 1, text: 'Ny version efter fejl' })
      : action === 'confirm' ? f.call('confirmMemory', note.id, { expectedRevision: 1 }) : f.call('archiveMemory', note.id, 1);
    f.fail(true); await assert.rejects(call(), /rename failure/);
    assert.deepEqual(f.disk(), before); assert.deepEqual(f.secretary.listMemories(), visible);
    assert.equal(f.secretary.memoryHistory(note.id).historyCount, 0);
    f.fail(false); const changed = await call(); assert.equal(changed.revision, 2); assert.equal(changed.historyCount, 1);
  }
});

test('A1/B1 actual atomic rename failure retains both disk/current history; uncertain post-rename publication is never retried', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-note-history-disk-')), path = join(directory, 'state.json');
  let failure = null;
  const store = new DurableState({ initial: {}, write: text => atomicStateWrite(path, text,
    failure === 'rename' ? { renameFile: async () => { throw Object.assign(new Error('synthetic actual rename failure'), { code: 'EIO' }); } }
      : failure === 'sync' ? { syncDirectory: async () => { throw Object.assign(new Error('synthetic directory sync failure'), { code: 'EIO' }); } } : {}) });
  const secretary = new SecretaryCore({ state: store.state, save: () => store.save(), now: () => new Date(NOW) }); await store.initialize();
  const call = (method, ...args) => store.transact(['memories'], () => secretary[method](...args));
  const note = await call('remember', 'Før den faktiske rename-fejl'), before = await readFile(path, 'utf8');
  failure = 'rename';
  await assert.rejects(call('updateMemory', note.id, { expectedRevision: 1, text: 'Må ikke publiceres' }), /rename failure/);
  assert.equal(await readFile(path, 'utf8'), before); assert.equal(secretary.memoryHistory(note.id).historyCount, 0);
  failure = null; await call('updateMemory', note.id, { expectedRevision: 1, text: 'Sikkert publiceret rettelse' });
  assert.equal(secretary.memoryHistory(note.id).historyCount, 1);
  failure = 'sync';
  await assert.rejects(call('archiveMemory', note.id, 2), { code: 'STATE_DURABILITY_UNKNOWN' });
  assert.equal(secretary.memoryHistory(note.id).historyCount, 2); assert.equal(secretary.memoryHistory(note.id).archived, true);
  const published = await readFile(path, 'utf8'); assert.equal(JSON.parse(published).memories[0].revisionHistory.length, 2);
  await assert.rejects(call('archiveMemory', note.id, 2), /udfald er ukendt/); assert.equal(await readFile(path, 'utf8'), published);
  const restarted = new SecretaryCore({ state: JSON.parse(published) });
  assert.equal(restarted.memoryHistory(note.id).historyCount, 2); assert.equal(restarted.memoryContext(), '');
});

test('B1 two concurrent changes with the same note revision create exactly one history transition', async () => {
  const f = await fixture(), note = await f.remember();
  const results = await Promise.allSettled(['Solsikker', 'Roser'].map(text => f.call('updateMemory', note.id, { expectedRevision: 1, text })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.secretary.memoryHistory(note.id).historyCount, 1);
  assert.equal(f.secretary.memoryHistory(note.id).history[0].text, note.text); assert.equal(f.secretary.listMemories()[0].revision, 2);
});

test('B1 historical, archived and invalidated/expired old facts never re-enter lexical or model memory', async () => {
  const f = await fixture(), note = await f.remember();
  await f.call('updateMemory', note.id, { expectedRevision: 1, text: 'Jeg foretrækker solsikker.' });
  const history = f.secretary.memoryHistory(note.id).history;
  assert.deepEqual(f.knowledge.search('zebrablomster'), []); assert.match(f.secretary.memoryContext(), /solsikker/);
  assert.doesNotMatch(f.secretary.memoryContext(), /zebrablomster/);
  const docs = indexPersonalKnowledge(f.store.state, { now: new Date(NOW) });
  assert.equal(docs.filter(doc => doc.type === 'memory').length, 1); assert.equal(JSON.stringify(docs).includes('zebrablomster'), false);
  assert.equal(JSON.stringify(docs).includes('revisionHistory'), false);
  const accidentallyFlattened = { memories: history };
  new SecretaryCore({ state: accidentallyFlattened });
  assert.deepEqual(indexPersonalKnowledge(accidentallyFlattened, { now: new Date(NOW) }), []);
  assert.equal(history[0].historical, true); assert.equal(activePersonalMemory(history[0]), false);
  await f.call('updateMemory', note.id, { expectedRevision: 2, expiresAt: '2020-01-01T00:00:00Z' });
  assert.deepEqual(f.knowledge.search('solsikker'), []); assert.equal(f.secretary.memoryContext(), '');
  await f.call('archiveMemory', note.id, 3); assert.equal(f.secretary.memoryHistory(note.id).historyCount, 3);
  assert.deepEqual(f.knowledge.search('solsikker'), []);
});

test('L/B1 synthetic v4.9.1 migration records only known revisions and preserves exact legacy backup and manual data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-note-history-')), path = join(directory, 'state.json');
  const legacy = { memories: [{ id: 'legacy-note', text: 'En gammel manuel note', revision: 7, category: 'fact',
    source: provenance, status: 'confirmed', confirmed: true, expiresAt: null, createdAt: '2021-01-01T00:00:00Z',
    unknownManualField: { keep: 'Bevar brugerens data' } }] };
  const original = JSON.stringify(legacy); await writeFile(path, original, { mode: 0o600 });
  const migrated = await loadVersionedState(path);
  assert.equal(migrated.memories[0].revisionHistory, undefined);
  const secretary = new SecretaryCore({ state: migrated, save: () => atomicStateWrite(path, JSON.stringify(migrated)), now: () => new Date(NOW) });
  assert.equal(secretary.memoryHistory('legacy-note').historyCount, 0);
  assert.equal(secretary.memoryHistory('legacy-note').earlierRevisionsUnavailable, true);
  await secretary.updateMemory('legacy-note', { expectedRevision: 7, text: 'Den første kendte rettelse i v5' });
  const reloaded = await loadVersionedState(path), reader = new SecretaryCore({ state: reloaded });
  assert.equal(reader.memoryHistory('legacy-note').firstCapturedRevision, 7);
  assert.deepEqual(reader.memoryHistory('legacy-note').history.map(entry => entry.revision), [7]);
  assert.deepEqual(reloaded.memories[0].unknownManualField, legacy.memories[0].unknownManualField);
  assert.equal(await readFile(`${path}.v4.9.1-before-v5.backup`, 'utf8'), original);
  assert.deepEqual((await loadVersionedState(path)).memories[0].revisionHistory, reloaded.memories[0].revisionHistory);
});

test('B1 history caps fail closed without trimming, but final archival remains possible', async () => {
  const f = await fixture(), note = await f.remember(); let current = note;
  for (let index = 0; index < MAX_MEMORY_HISTORY; index++) current = await f.call('updateMemory', note.id,
    { expectedRevision: current.revision, text: `Syntetisk historikrevision ${index}` });
  assert.equal(current.historyCount, 100); const before = f.disk();
  const count = f.writes();
  assert.deepEqual(await f.call('updateMemory', note.id, { expectedRevision: current.revision, text: current.text }), current);
  assert.equal(f.writes(), count, 'a full history must still permit a true no-op');
  await assert.rejects(f.call('updateMemory', note.id, { expectedRevision: current.revision, text: 'Må ikke erstatte gammel historik' }), /100 historiske/);
  assert.deepEqual(f.disk(), before);
  const archived = await f.call('archiveMemory', note.id, current.revision);
  assert.equal(archived.historyCount, 101); assert.equal(f.secretary.memoryHistory(note.id).history[0].text, note.text);
  assert.equal(f.secretary.memoryContext(), ''); assert.deepEqual(f.knowledge.search('historikrevision'), []);
});

test('L/B1 malformed or future revision-history schemas are retained and rejected rather than silently rewritten', async () => {
  for (const revisionHistory of [{ future: true }, [{ historySchemaVersion: 2, historical: true, revision: 1 }]]) {
    const f = await fixture({ memories: [{ id: 'unknown-history', revision: 2, text: 'Bevar den aktuelle note', revisionHistory }] });
    const before = f.disk();
    await assert.rejects(f.call('updateMemory', 'unknown-history', { expectedRevision: 2, text: 'Ny tekst' }), /historik/);
    assert.throws(() => f.secretary.memoryHistory('unknown-history'), /historik/); assert.deepEqual(f.disk(), before);
  }
});

test('I/B1 secret-like legacy history stays private on disk and is never exported, retrieved or made current', async () => {
  const secret = 'password=synthetic-legacy-secret';
  const f = await fixture({ memories: [{ id: 'legacy-secret', revision: 1, text: secret, status: 'confirmed', confirmed: true }] });
  assert.equal(f.secretary.memoryContext(), ''); assert.deepEqual(f.knowledge.search('legacy-secret'), []);
  const changed = await f.call('updateMemory', 'legacy-secret', { expectedRevision: 1, text: 'En sikker note uden hemmeligheder' });
  assert.equal(changed.historyCount, 1); assert.equal(JSON.stringify(changed).includes(secret), false);
  assert.equal(f.disk().memories[0].revisionHistory[0].text, secret, 'private original bytes are not silently deleted');
  const history = f.secretary.memoryHistory('legacy-secret'); assert.equal(history.history[0].redacted, true);
  assert.equal(JSON.stringify(history).includes(secret), false); assert.equal(JSON.stringify(f.secretary.listMemories()).includes(secret), false);
  assert.deepEqual(f.knowledge.search('synthetic-legacy-secret'), []);
});
