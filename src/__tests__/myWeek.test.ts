import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { buildPlanWeek } from '@/lib/athletes/plan-week';

/** "השבוע שלי" (Ofer, 2026-10-18, mockups/my-week/full.html). */
const run = (start: string, km: number, id = start) => ({ id, start_time: `${start}+00:00`, distance: km * 1000, duration: km * 280, activity_type: 'running' });
// Sunday 18.10, 21:00 Israel (wall clock, Convention A).
const NOW = Date.UTC(2026, 9, 18, 21, 0);

describe('the plan week', () => {
  it('is the Sunday week by day — not the watch\'s Monday week', () => {
    const w = buildPlanWeek([run('2026-10-18T08:45:20', 16), run('2026-10-17T07:00:00', 6)], NOW);
    expect(w.weekStart).toBe('2026-10-18');
    expect(w.today).toBe(0);
    expect(w.days).toEqual([16, 0, 0, 0, 0, 0, 0]);
    expect(w.km).toBe(16);
  });

  it('compares with last week at the same weekday and minute', () => {
    const w = buildPlanWeek([
      run('2026-10-11T07:26:00', 16.5),   // last Sunday morning: counts
      run('2026-10-11T21:30:00', 5),      // last Sunday after 21:00: not yet
      run('2026-10-12T06:00:00', 10),     // last Monday: not yet
    ], NOW);
    expect(w.lastWeekSoFar).toBe(16.5);
  });

  it('keeps ten weeks, this one last, and averages the nine before it', () => {
    const w = buildPlanWeek([run('2026-10-11T07:00:00', 90), run('2026-10-04T07:00:00', 18)], NOW);
    expect(w.weeks).toHaveLength(10);
    expect(w.weeks[9]).toEqual({ weekStart: '2026-10-18', km: 0 });
    expect(w.weeks[8]).toEqual({ weekStart: '2026-10-11', km: 90 });
    expect(w.avgKm).toBe(12);
  });

  it('ignores what has not happened yet', () => {
    expect(buildPlanWeek([run('2026-10-18T22:00:00', 8)], NOW).km).toBe(0);
  });
});

describe('the card', () => {
  const card = readFileSync('src/components/profile/MyWeekCard.tsx', 'utf8');
  it('marks where to be by the end of today, and not a day further', () => {
    expect(card).toMatch(/Array\.from\(\{ length: pw\.today \+ 1 \}, \(_, d\) => plannedMin\(d\)\)/);
    // Days still ahead show no planned number and cannot be opened.
    expect(card).toMatch(/disabled=\{future\}/);
    expect(card).toMatch(/\{future \? '·' :/);
  });
  it('measures against the group\'s range only when a club week is published', () => {
    expect(card).toMatch(/const clubPlan = plan\?\.hasPlan && plan\.hasClubPlan !== false;/);
    expect(card).toMatch(/target\?\.max \|\| Math\.max\(pw\.avgKm/);
  });
  it('is on the stats tab for the owner and for a teammate', () => {
    expect(readFileSync('src/components/profile/AthleteProfileBody.tsx', 'utf8')).toMatch(/\{owner \? weekSlot : athleteId && <MyWeekCard athleteId=\{athleteId\} owner=\{false\} athleteName=\{profile\?\.name\} \/>\}/);
    expect(readFileSync('src/components/profile/ProfileOverview.tsx', 'utf8')).toMatch(/<MyWeekCard athleteId=\{athleteId\} owner /);
  });
});
