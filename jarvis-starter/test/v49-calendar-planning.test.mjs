import test from 'node:test';
import assert from 'node:assert/strict';
import { busyMealDates } from '../calendar-planning.mjs';

test('calendar planning uses dinner overlap rather than every event on a date', () => {
  const events = [
    { start: '2026-11-04T08:00:00+01:00', end: '2026-11-04T09:00:00+01:00', title: 'Not evidence that the household is away' },
    { start: '2026-11-05T15:00:00+01:00', end: '2026-11-05T16:00:00+01:00' },
    { start: '2026-11-05T20:00:00+01:00', end: '2026-11-05T23:00:00+01:00' },
    { start: '2026-11-06T15:59:00+01:00', end: '2026-11-06T16:01:00+01:00' },
    { start: '2026-11-06T18:00:00+01:00', end: '2026-11-06T19:00:00+01:00' },
    { start: '2026-11-07T19:59:00+01:00', end: '2026-11-07T20:01:00+01:00' },
  ];
  assert.deepEqual(busyMealDates(events, { startDate: '2026-11-04', days: 4 }), ['2026-11-06', '2026-11-07']);
});

test('winter, summer and DST transition dinner hours are interpreted in Copenhagen', () => {
  assert.deepEqual(busyMealDates([{ start: '2026-07-01T14:00:00Z', end: '2026-07-01T15:00:00Z' }], { startDate: '2026-07-01', days: 1 }), ['2026-07-01']);
  assert.deepEqual(busyMealDates([{ start: '2026-11-01T14:00:00Z', end: '2026-11-01T15:00:00Z' }], { startDate: '2026-11-01', days: 1 }), []);
  assert.deepEqual(busyMealDates([{ start: '2026-03-29T13:59:00Z', end: '2026-03-29T14:01:00Z' }], { startDate: '2026-03-28', days: 3 }), ['2026-03-29']);
  assert.deepEqual(busyMealDates([{ start: '2026-10-25T14:00:00Z', end: '2026-10-25T15:00:00Z' }], { startDate: '2026-10-25', days: 1 }), []);
  assert.deepEqual(busyMealDates([{ start: '2026-10-25T14:59:00Z', end: '2026-10-25T15:01:00Z' }], { startDate: '2026-10-25', days: 1 }), ['2026-10-25']);
});

test('multi-day all-day events use exclusive end and are clipped to the requested dates', () => {
  const events = [
    { allDay: true, start: '2026-11-04', end: '2026-11-07', title: 'Source text must not be returned' },
    { allDay: true, start: '2026-11-07', end: '2026-11-08', title: 'Single-day birthday' },
  ];
  assert.deepEqual(busyMealDates(events, { startDate: '2026-11-05', days: 3 }), ['2026-11-05', '2026-11-06']);
});

test('overnight events count each actual dinner overlap, never occupancy', () => {
  assert.deepEqual(busyMealDates([{ start: '2026-11-04T20:00:00+01:00', end: '2026-11-06T16:00:00+01:00', title: 'Children home' }],
    { startDate: '2026-11-04', days: 4 }), ['2026-11-05']);
});

test('malformed, cancelled and transparent events cannot create spurious busy days', () => {
  const events = [null, {},
    { start: '2026-11-04T16:00:00', end: '2026-11-04T18:00:00' },
    { start: '2026-02-30T16:00:00Z', end: '2026-03-01T18:00:00Z' },
    { start: '2026-11-04T16:00:00Z', end: '2026-11-04T15:00:00Z' },
    { start: '2026-11-04T16:00:00Z', end: '2026-11-04T18:00:00Z', status: 'cancelled' },
    { start: '2026-11-04T16:00:00Z', end: '2026-11-04T18:00:00Z', transparency: 'transparent' },
    { allDay: true, start: '2026-11-04', end: '2026-11-09', transparency: 'transparent' },
  ];
  assert.deepEqual(busyMealDates(events, { startDate: '2026-11-04', days: 5 }), []);
});

test('default date follows Danish midnight and plan interval validation is strict', () => {
  const events = [{ start: '2026-11-04T16:00:00+01:00', end: '2026-11-04T18:00:00+01:00' }];
  assert.deepEqual(busyMealDates(events, { days: 1, now: new Date('2026-11-03T23:30:00Z') }), ['2026-11-04']);
  assert.throws(() => busyMealDates([], { startDate: '2026-02-30' }), /kalenderdato/);
  assert.throws(() => busyMealDates([], { days: 0 }), /1–14/);
  assert.throws(() => busyMealDates([], { days: 15 }), /1–14/);
  assert.throws(() => busyMealDates({}, {}), /kalenderoversigt/);
});

test('unobserved past or future dinner windows are rejected rather than labelled free', () => {
  const calendarWindow = { from: new Date('2026-11-04T10:00:00Z'), until: '2026-11-18T10:00:00Z' };
  assert.deepEqual(busyMealDates([], { startDate: '2026-11-05', days: 7, calendarWindow }), []);
  assert.throws(() => busyMealDates([], { startDate: '2026-11-03', days: 1, calendarWindow }), /dækker ikke/);
  assert.throws(() => busyMealDates([], { startDate: '2026-11-18', days: 1, calendarWindow }), /dækker ikke/);
  assert.throws(() => busyMealDates([], { startDate: '2026-11-04', days: 1,
    calendarWindow: { ...calendarWindow, from: '2026-11-04T15:01:00Z' } }), /dækker ikke/);
  assert.throws(() => busyMealDates([], { startDate: '2026-11-05', days: 1,
    calendarWindow: { from: '2026-11-04T10:00:00', until: '2026-11-18T10:00:00Z' } }), /observationsvindue/);
});
