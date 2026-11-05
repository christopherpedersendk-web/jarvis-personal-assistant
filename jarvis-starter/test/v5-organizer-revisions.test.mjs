import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizerCore } from '../organizer-core.mjs';

function fixture() {
  const state = { organizer: [] };
  let writes = 0;
  const organizer = new OrganizerCore({ state, save: async () => { writes++; }, now: () => new Date('2026-11-05T08:00:00.000Z') });
  return { state, organizer, writes: () => writes };
}

test('R03/K5 rename and archive reject a stale captured collection version without mutation', async () => {
  const f = fixture(), collection = await f.organizer.create({ title: 'Syntetiske noter', type: 'notes' });
  const initial = collection.updatedAt;
  await f.organizer.rename(collection.id, 'Gennemgåede noter', { updatedAt: initial });
  assert.notEqual(collection.updatedAt, initial);
  const before = JSON.stringify(f.state), writes = f.writes();
  await assert.rejects(f.organizer.rename(collection.id, 'Min gamle kladde', { updatedAt: initial }), /opdateret på en anden enhed/);
  await assert.rejects(f.organizer.archive(collection.id, { updatedAt: initial }), /opdateret på en anden enhed/);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.writes(), writes);
  await f.organizer.archive(collection.id, { updatedAt: collection.updatedAt });
  assert.equal(f.organizer.list().length, 0);
});

test('R03/K5 item revisions advance within the same millisecond and stale deletion cannot erase the newer item', async () => {
  const f = fixture(), collection = await f.organizer.create({ title: 'Ønsker', type: 'gifts' });
  const item = await f.organizer.addItem(collection.id, { text: 'Syntetisk gaveidé' }), initial = item.updatedAt;
  await f.organizer.updateItem(collection.id, item.id, { updatedAt: initial, notes: 'Ny ejerrettelse' });
  assert.notEqual(item.updatedAt, initial);
  await assert.rejects(f.organizer.updateItem(collection.id, item.id, { updatedAt: initial, notes: 'Forældet kladde' }), /opdateret på en anden enhed/);
  await assert.rejects(f.organizer.removeItem(collection.id, item.id, { updatedAt: initial }), /opdateret på en anden enhed/);
  assert.equal(item.notes, 'Ny ejerrettelse'); assert.equal(collection.items.length, 1);
  await f.organizer.removeItem(collection.id, item.id, { updatedAt: item.updatedAt });
  assert.equal(collection.items.length, 0);
});

test('R03/K5 malformed supplied revisions cannot opt out, while omitted legacy revisions remain compatible', async () => {
  const f = fixture(), collection = await f.organizer.create({ title: 'Familiedatoer', type: 'dates' });
  const item = await f.organizer.addItem(collection.id, { text: 'Syntetisk mærkedag' });
  for (const updatedAt of ['', null, 0, {}, 'not-an-instant']) {
    await assert.rejects(f.organizer.rename(collection.id, 'Usikker', { updatedAt }), /opdateret/);
    await assert.rejects(f.organizer.archive(collection.id, { updatedAt }), /opdateret/);
    await assert.rejects(f.organizer.updateItem(collection.id, item.id, { notes: 'Usikker', updatedAt }), /opdateret/);
    await assert.rejects(f.organizer.removeItem(collection.id, item.id, { updatedAt }), /opdateret/);
  }
  await f.organizer.rename(collection.id, 'Legacy-navn');
  await f.organizer.updateItem(collection.id, item.id, { notes: 'Legacy-værktøjskald' });
  assert.equal(collection.title, 'Legacy-navn'); assert.equal(item.notes, 'Legacy-værktøjskald');
});

test('R03/K5 an append changes the collection basis but does not invalidate a different unchanged item', async () => {
  const f = fixture(), collection = await f.organizer.create({ title: 'Indkøb', type: 'shopping' });
  const item = await f.organizer.addItem(collection.id, { text: 'Ris' });
  const itemVersion = item.updatedAt, collectionVersion = collection.updatedAt;
  await f.organizer.addItem(collection.id, { text: 'Frisk basilikum' });
  assert.notEqual(collection.updatedAt, collectionVersion); assert.equal(item.updatedAt, itemVersion);
  await f.organizer.updateItem(collection.id, item.id, { text: 'Brune ris', updatedAt: itemVersion });
  assert.deepEqual(collection.items.map(row => row.text), ['Brune ris', 'Frisk basilikum']);
});
