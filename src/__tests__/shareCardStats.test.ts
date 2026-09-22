import { describe, it, expect } from 'vitest';
import { secondaryStats } from '@/lib/feed/share-image';
import type { FeedActivity } from '@/lib/feed/project';

/**
 * The share card's stats row.
 *
 * The drawing code needs a canvas and can't be asserted on here, but the CONTENT
 * of the row is pure and is the part that has been reported wrong twice: a stat
 * that shouldn't be there, and a clock time shifted by the viewer's timezone.
 */

const I18N = {
  km: 'km', perKm: '/km', pace: 'Avg pace', time: 'Time', hr: 'HR', start: 'Started',
  // Only the newer views print these, but the type is shared.
  distance: 'Distance', elevation: 'Elevation', calories: 'Calories', metres: 'm', hoursShort: 'h', minutesShort: 'min',
  // Only the bars print these.
  splits: 'Kilometre by kilometre', fastest: 'tallest = fastest',
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

  it('appends the start time last, so the other stats do not move', () => {
    const stats = secondaryStats(activity(), I18N, true);
    expect(stats.map(s => s.label)).toEqual(['Avg pace', 'Time', 'HR', 'Started']);
    expect(stats[3].value).toBe('6:01');
  });

  /**
   * Garmin writes `startTimeLocal` with a space and no offset, Postgres hands back
   * an explicit +00:00 — both must read as the athlete's own clock, or a card
   * rendered in a different zone reports a run they never did at that hour.
   */
  it('reads both timestamp shapes as the athlete local clock', () => {
    for (const startTime of ['2026-07-12 06:01:40', '2026-07-12T06:01:40+00:00', '2026-07-12T06:01:40Z']) {
      const stats = secondaryStats(activity({ startTime }), I18N, true);
      expect(stats[stats.length - 1].value, startTime).toBe('6:01');
    }
  });

  it('still shows the start time on a run with no pace or HR', () => {
    const stats = secondaryStats(activity({ averagePace: null, averageHr: null }), I18N, true);
    expect(stats.map(s => s.label)).toEqual(['Time', 'Started']);
  });

  /** A row with a blank column would read as a rendering bug. */
  it('drops the column when the activity has no start time', () => {
    const stats = secondaryStats(activity({ startTime: '' }), I18N, true);
    expect(stats.map(s => s.label)).toEqual(['Avg pace', 'Time', 'HR']);
  });

  /** Four columns is what makes the row step down a font size — see layoutClassic. */
  it('never returns more than four columns', () => {
    expect(secondaryStats(activity(), I18N, true)).toHaveLength(4);
  });
});
