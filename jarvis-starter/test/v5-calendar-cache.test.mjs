import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { GoogleCalendarReadOnly } from '../google-calendar.mjs';
import { busyMealDates } from '../calendar-planning.mjs';

const config = { clientId: 'synthetic-cache-id', clientSecret: 'synthetic-cache-secret',
  redirectUri: 'https://synthetic.invalid/api/google/calendar/callback', refreshToken: 'synthetic-cache-refresh' };
const instant = '2026-11-05T09:00:00Z';
const event = { id: 'synthetic-event', summary: 'Ekstern tidskonflikt – beviser ikke fremmøde',
  start: { dateTime: '2026-11-05T17:00:00+01:00' }, end: { dateTime: '2026-11-05T18:00:00+01:00' },
  description: 'not-for-cache', location: 'not-for-cache', attendees: [{ email: 'not-for-cache' }] };
const fixture = () => {
  const f = { now: Date.parse(instant), calls: [], response: { items: [event] } };
  f.calendar = new GoogleCalendarReadOnly({ ...config, now: () => f.now,
    fetcher: async url => {
      f.calls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'synthetic-short-token', expires_in: 3600 }), { status: 200 });
      if (f.failure) throw new Error('Synthetic network failure');
      return new Response(JSON.stringify(f.response), { status: 200 });
    } });
  return f;
};

test('D4/I1 cache/status reads perform no external requests and unknown coverage is not free capacity', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) {
    const view = f.calendar.cached({ startDate: '2026-11-05', days: 7 }); f.calendar.status();
    assert.equal(view.canEdit, false); assert.equal(view.cacheState, 'unknown'); assert.equal(view.ready, false);
    assert.equal(view.dinnerDays.length, 7); assert.ok(view.dinnerDays.every(day => day.status === 'unknown'));
    assert.deepEqual(view.events, []);
    assert.doesNotMatch(JSON.stringify(view), /synthetic-cache-secret|synthetic-cache-refresh|cacheConfiguration|accessToken/);
  }
  assert.equal(f.calls.length, 0);
});

test('D4/I1 an explicit read populates a bounded source-bound snapshot with fresh metadata and isolated copies', async () => {
  const f = fixture(); await f.calendar.upcoming(7);
  const count = f.calls.length, view = f.calendar.cached({ startDate: '2026-11-05', days: 7 });
  assert.equal(view.ready, true); assert.equal(view.calendarId, 'primary'); assert.equal(view.coverage.complete, true);
  assert.equal(view.fetchedAt, instant.replace('Z', '.000Z')); assert.equal(view.expiresAt, '2026-11-05T09:05:00.000Z');
  assert.equal(view.dinnerDays[0].status, 'busy'); assert.equal(view.dinnerDays[1].status, 'no_conflict');
  assert.equal(view.dinnerDays[0].eventCount, 1); assert.doesNotMatch(JSON.stringify(view), /not-for-cache/);
  view.events[0].title = 'Must not change cached data'; view.coverage.complete = false; view.dinnerDays[0].events[0].title = 'Different local mutation';
  const next = f.calendar.cached(); assert.equal(next.events[0].title, event.summary); assert.equal(next.coverage.complete, true);
  assert.equal(f.calls.length, count, 'polling never refreshes the remote source');
});

test('D4 stale or out-of-range calendar data cannot claim a dinner is available', async () => {
  const f = fixture(); await f.calendar.upcoming(1);
  const view = f.calendar.cached({ startDate: '2026-11-05', days: 2 });
  assert.equal(view.dinnerDays[0].status, 'busy'); assert.equal(view.dinnerDays[1].status, 'unknown');
  assert.equal(view.dinnerDays[1].reason, 'outside_coverage');
  const out = f.calendar.cached({ start: '2026-11-10T15:00:00Z', end: '2026-11-10T19:00:00Z' });
  assert.equal(out.cacheState, 'outside_coverage'); assert.equal(out.ready, false);
  f.now += 300_000;
  const expired = f.calendar.cached(); assert.equal(expired.cacheState, 'stale'); assert.equal(expired.ready, false);
  assert.equal(expired.events.length, 1, 'old observations may remain inspectable but are not current evidence');
  assert.ok(expired.dinnerDays.every(day => day.status === 'unknown'));
});

test('I1 cache validation rejects impossible dates and unbounded or ambiguous ranges', () => {
  const f = fixture();
  for (const options of [{ startDate: '2026-02-30' }, { days: 15 }, { days: 0 }, { days: 1.5 },
    { start: '2026-11-05', end: '2026-11-06' }, { start: '2026-11-05T10:00Z', end: '2026-12-05T10:00Z' }])
    assert.throws(() => f.calendar.cached(options));
  assert.equal(f.calls.length, 0);
});

test('I1 calendar selection and credential/config changes invalidate cache without reusing private observations', async () => {
  for (const [key, value] of [['clientId', 'changed-id'], ['clientSecret', 'changed-secret'],
    ['redirectUri', 'https://new.invalid/api/google/calendar/callback'], ['refreshToken', 'changed-refresh']]) {
    const f = fixture(); await f.calendar.upcoming(); const count = f.calls.length;
    f.calendar[key] = value;
    const view = f.calendar.cached(); assert.equal(view.cacheState, 'unknown'); assert.deepEqual(view.events, []);
    assert.equal(f.calendar.status().lastReadAt, null); assert.equal(f.calendar.accessToken, ''); assert.equal(f.calls.length, count);
  }
  const f = fixture(); await f.calendar.upcoming(); await f.calendar.selectCalendar('different@group.calendar.google.com');
  assert.deepEqual(f.calendar.cached().events, []); assert.equal(f.calendar.cached().calendarId, 'different@group.calendar.google.com');
});

test('I1 failed reads or malformed pagination preserve only explicitly unavailable observations, not no-change/free claims', async () => {
  for (const failure of ['network', 'format', 'paging']) {
    const f = fixture(); await f.calendar.upcoming();
    if (failure === 'network') f.failure = true;
    if (failure === 'format') f.response = { items: 'not-an-array' };
    if (failure === 'paging') f.response = { items: [], nextPageToken: 'same-token' };
    await assert.rejects(f.calendar.upcoming());
    const view = f.calendar.cached(); assert.equal(view.cacheState, 'unavailable'); assert.equal(view.ready, false);
    assert.equal(view.events.length, 1); assert.ok(view.dinnerDays.every(day => day.status === 'unknown'));
  }
});

test('I1 cache starts unknown after restart and a failed settings save preserves the previous verified source', async () => {
  const f = fixture(); await f.calendar.upcoming();
  const restarted = new GoogleCalendarReadOnly({ ...config, fetcher: async () => { throw new Error('Must not read during restart'); } });
  assert.equal(restarted.cached().cacheState, 'unknown'); assert.deepEqual(restarted.cached().events, []);
  f.calendar.saveCalendarId = async () => { throw new Error('Synthetic rename failure'); };
  await assert.rejects(f.calendar.selectCalendar('changed@group.calendar.google.com'));
  assert.equal(f.calendar.cached().calendarId, 'primary'); assert.equal(f.calendar.cached().ready, true);
  await f.calendar.disconnect(); assert.equal(f.calendar.cached().cacheState, 'unknown'); assert.deepEqual(f.calendar.cached().events, []);
});

test('I1 a source change during an in-flight read never publishes the previous source as the newly selected calendar', async () => {
  const f = fixture(); let finish, requested;
  const called = new Promise(resolve => { requested = resolve; });
  f.calendar.fetcher = async url => {
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'synthetic', expires_in: 3600 }));
    requested(); return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({ items: [event] }))); });
  };
  const read = f.calendar.upcoming(); await called; await f.calendar.selectCalendar('new-source@group.calendar.google.com'); finish();
  await assert.rejects(read, /ændret under læsningen/);
  assert.equal(f.calendar.cached().calendarId, 'new-source@group.calendar.google.com'); assert.deepEqual(f.calendar.cached().events, []);
});

test('D4 shared dinner rules handle Copenhagen DST, all-day ranges and transparent notes without attendance inference', async () => {
  const f = fixture(); f.now = Date.parse('2026-03-28T08:00:00Z');
  f.response = { items: [
    { id: 'morning', summary: 'Børn er her ifølge teksten', start: { dateTime: '2026-03-29T08:00:00+02:00' }, end: { dateTime: '2026-03-29T09:00:00+02:00' } },
    { id: 'dinner', summary: 'Børn er ikke hjemme ifølge teksten', start: { dateTime: '2026-03-29T16:30:00+02:00' }, end: { dateTime: '2026-03-29T17:00:00+02:00' } },
    { id: 'note', summary: 'En fødselsdag', start: { date: '2026-03-30' }, end: { date: '2026-03-31' } },
    { id: 'free', summary: 'Transparent note', transparency: 'transparent', start: { dateTime: '2026-03-30T17:00:00+02:00' }, end: { dateTime: '2026-03-30T18:00:00+02:00' } },
    { id: 'multi', summary: 'Flerdages hændelse', start: { date: '2026-03-31' }, end: { date: '2026-04-02' } },
  ] };
  await f.calendar.upcoming(7); const view = f.calendar.cached({ startDate: '2026-03-29', days: 5 });
  assert.deepEqual(view.dinnerDays.map(day => day.status), ['busy', 'no_conflict', 'busy', 'busy', 'no_conflict']);
  assert.deepEqual(view.dinnerDays.filter(day => day.status === 'busy').map(day => day.date),
    busyMealDates(view.events, { startDate: '2026-03-29', days: 5 }));
  assert.deepEqual(view.dinnerDays[0].events.map(item => item.id), ['dinner']);
  for (const day of view.dinnerDays) for (const key of ['adults', 'children', 'guests', 'attendance', 'servings']) assert.equal(key in day, false);
});

test('D4 event display is bounded to six conflicts per day while reporting the actual total', async () => {
  const f = fixture(); f.response = { items: Array.from({ length: 30 }, (_, index) => ({ ...event, id: `event-${index}` })) };
  await f.calendar.upcoming(); const view = f.calendar.cached();
  assert.equal(view.events.length, 30); assert.equal(view.dinnerDays[0].eventCount, 30); assert.equal(view.dinnerDays[0].events.length, 6);
});

const mealSource = await readFile(new URL('../public/meals.js', import.meta.url), 'utf8');
const uiSource = mealSource.slice(mealSource.indexOf('function mealCalendarTimestamp('), mealSource.indexOf('function mealEnhanceStaticUI('));
const FixedDate = class extends Date { static now() { return Date.parse(instant); } };
const observe = vm.runInNewContext(`${uiSource}\nmealCalendarObservation;`, { Date: FixedDate, Intl });
test('D4 rendered calendar wording distinguishes unknown, stale, busy and observed no-conflict without confirming attendance', () => {
  const base = { ready: true, cacheState: 'ready', expiresAt: '2026-11-05T09:05:00Z', dinnerDays: [{ date: '2026-11-05', status: 'no_conflict', events: [], eventCount: 0 }] };
  assert.match(observe(base, '2026-11-05').text, /Ingen registrerede konflikter.*Ikke bevis for fremmøde/);
  assert.equal(observe(base, '2026-11-06').state, 'unknown');
  assert.match(observe({ ...base, expiresAt: '2026-11-05T08:59:59Z' }, '2026-11-05').text, /forældede.*ikke ledig tid/);
  assert.match(observe({ ...base, ready: false, cacheState: 'unavailable' }, '2026-11-05').text, /læsning fejlede/);
  assert.match(observe({ ...base, dinnerDays: [{ date: '2026-11-05', status: 'busy', eventCount: 2, events: [] }] }, '2026-11-05').text, /2 registrerede tidskonflikter.*Fremmøde afgøres ikke/);
});
