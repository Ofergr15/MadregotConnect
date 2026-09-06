import { describe, expect, it } from 'vitest';
import { lapsWorthStoring, narrowLaps, normalizeStoredLaps } from '@/lib/garmin/laps';
import { splitsToLaps, type StravaSplit } from '@/lib/strava/client';
import { traceFromLaps } from '@/lib/academy/execution';

/**
 * `athlete_activities.laps` is schemaless jsonb that three writers have filled over
 * time, and everything downstream — the rep finder, the block grading, the run
 * card — divides by `duration`. So the read path is where the shapes have to be
 * reconciled, and it is worth pinning precisely because nothing fails loudly when it
 * isn't: a lap that comes back with `duration: 0` is indistinguishable from a run
 * with no lap markers at all, and the athlete is simply told their session can't be
 * verified.
 */

const split = (n: number, extra: Partial<StravaSplit> = {}): StravaSplit => ({
  split: n,
  distance: 1000,
  moving_time: 300,
  elapsed_time: 305,
  average_speed: 1000 / 300,
  ...extra,
});

describe('narrowLaps', () => {
  it('narrows Garmin lapDTOs to the shape the readers expect', () => {
    expect(narrowLaps([
      { distance: 1000, duration: 300, averageHR: 148.6, maxHR: 161.2 },
      { distance: 400, movingDuration: 90 },
    ])).toEqual([
      { distance: 1000, duration: 300, averagePace: 300, averageHR: 149, maxHR: 161 },
      { distance: 400, duration: 90, averagePace: 225, averageHR: null, maxHR: null },
    ]);
  });

  /**
   * Elapsed over moving, deliberately. A 15-second stride and the 45-second walk
   * after it are two laps; auto-pause on the walk would make the recovery look
   * shorter than the athlete's watch says it was, and the rep finder matches a timed
   * rep by its duration.
   */
  it('prefers the lap duration over its moving duration', () => {
    expect(narrowLaps([{ distance: 62, duration: 45, movingDuration: 20 }])[0].duration).toBe(45);
    expect(narrowLaps([{ distance: 62, elapsedDuration: 45, movingDuration: 20 }])[0].duration).toBe(45);
  });

  it('drops a lap with no time in it', () => {
    expect(narrowLaps([{ distance: 5, duration: 0 }, { distance: 1000, duration: 300 }]))
      .toHaveLength(1);
    expect(narrowLaps(null)).toEqual([]);
  });

  /**
   * The field that settles planned-vs-executed. When the athlete starts the pushed
   * workout from the watch, every lap carries the index of the step it executed, so
   * "which part of the plan is this?" is a lookup instead of a search over paces and
   * distances. Step 0 is the warm-up — a real index, and the reason this is read with
   * a null check rather than a truthiness test.
   */
  it('keeps the workout step index, zero included', () => {
    const laps = narrowLaps([
      { distance: 2000, duration: 622, wktStepIndex: 0, intensityType: 'WARMUP' },
      { distance: 62, duration: 15, wktStepIndex: 1, intensityType: 'INTERVAL' },
      { distance: 90, duration: 45, wktStepIndex: 2, intensityType: 'REST' },
      { distance: 1000, duration: 300 },
    ]);
    expect(laps.map(l => l.wktStepIndex)).toEqual([0, 1, 2, undefined]);
    expect(laps.map(l => l.intensityType)).toEqual(['WARMUP', 'INTERVAL', 'REST', undefined]);
    // A plain run's laps carry none of this, and it must not cost a byte in jsonb:
    // 26 athletes × 40 laps of `"wktStepIndex": null` buys nothing. `JSON.stringify`
    // on the way to Postgres drops an undefined value, so the key never lands.
    expect(JSON.parse(JSON.stringify(laps[3]))).toEqual({
      distance: 1000, duration: 300, averagePace: 300, averageHR: null, maxHR: null,
    });
  });

  // Garmin reports grade-adjusted SPEED in m/s. Everything downstream is sec/km, and
  // a block run uphill is not a slower block.
  it('converts grade-adjusted speed to a pace', () => {
    const laps = narrowLaps([
      { distance: 1000, duration: 300, avgGradeAdjustedSpeed: 3.7 },
      { distance: 0, duration: 45, avgGradeAdjustedSpeed: 3.7 },
      { distance: 1000, duration: 300 },
    ]);
    expect(laps.map(l => l.gradeAdjustedPace)).toEqual([270, undefined, undefined]);
  });

  it('keeps cadence, elevation, and a moving time that disagrees with the lap', () => {
    expect(narrowLaps([
      { distance: 1000, duration: 300, averageRunCadence: 172.4, elevationGain: 12.6, elevationLoss: 3.2 },
    ])[0]).toMatchObject({ averageCadence: 172, elevationGain: 13, elevationLoss: 3 });
    // Auto-pause on a walk break: worth recording that the two differ.
    expect(narrowLaps([{ distance: 62, duration: 45, movingDuration: 20 }])[0].movingDuration).toBe(20);
    // And not worth a key when they agree, which is the common case.
    expect(narrowLaps([{ distance: 1000, duration: 300, movingDuration: 300 }])[0].movingDuration)
      .toBeUndefined();
  });
});

describe('normalizeStoredLaps', () => {
  it('reads back the narrow shape it was written in', () => {
    const laps = narrowLaps([{ distance: 1000, duration: 300 }, { distance: 400, duration: 90 }]);
    expect(normalizeStoredLaps(laps)).toEqual(laps);
  });

  /**
   * The bug this exists for. Strava's stored laps carry `moving_time`, not
   * `duration`, so a reader that knew only Garmin's key gave every Strava athlete a
   * full set of zero-duration laps — a run that looked, to the grading engine, like
   * one with no markers at all. Piped through the real writer so the two cannot drift.
   */
  it('reads Strava splits, which carry moving_time and no duration at all', () => {
    const stored = splitsToLaps([split(1), split(2), split(3, { distance: 421, moving_time: 130 })]);
    expect((stored[0] as unknown as Record<string, unknown>).duration).toBeUndefined();

    const laps = normalizeStoredLaps(stored);
    expect(laps.map(l => [l.distance, l.duration])).toEqual([
      [1000, 300], [1000, 300], [421, 130],
    ]);
    // And the trace the block grading needs is buildable from them.
    expect(traceFromLaps(laps)!.d).toEqual([0, 1000, 2000, 2421]);
  });

  it('reads a raw-DTO passthrough, which carries movingDuration', () => {
    expect(normalizeStoredLaps([{ distance: 1000, movingDuration: 300 }])[0])
      .toMatchObject({ duration: 300, averagePace: 300 });
  });

  it('keeps a stored pace rather than recomputing one', () => {
    // A lap whose stored pace came off the watch's own average speed, which is not
    // exactly distance/duration. Recomputing it would move numbers already on screen.
    expect(normalizeStoredLaps([{ distance: 1000, duration: 300, averagePace: 298 }])[0].averagePace)
      .toBe(298);
  });

  it('carries heart rate through under either name', () => {
    expect(normalizeStoredLaps([
      { distance: 1000, duration: 300, averageHR: 150, maxHR: 165 },
      { distance: 1000, duration: 300, average_heartrate: 152, max_heartrate: 167 },
    ]).map(l => [l.averageHR, l.maxHR])).toEqual([[150, 165], [152, 167]]);
  });

  it('reads the workout step index back, zero included', () => {
    const laps = normalizeStoredLaps([
      { distance: 2000, duration: 622, wktStepIndex: 0, intensityType: 'WARMUP' },
      { distance: 62, duration: 15, wktStepIndex: 1 },
      { distance: 1000, duration: 300 },
    ]);
    expect(laps.map(l => l.wktStepIndex)).toEqual([0, 1, undefined]);
    expect(laps[0].intensityType).toBe('WARMUP');
  });

  it('reads a grade-adjusted pace whether it was stored narrowed or raw', () => {
    expect(normalizeStoredLaps([
      { distance: 1000, duration: 300, gradeAdjustedPace: 270 },   // already narrowed
      { distance: 1000, duration: 300, avgGradeAdjustedSpeed: 3.7 }, // raw DTO passthrough
    ]).map(l => l.gradeAdjustedPace)).toEqual([270, 270]);
  });

  it('numbers Strava splits and reads their climb', () => {
    expect(normalizeStoredLaps([
      { split: 3, distance: 1000, moving_time: 300, total_elevation_gain: 8.4 },
      { lap_index: 4, distance: 1000, moving_time: 300 },
    ]).map(l => [l.lapIndex, l.elevationGain])).toEqual([[3, 8], [4, undefined]]);
  });

  /**
   * Strava reports a run's `average_cadence` as one leg per minute where Garmin
   * reports both, so the same athlete would come back at 86 or 172 depending on which
   * watch synced the run. A number whose unit depends on the provider is worse than no
   * number, so it is deliberately not mapped.
   */
  it('does not mix Strava cadence in with Garmin cadence', () => {
    expect(normalizeStoredLaps([{ distance: 1000, moving_time: 300, average_cadence: 86 }])[0]
      .averageCadence).toBeUndefined();
    expect(normalizeStoredLaps([{ distance: 1000, duration: 300, averageRunCadence: 172 }])[0]
      .averageCadence).toBe(172);
  });

  // A Strava split's moving time is only news when it differs from the elapsed time.
  it('records a Strava split that was paused', () => {
    expect(normalizeStoredLaps([
      { distance: 1000, moving_time: 280, elapsed_time: 300 },
      { distance: 1000, moving_time: 300, elapsed_time: 300 },
    ]).map(l => [l.duration, l.movingDuration])).toEqual([[280, 280], [300, undefined]]);
  });

  it('drops what it cannot use instead of returning an infinite pace', () => {
    expect(normalizeStoredLaps([{ distance: 100 }, { distance: 100, duration: 0 }, null, 'x']))
      .toEqual([]);
    expect(normalizeStoredLaps(null)).toEqual([]);
    expect(normalizeStoredLaps({ laps: [] })).toEqual([]);
  });
});

describe('lapsWorthStoring', () => {
  // Garmin returns one lap for a run with no markers. Storing it makes
  // `laps IS NOT NULL` mean "we looked" instead of "we found something".
  it('is false for the single lap that is just the run itself', () => {
    expect(lapsWorthStoring([{ distance: 10000, duration: 2800 }])).toBe(false);
    expect(lapsWorthStoring([])).toBe(false);
    expect(lapsWorthStoring(null)).toBe(false);
    expect(lapsWorthStoring([{ distance: 1000 }, { distance: 1000 }])).toBe(true);
  });
});
