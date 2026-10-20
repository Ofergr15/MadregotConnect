import { describe, expect, it } from 'vitest';
import { groupsOf, isTeamDay } from '@/lib/attendance/together';
import { week, type AttendanceData } from '@/components/attendance/model';

/** Attendance by who ran together (2026-10-20: RSVP said 2–9, the GPS says 11–18). */
const line = (lat: number, n = 40) => Array.from({ length: n }, (_, i) => ({ lat: lat + i * 0.0005, lng: 34.78 }));
const t0 = Date.parse('2026-10-20T05:00:00Z');

describe('who ran together', () => {
  it('same start, same route: one group; a runner elsewhere is not counted', () => {
    const g = groupsOf([
      { athleteId: 'a', startMs: t0, route: line(32.1) },
      { athleteId: 'b', startMs: t0 + 60_000, route: line(32.1) },
      { athleteId: 'c', startMs: t0 + 120_000, route: line(32.1) },
      { athleteId: 'solo', startMs: t0, route: line(32.3) },
    ]);
    expect(g).toEqual([expect.arrayContaining(['a', 'b', 'c'])]);
    expect(g.flat()).not.toContain('solo');
  });
  it('two packs on two routes are two groups; 20 minutes apart is not together', () => {
    const g = groupsOf([
      { athleteId: 'a', startMs: t0, route: line(32.1) }, { athleteId: 'b', startMs: t0, route: line(32.1) },
      { athleteId: 'c', startMs: t0, route: line(32.2) }, { athleteId: 'd', startMs: t0, route: line(32.2) },
      { athleteId: 'late', startMs: t0 + 20 * 60_000, route: line(32.1) },
    ]);
    expect(g).toHaveLength(2);
    expect(g.flat()).not.toContain('late');
  });
  it('team days are Tuesday and Friday', () => {
    expect(['2026-10-20', '2026-10-23'].map(isTeamDay)).toEqual([true, true]);
    expect(isTeamDay('2026-10-21')).toBe(false);
  });
});

describe('the week screen', () => {
  const P = (id: string, pack: number | null, academy = false) => ({ id, name: id, avatarUrl: null, pack, academy, active: true });
  const data: AttendanceData = {
    today: '2026-10-20',
    sizes: { 1: 2, 2: 1, 3: 0, academy: 1 },
    people: { a: P('a', 1), b: P('b', 1), c: P('c', 2), o: P('o', 2, true), gone: P('gone', 1) },
    days: [
      { date: '2026-09-29', held: true, groups: [['gone', 'a']], came: ['gone', 'a'], said: [] },
      { date: '2026-10-02', held: true, groups: [['gone', 'a']], came: ['gone', 'a'], said: [] },
      { date: '2026-10-06', held: true, groups: [['gone', 'b']], came: ['gone', 'b'], said: [] },
      { date: '2026-10-16', held: true, groups: [['a', 'b', 'c']], came: ['a', 'b', 'c'], said: ['a'] },
      { date: '2026-10-20', held: true, groups: [['a', 'o']], came: ['a', 'o'], said: [] },
      { date: '2026-10-23', held: false, groups: [], came: [], said: ['c'] },
    ],
  };
  it('the last 7 days, what is ahead, and who usually comes but did not', () => {
    const w = week(data);
    expect(w.last7.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-16']);
    expect(w.ahead.map((d) => d.date)).toEqual(['2026-10-23']);
    expect(w.average).toBe(2.5);
    expect(w.c7.get('a')).toBe(2);
    expect(w.missing).toEqual([{ id: 'gone', n: 3 }]);
  });
});
