import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import type { WorkoutStep } from '@/lib/ai/types';
import { workoutStoryText } from '@/lib/plans/workout-story-text';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/**
 * THE INSTAGRAM STORY, AS THE CLUB ACTUALLY POSTS IT.
 *
 * The reference is a real posted story (feedback 3502fd8f): a title band and the
 * structure typed out with a blank line between blocks. The first test reproduces
 * that post character for character, because "in this style" is the entire
 * requirement and prose cannot pin a layout.
 *
 * The post also carries a footer band — "⏰06:00am 📍Madregot" — and this does
 * NOT reproduce it, on his call: "without the 6am madregot, only the training
 * info". The test below that pins its absence is there so nobody helpfully adds
 * it back.
 */

const secs = (v: number, g1: number, g2: number, g3: number): WorkoutStep => ({
  order: 0, type: 'interval', durationType: 'time', durationValue: v,
  targetType: 'pace', targetPaceMinPerKm: g1,
  group2Pace: { min: g2, max: g2 }, group3Pace: { min: g3, max: g3 },
});
const p = (m: number, s: number) => m * 60 + s;

const rep = (count: number, subs: WorkoutStep[]): WorkoutStep => ({
  order: 0, type: 'interval', durationType: 'open', targetType: 'no_target',
  repeatCount: count, repeatSteps: subs,
});

describe('the story the club posts', () => {
  it('reproduces the posted Wednesday fartlek exactly', () => {
    const text = workoutStoryText({
      dayOfWeek: 3,
      type: 'fartlek',
      km: '14',
      steps: [
        { order: 0, type: 'warmup', durationType: 'open', targetType: 'no_target' },
        rep(2, [secs(90, p(3, 15), p(3, 25), p(3, 35)), secs(90, p(3, 50), p(4, 0), p(4, 10))]),
        rep(4, [secs(60, p(3, 10), p(3, 20), p(3, 30)), secs(60, p(3, 50), p(4, 0), p(4, 10))]),
        rep(4, [secs(30, p(3, 0), p(3, 10), p(3, 20)), secs(30, p(3, 50), p(4, 0), p(4, 10))]),
        rep(4, [secs(15, p(2, 55), p(3, 5), p(3, 15)), secs(15, p(3, 50), p(4, 0), p(4, 10))]),
        { order: 0, type: 'cooldown', durationType: 'open', targetType: 'no_target' },
      ],
    });

    expect(text).toBe([
      "Wednesday's Fartlek (14km):",
      'Warm-up',
      '2x',
      '90sec @ 3:15 (3:25) ((3:35))',
      '90sec @ 3:50 (4:00) ((4:10))',
      '',
      '4x',
      '60sec @ 3:10 (3:20) ((3:30))',
      '60sec @ 3:50 (4:00) ((4:10))',
      '',
      '4x',
      '30sec @ 3:00 (3:10) ((3:20))',
      '30sec @ 3:50 (4:00) ((4:10))',
      '',
      '4x',
      '15sec @ 2:55 (3:05) ((3:15))',
      '15sec @ 3:50 (4:00) ((4:10))',
      'Cool-down',
    ].join('\n'));
  });
});

describe('what a line says', () => {
  it('keeps seconds as seconds, because 1:30 next to 3:15 reads as a pace', () => {
    const text = workoutStoryText({
      dayOfWeek: 1, type: 'intervals', km: '10',
      steps: [rep(1, [secs(90, p(3, 15), p(3, 25), p(3, 35))])],
    });
    expect(text).toContain('90sec @ 3:15');
    expect(text).not.toContain('1:30');
  });

  it('switches to minutes for a round block of two minutes or more', () => {
    const text = workoutStoryText({
      dayOfWeek: 1, type: 'tempo', km: '12',
      steps: [rep(3, [secs(600, p(3, 40), p(3, 50), p(4, 0))])],
    });
    expect(text).toContain('10min @ 3:40');
  });

  it('prints a range the coach wrote as a range, with one unit', () => {
    const step: WorkoutStep = {
      order: 0, type: 'interval', durationType: 'time', durationValue: 2400,
      durationMaxValue: 3000, targetType: 'pace', targetPaceMinPerKm: p(4, 30),
    };
    expect(workoutStoryText({ dayOfWeek: 6, type: 'long_run', km: '20', steps: [step] }))
      .toContain('40-50min @ 4:30');
  });

  it('prints distance steps in the club\'s own units', () => {
    const km: WorkoutStep = {
      order: 0, type: 'interval', durationType: 'distance', durationValue: 1000,
      targetType: 'pace', targetPaceMinPerKm: p(3, 30),
    };
    const m: WorkoutStep = { ...km, durationValue: 400 };
    const text = workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '10', steps: [rep(5, [km, m])] });
    expect(text).toContain('1km @ 3:30');
    expect(text).toContain('400m @ 3:30');
  });

  it('prints a pace RANGE with the club\'s bracket notation intact', () => {
    const step: WorkoutStep = {
      order: 0, type: 'interval', durationType: 'time', durationValue: 60,
      targetType: 'pace', targetPaceMinPerKm: p(3, 30), targetPaceMaxPerKm: p(3, 40),
      group2Pace: { min: p(3, 40), max: p(3, 50) },
    };
    expect(workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '8', steps: [step] }))
      .toContain('60sec @ 3:30–3:40 (3:40–3:50)');
  });

  it('drops the @ when a step has no pace at all', () => {
    const step: WorkoutStep = {
      order: 0, type: 'recovery', durationType: 'time', durationValue: 60,
      targetType: 'no_target',
    };
    const text = workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '8', steps: [step] });
    expect(text).toContain('\n60sec');
    expect(text).not.toContain('@');
  });

  it('reads the groupPaces array the athlete screens are given', () => {
    // The weekly API sends an array; the parse writes group2Pace/group3Pace. The
    // copy button lives inside the sheet, so the text has to say what the sheet says.
    const step = {
      order: 0, type: 'interval', durationType: 'time', durationValue: 60,
      targetType: 'pace',
      groupPaces: [{ min: p(3, 15), max: p(3, 15) }, { min: p(3, 25), max: p(3, 25) }, null],
    } as unknown as WorkoutStep;
    expect(workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '8', steps: [step] }))
      .toContain('60sec @ 3:15 (3:25)');
  });
});

describe('what the story leaves out', () => {
  it('never carries the coach\'s Hebrew step notes into an English story', () => {
    const step: WorkoutStep = {
      order: 0, type: 'interval', durationType: 'time', durationValue: 60,
      targetType: 'pace', targetPaceMinPerKm: p(3, 20), notes: 'אינטרוול חזק',
    };
    const text = workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '8', steps: [step] });
    expect(text).not.toMatch(/[֐-׿]/);
  });

  it('names the warm-up once even when the parse split it in two', () => {
    const w = (v: number): WorkoutStep => ({
      order: 0, type: 'warmup', durationType: 'time', durationValue: v, targetType: 'no_target',
    });
    const text = workoutStoryText({ dayOfWeek: 2, type: 'intervals', km: '8', steps: [w(600), w(300)] });
    expect(text.match(/Warm-up/g)).toHaveLength(1);
  });

  it('carries no time and no place — his call, only the training info', () => {
    // The reference post has "⏰06:00am 📍Madregot" on it and this deliberately
    // does not: nothing in the app knows when or where a session meets, so every
    // version of that line was either a guess or a form to fill in.
    const text = workoutStoryText({
      dayOfWeek: 2, type: 'intervals', km: '8',
      steps: [secs(60, p(3, 10), p(3, 20), p(3, 30))],
    });
    expect(text).not.toMatch(/⏰|📍|Madregot|06:00/);
    expect(text.trimEnd()).toBe(text);
  });

  it('carries no athlete name — the same story goes to all three groups', () => {
    const text = workoutStoryText({
      dayOfWeek: 2, type: 'intervals', km: '8',
      steps: [secs(60, p(3, 10), p(3, 20), p(3, 30))],
    });
    expect(text).toMatch(/\(3:20\) \(\(3:30\)\)/);
  });
});

describe('the story is English even when the app is not', () => {
  it('uses the same type names as en.json, so the two cannot drift', () => {
    const en = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));
    const labels = en.activities as Record<string, string>;
    const cases: Array<[string, string]> = [
      ['fartlek', 'runType_fartlek'], ['intervals', 'runType_intervals'],
      ['long_run', 'runType_long_run'], ['tempo', 'runType_tempo'],
      ['easy', 'runType_easy'], ['progressive', 'runType_progressive'],
    ];
    for (const [type, key] of cases) {
      const text = workoutStoryText({ dayOfWeek: 0, type, km: '10', steps: [] });
      expect(text, type).toContain(`Sunday's ${labels[key]}`);
    }
  });

  it('falls back to Run rather than printing a raw type key', () => {
    expect(workoutStoryText({ dayOfWeek: 0, type: 'hill_repeats', km: '10', steps: [] }))
      .toBe("Sunday's Run (10km):");
  });
});
