import { describe, expect, it } from 'vitest';
import {
  pickHighlight,
  activeDaysInWindow,
  bestPriorActiveDays,
  shiftDayKey,
  dayKeyDiff,
  ACTIVE_DAYS_WINDOW,
  type HighlightChallenge,
  type HighlightInput,
} from '@/lib/feed/highlight';

const TODAY = '2026-09-05';

/** Day keys for the last `n` days, today first. */
function lastDays(n: number, from = TODAY): string[] {
  return Array.from({ length: n }, (_, i) => shiftDayKey(from, -i));
}

function input(over: Partial<HighlightInput> = {}): HighlightInput {
  return {
    challenge: null,
    activeDayKeys: new Set<string>(),
    todayKey: TODAY,
    weekStreak: 0,
    longestStreak: 0,
    thisWeekKm: 0,
    priorWeeksKm: [],
    totalRuns: 5,
    ...over,
  };
}

const challenge: HighlightChallenge = {
  id: 'c1',
  nameHe: 'ספטמבר 100',
  nameEn: 'September 100',
  icon: '🏆',
  iconUrl: null,
  metric: 'distance_km',
  current: 62.5,
  target: 100,
  daysLeft: 12,
  onTrack: true,
};

describe('day key arithmetic', () => {
  it('shifts across month boundaries without touching the local timezone', () => {
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDayKey(TODAY, 0)).toBe(TODAY);
  });

  it('measures whole days, signed', () => {
    expect(dayKeyDiff('2026-09-01', '2026-09-05')).toBe(4);
    expect(dayKeyDiff('2026-09-05', '2026-09-01')).toBe(-4);
    expect(dayKeyDiff('2026-08-31', '2026-09-01')).toBe(1);
  });
});

describe('activeDaysInWindow', () => {
  it('counts today and reaches back window - 1 days, not window', () => {
    const keys = new Set([TODAY, shiftDayKey(TODAY, -29), shiftDayKey(TODAY, -30)]);
    const { days } = activeDaysInWindow(keys, TODAY, 30);
    expect(days).toBe(2);
  });

  it('puts today in the newest bucket so the chart reads oldest to newest', () => {
    const { spark } = activeDaysInWindow(new Set([TODAY]), TODAY, 30, 6);
    expect(spark).toEqual([0, 0, 0, 0, 0, 1]);

    const oldest = activeDaysInWindow(new Set([shiftDayKey(TODAY, -29)]), TODAY, 30, 6);
    expect(oldest.spark).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('spreads a full window evenly across the buckets', () => {
    const { days, spark } = activeDaysInWindow(new Set(lastDays(30)), TODAY, 30, 6);
    expect(days).toBe(30);
    expect(spark).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('ignores days outside the window entirely', () => {
    const { days, spark } = activeDaysInWindow(new Set([shiftDayKey(TODAY, -45)]), TODAY, 30, 6);
    expect(days).toBe(0);
    expect(spark).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('bestPriorActiveDays', () => {
  it('is 0 with no history, which makes a first month a personal best', () => {
    expect(bestPriorActiveDays(new Set(lastDays(10)), TODAY, 30, 365)).toBe(0);
  });

  it('never counts a window that overlaps today', () => {
    // Twenty consecutive days ending today. Every window containing any of them
    // also contains today, so nothing prior is comparable.
    expect(bestPriorActiveDays(new Set(lastDays(20)), TODAY, 30, 365)).toBe(0);
  });

  it('finds the best genuinely past window', () => {
    // 25 active days, all at least 30 days ago.
    const past = Array.from({ length: 25 }, (_, i) => shiftDayKey(TODAY, -(35 + i)));
    expect(bestPriorActiveDays(new Set(past), TODAY, 30, 365)).toBe(25);
  });
});

describe('pickHighlight', () => {
  it('shows nothing to a member who has never synced a run', () => {
    expect(pickHighlight(input({ totalRuns: 0, thisWeekKm: 40 }))).toBeNull();
  });

  it('shows nothing when there is no volume and no average either', () => {
    expect(pickHighlight(input({ thisWeekKm: 0, priorWeeksKm: [0, 0, 0] }))).toBeNull();
  });

  it('lets an unfinished challenge win over everything else', () => {
    const picked = pickHighlight(input({
      challenge,
      challengeSpark: [10, 30, 62.5],
      activeDayKeys: new Set(lastDays(30)),
      weekStreak: 9,
      thisWeekKm: 60,
      priorWeeksKm: [30, 30, 30],
    }));

    expect(picked).toMatchObject({ kind: 'challenge', value: 62.5 });
    expect(picked!.challenge).toBe(challenge);
    expect(picked!.spark).toEqual([10, 30, 62.5]);
  });

  it('falls past a challenge that is already met', () => {
    const done = { ...challenge, current: 100 };
    const picked = pickHighlight(input({ challenge: done, weekStreak: 4 }));
    expect(picked!.kind).toBe('streak');
  });

  it('shows active days when the count is a personal best', () => {
    // Six days in the last thirty — not a headline on its own, but nothing prior
    // to compare with, so it is this athlete's best.
    const picked = pickHighlight(input({ activeDayKeys: new Set(lastDays(6)) }));
    expect(picked).toMatchObject({
      kind: 'activeDays',
      activeDays: { days: 6, window: ACTIVE_DAYS_WINDOW, isBest: true },
    });
  });

  it('does not show a mediocre active-days count once there is better past form', () => {
    // 6 recent days against a past month of 25 — true, and not worth the top slot.
    const past = Array.from({ length: 25 }, (_, i) => shiftDayKey(TODAY, -(35 + i)));
    const picked = pickHighlight(input({
      activeDayKeys: new Set([...lastDays(6), ...past]),
      thisWeekKm: 20,
      priorWeeksKm: [20, 20, 20],
    }));
    expect(picked!.kind).toBe('volume');
  });

  it('shows a high active-days count even when it is not a best', () => {
    const past = Array.from({ length: 28 }, (_, i) => shiftDayKey(TODAY, -(35 + i)));
    const picked = pickHighlight(input({
      activeDayKeys: new Set([...lastDays(14), ...past]),
      thisWeekKm: 20,
    }));
    expect(picked).toMatchObject({ kind: 'activeDays', activeDays: { days: 14, isBest: false } });
  });

  it('treats one week as no streak at all', () => {
    const oneWeek = pickHighlight(input({ weekStreak: 1, thisWeekKm: 20, priorWeeksKm: [20, 20, 20] }));
    expect(oneWeek!.kind).toBe('volume');

    const twoWeeks = pickHighlight(input({ weekStreak: 2, longestStreak: 7, thisWeekKm: 20 }));
    expect(twoWeeks).toMatchObject({ kind: 'streak', streak: { weeks: 2, longest: 7 } });
  });

  it('caps the streak sparkline so a long streak stays drawable', () => {
    const picked = pickHighlight(input({ weekStreak: 40, longestStreak: 40 }));
    expect(picked!.spark).toHaveLength(12);
    expect(picked!.value).toBe(40);
  });

  it('compares this week against the athlete own trailing average', () => {
    const picked = pickHighlight(input({ thisWeekKm: 48, priorWeeksKm: [30, 40, 50] }));
    expect(picked).toMatchObject({
      kind: 'volume',
      volume: { km: 48, averageKm: 40, deltaPct: 20 },
    });
    // The chart is the prior weeks plus this one, oldest first.
    expect(picked!.spark).toEqual([30, 40, 50, 48]);
  });

  it('keeps empty weeks in the average rather than flattering a comeback', () => {
    const picked = pickHighlight(input({ thisWeekKm: 12, priorWeeksKm: [0, 0, 30] }));
    expect(picked!.volume!.averageKm).toBe(10);
  });

  it('reports no average at all for a first week, instead of a fake 100%', () => {
    const picked = pickHighlight(input({ thisWeekKm: 12, priorWeeksKm: [0, 0, 0] }));
    expect(picked!.volume).toMatchObject({ km: 12, averageKm: 0, deltaPct: 0 });
  });
});
