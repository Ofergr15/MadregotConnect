import { describe, expect, it } from 'vitest';
import { summariseClubWeek } from '@/lib/admin/club-week';

// Admin home tiles (#71 option B). Week of Sun 2026-09-20; "today" is Tue 09-22,
// so last week's comparison stretch is Sun 09-13 to Tue 09-15 — not all of it.
const base = { weekStart: '2026-09-20', today: '2026-09-22', memberIds: ['a', 'b', 'c'] };

describe('summariseClubWeek', () => {
  it('compares this week so far with the same days of last week', () => {
    const w = summariseClubWeek({
      ...base,
      opens: null,
      runs: [
        { athleteId: 'a', day: '2026-09-20', km: 10.4 },
        { athleteId: 'a', day: '2026-09-22', km: 5 },
        { athleteId: 'b', day: '2026-09-21', km: 8 },
        { athleteId: 'a', day: '2026-09-14', km: 12 },
        // Wednesday of last week: outside the comparison stretch.
        { athleteId: 'c', day: '2026-09-16', km: 30 },
      ],
    });
    expect(w.members).toBe(3);
    expect(w.activeMembers).toEqual({ now: 2, prev: 1 });
    expect(w.km).toEqual({ now: 23, prev: 12 });
    expect(w.runs).toEqual({ now: 3, prev: 1 });
    expect(w.appOpeners).toBeNull();
  });

  it('counts members with no run in the last 7 days, today included', () => {
    const w = summariseClubWeek({
      ...base,
      opens: null,
      runs: [
        { athleteId: 'a', day: '2026-09-16', km: 5 }, // exactly 7 days ago, inclusive
        { athleteId: 'b', day: '2026-09-15', km: 5 }, // 8 days ago
      ],
    });
    expect(w.silent7d).toBe(2);
  });

  it('ignores rows of non-members, such as the admin account', () => {
    const w = summariseClubWeek({
      ...base,
      runs: [{ athleteId: 'admin', day: '2026-09-21', km: 99 }],
      opens: [
        { athleteId: 'admin', day: '2026-09-21' },
        { athleteId: 'b', day: '2026-09-21' },
        { athleteId: 'b', day: '2026-09-22' },
        { athleteId: 'c', day: '2026-09-13' },
      ],
    });
    expect(w.km.now).toBe(0);
    expect(w.appOpeners).toEqual({ now: 1, prev: 1 });
  });
});
