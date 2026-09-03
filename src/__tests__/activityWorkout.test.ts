import { describe, expect, it } from 'vitest';
import {
  isUnresolvedPlan,
  plannedWorkoutFromActivity,
  UNMATCHED_PLAN_TEXT,
  UNMATCHED_PLAN_TITLE,
} from '@/lib/run-chat/activity-workout';

describe('plannedWorkoutFromActivity', () => {
  it('builds a clipboard workout from the recorded run', () => {
    const workout = plannedWorkoutFromActivity({
      activity_name: 'Morning Run',
      distance: 2540,
      duration: 900,
      average_pace: 354,
      average_hr: 139.8,
    });

    expect(workout.title).toBe('Morning Run');
    expect(workout.prompt).toContain('2.5 km');
    expect(workout.prompt).toContain('5:54/km');
    expect(workout.prompt).toContain('140 bpm');
    expect(workout.segments[0]).toMatchObject({
      kind: 'easy',
      label: 'Run',
      distanceM: 2540,
      durationSec: 900,
    });
    expect(workout.source).toEqual({ matchMethod: 'activity' });
  });
});

describe('isUnresolvedPlan', () => {
  it('treats the seeded no-plan card as unresolved', () => {
    expect(
      isUnresolvedPlan(
        { title: UNMATCHED_PLAN_TITLE, prompt: '', segments: [] },
        UNMATCHED_PLAN_TEXT,
      ),
    ).toBe(true);
  });

  it('treats an activity-derived stand-in as unresolved so the program card can return', () => {
    expect(
      isUnresolvedPlan(
        {
          title: 'Morning Run',
          prompt: '2.5 km',
          segments: [],
          source: { matchMethod: 'activity' },
        },
        '2.5 km',
      ),
    ).toBe(true);
  });

  it('leaves a real published workout alone', () => {
    expect(
      isUnresolvedPlan(
        { title: 'אינטרוולים 1000מ', prompt: '5x1000', segments: [] },
        '5x1000',
      ),
    ).toBe(false);
  });
});
