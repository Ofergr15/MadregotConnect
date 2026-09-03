import { describe, expect, it } from 'vitest';
import {
  intensityLayout,
  intensitySteps,
  stepWeightMeters,
} from '@/lib/run-chat/clipboard-layout';
import { expandWorkoutSteps, type PlannedWorkout, type WorkoutSegment } from '@/lib/run-chat/mock-workout';
import { fallbackPromptWorkout } from '@/lib/run-chat/prompt-workout';

const seg = (kind: WorkoutSegment['kind'], extra: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  kind,
  label: kind,
  detail: '',
  ...extra,
});

const WIDTH = 350;
const total = (bars: ReturnType<typeof intensityLayout>, gap = 2) =>
  bars.reduce((sum, bar) => sum + bar.width, 0) + gap * (bars.length - 1);

describe('stepWeightMeters', () => {
  it('uses distance when present', () => {
    expect(stepWeightMeters(seg('interval', { distanceM: 1000 }))).toBe(1000);
  });

  it('converts time via target pace, otherwise a per-kind default', () => {
    expect(stepWeightMeters(seg('interval', { durationSec: 300, targetPaceSec: 300 }))).toBe(1000);
    expect(stepWeightMeters(seg('recovery', { durationSec: 420 }))).toBe(1000);
  });

  it('gives open-ended steps a nominal size', () => {
    expect(stepWeightMeters(seg('warmup', { detail: 'Lap Button Press' }))).toBeGreaterThan(0);
    expect(stepWeightMeters(seg('rest'))).toBeGreaterThan(0);
    expect(stepWeightMeters(seg('interval', { distanceM: Number.NaN }))).toBeGreaterThan(0);
  });
});

describe('intensityLayout', () => {
  it('returns nothing for an empty or header-only workout', () => {
    expect(intensityLayout([], WIDTH)).toEqual([]);
    expect(intensityLayout([seg('repeat', { reps: 5 })], WIDTH)).toEqual([]);
    expect(intensityLayout([seg('easy', { distanceM: 5000 })], 0)).toEqual([]);
  });

  it('draws equal-distance fast and slow kilometres at the same width', () => {
    const bars = intensityLayout(
      [seg('interval', { distanceM: 1000 }), seg('recovery', { distanceM: 1000 })],
      WIDTH,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].width).toBeCloseTo(bars[1].width, 5);
    expect(total(bars)).toBeCloseTo(WIDTH, 5);
  });

  it('keeps widths proportional to distance', () => {
    const bars = intensityLayout(
      [seg('warmup', { distanceM: 2000 }), seg('interval', { distanceM: 1000 })],
      WIDTH,
    );
    expect(bars[0].width / bars[1].width).toBeCloseTo(2, 5);
  });

  it('mixes time and distance steps on one scale', () => {
    const bars = intensityLayout(
      [
        seg('interval', { distanceM: 1000 }),
        seg('recovery', { durationSec: 210 }), // 3.5 min at the 7:00/km default = 500 m
      ],
      WIDTH,
    );
    expect(bars[0].width / bars[1].width).toBeCloseTo(2, 5);
  });

  it('never lets a short rest vanish and still fills the strip exactly', () => {
    const bars = intensityLayout(
      [seg('warmup', { distanceM: 5000 }), seg('rest', { durationSec: 10 }), seg('interval', { distanceM: 5000 })],
      WIDTH,
    );
    expect(bars[1].width).toBeCloseTo(4, 5);
    expect(total(bars)).toBeCloseTo(WIDTH, 5);
    expect(bars.every((bar) => bar.width > 0)).toBe(true);
  });

  it('lays bars out left to right without overlap', () => {
    const bars = intensityLayout(
      [seg('warmup', { distanceM: 2000 }), seg('interval', { distanceM: 400 }), seg('recovery', { distanceM: 200 })],
      WIDTH,
    );
    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].width);
    }
    const last = bars[bars.length - 1];
    expect(last.x + last.width).toBeCloseTo(WIDTH, 5);
  });

  it('expands a 5×(1 km fast / 1 km slow) repeat into ten equal bars', () => {
    const workout: PlannedWorkout = {
      title: 'ריצת אינטרוולים 5×1 ק״מ',
      prompt: '5 ק"מ חימום ואז 5x1 ק"מ מהר / 1 ק"מ לאט',
      segments: [
        seg('warmup', { distanceM: 5000 }),
        seg('repeat', {
          reps: 5,
          steps: [seg('interval', { distanceM: 1000 }), seg('recovery', { distanceM: 1000 })],
        }),
      ],
    };
    const bars = intensityLayout(expandWorkoutSteps(workout), WIDTH);
    expect(bars).toHaveLength(11);
    const repeated = bars.slice(1);
    const widths = new Set(repeated.map((bar) => bar.width.toFixed(3)));
    expect(widths.size).toBe(1);
    expect(bars[0].width / repeated[0].width).toBeCloseTo(5, 3);
  });

  it('survives crowded strips like 30×200 m with 200 m jogs', () => {
    const workout: PlannedWorkout = {
      title: '30×200',
      prompt: '30x200',
      segments: [
        seg('warmup', { distanceM: 2000 }),
        seg('repeat', {
          reps: 30,
          steps: [seg('interval', { distanceM: 200 }), seg('recovery', { distanceM: 200 })],
        }),
        seg('cooldown', { distanceM: 1000 }),
      ],
    };
    const bars = intensityLayout(expandWorkoutSteps(workout), WIDTH);
    expect(bars).toHaveLength(62);
    expect(bars.every((bar) => bar.width > 0)).toBe(true);
    const last = bars[bars.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(WIDTH + 1e-6);
  });

  it('handles a single steady run as one full-width bar', () => {
    const bars = intensityLayout([seg('easy', { distanceM: 10000 })], WIDTH);
    expect(bars).toHaveLength(1);
    expect(bars[0].width).toBeCloseTo(WIDTH, 5);
  });

  it('works for the deterministic prompt fallback plan', () => {
    const workout = fallbackPromptWorkout('2 ק"מ חימום + 5x1000 עם דקה הליכה');
    const bars = intensityLayout(expandWorkoutSteps(workout), WIDTH);
    expect(bars.length).toBe(11);
    expect(total(bars)).toBeCloseTo(WIDTH, 5);
  });

  it('filters only the repeat header', () => {
    const steps = [seg('repeat'), seg('interval', { distanceM: 400 }), seg('rest')];
    expect(intensitySteps(steps)).toHaveLength(2);
  });
});
