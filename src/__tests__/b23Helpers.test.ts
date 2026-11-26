import { describe, expect, it } from 'vitest';
import { dayKmOf, parseWeekOffset } from '@/lib/records/day-km';
import { buildDataCheck } from '@/lib/admin/data-check';
import { fromRow, latePushCopy, lateOfRow, readLateInput } from '@/lib/day-session/model';

const run = (athlete_id: string, start_time: string, km: number) => ({ athlete_id, start_time, distance: km * 1000, duration: 1800, activity_type: 'running' });

describe('records weekly dayKm (b23 club week bars)', () => {
  it('buckets Monday-first by the wall-clock date string, club and caller apart', () => {
    const rows = [
      run('a', '2026-11-23T06:00:00+00:00', 10), // Mon
      run('b', '2026-11-23T21:30:00+00:00', 5), // Mon, late — never pushed to Tuesday
      run('a', '2026-11-29T07:00:00+00:00', 20), // Sun = index 6
      run('b', '2026-11-30T07:00:00+00:00', 99), // next week — ignored
      { athlete_id: 'a', start_time: '2026-11-24T07:00:00+00:00', distance: 3000, duration: 600, activity_type: 'cycling' },
    ];
    const { dayKm, myDayKm } = dayKmOf(rows, '2026-11-23', 'a');
    expect(dayKm).toEqual([15, 0, 0, 0, 0, 0, 20]);
    expect(myDayKm).toEqual([10, 0, 0, 0, 0, 0, 20]);
  });

  it('club bars count only the board (group + opt-out, QA 26.11 #8); the caller keeps their own', () => {
    const rows = [run('a', '2026-11-23T06:00:00Z', 10), run('hidden', '2026-11-23T07:00:00Z', 7), run('g2', '2026-11-24T07:00:00Z', 4)];
    const { dayKm, myDayKm } = dayKmOf(rows, '2026-11-23', 'hidden', new Set(['a']));
    expect(dayKm).toEqual([10, 0, 0, 0, 0, 0, 0]);
    expect(myDayKm).toEqual([7, 0, 0, 0, 0, 0, 0]);
  });

  it('no caller id → zero row for "mine"', () => {
    expect(dayKmOf([run('a', '2026-11-23T06:00:00Z', 4)], '2026-11-23', null).myDayKm).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('weekOffset accepts only -1', () => {
    expect(parseWeekOffset('-1')).toBe(-1);
    for (const v of [null, '0', '-2', '1', 'x']) expect(parseWeekOffset(v)).toBe(0);
  });
});

describe('data check', () => {
  const p = (o: Partial<{ connected: boolean; lastSyncAt: string | null; authFailedAt: string | null }> = {}) =>
    ({ connected: true, lastSyncAt: '2026-11-24T08:00:00Z', authFailedAt: null, ...o });
  const now = new Date('2026-11-24T10:00:00Z');

  it('14 days ending today, synced where a run exists, missing elsewhere', () => {
    const r = buildDataCheck({ today: '2026-11-24', activityDates: ['2026-11-24', '2026-11-20'], garmin: p(), strava: p({ connected: false }), now });
    expect(r.days14).toHaveLength(14);
    expect(r.days14[0].date).toBe('2026-11-11');
    expect(r.days14[13]).toEqual({ date: '2026-11-24', state: 'synced' });
    expect(r.days14.find((d) => d.date === '2026-11-21')!.state).toBe('missing');
    expect(r.headline).toBe('ok');
  });

  it('no provider → noWatch days and noProvider headline', () => {
    const r = buildDataCheck({ today: '2026-11-24', activityDates: [], garmin: p({ connected: false }), strava: p({ connected: false }), now });
    expect(r.days14.every((d) => d.state === 'noWatch')).toBe(true);
    expect(r.headline).toBe('noProvider');
  });

  it('auth rejected after the last good sync wins the headline', () => {
    const r = buildDataCheck({ today: '2026-11-24', activityDates: ['2026-11-24'], garmin: p({ authFailedAt: '2026-11-24T09:00:00Z' }), strava: p({ connected: false }), now });
    expect(r.headline).toBe('authFailed');
    expect(r.checks.find((c) => c.key === 'garminAuth')!.ok).toBe(false);
  });

  it('stale sync and quiet week', () => {
    expect(buildDataCheck({ today: '2026-11-24', activityDates: ['2026-11-24'], garmin: p({ lastSyncAt: '2026-11-20T00:00:00Z' }), strava: p({ connected: false }), now }).headline).toBe('staleSync');
    expect(buildDataCheck({ today: '2026-11-24', activityDates: ['2026-11-12'], garmin: p(), strava: p({ connected: false }), now }).headline).toBe('noRecentRuns');
  });
});

describe('late notice model', () => {
  it('validates minutes 5–30 and trims the note', () => {
    expect(readLateInput({ date: '2026-11-24', minutes: 10, note: '  traffic ' })).toEqual({ date: '2026-11-24', minutes: 10, note: 'traffic' });
    expect(readLateInput({ date: '2026-11-24', minutes: 5 })).toEqual({ date: '2026-11-24', minutes: 5, note: null });
    for (const minutes of [4, 31, 7.5, '10', null]) expect(typeof readLateInput({ date: '2026-11-24', minutes })).toBe('string');
    expect(typeof readLateInput({ date: '24/11', minutes: 10 })).toBe('string');
    expect(typeof readLateInput(null)).toBe('string');
  });

  it('reads late off the row; absent columns = null', () => {
    expect(lateOfRow({})).toBeNull();
    expect(lateOfRow({ late_minutes: 15, late_note: '', late_at: '2026-11-24T05:00:00Z' })).toEqual({ minutes: 15, note: null, at: '2026-11-24T05:00:00Z' });
    expect(fromRow({ id: 'x', session_date: '2026-11-24', late_minutes: 20, late_note: 'n', late_at: 't' }).late).toEqual({ minutes: 20, note: 'n', at: 't' });
  });

  it('push copy carries the minutes', () => {
    expect(latePushCopy({ minutes: 10, note: null }, { startTime: '06:00' }, 'he').title).toContain('10');
    expect(latePushCopy({ minutes: 10, note: 'x' }, { startTime: null }, 'en').body).toBe('x');
  });
});
