// Task 81: club-numbers weekly figures on the activity week (Mon–Sun, CLAUDE.md) behind
// `club_numbers_activity_week`; default stays Sun–Sat. Synthetic athletes and runs only.
import { describe, it, expect } from 'vitest';
import { addDays, computeClubNumbers, mondayOf, sundayOf, weekdayOffset, type NAthlete, type NRun } from '@/lib/club-numbers/compute';
import { FEATURES } from '@/lib/features/flags';

const athlete = (id: string): NAthlete => ({
  id, name: `R ${id}`, status: 'active', role: 'runner', isAcademy: false, bandNumber: null, academyJoinedOn: null,
  groupName: null, createdAt: '2026-07-01T00:00:00Z', firstSeenAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-10-01T00:00:00Z',
  approved: true, watch: true, birthDate: null, gender: null,
});
const run = (athleteId: string, date: string, km: number): NRun => ({ athleteId, start: `${date}T06:00:00`, meters: km * 1000, seconds: km * 300, type: 'running' });
const base = (runs: NRun[], weekStartsOn?: 'sunday' | 'monday') => computeClubNumbers({
  today: '2026-10-20', athletes: [athlete('a')], runs, candidates: [], tested: new Set(), formed: new Set(), planned: new Set(), weekStartsOn,
});

describe('week anchors', () => {
  it('mondayOf / sundayOf on every weekday', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // Monday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // Sunday belongs to the week that started Monday
    expect(sundayOf('2026-10-25')).toBe('2026-10-25');
    expect(mondayOf('2026-10-20')).toBe('2026-10-19');
  });
  it('weekday → offset', () => {
    expect(weekdayOffset(2, 'sunday')).toBe(2);
    expect(weekdayOffset(2, 'monday')).toBe(1); // Tuesday is day 1 of a Monday week
    expect(weekdayOffset(0, 'monday')).toBe(6); // Sunday is the last day
  });
});

describe('computeClubNumbers weekStartsOn', () => {
  const runs: NRun[] = [];
  for (let d = '2026-09-01'; d <= '2026-10-20'; d = addDays(d, 1)) runs.push(run('a', d, 5));
  runs.push(run('a', '2026-10-18', 20)); // a long Sunday run

  it('default is unchanged (Sunday anchor)', () => {
    const out = base(runs);
    expect(out.thisWeek).toBe('2026-10-18');
    expect(out.weekStartsOn).toBe('sunday');
    expect(out.dayIndex).toBe(2);
  });
  it('Monday anchor: this week starts Monday, the Sunday long run counts in LAST week', () => {
    const sun = base(runs, 'sunday');
    const mon = base(runs, 'monday');
    expect(mon.thisWeek).toBe('2026-10-19');
    expect(mon.dayIndex).toBe(1);
    // Sun-anchor "so far" (Sun–Tue) includes the 25 km Sunday; Mon-anchor (Mon–Tue) does not.
    expect(sun.overview.club.soFar).toBe(35);
    expect(mon.overview.club.soFar).toBe(10);
  });
  it('team days stay the same weekdays: Tue/Fri → offsets 1/4 in a Monday week', () => {
    const mon = base(runs, 'monday');
    expect(mon.insights.teamDays).toEqual([2, 5]);
    expect(mon.insights.teamOffsets).toEqual([1, 4]);
  });
  it('the flag exists and is default-off', () => {
    expect(FEATURES.club_numbers_activity_week.defaultEnabled).toBe(false);
  });
});
