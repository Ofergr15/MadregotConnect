import { describe, expect, it } from 'vitest';
import { eventSchedule, offsetMinutes, resolveZone, wallClockIn, wallToUtc, withSchedule } from '@/lib/events/schedule';

// Task 149: event times in the venue's zone and in Israel, across the DST edges.
const TLV = { lat: 32.0055, lng: 34.8854 }; // Ben Gurion
const VLC = { lat: 39.4699, lng: -0.3763 };

describe('resolveZone', () => {
  it('Israel venue → Asia/Jerusalem, Valencia → Europe/Madrid (venue)', () => {
    expect(resolveZone(TLV)).toEqual({ tz: 'Asia/Jerusalem', source: 'venue' });
    expect(resolveZone(VLC)).toEqual({ tz: 'Europe/Madrid', source: 'venue' });
  });
  it('no coordinates / elsewhere → home zone, marked default', () => {
    expect(resolveZone({})).toEqual({ tz: 'Asia/Jerusalem', source: 'default' });
    expect(resolveZone({ lat: 52.52, lng: 13.4 })).toEqual({ tz: 'Asia/Jerusalem', source: 'default' });
    expect(resolveZone({ lat: 28.1, lng: -15.4 }).tz).toBe('Asia/Jerusalem'); // Canaries are not Madrid time
  });
  it('an explicit valid time_zone wins; a bogus one is ignored', () => {
    expect(resolveZone({ ...TLV, time_zone: 'Europe/Madrid' })).toEqual({ tz: 'Europe/Madrid', source: 'event' });
    expect(resolveZone({ ...VLC, time_zone: 'Fake/Zone' })).toEqual({ tz: 'Europe/Madrid', source: 'venue' });
  });
});

describe('Valencia week', () => {
  it('the 08:15 start is 07:15Z, 08:15 in Spain and 09:15 in Israel, on Sunday', () => {
    expect(eventSchedule({ date: '2026-12-06', start_time: '08:15:00', ...VLC })).toEqual({
      starts_at: '2026-12-06T07:15:00.000Z', time_zone: 'Europe/Madrid', time_zone_source: 'venue',
      venue: { date: '2026-12-06', time: '08:15', weekday: 0 },
      israel: { date: '2026-12-06', time: '09:15', weekday: 0 },
    });
  });
  it.each([
    ['2026-12-02', 3, '05:40', '2026-12-02T03:40:00.000Z'],
    ['2026-12-03', 4, '23:55', '2026-12-03T21:55:00.000Z'],
    ['2026-12-04', 5, '06:10', '2026-12-04T04:10:00.000Z'],
  ])('departure %s (weekday %i) at %s Israel', (date, weekday, time, iso) => {
    const s = eventSchedule({ date, start_time: time, ...TLV })!;
    expect(s.starts_at).toBe(iso);
    expect(s.israel).toEqual({ date, time, weekday });
    expect(s.venue).toEqual(s.israel);
  });
  it('a late departure in Israel is the previous evening in Spain-time terms only by the hour, never the day', () => {
    const s = eventSchedule({ date: '2026-12-03', start_time: '00:30', ...TLV })!;
    expect(s.starts_at).toBe('2026-12-02T22:30:00.000Z');
    expect(wallClockIn(Date.parse(s.starts_at), 'Europe/Madrid')).toEqual({ date: '2026-12-02', time: '23:30', weekday: 3 });
  });
  it('all-day events and broken times have no schedule', () => {
    expect(eventSchedule({ date: '2026-12-02', start_time: null, ...TLV })).toBeNull();
    expect(eventSchedule({ date: '2026-12-02', start_time: '25:00', ...TLV })).toBeNull();
    expect(eventSchedule({ date: '2026-02-30', start_time: '08:00', ...TLV })).toBeNull();
  });
  it('withSchedule keeps the raw row intact', () => {
    const row = { id: 'e1', date: '2026-12-06', start_time: '08:15', ...VLC };
    expect(withSchedule(row)).toMatchObject({ ...row, schedule: { starts_at: '2026-12-06T07:15:00.000Z' } });
  });
});

describe('DST and zone boundaries', () => {
  it('the spring week when Israel has moved and Spain has not: 2 h apart, not 1', () => {
    // Israel jumps Fri 27.3.2026, Spain Sun 29.3.2026.
    const s = eventSchedule({ date: '2026-03-28', start_time: '08:15', ...VLC })!;
    expect(s.starts_at).toBe('2026-03-28T07:15:00.000Z');
    expect(s.israel.time).toBe('10:15');
    const after = eventSchedule({ date: '2026-03-29', start_time: '08:15', ...VLC })!;
    expect(after.starts_at).toBe('2026-03-29T06:15:00.000Z');
    expect(after.israel.time).toBe('09:15');
  });
  it('summer: Spain +2, Israel +3', () => {
    expect(offsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'Europe/Madrid')).toBe(120);
    expect(offsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'Asia/Jerusalem')).toBe(180);
    expect(eventSchedule({ date: '2026-07-01', start_time: '08:15', ...VLC })!.israel.time).toBe('09:15');
  });
  it('a time in the spring-forward gap moves forward by the gap (Madrid 02:30 → 03:30)', () => {
    expect(new Date(wallToUtc('2026-03-29', '02:30', 'Europe/Madrid')!).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(wallClockIn(wallToUtc('2026-03-29', '02:30', 'Europe/Madrid')!, 'Europe/Madrid').time).toBe('03:30');
  });
  it('a time that happens twice when clocks fall back is the first one (Madrid 02:30 on 25.10)', () => {
    expect(new Date(wallToUtc('2026-10-25', '02:30', 'Europe/Madrid')!).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
  it('Israel fall-back night (25.10.2026): 01:30 happens twice → the first', () => {
    expect(new Date(wallToUtc('2026-10-25', '01:30', 'Asia/Jerusalem')!).toISOString()).toBe('2026-10-24T22:30:00.000Z');
  });
  it('midnight around the date line between the zones', () => {
    expect(new Date(wallToUtc('2026-12-06', '00:00', 'Asia/Jerusalem')!).toISOString()).toBe('2026-12-05T22:00:00.000Z');
    expect(new Date(wallToUtc('2026-12-06', '00:00', 'Europe/Madrid')!).toISOString()).toBe('2026-12-05T23:00:00.000Z');
  });
});
