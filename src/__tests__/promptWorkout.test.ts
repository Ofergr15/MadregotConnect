import { describe, expect, it } from 'vitest';
import { expandWorkoutSteps } from '@/lib/run-chat/mock-workout';
import {
  fallbackPromptWorkout,
  parsePromptWorkoutJson,
} from '@/lib/run-chat/prompt-workout';

const PROMPT = '2 חימום 5 כפול 1000 קצב מרתון עם דקה הליכה בין לבין';

describe('prompt workout parsing', () => {
  it('repairs flat model output into a repeat block without invented steps', () => {
    const workout = parsePromptWorkoutJson(
      JSON.stringify({
        title: 'Marathon Pace Workout',
        segments: [
          { kind: 'warmup', detail: '2 min', durationSec: 120 },
          {
            kind: 'interval',
            detail: '5×, 1 km',
            reps: 5,
            distanceM: 1000,
            targetPaceSec: 299,
            note: 'Marathon pace',
          },
          {
            kind: 'recovery',
            detail: '1 min',
            durationSec: 60,
            note: 'Walking',
          },
          {
            kind: 'cooldown',
            detail: 'Easy running to finish',
          },
        ],
      }),
      PROMPT,
    );

    expect(workout.segments).toHaveLength(2);
    expect(workout.title).toBe('5×1000 קצב מרתון');
    expect(workout.segments[0]).toMatchObject({
      kind: 'warmup',
      distanceM: 2000,
      detail: '2 km',
    });
    expect(workout.segments[0].durationSec).toBeUndefined();
    expect(workout.segments[1]).toMatchObject({
      kind: 'repeat',
      reps: 5,
      detail: '5 Times',
      steps: [
        {
          kind: 'interval',
          distanceM: 1000,
          detail: '1 km, קצב מרתון',
          note: 'קצב מרתון',
        },
        {
          kind: 'recovery',
          durationSec: 60,
          note: 'Walking',
        },
      ],
    });
    expect(workout.segments[1].steps?.[0].targetPaceSec).toBeUndefined();
  });

  it('builds the repeat structure even when the model is unavailable', () => {
    const workout = fallbackPromptWorkout(PROMPT);

    expect(workout.segments).toMatchObject([
      { kind: 'warmup', distanceM: 2000 },
      {
        kind: 'repeat',
        reps: 5,
        steps: [
          { kind: 'interval', distanceM: 1000, note: 'קצב מרתון' },
          { kind: 'recovery', durationSec: 60, note: 'הליכה' },
        ],
      },
    ]);
  });

  it('keeps a distance-based recovery ("1000 לאט") instead of dropping it', () => {
    const workout = fallbackPromptWorkout('5 ק"מ חימום ואז 5x1000 מהר 1000 לאט');

    expect(workout.segments).toMatchObject([
      { kind: 'warmup', distanceM: 5000 },
      {
        kind: 'repeat',
        reps: 5,
        steps: [
          { kind: 'interval', distanceM: 1000 },
          { kind: 'recovery', distanceM: 1000, detail: '1 km, קל' },
        ],
      },
    ]);
    expect(workout.segments[1].steps?.[1].durationSec).toBeUndefined();
  });

  it.each([
    ['30x200 עם 200 קל', 200],
    ['10x400 / 200 הליכה', 200],
    ['6x1 ק"מ עם 1 ק"מ קל בין לבין', 1000],
    ['8x800 with 400m jog', 400],
    ['4x2000 ו-1 לאט', 1000],
  ])('reads the recovery distance from %s', (prompt, distanceM) => {
    const workout = fallbackPromptWorkout(prompt);
    const repeat = workout.segments.find((segment) => segment.kind === 'repeat');
    expect(repeat?.steps?.[1]).toMatchObject({ kind: 'recovery', distanceM });
  });

  it('prefers an explicit walking time over a distance word', () => {
    const workout = fallbackPromptWorkout('5x1000 עם 2 דקות הליכה קלה');
    const repeat = workout.segments.find((segment) => segment.kind === 'repeat');
    expect(repeat?.steps?.[1]).toMatchObject({ kind: 'recovery', durationSec: 120 });
    expect(repeat?.steps?.[1].distanceM).toBeUndefined();
  });

  it('applies the prompt recovery distance to model output too', () => {
    const workout = parsePromptWorkoutJson(
      JSON.stringify({
        title: 'Intervals',
        segments: [
          { kind: 'warmup', distanceM: 2000 },
          {
            kind: 'repeat',
            reps: 5,
            steps: [
              { kind: 'interval', distanceM: 1000 },
              { kind: 'recovery', durationSec: 120 },
            ],
          },
        ],
      }),
      '2 חימום 5x1000 מהר 1000 לאט',
    );
    const repeat = workout.segments.find((segment) => segment.kind === 'repeat');
    expect(repeat?.steps?.[1]).toMatchObject({ kind: 'recovery', distanceM: 1000 });
    expect(repeat?.steps?.[1].durationSec).toBeUndefined();
  });

  it('expands repeat children for the intensity graph', () => {
    const workout = fallbackPromptWorkout(PROMPT);
    const steps = expandWorkoutSteps(workout);

    expect(steps.map((step) => step.kind)).toEqual([
      'warmup',
      'interval',
      'recovery',
      'interval',
      'recovery',
      'interval',
      'recovery',
      'interval',
      'recovery',
      'interval',
      'recovery',
    ]);
  });
});
