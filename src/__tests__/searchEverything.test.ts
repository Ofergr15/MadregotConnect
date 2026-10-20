import { describe, expect, it, vi } from 'vitest';
import { findPlaces, mayOpenPlace, PLACES } from '@/lib/search/places';

// Search, 2026-10-20 (mockup ~/.cache/madregot/search-proposal.html): screens and settings by
// role, runs by what the workout was, this week's plan, my records.

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/auth/pending-athletes', () => ({ pendingAthleteIds: async () => new Set(['waiting']) }));
const { searchRuns, workoutQuery } = await import('@/lib/search/runs');
const { matchSessions, recordBuckets } = await import('@/components/search/SearchExtras');

const runner = { role: 'runner' };
const coach = { role: 'coach' };
const admin = { role: 'admin' };

describe('screens and settings, by role', () => {
  it('a runner who types "תפקיד" finds nothing', () => {
    expect(findPlaces(runner, 'תפקיד')).toEqual([]);
    expect(findPlaces(admin, 'תפקיד').map((p) => p.href)).toContain('/dashboard/roles');
  });
  it('a setting inside a screen, for everybody ("דופק")', () => {
    const hits = findPlaces(runner, 'דופק');
    expect(hits[0]).toMatchObject({ href: '/dashboard/profile?tab=personalInfo', setting: true });
  });
  it('the staff screens are the staff\'s; the admin\'s are the admin\'s', () => {
    expect(findPlaces(coach, 'תחילת שבוע').map((p) => p.href)).toContain('/dashboard/week');
    expect(findPlaces(coach, 'גרעין')).toEqual([]);
    expect(mayOpenPlace({ role: 'runner', canApprove: true }, { who: 'approver' })).toBe(true);
    expect(mayOpenPlace({ role: 'runner', isClubManager: true }, { who: 'numbers' })).toBe(true);
    expect(mayOpenPlace(null, { who: 'staff' })).toBe(false);
  });
  it('every place opens a screen that exists', async () => {
    const fs = await import('fs');
    for (const p of PLACES) {
      const path = p.href.split('?')[0].replace(/^\/dashboard/, 'src/app/(app)/dashboard');
      expect(fs.existsSync(`${path}/page.tsx`), p.href).toBe(true);
    }
  });
});

describe('runs, by the workout', () => {
  it('"10x1600" is read as the stored "10 × 1600"', () => {
    expect(workoutQuery('10x1600')).toBe('10 × 1600');
    expect(workoutQuery('10 * 1600')).toBe('10 × 1600');
    expect(workoutQuery('1600')).toBe('1600');
  });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const rows = [
    ...['a', 'b', 'c', 'd'].map((id, i) => ({ id: `r${i}`, athlete_id: id, start_time: `${today}T05:0${i}:00`, activity_name: 'שלישי', workout_title: '10 × 1600', distance: 21000, average_pace: 260, garmin_activity_id: 100 + i })),
    { id: 'me1', athlete_id: 'me', start_time: `${today}T05:10:00`, activity_name: 'שלישי', workout_title: '10 × 1600', distance: 20000, average_pace: 255, garmin_activity_id: 200 },
    { id: 's1', athlete_id: 'strava', start_time: '2026-09-01T05:00:00', activity_name: 'Intervals 1600*5', workout_title: null, distance: 12000, average_pace: 270, garmin_activity_id: -5 },
    { id: 'p1', athlete_id: 'waiting', start_time: '2026-09-02T05:00:00', activity_name: '1600 repeats', workout_title: null, distance: 9000, average_pace: 280, garmin_activity_id: 7 },
    { id: 'o1', athlete_id: 'a', start_time: '2026-09-03T05:00:00', activity_name: '1600X5', workout_title: null, distance: 15000, average_pace: 275, garmin_activity_id: 8 },
  ];
  const db = {
    from: (t: string) => {
      const chain: Record<string, unknown> = {};
      for (const k of ['select', 'or', 'gte', 'order', 'limit', 'in', 'eq']) chain[k] = () => chain;
      chain.then = (ok: (v: unknown) => unknown) => ok(t === 'athletes'
        ? { data: ['a', 'b', 'c', 'd', 'me', 'strava', 'waiting'].map((id) => ({ id, name: `${id.toUpperCase()} Runner` })), error: null }
        : { data: rows, error: null });
      return chain;
    },
  };

  it('today\'s session folds into one row; mine stays; others\' Strava runs and waiting members do not show', async () => {
    const r = await searchRuns(db as never, '1600', { athleteId: 'me' });
    expect(r.today).toEqual([expect.objectContaining({ title: '10 × 1600', count: 5 })]);
    const ids = r.runs.map((x) => x.id);
    expect(ids[0]).toBe('me1');
    expect(ids).toContain('o1');
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('p1');
    expect(ids).not.toContain('r0');
  });
  it('a Strava run is still its owner\'s to find', async () => {
    const r = await searchRuns(db as never, '1600', { athleteId: 'strava' });
    expect(r.runs.map((x) => x.id)).toContain('s1');
  });
});

describe('the plan and my records', () => {
  it('a record by its distance, all of them by "שיא", and "מרתון" alone is a race', () => {
    expect(recordBuckets('שיא 10K')).toEqual(['10k']);
    expect(recordBuckets('שיא')).toEqual(['5k', '10k', 'hm', 'fm']);
    expect(recordBuckets('מרתון')).toBeNull();
    expect(recordBuckets('אלון')).toBeNull();
  });
  it('a session by its name or a distance in its steps', () => {
    const sessions = [
      { key: '1', dayOfWeek: 2, name: 'שלישי', type: 'intervals', steps: [{ distanceM: 1600 }] },
      { key: '2', dayOfWeek: 5, name: 'ארוכה', type: 'long', steps: [{ distanceM: 30000 }] },
    ] as never;
    expect(matchSessions(sessions, '1600').map((x) => x.key)).toEqual(['1']);
    expect(matchSessions(sessions, 'ארוכה').map((x) => x.key)).toEqual(['2']);
    expect(matchSessions(sessions, 'x')).toEqual([]);
  });
});
