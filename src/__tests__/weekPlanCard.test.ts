import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dayStatus, weekRangeParts, DONE_SHARE } from '@/lib/plans/week-status';

/** THE PROFILE'S WEEK, DAY BY DAY (Ofer, 2026-10-17, mockups/weekly-plan). */
describe('a plan day against what was run', () => {
  const day = (km: number, date = '2026-10-14', requiredMin = 16.4) => dayStatus({ date, today: '2026-10-17', requiredMin, km });

  it('is done from 85% of the prescribed minimum, partial below it', () => {
    expect(DONE_SHARE).toBe(0.85);
    expect(day(16.4)).toBe('done');
    expect(day(14)).toBe('done');
    expect(day(4)).toBe('partial');
  });

  it('is missed only once the day is over, and a rest day is never missed', () => {
    expect(day(0)).toBe('missed');
    expect(day(0, '2026-10-17')).toBe('today');
    expect(day(0, '2026-10-18')).toBe('future');
    expect(day(0, '2026-10-14', 0)).toBe('rest');
    expect(day(6, '2026-10-14', 0)).toBe('rest');
  });

  it('names the week in one month or across two', () => {
    expect(weekRangeParts('2026-10-11', 'en')).toEqual({ days: '11–17', month: 'Oct' });
    expect(weekRangeParts('2026-09-27', 'en')).toEqual({ from: '27 Sep', to: '3 Oct' });
  });
});

describe('the plan route', () => {
  const route = readFileSync('src/app/api/plans/week/route.ts', 'utf8');
  it('reads the caller\'s lane, or a teammate\'s — never a teammate\'s own plan', () => {
    expect(route).toMatch(/laneParam === 'mine' \? caller\.athleteId/);
    expect(route).toMatch(/forOther \? \(rowsRaw \|\| \[\]\)\.filter\(\(r\) => !r\.athlete_id\)/);
    expect(route).toMatch(/laneWorkouts\(plan\.parsed_workouts, lane\)/);
  });
});
