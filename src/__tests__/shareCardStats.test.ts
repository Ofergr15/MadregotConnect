import { describe, it, expect } from 'vitest';
import { secondaryStats, startLine } from '@/lib/feed/share-image';
import type { FeedActivity } from '@/lib/feed/project';

/**
 * The share card's stats row.
 *
 * The drawing code needs a canvas and can't be asserted on here, but the CONTENT
 * of the row is pure and is the part that has been reported wrong twice: a stat
 * that shouldn't be there, and a clock time shifted by the viewer's timezone.
 */

const I18N = {
  km: 'km', perKm: '/km', pace: 'Avg pace', time: 'Time', hr: 'HR', start: 'Started', onTarget: 'On target', repPace: 'Rep pace',
  // Only the newer views print these, but the type is shared.
  distance: 'Distance', elevation: 'Elevation', calories: 'Calories', metres: 'm', hoursShort: 'h', minutesShort: 'min',
  // Only the bars print these.
  splits: 'Kilometre by kilometre', segments: 'Splits', fastest: 'tallest = fastest',
};

function activity(over: Partial<FeedActivity> = {}): FeedActivity {
  return {
    startTime: '2026-07-12 06:01:40',
    distance: 10000,
    duration: 2700,
    averagePace: 270,
    averageHr: 148,
    ...over,
  } as FeedActivity;
}

describe('secondaryStats', () => {
  it('keeps pace, time and HR in their familiar order', () => {
    expect(secondaryStats(activity(), I18N).map(s => s.label)).toEqual(['Avg pace', 'Time', 'HR']);
  });

  it('leaves the start time off unless asked', () => {
    expect(secondaryStats(activity(), I18N).map(s => s.label)).not.toContain('Started');
  });

  it('never carries the start time any more (#100: it moved under the name)', () => {
    expect(secondaryStats(activity(), I18N)).toHaveLength(3);
  });
});

describe('startLine (#100)', () => {
  it('is day.month · clock, under the run name', () => {
    expect(startLine(activity({ startTime: '2026-10-01 05:38:12' }), true)).toBe('1.10 · 5:38');
  });

  it('is absent unless the athlete turned it on', () => {
    expect(startLine(activity(), false)).toBeNull();
  });

  /**
   * Garmin writes `startTimeLocal` with a space and no offset, Postgres hands back
   * an explicit +00:00 — both must read as the athlete's own clock, or a card
   * rendered in a different zone reports a run they never did at that hour.
   */
  it('reads both timestamp shapes as the athlete local clock', () => {
    for (const startTime of ['2026-07-12 06:01:40', '2026-07-12T06:01:40+00:00', '2026-07-12T06:01:40Z']) {
      expect(startLine(activity({ startTime }), true), startTime).toBe('12.7 · 6:01');
    }
  });

  it('draws nothing for an activity with no start time', () => {
    expect(startLine(activity({ startTime: '' }), true)).toBeNull();
  });
});
