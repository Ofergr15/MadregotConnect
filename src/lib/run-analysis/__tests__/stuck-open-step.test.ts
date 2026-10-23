import { describe, expect, it } from 'vitest';
import fixture from './stuck-open-step.fixture.json';
import { readWorkout } from '../workout';

describe('readWorkout — the Lap button never pressed on an open walk (10-23)', () => {
  const w = readWorkout(fixture.laps as never, fixture.executed_workout as never, 1)!;
  it('hands the main part back to 14 + 7 + 7 km', () => {
    const m = (step: number) => w.segments.filter((s) => s.step === step).reduce((a, s) => a + s.meters, 0);
    expect(m(14)).toBe(13000); // the 5:37 first km is the walk ending, not the block
    expect(m(15)).toBe(7000);
    expect(m(16)).toBe(7000);
    const b14 = w.segments.find((x) => x.step === 14)!;
    expect(b14.pace).toBeLessThanOrEqual(250);
    expect(w.segments.every((s) => !(s.kind === 'recovery' && s.meters > 2000))).toBe(true);
  });
  it('names it as one run: 14 + 7 + 7, not "2 × 7K"', () => expect(w.title).toBe('14 + 7 + 7 ק״מ'));
});

describe('a continuous 14 + 7 + 7 (10-23)', () => {
  const w = readWorkout(fixture.laps as never, fixture.executed_workout as never, 1)!;
  it('the 14 is work, not easy running', () => {
    expect(w.segments.find((s) => s.step === 14)!.kind).toBe('rep');
    expect(w.reps.map((r) => r.step)).toEqual([14, 15, 16]);
  });
});

describe('targets as written ranges (10-23)', () => {
  const w = readWorkout(fixture.laps as never, fixture.executed_workout as never, 1)!;
  it('a 7 km at 3:50–3:55 keeps its range, and 3:59 is inside ±10', () => {
    const r = w.reps.find((x) => x.step === 15)!;
    expect([r.targetLo, r.targetHi]).toEqual([230, 235]);
    expect(r.onTarget).toBe(true);
    expect(r.kms).toHaveLength(7);
  });
});
