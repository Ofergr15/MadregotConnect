import { describe, expect, it } from 'vitest';
import { classifyWorkout, sessionFrame, sessionHeadline } from '@/lib/plans/session-summary';
import { LATIN_UNITS } from '@/lib/plans/step-display';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The shapes here are the real week of 2026-09-06 (group ❶), reduced to the
// parts each assertion is about. Every one of them was rendered wrong before:
// see the comments on `classifyWorkout` and `sessionHeadline`.

const FRAME = { ...LATIN_UNITS, warmup: 'W/U', cooldown: 'C/D' };

const step = (o: Partial<WorkoutStep>): WorkoutStep => ({
  order: 1, type: 'active', durationType: 'time', targetType: 'no_target', ...o,
});

const km = (value: number, o: Partial<WorkoutStep> = {}) =>
  step({ durationType: 'distance', durationValue: value * 1000, ...o });

const workout = (name: string, steps: WorkoutStep[], o: Partial<ParsedWorkout> = {}): ParsedWorkout =>
  ({ dayOfWeek: 0, name, steps, ...o });

/** 8 × (15 s hard / 45 s walk) — the strides Sunday and Saturday end on. */
const strides = (count: number) => step({
  repeatCount: count,
  repeatSteps: [
    step({ type: 'interval', durationValue: 15, notes: 'מתגברת' }),
    step({ type: 'rest', durationValue: 45, notes: 'הליכה' }),
  ],
});

describe('classifyWorkout', () => {
  it('takes the coach\'s word for it', () => {
    expect(classifyWorkout(workout('יום שישי - ITALIAN MEDIO', [km(20)]))).toBe('tempo');
    expect(classifyWorkout(workout('Fartlek 20/40', [km(10)]))).toBe('fartlek');
    expect(classifyWorkout(workout('Pyramid session', [km(10)]))).toBe('intervals');
  });

  it('does not call a long run "intervals" for finishing with strides', () => {
    // Sunday: 20 km at 4:25 plus eight 15-second strides. Eight minutes of a
    // 107-minute run. This is the session that used to be headlined "8x0:15".
    const sunday = workout('יום ראשון', [
      step({ type: 'warmup', durationType: 'distance', durationValue: 2000 }),
      km(20, { targetPaceMinPerKm: 265 }),
      strides(8),
    ]);
    expect(classifyWorkout(sunday)).toBe('long_run');
  });

  it('calls a 21 km rep session "intervals", not a long run', () => {
    // Tuesday morning is over the 20 km long-run line and is still an interval
    // session. Distance is therefore the LAST question asked, not the first.
    const tuesday = workout('יום שלישי - בוקר', [
      step({ type: 'warmup', durationType: 'distance', durationValue: 4000 }),
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 215 })] }),
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 210 })] }),
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 205 })] }),
      step({ repeatCount: 5, repeatSteps: [step({ type: 'interval', durationType: 'distance', durationValue: 300 })] }),
    ]);
    expect(classifyWorkout(tuesday)).toBe('intervals');
  });

  it('falls back to easy with nothing to go on', () => {
    expect(classifyWorkout(workout('יום שני', []))).toBe('easy');
  });
});

describe('sessionHeadline', () => {
  it('names the biggest block, not the first repeat it finds', () => {
    const sunday = [
      step({ type: 'warmup', durationType: 'distance', durationValue: 2000 }),
      km(20, { targetPaceMinPerKm: 265 }),
      strides(8),
    ];
    expect(sessionHeadline(sunday, LATIN_UNITS)).toBe('20 km');
  });

  it('keeps the inner count of a ladder of sets', () => {
    // Three sets of two reps, at 3:35 / 3:30 / 3:25. "3 × 2 km" would be a third
    // of the work; "6 × 2 km" would be a set structure the program doesn't have.
    const main = [
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 215 })] }),
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 210 })] }),
      step({ repeatCount: 2, repeatSteps: [km(2, { type: 'interval', targetPaceMinPerKm: 205 })] }),
    ];
    expect(sessionHeadline(main, LATIN_UNITS)).toBe('3 × (2 × 2 km)');
  });

  it('names a plain repeat block by its working leg', () => {
    const evening = [step({
      repeatCount: 20,
      repeatSteps: [
        step({ type: 'interval', durationType: 'distance', durationValue: 500, targetPaceMinPerKm: 205 }),
        step({ type: 'recovery', durationValue: 60, notes: 'ג׳וג' }),
      ],
    })];
    expect(sessionHeadline(evening, LATIN_UNITS)).toBe('20 × 500 m');
  });

  it('uses the note when the whole prescription is prose', () => {
    // Monday evening has no metric of any kind — it used to render as one word.
    const prose = [step({ durationType: 'open', notes: 'אופציה ל30-40 דק׳ קל בערב / כוח' })];
    expect(sessionHeadline(prose, LATIN_UNITS)).toBe('אופציה ל30-40 דק׳ קל בערב / כוח');
  });

  it('is empty with no steps, so the caller can fall back to the name', () => {
    expect(sessionHeadline([], LATIN_UNITS)).toBe('');
  });
});

describe('sessionFrame', () => {
  it('names the warm-up and the jog home by distance', () => {
    const friday = [
      step({ type: 'warmup', durationType: 'distance', durationValue: 2000 }),
      km(20, { targetPaceMinPerKm: 240 }),
      step({ type: 'cooldown', durationType: 'distance', durationValue: 2000 }),
    ];
    expect(sessionFrame(friday, FRAME)).toBe('W/U 2 km · C/D 2 km');
  });

  it('names the other sets and stops at two', () => {
    const tuesday = [
      step({ type: 'warmup', durationType: 'distance', durationValue: 4000 }),
      km(6, { type: 'interval', targetPaceMinPerKm: 215 }),
      step({ repeatCount: 5, repeatSteps: [step({ type: 'interval', durationType: 'distance', durationValue: 300 })] }),
      strides(4),
      step({ repeatCount: 3, repeatSteps: [step({ type: 'interval', durationValue: 20 })] }),
    ];
    const frame = sessionFrame(tuesday, FRAME);
    expect(frame).toBe('5 × 300 m · 4 × 15 s · W/U 4 km');
  });

  it('leaves out a jog that is neither reps nor a real slab of the session', () => {
    // The 1 km float in the middle of Tuesday morning: 5% of the session at
    // 5:00–5:30, which must not sit beside the 2 km reps as if it were work.
    const withFiller = [
      km(12, { type: 'interval', targetPaceMinPerKm: 240 }),
      km(1, { targetPaceMinPerKm: 320 }),
      step({ repeatCount: 5, repeatSteps: [step({ type: 'interval', durationType: 'distance', durationValue: 300 })] }),
    ];
    expect(sessionFrame(withFiller, FRAME)).toBe('5 × 300 m');
  });

  it('says the same 5 km once, not twice', () => {
    const friday = [
      km(5, { targetPaceMinPerKm: 280, targetPaceMaxPerKm: 300 }),
      km(20, { type: 'interval', targetPaceMinPerKm: 240 }),
      km(5, { targetPaceMinPerKm: 280, targetPaceMaxPerKm: 300 }),
    ];
    expect(sessionFrame(friday, FRAME)).toBe('5 km');
  });
});
