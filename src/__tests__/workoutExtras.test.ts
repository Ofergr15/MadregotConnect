import { describe, expect, it } from 'vitest';
import type { WorkoutStep } from '@/lib/ai/types';
import { plannedLoad, plannedParts } from '@/lib/academy/load';
import { feelPrefillOf, personalRecord, watchSteps, workoutDone } from '@/lib/academy/workout-extras';
import type { WorkoutAdherenceRow } from '@/lib/academy/report';
import type { WorkoutSheet } from '@/lib/academy/workout-sheet';

/**
 * Screens 4, 5 and 6's additions (trainee-experience-v2): the watch range on work steps
 * only, the planned ⚡'s parts summing to the ⚡, the plan/done/diff table, the reps
 * against the watch range, a medal only for a real record, and the watch's own feel.
 */

const pace = (sec: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const SCREEN4: WorkoutStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, ...pace(340) },
  {
    order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(245) },
      { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
    ],
  },
  { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, ...pace(340) },
];

describe('watchSteps', () => {
  it('prints a range on the reps only: 4:05 → 4:01–4:09', () => {
    const steps = watchSteps(SCREEN4, 252);
    expect(steps.map(s => s.work)).toEqual([false, true, false]);
    expect(steps[1].watchRange).toEqual({ min: 241, max: 249 });
    expect(steps[0].watchRange).toBeNull();
    expect(steps[2].watchRange).toBeNull();
  });

  it('a stored range wins (that is what Garmin got)', () => {
    const steps = watchSteps([{ order: 1, type: 'active', durationType: 'distance', durationValue: 6000, targetType: 'pace', targetZone: 'tempo', targetPaceMinPerKm: 265, targetPaceMaxPerKm: 275 }], 252);
    expect(steps[0]).toMatchObject({ work: true, watchRange: { min: 265, max: 275 } });
  });

  it('an easy run without a zone is not work', () => {
    expect(watchSteps([{ order: 1, type: 'active', durationType: 'distance', durationValue: 8000, ...pace(340) }], 252)[0].work).toBe(false);
  });
});

describe('plannedParts', () => {
  it('splits screen 4\'s expected ⚡ into warmup, reps, jog, cooldown that add up to it', () => {
    const parts = plannedParts(SCREEN4, 252);
    expect(parts.map(p => p.labelKey.split('.').pop())).toEqual(['warmup', 'work', 'jog', 'cooldown']);
    expect(parts.reduce((s, p) => s + p.load, 0)).toBe(Math.round(plannedLoad(SCREEN4, 252)));
    expect(parts[1].params).toMatchObject({ count: 5, distM: 1000, paceSec: 245 });
    expect(parts[2].params).toMatchObject({ count: 5, sec: 120 });
  });

  it('nothing without a threshold', () => {
    expect(plannedParts(SCREEN4, 0)).toEqual([]);
  });
});

function rowAndSheet(repPaces: number[]): { row: WorkoutAdherenceRow; sheet: WorkoutSheet } {
  const row = {
    date: '2026-10-13', name: '5 × 1 ק״מ', completed: true,
    planned: {} as never,
    actual: { id: 'act', date: '2026-10-13', distance: 10400, duration: 3022, averageHr: 152 },
    distance: { status: 'on', plannedMin: 10300, plannedMax: 10300, actual: 10400, pct: 101 },
    duration: { status: 'on', planned: 3065, actual: 3022, pct: 99, estimated: false },
    pace: { status: 'on', plannedMin: 245, plannedMax: 245, comparedMin: null, comparedMax: null, actual: 291 },
    score: 1,
  } as unknown as WorkoutAdherenceRow;
  const sheet = {
    distance: { actualM: 10400, plannedMinM: 10300, plannedMaxM: 10300, verdict: { kind: 'on', delta: 0 } },
    pace: { label: 'קצב החזרות', actual: 241, targetMin: 245, targetMax: 245, verdict: { kind: 'on', deltaSec: 0 } },
    time: { actualSec: 3022, plannedSec: 3065, estimated: false, verdict: { kind: 'on', delta: 0 } },
    chart: { mode: 'reps', bandMin: 240, bandMax: 250, target: 245, points: repPaces.map((p, i) => ({ label: String(i + 1), pace: p, kind: 'on' })) },
  } as unknown as WorkoutSheet;
  return { row, sheet };
}

describe('workoutDone', () => {
  it('is screen 5: the table, the reps against 4:01–4:09, "as planned, a bit fast"', () => {
    const { row, sheet } = rowAndSheet([244, 243, 242, 241, 236]);
    const done = workoutDone({ row, sheet, steps: watchSteps(SCREEN4, 252), expectedLoad: 62, actualLoad: 64, hr: { cap: 170, actual: 164 } })!;
    expect(done.verdictKey).toBe('onPlanFast');
    expect(done.verdictTone).toBe('good');
    expect(done.table.map(r => r.key)).toEqual(['distance', 'time', 'pace', 'hr', 'load']);
    expect(done.table[0]).toMatchObject({ planned: 10300, done: 10400, diff: 100, tone: 'good' });
    expect(done.table[1]).toMatchObject({ planned: 3065, done: 3022, diff: -43 });
    expect(done.table[2]).toMatchObject({ planned: 245, done: 241, diff: 4, tone: 'good' });
    expect(done.table[3]).toMatchObject({ planned: 170, done: 164, tone: 'good' });
    expect(done.table[4]).toMatchObject({ planned: 62, done: 64, diff: 2, tone: 'muted' });
    expect(done.band).toEqual({ min: 241, max: 249 });
    expect(done.reps.map(r => r.tone)).toEqual(['in', 'in', 'in', 'in', 'fast']);
    expect(done.detail).toMatchObject({ actual: 241, target: 245, reps: true, inRange: 4, of: 5, lastFaster: true });
  });

  it('a run cut short reads short, in the warning tone', () => {
    const { row, sheet } = rowAndSheet([250, 252]);
    (sheet.distance as any).verdict = { kind: 'less', delta: 3000 };
    const done = workoutDone({ row, sheet, steps: [], expectedLoad: null, actualLoad: null, hr: { cap: null, actual: null } })!;
    expect(done.verdictKey).toBe('short');
    expect(done.verdictTone).toBe('warn');
    expect(done.table.find(r => r.key === 'load')).toBeUndefined();
    expect(done.table.find(r => r.key === 'hr')).toBeUndefined();
  });

  it('nothing before the run', () => {
    const { row, sheet } = rowAndSheet([]);
    expect(workoutDone({ row: { ...row, completed: false }, sheet, steps: [], expectedLoad: 62, actualLoad: null, hr: { cap: null, actual: null } })).toBeNull();
  });
});

describe('personalRecord', () => {
  const km = (n: number, paceSec: number) => Array.from({ length: n }, () => ({ distance: 1000, duration: paceSec }));
  const run = (id: string, date: string, paceSec: number) => ({ id, start_time: `${date}T07:00:00`, activity_type: 'running', distance: 10000, duration: 10 * paceSec, laps: km(10, paceSec) });

  it('a 10K faster than every other run in the window, beating an earlier one, is a medal', () => {
    const today = run('t', '2026-10-13', 250);
    const pr = personalRecord(today, [run('a', '2026-05-01', 262), run('b', '2026-08-01', 258)]);
    expect(pr).toMatchObject({ bucket: '5k', value: 1250, previous: 1290, previousDate: '2026-08-01' });
  });

  it('no medal when a later run was faster, or when nothing earlier was beaten', () => {
    expect(personalRecord(run('t', '2026-08-01', 255), [run('later', '2026-09-01', 250), run('a', '2026-05-01', 262)])).toBeNull();
    expect(personalRecord(run('t', '2026-10-13', 250), [])).toBeNull();
    expect(personalRecord(run('t', '2026-10-13', 270), [run('a', '2026-05-01', 262)])).toBeNull();
  });
});

describe('feelPrefillOf', () => {
  it('reads the watch\'s feel 0–4 and effort 1–10, including a raw Garmin value', () => {
    expect(feelPrefillOf({ perceived_feel: 3, perceived_rpe: 7 })).toEqual({ feel: 3, effort: 7 });
    expect(feelPrefillOf({ perceived_feel: 75, perceived_rpe: 70 })).toEqual({ feel: 3, effort: 7 });
    expect(feelPrefillOf({ perceived_feel: null, perceived_rpe: null })).toBeNull();
    expect(feelPrefillOf(null)).toBeNull();
  });
});
