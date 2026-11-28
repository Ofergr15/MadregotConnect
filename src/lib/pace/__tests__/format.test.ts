import { describe, expect, it } from 'vitest';
import { formatPace, NO_PACE, parsePace } from '../format';
import { formatPace as stravaFormatPace } from '@/lib/strava/client';
import { formatPace as runAnalysisFormatPace } from '@/lib/run-chat/run-analysis';
import { fmtPace as verdictFmtPace } from '@/lib/academy/pace-verdict';
import { formatPace as garminFormatPace, metersPerSecondToPace } from '@/lib/garmin/pace';
import { formatPace as activityFormatPace } from '@/components/activity/format';
import { formatPaceSec } from '@/lib/run-chat/workout-from-laps';

// The split-then-round body every replaced copy had (garmin/pace, FeedCard,
// activities page, WorkoutDetailModal, ActivitySyncEditor, run-chat WorkoutCard,
// AcademySettings, plans/verify/compare, run-chat/prompt-workout, workout-from-laps).
const legacySplitFirst = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
// share-image.ts already rounded first.
const legacyRoundFirst = (s: number) => {
  const w = Math.round(s);
  return `${Math.floor(w / 60)}:${String(w % 60).padStart(2, '0')}`;
};

describe('formatPace', () => {
  it.each([
    [0, '0:00'], [5, '0:05'], [59, '0:59'], [60, '1:00'], [61, '1:01'],
    [245, '4:05'], [299.4, '4:59'], [299.5, '5:00'], [59.5, '1:00'],
    [239.6, '4:00'], [119.5, '2:00'], [600, '10:00'], [3599.5, '60:00'], [3725, '62:05'],
  ])('%s → %s', (input, out) => expect(formatPace(input)).toBe(out));

  it.each([NaN, Infinity, -Infinity, -1, -88])('%s is not a pace', (v) =>
    expect(formatPace(v)).toBe(NO_PACE));

  it('is ASCII only (no bidi controls / Hebrew), so it renders identically in RTL', () =>
    expect(formatPace(245.2)).toMatch(/^\d+:\d\d$/));

  // Inputs where rounding does not carry: identical to every replaced copy.
  const same = [0, 1, 30, 59, 60, 61, 180, 200.2, 245, 245.4, 299.4, 330, 359.49, 400.1, 599, 600, 1234.3];
  it.each(same)('matches the legacy split-first copies at %s', (v) =>
    expect(formatPace(v)).toBe(legacySplitFirst(v)));
  it.each([...same, 59.5, 239.6, 299.5, -0])('matches share-image (round-first) at %s', (v) =>
    expect(formatPace(v)).toBe(legacyRoundFirst(v)));

  // The real bug fixed: the split-first copies printed a 60-second field.
  it.each([[59.5, '0:60'], [239.6, '3:60'], [299.7, '4:60']])('legacy %s was %s, now carries', (v, bad) => {
    expect(legacySplitFirst(v)).toBe(bad);
    expect(formatPace(v)).not.toBe(bad);
    expect(formatPace(v).endsWith(':00')).toBe(true);
  });
});

describe('migrated call sites delegate', () => {
  it.each([0, 245, 239.6, 299.5, 360])('garmin/workout-from-laps at %s', (v) => {
    expect(garminFormatPace(v)).toBe(formatPace(v));
    expect(formatPaceSec(v)).toBe(formatPace(v));
  });
  it('garmin metersPerSecondToPace', () => expect(metersPerSecondToPace(1000 / 245)).toBe('4:05'));
  it('activity/format keeps its own 0 → — guard', () => {
    expect(activityFormatPace(0)).toBe('—');
    expect(activityFormatPace(-88)).toBe('—');
    expect(activityFormatPace(NaN)).toBe('—');
    expect(activityFormatPace(239.6)).toBe('4:00');
  });
});

describe('formatters that already rounded first now delegate, same output', () => {
  const roundFirst = (s: number) => { const w = Math.round(s); return `${Math.floor(w / 60)}:${String(w % 60).padStart(2, '0')}`; };
  it.each([1, 59.5, 239.6, 245, 299.5, 360.2, 600])('at %s s/km', (v) => {
    expect(verdictFmtPace(v)).toBe(roundFirst(v));
    expect(runAnalysisFormatPace(v)).toBe(`${roundFirst(v)}/km`);
    expect(stravaFormatPace(1000 / v)).toBe(roundFirst(Math.round(1000 / (1000 / v))));
  });
  it('their own guards still answer first', () => {
    expect(verdictFmtPace(0)).toBe('—');
    expect(verdictFmtPace(null)).toBe('—');
    expect(runAnalysisFormatPace(0)).toBeNull();
    expect(runAnalysisFormatPace(NaN)).toBeNull();
    expect(stravaFormatPace(0)).toBe('—');
  });
});

describe('parsePace (strict m:ss)', () => {
  it.each([['4:05', 245], [' 3:38 ', 218], ['0:59', 59], ['12:00', 720], ['100:00', 6000]])('%s → %s', (t, n) =>
    expect(parsePace(t)).toBe(n));
  it.each(['', '4:5', '4.05', '405', 'abc', '4:05:00', '-4:05', '1000:00'])('%s → null', (t) =>
    expect(parsePace(t)).toBeNull());
  it('round-trips with formatPace on whole seconds', () => {
    for (let s = 0; s < 1200; s += 7) expect(parsePace(formatPace(s))).toBe(s);
  });
});
