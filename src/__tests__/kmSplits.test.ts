import { describe, expect, it } from 'vitest';
import { displaySplits, kmSplitsFromLaps } from '@/lib/activities/km-splits';
import { normalizeStoredLaps } from '@/lib/garmin/laps';

/**
 * The run in the bug report: Ben's Sunday, 15,009 m against a 2 km warm-up + 20 km
 * at 4:25 + 8 strides plan. Garmin pressed a lap per workout step, so the column
 * holds 31 laps — twelve kilometres and nineteen strides and walks — and the
 * detail screen labelled all 31 of them kilometres.
 */
const SUNDAY_LAPS = [
  ...[317.364, 299.337, 277.186, 274.93, 274, 273, 273, 276, 276, 274, 275, 275]
    .map((duration, i) => ({
      distance: 1000, duration, averagePace: Math.round(duration),
      averageHR: 130 + i, elevationGain: 4, elevationLoss: 4,
    })),
  // The eight strides with their walk-back rests: 15 s hard, 45 s walking.
  ...Array.from({ length: 8 }, () => [
    { distance: 90, duration: 15, averagePace: 167, averageHR: 160, elevationGain: 0, elevationLoss: 0 },
    { distance: 60, duration: 45, averagePace: 750, averageHR: 140, elevationGain: 0, elevationLoss: 0 },
  ]).flat(),
  { distance: 1809, duration: 570, averagePace: 315, averageHR: 135, elevationGain: 3, elevationLoss: 3 },
];

describe('kmSplitsFromLaps — the kilometre grid the UI says it draws', () => {
  it('leaves a run that auto-lapped every kilometre alone', () => {
    const laps = [
      { distance: 1000, duration: 300, averagePace: 300, averageHR: 140, maxHR: null, elevationGain: 5, elevationLoss: 2 },
      { distance: 1000, duration: 310, averagePace: 310, averageHR: 145, maxHR: null, elevationGain: 1, elevationLoss: 8 },
    ];
    expect(kmSplitsFromLaps(laps)).toEqual([
      { distance: 1000, duration: 300, averagePace: 300, averageHR: 140, elevationGain: 5, elevationLoss: 2 },
      { distance: 1000, duration: 310, averagePace: 310, averageHR: 145, elevationGain: 1, elevationLoss: 8 },
    ]);
  });

  it('turns 31 workout laps into the 15 kilometres they were', () => {
    const splits = kmSplitsFromLaps(normalizeStoredLaps(SUNDAY_LAPS));
    // The headline defect: "0 of 31 kilometres inside the target band" on a 15 km run.
    expect(splits).toHaveLength(15);
    expect(splits.reduce((sum, s) => sum + s.distance, 0)).toBe(15009);
    // The first twelve are the laps themselves, untouched.
    expect(splits[0]).toMatchObject({ distance: 1000, duration: 317, averagePace: 317 });
    expect(splits[11]).toMatchObject({ distance: 1000, duration: 275, averagePace: 275 });
    // Then the strides: a kilometre of 15 s efforts and 45 s walks is a slow
    // kilometre, and saying so is the point — each stride is not a kilometre.
    expect(splits[12].distance).toBe(1000);
    // Slower than every running kilometre before it (4:35), because it is mostly
    // walking — and not one 15-second stride is charted as a kilometre of its own.
    expect(splits[12].averagePace).toBeGreaterThan(350);
    // 9 m of remainder is not a data point; it rides on the last full kilometre.
    expect(splits[14].distance).toBe(1009);
  });

  it('gives every kilometre a pace, from either provider’s lap shape', () => {
    // The regression as it looked on screen: Garmin laps read with Strava's key
    // names shipped 0:00 for every split, of every Garmin run in the club.
    const garmin = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 1000, duration: 300, averagePace: 300 }]));
    const strava = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 1000, moving_time: 300, average_speed: 3.333 }]));
    expect(garmin[0].averagePace).toBe(300);
    expect(strava[0].averagePace).toBe(300);
  });

  it('splits a lap that straddles a kilometre pro rata', () => {
    // One 2 km lap at 5:00 is two kilometres at 5:00, not one 10-minute one.
    const splits = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 2000, duration: 600, averagePace: 300 }]));
    expect(splits).toEqual([
      { distance: 1000, duration: 300, averagePace: 300, averageHR: null, elevationGain: null, elevationLoss: null },
      { distance: 1000, duration: 300, averagePace: 300, averageHR: null, elevationGain: null, elevationLoss: null },
    ]);
  });

  it('keeps a real trailing stretch as its own split, paced per km', () => {
    const splits = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 1600, duration: 480 }]));
    expect(splits[1]).toMatchObject({ distance: 600, duration: 180, averagePace: 300 });
  });

  it('averages heart rate by distance, and says nothing when nobody measured it', () => {
    const splits = kmSplitsFromLaps(normalizeStoredLaps([
      { distance: 800, duration: 240, averageHR: 150 },
      { distance: 200, duration: 60, averageHR: 100 },
      { distance: 1000, duration: 300 },
    ]));
    // 800 m at 150 and 200 m at 100 → 140, not the flat mean of 125.
    expect(splits[0].averageHR).toBe(140);
    // A kilometre nobody wore a strap for is null, never 0 — a chart of zeroes
    // claims a reading of zero.
    expect(splits[1].averageHR).toBeNull();
  });

  it('leaves elevation null when the laps carry none', () => {
    const [split] = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 1000, duration: 300, averagePace: 300 }]));
    expect(split.elevationGain).toBeNull();
    expect(split.elevationLoss).toBeNull();
    // A flat kilometre that WAS measured is 0, and stays 0.
    const [flat] = kmSplitsFromLaps(normalizeStoredLaps([{ distance: 1000, duration: 300, elevationGain: 0 }]));
    expect(flat.elevationGain).toBe(0);
  });

  it('has nothing to say about a run with no laps', () => {
    expect(kmSplitsFromLaps([])).toEqual([]);
    expect(kmSplitsFromLaps(normalizeStoredLaps(null))).toEqual([]);
  });

  it('still returns the one short split of a run shorter than a kilometre', () => {
    expect(kmSplitsFromLaps(normalizeStoredLaps([{ distance: 150, duration: 45 }])))
      .toMatchObject([{ distance: 150, duration: 45, averagePace: 300 }]);
  });
});

/**
 * `displaySplits` is the seam both the server and the client draw through — the
 * detail route for its response, and the detail body for the row it already holds
 * while that request is in flight. They must agree, or the screen re-draws itself
 * differently a moment after it appeared.
 */
describe('displaySplits — which column the kilometres come from', () => {
  it('prefers whichever column is the finer record of the run', () => {
    // Garmin's aggregated summaries in `splits` — two rows for a 15 km run —
    // against the 31 real lap presses. The laps win, and get binned.
    const aggregated = [
      { distance: 12000, duration: 3300, averagePace: 275 },
      { distance: 3009, duration: 960, averagePace: 319 },
    ];
    expect(displaySplits(aggregated, SUNDAY_LAPS)).toHaveLength(15);
    // And the other way round: a run whose `splits` are the real per-km record
    // keeps them, rather than being rebuilt from two long laps.
    const perKm = Array.from({ length: 5 }, () => ({ distance: 1000, duration: 300 }));
    expect(displaySplits(perKm, [{ distance: 5000, duration: 1500 }])).toHaveLength(5);
  });

  it('reads either provider’s shape and says nothing when a row has neither column', () => {
    // Strava's keys, straight off the jsonb — the shape that shipped 0:00 rows.
    expect(displaySplits([{ distance: 1000, moving_time: 300 }], null))
      .toMatchObject([{ distance: 1000, duration: 300, averagePace: 300 }]);
    expect(displaySplits(null, null)).toEqual([]);
    expect(displaySplits(undefined, [])).toEqual([]);
  });
});

// The lap reader and writer themselves are pinned in `storedLaps.test.ts`, next to
// the module they belong to. What is read here is only what these bins are built
// from: the shapes both providers store, through the one normalizer.
