import { describe, expect, it } from 'vitest';
import { planWeekStartOf } from '@/lib/utils';
import { weekStartOf as pmcWeekStartOf } from '@/lib/academy/pmc';
import { weekStartOf as setupWeekStartOf } from '@/lib/week-setup/server';
import { buildPlanWeek, israelWallNow } from '@/lib/athletes/plan-week';

// QA 2026-11-17 #3: one canonical week, Sunday–Saturday in Asia/Jerusalem. Every
// helper that names "this week" has to agree with planWeekStartOf at the edges.
const cases: Array<[string, string, string]> = [
  ['Saturday 23:30 Israel', '2026-11-21T21:30:00Z', '2026-11-15'],
  ['Sunday 00:30 Israel (Saturday in UTC)', '2026-11-14T22:30:00Z', '2026-11-15'],
  ['Sunday 00:30 Israel during DST (IDT, UTC+3)', '2026-09-19T21:30:00Z', '2026-09-20'],
  // Israel leaves DST on Sunday 2026-10-25 02:00 → 01:00.
  ['DST end Sunday 00:30 IDT', '2026-10-24T21:30:00Z', '2026-10-25'],
  ['DST end Saturday 23:59 IDT', '2026-10-24T20:59:00Z', '2026-10-18'],
  // Israel enters DST on Friday 2026-03-27.
  ['DST start Sunday 00:30 IDT', '2026-03-28T21:30:00Z', '2026-03-29'],
];

describe('canonical plan week', () => {
  for (const [name, iso, sunday] of cases) {
    it(name, () => {
      const now = new Date(iso);
      expect(planWeekStartOf(now)).toBe(sunday);
      expect(buildPlanWeek([], israelWallNow(now)).weekStart).toBe(sunday);
    });
  }

  it('bare-date helpers delegate to the same Sunday', () => {
    for (const d of ['2026-11-14', '2026-11-15', '2026-11-21', '2026-10-25', '2026-03-28']) {
      expect(pmcWeekStartOf(d)).toBe(planWeekStartOf(d));
      expect(setupWeekStartOf(d)).toBe(planWeekStartOf(d));
    }
    expect(planWeekStartOf('2026-11-21')).toBe('2026-11-15');
    expect(planWeekStartOf('2026-11-22')).toBe('2026-11-22');
  });
});
