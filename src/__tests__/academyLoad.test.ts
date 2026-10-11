import { describe, expect, it } from 'vitest';
import type { WorkoutStep } from '@/lib/ai/types';
import {
  activityBreakdown, activityLoad, groupSegments, hrLoad, IF_MAX, intensityOf, isRunType, largestRemainder,
  loadParts, maxHrOf, paceLoad, plannedLoad, segmentsFromActivity, thresholdOn, type LoadActivity,
} from '@/lib/academy/load';

/**
 * The load of a run (⚡), spec §3.1 — the numbers of mockup 5ב and screen 4, the clamps,
 * which test prices a run, and the HR / none / not_run fallbacks.
 */

const T = 252; // 4:12/km, the September test
const TESTS = [{ date: '2026-09-16', thresholdSec: T }];

const lap = (distance: number, duration: number, extra: Record<string, unknown> = {}) => ({ distance, duration, ...extra });

/** Mockup 5ב: 2 km warmup at 5:40, 5 × 1000 (the five reps of screen 5), 4 × 2:00 jog, 2 km cooldown. */
function intervalLaps(withSteps = false) {
  const s = (step: number, intensityType: string) => (withSteps ? { wktStepIndex: step, intensityType } : {});
  return [
    lap(1000, 340, s(1, 'WARMUP')), lap(1000, 340, s(1, 'WARMUP')),
    lap(1000, 244, s(3, 'ACTIVE')), lap(333, 120, s(4, 'RECOVERY')),
    lap(1000, 243, s(3, 'ACTIVE')), lap(333, 120, s(4, 'RECOVERY')),
    lap(1000, 242, s(3, 'ACTIVE')), lap(333, 120, s(4, 'RECOVERY')),
    lap(1000, 241, s(3, 'ACTIVE')), lap(333, 120, s(4, 'RECOVERY')),
    lap(1000, 236, s(3, 'ACTIVE')),
    lap(1000, 330, s(5, 'COOLDOWN')), lap(1000, 330, s(5, 'COOLDOWN')),
  ];
}

const run = (over: Partial<LoadActivity> = {}): LoadActivity => ({
  start_time: '2026-10-13T06:30:00', activity_type: 'running', distance: 10332, duration: 3122, moving_duration: 3100,
  average_hr: 150, max_hr: 172, laps: intervalLaps(), splits: null, ...over,
});

const NO_HR = { rhr: null, maxHr: null };

describe('mockup 5ב at T = 4:12', () => {
  it('is 10 + 37 + 6 + 11 = 64, grouped by pace tone', () => {
    const b = activityBreakdown(run(), { tests: TESTS, ...NO_HR });
    expect(b).toMatchObject({ load: 64, source: 'pace', thresholdSec: 252, basisTestDate: '2026-09-16' });
    expect(b.parts.map(p => [p.labelKey.split('.').pop(), p.load])).toEqual([
      ['warmup', 10], ['work', 37], ['jog', 6], ['cooldown', 11],
    ]);
    expect(b.parts.reduce((a, p) => a + p.load, 0)).toBe(b.load);
  });

  it('gives each line the numbers its label prints', () => {
    const [warm, work, jog] = activityBreakdown(run(), { tests: TESTS, ...NO_HR }).parts;
    expect(warm.params).toMatchObject({ count: 2, km: 2, paceSec: 340 });
    expect(work.params).toMatchObject({ count: 5, distM: 1000, paceSec: 241 });
    expect(jog.params).toMatchObject({ count: 4, sec: 120 });
  });

  it('is the same split by the watch\'s workout steps', () => {
    const b = activityBreakdown(run({ laps: intervalLaps(true) }), { tests: TESTS, ...NO_HR });
    expect(b.parts.map(p => [p.labelKey.split('.').pop(), p.load])).toEqual([
      ['warmup', 10], ['work', 37], ['jog', 6], ['cooldown', 11],
    ]);
  });
});

describe('the planned load of screen 4', () => {
  it('2 km @5:40, 5 × 1000 @4:05 with 2:00 jogs between, 2 km @5:40 is 60 ± 1 (four jogs, mockup 5ב)', () => {
    const steps: WorkoutStep[] = [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 340 },
      {
        order: 2, type: 'interval', durationType: 'open', targetType: 'no_target', repeatCount: 5,
        repeatSteps: [
          { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 245 },
          { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
        ],
      },
      { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 340 },
    ];
    expect(Math.abs(Math.round(plannedLoad(steps, T)) - 60)).toBeLessThanOrEqual(1);
  });

  it('is nothing without a threshold or steps', () => {
    expect(plannedLoad([], T)).toBe(0);
    expect(plannedLoad(null, T)).toBe(0);
  });
});

describe('the clamps and the filters', () => {
  it('a GPS spike at 2:00/km prices at IF 1.4, not 2.1', () => {
    const seg = { sec: 60, paceSec: 120, distM: 500 };
    expect(paceLoad([seg], T)).toBeCloseTo(100 * (60 / 3600) * IF_MAX * IF_MAX, 6);
  });

  it('drops a lap slower than 12:00/km and a lap under 50 m', () => {
    const { segments } = segmentsFromActivity(run({ laps: [lap(1000, 300), lap(1000, 780), lap(30, 10)], splits: null }));
    expect(segments).toHaveLength(1);
    expect(segments[0].paceSec).toBe(300);
  });

  it('prices moving time, not elapsed', () => {
    const { segments } = segmentsFromActivity(run({ laps: [lap(1000, 400, { movingDuration: 300 })] }));
    expect(segments[0]).toMatchObject({ sec: 300, paceSec: 300 });
  });

  it('takes the per-km splits when they are finer than the laps', () => {
    const splits = Array.from({ length: 5 }, () => lap(1000, 330));
    const { segments, kind } = segmentsFromActivity(run({ laps: [lap(5000, 1650)], splits }));
    expect(kind).toBe('pace');
    expect(segments).toHaveLength(5);
  });

  it('falls back to one segment at the moving average, as pace_avg', () => {
    const r = activityLoad(run({ laps: null, splits: null, distance: 10000, moving_duration: 3000 }), { tests: TESTS, ...NO_HR });
    expect(r.source).toBe('pace_avg');
    expect(r.load).toBe(Math.round(100 * (3000 / 3600) * (252 / 300) ** 2));
  });
});

describe('which test prices a run', () => {
  const tests = [{ date: '2026-07-10', thresholdSec: 261 }, { date: '2026-09-16', thresholdSec: 252 }];

  it('is the newest test on or before the run, never a later one', () => {
    expect(thresholdOn('2026-09-15', tests)?.thresholdSec).toBe(261);
    expect(thresholdOn('2026-09-16', tests)?.thresholdSec).toBe(252);
    expect(thresholdOn('2026-07-09', tests)).toBeNull();
  });

  it('a run before any test is priced by heart rate', () => {
    const r = activityLoad(run({ start_time: '2026-07-01T07:00:00' }), { tests, rhr: 50, maxHr: 185 });
    expect(r.source).toBe('hr');
    expect(r.basisTestDate).toBeNull();
  });
});

describe('the fallbacks', () => {
  // Mockup 1ג: Noa, no test yet — an easy 5 km at 6:10, "⚡ 31 · הערכה לפי דופק".
  const easy = run({ laps: null, splits: null, distance: 5000, duration: 1850, moving_duration: 1850, average_hr: 140 });

  it('no test but heart rate → hr, an easy 5 km around 31', () => {
    const r = activityLoad(easy, { tests: [], rhr: 57, maxHr: 185 });
    expect(r.source).toBe('hr');
    expect(Math.abs(r.load! - 31)).toBeLessThanOrEqual(2);
  });

  it('neither → none, with no load (never a 0)', () => {
    expect(activityLoad(easy, { tests: [], ...NO_HR })).toMatchObject({ source: 'none', load: null });
    expect(activityLoad(run({ average_hr: null, laps: null }), { tests: [], rhr: 57, maxHr: 185 }).source).toBe('none');
  });

  it('a bike ride is not_run, whatever data it has', () => {
    expect(activityLoad(run({ activity_type: 'cycling' }), { tests: TESTS, rhr: 50, maxHr: 185 }))
      .toEqual({ load: null, source: 'not_run', thresholdSec: null, basisTestDate: null });
  });

  it('the HR formula: IF = (HR − RHR) / (0.89·max − RHR)', () => {
    const lthr = 0.89 * 190;
    const f = (160 - 50) / (lthr - 50);
    expect(hrLoad([{ sec: 3600, hr: 160 }], { rhr: 50, maxHr: 190 })).toBeCloseTo(100 * f * f, 6);
  });

  it('an HR load breaks down into parts that add up to it', () => {
    const b = activityBreakdown(easy, { tests: [], rhr: 57, maxHr: 185 });
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0].load).toBe(b.load);
  });
});

describe('max HR', () => {
  const acts = [
    { date: '2026-10-01', maxHr: 181, type: 'running' },
    { date: '2026-09-01', maxHr: 186, type: 'running' },
    { date: '2026-08-01', maxHr: 178, type: 'running' },
    { date: '2026-09-10', maxHr: 199, type: 'cycling' },
    { date: '2026-01-01', maxHr: 195, type: 'running' },
  ];

  it('is the highest over 180 days of runs, once 3 runs carry it', () => {
    expect(maxHrOf(acts, '2026-10-10')).toBe(186);
  });

  it('is null with fewer than 3 runs in the window', () => {
    expect(maxHrOf(acts.slice(0, 2), '2026-10-10')).toBeNull();
  });
});

describe('the parts arithmetic', () => {
  it('largest remainder keeps the sum', () => {
    expect(largestRemainder([10.38, 36.56, 6.52, 10.69])).toEqual([10, 37, 6, 11]);
    expect(largestRemainder([0.4, 0.4, 0.4]).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('an easy run with no work is one line', () => {
    const segs = [300, 305, 310].map(p => ({ sec: p, paceSec: p, distM: 1000 }));
    const groups = groupSegments(segs, intensityOf(T));
    expect(groups).toEqual([{ kind: 'run', idx: [0, 1, 2] }]);
    expect(loadParts(segs, T, groups)[0].labelKey).toBe('trainee.loadSheet.part.run');
  });
});

describe('isRunType', () => {
  it('is the PR list, untyped included', () => {
    expect(isRunType('running')).toBe(true);
    expect(isRunType('treadmill_running')).toBe(true);
    expect(isRunType(null)).toBe(true);
    expect(isRunType('cycling')).toBe(false);
    expect(isRunType('strength_training')).toBe(false);
  });
});
