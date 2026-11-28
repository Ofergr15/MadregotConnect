import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { planDayKey } from '@/lib/plans/workout-parsing';

/** Round-4 bug hunt over src/lib (task 115) — one regression test per fix. */

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

afterEach(() => { vi.useRealTimers(); });

describe('checkAndAwardChallenges uses the Israel calendar day', () => {
  it('at 01:30 Israel (22:30 UTC the day before) "today" is the Israel date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T22:30:00Z')); // 2026-10-25 01:30 in Israel
    db = createMemoryDb({ schema: { challenges: ['id', 'badge_id', 'name_he', 'name_en', 'metric', 'target_value', 'scope', 'start_date', 'end_date', 'active'] } });
    const { checkAndAwardChallenges } = await import('@/lib/challenges/engine');
    await checkAndAwardChallenges('athlete-1');
    const q = db.log.find((l) => l.table === 'challenges');
    expect(q?.filters.join(' ')).toContain('2026-10-25');
    expect(q?.filters.join(' ')).not.toContain('2026-10-24');
  });
});

describe('push-week workout dates come from date strings, not local-time setDate', () => {
  // The old expression, kept to show the bug it had in a non-UTC process.
  const old = (weekStart: string, dow: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dow);
    return d.toISOString().split('T')[0];
  };
  it('planDayKey gives Sunday+n for every day of the spring and autumn DST weeks', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => planDayKey('2026-03-22', n)))
      .toEqual(['2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28']);
    expect(planDayKey('2026-10-25', 6)).toBe('2026-10-31');
  });
  it('agrees with the old expression whenever the process runs in UTC or no DST switch is crossed', () => {
    for (const ws of ['2026-01-04', '2026-06-07', '2026-11-29']) {
      for (let n = 0; n < 7; n++) expect(planDayKey(ws, n)).toBe(old(ws, n));
    }
  });
  it('the push path no longer uses local-time setDate', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/lib/garmin/push-week.ts', 'utf8');
    expect(src).not.toMatch(/startDate\.setDate\(startDate\.getDate\(\)/);
    expect(src).toMatch(/planDayKey\(weekStartDate, workout\.dayOfWeek\)/);
  });
});

describe('the Apple watch provider dates a workout exactly like the Garmin push', () => {
  it('workoutDate === planDayKey across the spring DST week', async () => {
    const { workoutDate } = await import('@/lib/watch/providers/apple');
    for (let n = 0; n < 7; n++) expect(workoutDate('2026-03-22', n)).toBe(planDayKey('2026-03-22', n));
    expect(workoutDate('2026-03-22', 6)).toBe('2026-03-28');
  });
});
