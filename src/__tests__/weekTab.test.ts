import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastWeekKm, plannedMin, ringNumbers, weekDayRows, weekLeft, type WeekPlan } from '@/lib/plans/week-tab';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';
import type { WeekSession } from '@/lib/plans/workout-parsing';

const s = (dayOfWeek: number, type: string, kmMin: number, kmMax: number, optional = false, name = type): WeekSession => ({
  key: `${dayOfWeek}-${name}-${optional}`, dayOfWeek, name, type, kind: optional ? 'evening' : null, partIndex: 0, partCount: 1,
  optional, kmMin, kmMax, kmFrom: 'distance' as never, durationSec: 0, steps: [],
});
// The proposal's week (18–24.10, דבוקה ב׳), Tuesday afternoon.
const plan: WeekPlan = {
  hasPlan: true, hasClubPlan: true, weekTotalMin: 117, weekTotalMax: 140, weekRequiredMin: 117, weekRequiredMax: 124,
  sessions: [
    s(0, 'intervals', 15, 17), s(1, 'easy', 10, 12), s(1, 'easy', 6, 8, true, 'ערב'), s(2, 'intervals', 28, 29),
    s(3, 'easy', 11, 19), s(3, 'easy', 6, 8, true, 'ערב'), s(4, 'easy', 8, 10), s(5, 'long_run', 36, 38), s(6, 'easy', 7, 9, true),
  ],
  dailyDistances: [
    { dayOfWeek: 0, requiredMin: 15, min: 15, type: 'intervals' }, { dayOfWeek: 1, requiredMin: 10, min: 16, type: 'easy' },
    { dayOfWeek: 2, requiredMin: 28, min: 28, type: 'intervals' }, { dayOfWeek: 3, requiredMin: 11, min: 17, type: 'easy' },
    { dayOfWeek: 4, requiredMin: 8, min: 8, type: 'easy' }, { dayOfWeek: 5, requiredMin: 36, min: 36, type: 'long_run' },
    { dayOfWeek: 6, requiredMin: 0, min: 7, type: 'easy' },
  ],
};
const run = (km: number) => ({ id: `r${km}`, km, seconds: km * 310, start: '2026-10-18T05:30:00' });
const pw = (today: number, days: number[]): PlanWeekStats => ({
  weekStart: '2026-10-18', today, km: days.reduce((a, b) => a + b, 0), runs: days.filter(Boolean).length, seconds: 0,
  days: [...days, ...Array(7 - days.length).fill(0)],
  dayRuns: [...days.map((k) => (k ? [run(k)] : [])), ...Array(7 - days.length).fill([])],
  lastWeekSoFar: 52.2, lastDays: [], lastDayRuns: [], weeks: [{ weekStart: '2026-10-11', km: 132.1 }, { weekStart: '2026-10-18', km: 0 }], avgKm: 100,
});

describe('the "השבוע" tab (my-week-proposal, 10-20)', () => {
  it('puts the run under its own day, prescribed sessions first and the optional ones after', () => {
    const rows = weekDayRows(pw(2, [16, 10.1, 23.8]), plan);
    expect(rows.map((r) => r.when)).toEqual(['past', 'past', 'today', 'tomorrow', 'later', 'later', 'later']);
    expect(rows[1].runs.map((r) => r.km)).toEqual([10.1]);
    expect(rows[1].sessions.map((x) => x.optional)).toEqual([false, true]);
    expect(rows[6].prescribed).toBe(false); // Saturday is offered, not prescribed
  });
  it('the ring numbers are the profile card\'s: the plan by tonight is Sun–Tue prescribed', () => {
    const r = ringNumbers(pw(2, [16, 10.1, 23.8]), plan);
    expect(r.shouldBy).toBe(15 + 10 + 28);
    expect(r.target?.min).toBe(117);
    expect(plannedMin(plan, 1)).toBe(10); // the evening option left out
  });
  it('what is left = the ring\'s floor less what was run; days ahead with something prescribed', () => {
    const l = weekLeft(pw(2, [16, 10.1, 23.8]), plan)!;
    expect(l.requiredKm).toBe(67.1); // 117 − 49.9
    expect(l.days).toBe(3); // Wed, Thu, Fri — today already run
    expect(l.next?.session.type).toBe('long_run'); // the key one ahead, not Wednesday's easy
    expect(l.optionalKm).toBe(17); // Wednesday evening 8 + Saturday 9, long ends
  });
  it('today counts as ahead until it has a run', () => {
    expect(weekLeft(pw(2, [16, 10.1, 0]), plan)!.days).toBe(4);
  });
  it('no published week: nothing to be left of', () => {
    expect(weekLeft(pw(2, [5]), { ...plan, hasPlan: false })).toBeNull();
  });
  it('last week is the line\'s point before this one', () => {
    expect(lastWeekKm(pw(2, [1]))).toBe(132.1);
  });
  it('the profile card reads the same ring numbers', () => {
    expect(readFileSync('src/components/profile/MyWeekCard.tsx', 'utf8')).toMatch(/ringNumbers\(pw, plan\)/);
  });
  it('a link that names a week or a view still lands on it', () => {
    const page = readFileSync('src/app/(app)/dashboard/program/page.tsx', 'utf8');
    expect(page).toMatch(/setSelectedStart\(week\); setShowWeek\(false\)/);
    expect(page).toMatch(/view === 'nutrition' \|\| view === 'training' \|\| view === 'workout'/);
  });
});
