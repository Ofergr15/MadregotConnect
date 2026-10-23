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
  it('never titles it "N × 0"', () => expect(w.title).not.toMatch(/× 0/));
});
