import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const context = vm.createContext({ Date, Intl });
vm.runInContext(await readFile(new URL('../public/gui-today.js', import.meta.url), 'utf8'), context);
const today = context.JarvisToday;
const plain = value => JSON.parse(JSON.stringify(value));
const now = '2026-11-05T10:00:00.000Z';
const cache = () => ({ connectionState: 'connected', ready: true, cacheState: 'ready',
  fetchedAt: '2026-11-05T09:59:00.000Z', expiresAt: '2026-11-05T10:04:00.000Z',
  coverage: { start: '2026-11-04T23:00:00.000Z', end: '2026-11-05T23:00:00.000Z' }, events: [] });

test('GUI-T03/T15 Today uses the Danish calendar day at midnight and through DST boundaries', () => {
  assert.deepEqual(plain(today.dayRange('2026-11-04T23:30:00Z')),
    { date: '2026-11-05', start: '2026-11-04T23:00:00.000Z', end: '2026-11-05T23:00:00.000Z' });
  for (const [instant, hours] of [['2026-03-29T12:00:00Z', 23], ['2026-10-25T12:00:00Z', 25]]) {
    const range = today.dayRange(instant);
    assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 3600000, hours);
  }
  assert.equal(today.dateOf('2026-11-05'), '2026-11-05', 'a date-only birthday is not timezone shifted');
});

test('GUI-T03 empty, disconnected, failed, stale and uncovered calendars do not share a success state', () => {
  assert.equal(today.calendarSummary(cache(), now).state, 'empty');
  assert.equal(today.calendarSummary({ ...cache(), connectionState: 'not_connected' }, now).state, 'disconnected');
  assert.equal(today.calendarSummary(null, now).state, 'error');
  assert.equal(today.calendarSummary({ ...cache(), ready: false, cacheState: 'stale' }, now).state, 'unknown');
  assert.equal(today.calendarSummary({ ...cache(), coverage: null }, now).state, 'unknown');
  assert.equal(today.calendarSummary({ ...cache(), expiresAt: '2026-11-05T09:00:00Z' }, now).state, 'unknown');
});

test('GUI-T03 Today excludes tomorrow and events that ended exactly at this day’s midnight', () => {
  const data = cache(); data.events = [
    { id: 'yesterday', start: '2026-11-04T22:00:00Z', end: '2026-11-04T23:00:00Z' },
    { id: 'today', start: '2026-11-05T14:30:00Z', end: '2026-11-05T15:00:00Z' },
    { id: 'tomorrow', start: '2026-11-05T23:00:00Z', end: '2026-11-06T00:00:00Z' },
    { id: 'all-day', allDay: true, start: '2026-11-05', end: '2026-11-06' },
  ];
  assert.deepEqual(plain(today.calendarSummary(data, now).events.map(event => event.id)).sort(), ['all-day', 'today']);
});

test('GUI-T01/T09 list and task summaries retain the exact original source identity', () => {
  assert.equal(today.agendaSource({ source: { kind: 'organizer', collectionId: 'list', itemId: 'item' } }), 'organizer:list:item');
  assert.equal(today.agendaSource({ source: { kind: 'personal-task', id: 'task' } }), 'personal-task:task');
  assert.equal(today.agendaSource({ source: { kind: 'organizer' } }), null);
});
