import { describe, expect, it } from 'vitest';
import { buildWeekSummary, weekBest, type SummaryRun } from '@/lib/week-story/summary';
import { fastestWholeKm } from '@/lib/week-story/server';

// Task 158: "best of the week" on the weekly summary — longest run, fastest km, streaks —
// on the ACTIVITY week (Monday–Sunday), the same anchor as the summary's km.
// 2026-11-23 is a Monday, 2026-11-29 the Sunday that closes it.
const W = { weekStart: '2026-11-23', weekEnd: '2026-11-29' };
const run = (day: string, km: number, fastestKmSeconds?: number | null): SummaryRun => ({ day, km, seconds: km * 300, fastestKmSeconds });

describe('weekBest', () => {
  it('longest run and fastest km, this week only', () => {
    const b = weekBest(W, [
      run('2026-11-22', 30, 200),   // the Sunday before: last week, even though it is bigger and faster
      run('2026-11-23', 10, 262),
      run('2026-11-26', 18.44, 281),
      run('2026-11-29', 8, 255),    // the closing Sunday counts
    ]);
    expect(b.longestRun).toEqual({ day: '2026-11-26', km: 18.4 });
    expect(b.fastestKm).toEqual({ day: '2026-11-29', seconds: 255 });
  });

  it('no splits → no fastest km; a GPS-glitch km under 2:00 is ignored', () => {
    expect(weekBest(W, [run('2026-11-24', 10)]).fastestKm).toBeNull();
    expect(weekBest(W, [run('2026-11-24', 10, 95), run('2026-11-25', 5, 290)]).fastestKm).toEqual({ day: '2026-11-25', seconds: 290 });
  });

  it('ties on distance keep the earlier run', () => {
    expect(weekBest(W, [run('2026-11-24', 10), run('2026-11-27', 10)]).longestRun?.day).toBe('2026-11-24');
  });

  it('day streak: the longest run of consecutive days inside the week', () => {
    const b = weekBest(W, [run('2026-11-23', 5), run('2026-11-24', 5), run('2026-11-26', 5), run('2026-11-27', 5), run('2026-11-28', 5)]);
    expect(b.dayStreak).toBe(3);
    // Saturday→Sunday (plan-week boundary) is still one streak; Sunday→Monday of the next week isn't counted.
    expect(weekBest(W, [run('2026-11-28', 5), run('2026-11-29', 5)]).dayStreak).toBe(2);
  });

  it('week streak counts Monday–Sunday weeks back until one with no run', () => {
    const runs = [run('2026-11-23', 5), run('2026-11-16', 5), run('2026-11-15', 5) /* Sunday: week of 11-09 */, run('2026-10-26', 5)];
    // 11-23 ✓, 11-16 ✓, 11-09 ✓ (via its Sunday 11-15), 11-02 ✗ → 3.
    expect(weekBest(W, runs).weekStreak).toBe(3);
  });

  it('week streak caps at the 9 weeks the loader reads', () => {
    const runs = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 23 - 7 * i));
      return run(d.toISOString().slice(0, 10), 5);
    });
    expect(weekBest(W, runs).weekStreak).toBe(9);
  });

  it('rides on the summary', () => {
    const s = buildWeekSummary({ window: W, plan: null, records: [], packRank: null, runs: [run('2026-11-24', 12, 270)] })!;
    expect(s.best).toEqual({ longestRun: { day: '2026-11-24', km: 12 }, fastestKm: { day: '2026-11-24', seconds: 270 }, dayStreak: 1, weekStreak: 1 });
  });
});

describe('fastestWholeKm', () => {
  const lap = (distance: number, duration: number) => ({ distance, duration });
  it('fastest whole km, normalised to 1 km; a short last split is not a km', () => {
    expect(fastestWholeKm([lap(1000, 300), lap(1004, 281), lap(1000, 290), lap(400, 100)], null)).toBe(280);
  });
  it('nothing usable → null', () => {
    expect(fastestWholeKm(null, null)).toBeNull();
    expect(fastestWholeKm([lap(500, 120)], null)).toBeNull();
  });
});
