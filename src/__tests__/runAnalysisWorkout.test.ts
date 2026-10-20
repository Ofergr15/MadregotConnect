import { describe, expect, it } from 'vitest';
import { bestEffort, heatCostPct, heatCostSec, readWorkout, recoveries, type WLap, type WStep } from '@/lib/run-analysis/workout';

const steps: WStep[] = [
  { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', distanceM: 2000, notes: '5:00' },
  { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', distanceM: 1600, notes: '3:30 (3:40) ((3:50))' },
  { stepIndex: 2, intensity: 'RECOVERY', durationType: 'DISTANCE', distanceM: 400 },
  { stepIndex: 3, iterations: 3, repeatFrom: 1, durationType: 'REPEAT_UNTIL_STEPS_CMPLT' },
];
const lap = (step: number, it: string, distance: number, duration: number, hr = 150): WLap => ({ wktStepIndex: step, intensityType: it, distance, duration, averageHR: hr, maxHR: hr + 5 });
// Auto Lap on: each 1600 arrives as 1000 + 600.
const laps: WLap[] = [
  lap(0, 'WARMUP', 1000, 300, 130), lap(0, 'WARMUP', 1000, 300, 135),
  lap(1, 'ACTIVE', 1000, 220, 165), lap(1, 'ACTIVE', 600, 132, 168), lap(2, 'RECOVERY', 400, 180, 125),
  lap(1, 'ACTIVE', 1000, 221, 166), lap(1, 'ACTIVE', 600, 132, 169), lap(2, 'RECOVERY', 400, 190, 124),
  lap(1, 'ACTIVE', 1000, 228, 166), lap(1, 'ACTIVE', 600, 136, 170), lap(2, 'RECOVERY', 400, 200, 126),
];

describe('readWorkout', () => {
  const w = readWorkout(laps, { steps }, 1)!;
  it('merges the laps of one step, whatever the watch auto-laps', () => {
    expect(w.title).toBe('3 × 1600');
    expect(w.reps.map((r) => r.meters)).toEqual([1600, 1600, 1600]);
    expect(w.recoveryMeters).toBe(400);
  });
  it('scores each rep against the pack\'s own target, ±3 s/km', () => {
    expect(w.reps.map((r) => r.target)).toEqual([220, 220, 220]);
    expect(w.reps.map((r) => r.pace)).toEqual([220, 221, 228]);
    expect(w.hit).toBe(2);
    expect(readWorkout(laps, { steps }, 0)!.reps[0].target).toBe(210);
  });
  it('is null for a run the watch did not run as a workout', () => {
    expect(readWorkout(laps.map(({ wktStepIndex, ...l }) => l), { steps }, 1)).toBeNull();
  });
});

describe('trace pieces', () => {
  const t = Array.from({ length: 601 }, (_, i) => i);
  const d = t.map((s) => (s < 300 ? s * 3 : 900 + (s - 300) * 5)); // slow, then fast
  it('finds the fastest stretch', () => {
    expect(bestEffort({ t, d }, 1000)!.seconds).toBe(200);
  });
  it('reads heart rate from the end of a rep down to the low of its recovery', () => {
    const w = readWorkout(laps, { steps }, 1)!;
    const end = w.reps[0].start + w.reps[0].seconds;
    const tt = Array.from({ length: Math.ceil(end + 200) }, (_, i) => i);
    const hr = tt.map((s) => (s <= end ? 170 : Math.max(118, 170 - (s - end))));
    expect(recoveries({ t: tt, d: tt, hr }, w)[0]).toEqual({ rep: 1, from: 170, to: 118 });
  });
});

describe('heat cost', () => {
  it('follows temperature + dew point', () => {
    expect(heatCostPct(12, 5)).toBe(0);
    expect(heatCostPct(17, 12)).toBeGreaterThan(0);
    expect(heatCostSec(30, 24, 280)).toBeGreaterThan(heatCostSec(22, 16, 280));
  });
});

describe('Auto Lap inside a step that is not a distance (2026-10-20)', () => {
  it('a timed easy run is one step, not "8 × 1000"', () => {
    const easy = [...Array(8)].map(() => lap(0, 'ACTIVE', 1000, 330)).concat(lap(0, 'ACTIVE', 700, 240), lap(1, 'COOLDOWN', 500, 200));
    expect(readWorkout(easy, { steps: [{ stepIndex: 0, intensity: 'ACTIVE', durationSec: 2700 }, { stepIndex: 1, intensity: 'COOLDOWN' }] }, 0)).toBeNull();
  });
  it('an open step cut into kilometres is one run too', () => {
    const open = [...Array(12)].map(() => lap(0, 'ACTIVE', 1000, 320));
    expect(readWorkout(open, { steps: [{ stepIndex: 0, intensity: 'ACTIVE' }] }, 0)).toBeNull();
  });
  it('timed reps still count, each closed by its time', () => {
    const reps = [0, 1, 2].flatMap(() => [lap(3, 'ACTIVE', 1000, 200), lap(3, 'ACTIVE', 400, 80), lap(4, 'RECOVERY', 300, 120)]);
    const w = readWorkout([lap(0, 'WARMUP', 2000, 640), ...reps], { steps: [{ stepIndex: 3, intensity: 'ACTIVE', durationSec: 280 }, { stepIndex: 4, intensity: 'RECOVERY', durationSec: 120 }] }, 0)!;
    expect(w.reps.length).toBe(3);
    expect(w.reps[0].meters).toBe(1400);
  });
});
