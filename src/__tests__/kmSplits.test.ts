import { describe, expect, it } from 'vitest';
import { kmSplitsFromLaps } from '@/lib/activities/km-splits';
import { fromGarminLaps, readStoredLaps } from '@/lib/plan-execution/laps';

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
    const splits = kmSplitsFromLaps(readStoredLaps(SUNDAY_LAPS));
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
    const garmin = kmSplitsFromLaps(readStoredLaps([{ distance: 1000, duration: 300, averagePace: 300 }]));
    const strava = kmSplitsFromLaps(readStoredLaps([{ distance: 1000, moving_time: 300, average_speed: 3.333 }]));
    expect(garmin[0].averagePace).toBe(300);
    expect(strava[0].averagePace).toBe(300);
  });

  it('splits a lap that straddles a kilometre pro rata', () => {
    // One 2 km lap at 5:00 is two kilometres at 5:00, not one 10-minute one.
    const splits = kmSplitsFromLaps(readStoredLaps([{ distance: 2000, duration: 600, averagePace: 300 }]));
    expect(splits).toEqual([
      { distance: 1000, duration: 300, averagePace: 300, averageHR: null, elevationGain: null, elevationLoss: null },
      { distance: 1000, duration: 300, averagePace: 300, averageHR: null, elevationGain: null, elevationLoss: null },
    ]);
  });

  it('keeps a real trailing stretch as its own split, paced per km', () => {
    const splits = kmSplitsFromLaps(readStoredLaps([{ distance: 1600, duration: 480 }]));
    expect(splits[1]).toMatchObject({ distance: 600, duration: 180, averagePace: 300 });
  });

  it('averages heart rate by distance, and says nothing when nobody measured it', () => {
    const splits = kmSplitsFromLaps(readStoredLaps([
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
    const [split] = kmSplitsFromLaps(readStoredLaps([{ distance: 1000, duration: 300, averagePace: 300 }]));
    expect(split.elevationGain).toBeNull();
    expect(split.elevationLoss).toBeNull();
    // A flat kilometre that WAS measured is 0, and stays 0.
    const [flat] = kmSplitsFromLaps(readStoredLaps([{ distance: 1000, duration: 300, elevationGain: 0 }]));
    expect(flat.elevationGain).toBe(0);
  });

  it('has nothing to say about a run with no laps', () => {
    expect(kmSplitsFromLaps([])).toEqual([]);
    expect(kmSplitsFromLaps(readStoredLaps(null))).toEqual([]);
  });

  it('still returns the one short split of a run shorter than a kilometre', () => {
    expect(kmSplitsFromLaps(readStoredLaps([{ distance: 150, duration: 45 }])))
      .toMatchObject([{ distance: 150, duration: 45, averagePace: 300 }]);
  });
});

describe('readStoredLaps — the extras the splits table draws', () => {
  it('reads heart rate and elevation from either provider’s key names', () => {
    const [garmin] = readStoredLaps([
      { distance: 1000, duration: 300, averageHR: 150, maxHR: 165, elevationGain: 12, elevationLoss: 3 },
    ]);
    expect(garmin).toMatchObject({ averageHR: 150, maxHR: 165, elevationGain: 12, elevationLoss: 3 });
    const [strava] = readStoredLaps([
      { distance: 1000, moving_time: 300, average_heartrate: 150, max_heartrate: 165, total_elevation_gain: 12 },
    ]);
    expect(strava).toMatchObject({ averageHR: 150, maxHR: 165, elevationGain: 12 });
  });

  it('treats a heart rate of 0 as no reading', () => {
    expect(readStoredLaps([{ distance: 1000, duration: 300, averageHR: 0 }])[0].averageHR).toBeNull();
  });
});

describe('fromGarminLaps — the writer, paired with the reader', () => {
  /** One entry of Garmin's `lapDTOs`, trimmed to the keys that matter here. */
  const GARMIN_LAP = {
    distance: 1000.42, duration: 317.364, movingDuration: 315.1,
    averageHR: 141, maxHR: 152, elevationGain: 6.2, elevationLoss: 3.1,
    averageSpeed: 3.15, averageRunCadence: 172,
  };

  it('keeps every field the reader knows how to read', () => {
    // The whole point: what goes in comes back out. The two hand-rolled maps this
    // replaced dropped elevation (both) and HR (one), which is why the run
    // detail's elevation chart was empty for every run in the club.
    const [stored] = fromGarminLaps([GARMIN_LAP]);
    expect(stored).toEqual({
      distance: 1000.42,
      duration: 317.364,
      averagePace: 317,
      averageHR: 141,
      maxHR: 152,
      elevationGain: 6.2,
      elevationLoss: 3.1,
    });
    // And the reader reads back exactly what the writer wrote — no lossy round trip.
    expect(readStoredLaps(fromGarminLaps([GARMIN_LAP]))).toEqual([stored]);
  });

  it('falls back to movingDuration, and drops a lap with no usable duration', () => {
    const { duration: _drop, ...noDuration } = GARMIN_LAP;
    expect(fromGarminLaps([noDuration])[0].duration).toBe(315.1);
    expect(fromGarminLaps([{ distance: 1000 }])).toEqual([]);
    expect(fromGarminLaps([{ distance: 0, duration: 300 }])).toEqual([]);
  });

  it('says nothing rather than zero for a lap Garmin sent no HR for', () => {
    const { averageHR: _hr, maxHR: _max, elevationGain: _gain, ...bare } = GARMIN_LAP;
    expect(fromGarminLaps([bare])).toMatchObject([
      { averageHR: null, maxHR: null, elevationGain: null, elevationLoss: 3.1 },
    ]);
  });

  it('has nothing to write when Garmin returned nothing', () => {
    expect(fromGarminLaps(null)).toEqual([]);
    expect(fromGarminLaps([])).toEqual([]);
  });
});
