import { describe, expect, it } from 'vitest';
import {
  WEEK_DAYS,
  buildHighlight,
  dayKeyDiff,
  shiftDayKey,
  weekRemainingKm,
  weekStatus,
  type HighlightChallenge,
  type HighlightWeek,
} from '@/lib/feed/highlight';

const WEEK_START = '2026-09-06'; // a Sunday

function week(over: Partial<HighlightWeek> = {}): HighlightWeek {
  return {
    weekStart: WEEK_START,
    km: 0,
    targetMin: 0,
    targetMax: 0,
    dailyKm: new Array(WEEK_DAYS).fill(0),
    daysElapsed: 1,
    ...over,
  };
}

function challenge(over: Partial<HighlightChallenge> = {}): HighlightChallenge {
  return {
    id: 'c1',
    nameHe: 'ספטמבר 100',
    nameEn: 'September 100',
    icon: '🏆',
    iconUrl: null,
    metric: 'distance_km',
    current: 40,
    target: 100,
    daysLeft: 10,
    done: false,
    onTrack: true,
    ...over,
  };
}

describe('day-key arithmetic', () => {
  it('shifts across a month boundary', () => {
    expect(shiftDayKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDayKey('2026-09-06', 6)).toBe('2026-09-12');
  });

  it('counts whole days in both directions', () => {
    expect(dayKeyDiff('2026-09-06', '2026-09-09')).toBe(3);
    expect(dayKeyDiff('2026-09-09', '2026-09-06')).toBe(-3);
    expect(dayKeyDiff('2026-09-06', '2026-09-06')).toBe(0);
  });

  it('is immune to DST — Israel moves its clocks inside this range', () => {
    // If these were local Dates, the October shift would make one of the two 23h
    // and round to the wrong number of days.
    expect(dayKeyDiff('2026-10-20', '2026-10-27')).toBe(7);
    expect(dayKeyDiff('2026-03-24', '2026-03-31')).toBe(7);
  });
});

describe('weekStatus', () => {
  it('says noTarget when the coach published no plan for the week', () => {
    expect(weekStatus(week({ km: 22 }))).toBe('noTarget');
  });

  it('says met at the low end of the range, not the high end', () => {
    // The range is "30–40 ק״מ"; 30 is the number that was asked for.
    expect(weekStatus(week({ km: 30, targetMin: 30, targetMax: 40, daysElapsed: 5 }))).toBe('met');
  });

  it('measures against the max when the plan gives a single number', () => {
    expect(weekStatus(week({ km: 40, targetMin: 0, targetMax: 40, daysElapsed: 7 }))).toBe('met');
    expect(weekStatus(week({ km: 5, targetMin: 0, targetMax: 40, daysElapsed: 7 }))).toBe('behind');
  });

  it('pro-rates against the days gone by, so nobody is behind on Wednesday for no reason', () => {
    // Wednesday = 4 days in of 7. 40 km week ⇒ 22.8 km is the bar.
    const wed = { targetMin: 40, targetMax: 40, daysElapsed: 4 };
    expect(weekStatus(week({ ...wed, km: 23 }))).toBe('onTrack');
    expect(weekStatus(week({ ...wed, km: 17 }))).toBe('behind');
  });

  it('is generous on the first day of the week — one run of a 40 km week is on track', () => {
    expect(weekStatus(week({ km: 6, targetMin: 40, targetMax: 40, daysElapsed: 1 }))).toBe('onTrack');
  });

  it('only says behind on the last day when the target really was missed', () => {
    const sat = { targetMin: 40, targetMax: 40, daysElapsed: 7 };
    expect(weekStatus(week({ ...sat, km: 39.9 }))).toBe('behind');
    expect(weekStatus(week({ ...sat, km: 41 }))).toBe('met');
  });
});

describe('weekRemainingKm', () => {
  it('counts down to the same bar weekStatus uses', () => {
    expect(weekRemainingKm(week({ km: 18, targetMin: 30, targetMax: 40 }))).toBe(12);
    expect(weekRemainingKm(week({ km: 18, targetMin: 0, targetMax: 40 }))).toBe(22);
  });

  it('never goes negative — a met week owes nothing', () => {
    expect(weekRemainingKm(week({ km: 45, targetMin: 40, targetMax: 40 }))).toBe(0);
  });

  it('is zero with no target rather than a bogus number', () => {
    expect(weekRemainingKm(week({ km: 12 }))).toBe(0);
  });
});

describe('buildHighlight', () => {
  const base = {
    weekStart: WEEK_START,
    weekKm: 0,
    weekTargetMin: 0,
    weekTargetMax: 0,
    weekDailyKm: [] as number[],
    daysElapsed: 3,
    challenge: null as HighlightChallenge | null,
  };

  it('renders nothing when there is nothing true to say', () => {
    // No runs, no target, no challenge — a progress card stuck on zero is worse
    // than no card.
    expect(buildHighlight(base)).toBeNull();
  });

  it('shows up for a target even before the first run of the week', () => {
    const h = buildHighlight({ ...base, weekTargetMin: 30, weekTargetMax: 35, daysElapsed: 1 });
    expect(h).not.toBeNull();
    expect(h!.week.targetMin).toBe(30);
    expect(h!.week.km).toBe(0);
  });

  it('shows up for a challenge alone, in a week with no plan and no runs', () => {
    const h = buildHighlight({ ...base, challenge: challenge() });
    expect(h!.challenge!.id).toBe('c1');
    expect(h!.week.km).toBe(0);
  });

  it('pads the day array to seven and rounds to one decimal', () => {
    const h = buildHighlight({ ...base, weekKm: 18.4567, weekDailyKm: [10.0111, 8.4456] });
    expect(h!.week.dailyKm).toEqual([10, 8.4, 0, 0, 0, 0, 0]);
    expect(h!.week.km).toBe(18.5);
  });

  it('carries the week start through, because the dismiss X keys on it', () => {
    const h = buildHighlight({ ...base, weekKm: 12 });
    expect(h!.week.weekStart).toBe(WEEK_START);
  });

  it('clamps daysElapsed into the week — a bad clock cannot produce day 0 or day 9', () => {
    expect(buildHighlight({ ...base, weekKm: 5, daysElapsed: 0 })!.week.daysElapsed).toBe(1);
    expect(buildHighlight({ ...base, weekKm: 5, daysElapsed: 12 })!.week.daysElapsed).toBe(7);
  });

  it('keeps a completed challenge instead of hiding it', () => {
    // "Did I do it?" is the question this half of the card exists to answer, so a
    // challenge must not vanish the moment it is finished.
    const h = buildHighlight({
      ...base,
      weekKm: 12,
      challenge: challenge({ current: 100, done: true }),
    });
    expect(h!.challenge!.done).toBe(true);
  });
});
