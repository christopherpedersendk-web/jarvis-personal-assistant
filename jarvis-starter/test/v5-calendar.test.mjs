import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleCalendarReadOnly } from '../google-calendar.mjs';

const config = { clientId: 'synthetic-id', clientSecret: 'synthetic-only',
  redirectUri: 'https://jarvis.example/api/google/calendar/callback' };

test('read-only calendar selection keeps source, coverage and freshness without broader permissions', async () => {
  const seen = []; const saved = [];
  const calendar = new GoogleCalendarReadOnly({ ...config, refreshToken: 'synthetic-refresh',
    now: () => Date.parse('2026-11-04T08:00:00Z'), saveCalendarId: async value => saved.push(value),
    fetcher: async url => {
      seen.push(String(url));
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'synthetic' }), { status: 200 });
      return new Response(JSON.stringify({ items: [{ id: 'fake', summary: 'Aftale',
        start: { dateTime: '2026-11-05T18:00:00+01:00' }, end: { dateTime: '2026-11-05T19:00:00+01:00' },
        description: 'must never expose private text' }] }), { status: 200 });
    },
  });
  assert.equal(calendar.status().connectionState, 'not_verified');
  await assert.rejects(calendar.selectCalendar('../other'), /ugyldige/);
  await calendar.selectCalendar('shared@group.calendar.google.com');
  assert.deepEqual(saved, ['shared@group.calendar.google.com']);
  assert.equal(calendar.status().coverage, null);
  const events = await calendar.upcoming(7);
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /must never expose/);
  assert.ok(seen.some(url => url.includes('shared%40group.calendar.google.com/events')));
  assert.equal(calendar.status().connectionState, 'connected');
  assert.equal(calendar.status().coverage.calendarId, 'shared@group.calendar.google.com');
  assert.equal(calendar.status().coverage.complete, true);
  assert.equal(calendar.status().canEdit, false);
  await calendar.selectCalendar('primary');
  assert.equal(calendar.status().coverage, null);
  assert.equal(calendar.status().connectionState, 'not_verified');
});

test('revoked Google login is reported as expired instead of silently treating calendar as empty', async () => {
  const calendar = new GoogleCalendarReadOnly({ ...config, refreshToken: 'synthetic-revoked',
    fetcher: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
  });
  await assert.rejects(calendar.upcoming(7), /OAuth fejlede/);
  assert.equal(calendar.status().connectionState, 'expired_login');
  assert.equal(calendar.status().coverage, null);
  assert.equal(calendar.status().connected, true, 'stored credential is distinct from a verified live connection');
  await calendar.disconnect();
  assert.equal(calendar.status().connectionState, 'not_connected');
});
