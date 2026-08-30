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
