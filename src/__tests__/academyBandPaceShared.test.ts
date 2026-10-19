import { describe, expect, it } from 'vitest';
import { ZONE_INTENSITY, type LibraryStep } from '@/lib/academy/library';
import { materialiseWeek, weekGaps, type PlanSlot, type Recipient } from '@/lib/academy/plan-slot';
import { BAND_PACE_NOTE, markBandPriced, resolveThreshold } from '@/lib/academy/day-send';

/**
 * One no-test rule for every academy pricing path (2026-10-19): the test's threshold, else the
 * band's OWN pace — labelled "קצב לפי הדבוקה — עוד אין טסט" — else nothing (an explicit
 * skip). day-plan, copy-week and missed-week are covered by their routes (the chain test);
 * this pins the composer's book slots and the shared pieces.
 */

const REPS: LibraryStep[] = [{
  order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval },
    { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target' },
  ],
}];
const BOOK: PlanSlot = { source: 'book', entry: { id: 'l1', name: 'אינטרוולים', notes: 'מתחילים לאט', steps: REPS } };
const untested: Recipient = { athleteId: 'b', name: 'שחר', offsetSec: null, thresholdPaceSec: null };

describe("the composer's book slots", () => {
  it('no test, band with a pace: priced from the band, labelled, and no pace alarm', () => {
    const out = materialiseWeek({ 2: BOOK }, { ...untested, bandThresholdPaceSec: 270 });
    expect(out.skipped).toEqual([]);
    expect(out.workouts).toHaveLength(1);
    expect(JSON.stringify(out.workouts[0])).toContain(BAND_PACE_NOTE);
    expect(JSON.stringify(out.workouts[0])).toContain('מתחילים לאט');
    expect(out.paceAlerts).toBe(false);
    expect(weekGaps({ 2: BOOK }, { ...untested, bandThresholdPaceSec: 270 }).needsTest).toBe(false);
  });

  it('no test, band without a pace: the same explicit skip as before — nothing guessed', () => {
    const out = materialiseWeek({ 2: BOOK }, { ...untested, bandThresholdPaceSec: null });
    expect(out.workouts).toEqual([]);
    expect(out.skipped).toEqual([{ dayOfWeek: 2, entryId: 'l1', name: 'אינטרוולים', reason: 'no-test' }]);
    expect(weekGaps({ 2: BOOK }, untested).needsTest).toBe(true);
  });

  it('a test always wins over the band, unlabelled', () => {
    const out = materialiseWeek({ 2: BOOK }, { ...untested, thresholdPaceSec: 250, bandThresholdPaceSec: 300 });
    expect(JSON.stringify(out.workouts[0])).not.toContain(BAND_PACE_NOTE);
  });
});

describe('the shared pieces', () => {
  it('resolveThreshold: test, then band, then nothing', () => {
    expect(resolveThreshold(250, 300)).toEqual({ sec: 250, basis: 'test' });
    expect(resolveThreshold(null, 300)).toEqual({ sec: 300, basis: 'band' });
    expect(resolveThreshold(0, null)).toEqual({ sec: null, basis: null });
  });

  it('markBandPriced labels only band-priced sessions that actually got paces', () => {
    const w = { dayOfWeek: 2, name: 'x', description: 'קל', steps: [] };
    expect(markBandPriced([{ workout: w, paced: true }], 'band')[0].description).toBe(`${BAND_PACE_NOTE}\nקל`);
    expect(markBandPriced([{ workout: w, paced: false }], 'band')[0].description).toBe('קל');
    expect(markBandPriced([{ workout: w, paced: true }], 'test')[0].description).toBe('קל');
  });
});
