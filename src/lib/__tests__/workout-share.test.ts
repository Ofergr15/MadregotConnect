import { describe, it, expect } from 'vitest';
import { shareTextForDay, workoutToShareText } from '../workout-share';
import type { GroupedWeeklyPlans, ParsedWorkout } from '../ai/types';

// A synthetic interval workout mirroring the coach's format, with three groups.
function step(pace: number, sec: number) {
  return {
    order: 1,
    type: 'interval' as const,
    durationType: 'time' as const,
    durationValue: sec,
    targetType: 'pace' as const,
    targetPaceMinPerKm: pace,
    targetPaceMaxPerKm: pace,
  };
}

describe('workoutToShareText', () => {
  it('renders a repeat block with three-group bracket paces', () => {
    const mk = (p1: number): ParsedWorkout => ({
      dayOfWeek: 0,
      name: 'Sunday',
      steps: [
        { order: 1, type: 'interval', durationType: 'time', durationValue: undefined, targetType: 'no_target', repeatCount: 2,
          repeatSteps: [step(p1, 120), step(p1 + 15, 60)] },
      ],
    });
    const g1 = mk(205); // 3:25
    const g2 = mk(215); // 3:35
    const g3 = mk(225); // 3:45
    const text = workoutToShareText(g1, g2, g3);
    expect(text).toContain('2×');
    expect(text).toContain('2min @ 3:25 (3:35) ((3:45))');
    // second sub-step is +15s each group: 3:40 (3:50) ((4:00))
    expect(text).toContain('1min @ 3:40 (3:50) ((4:00))');
  });

  it('renders All-Out / effort notes without a pace', () => {
    const w: ParsedWorkout = {
      dayOfWeek: 0, name: 'x',
      steps: [{ order: 1, type: 'interval', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'All-Out' }],
    };
    expect(workoutToShareText(w)).toBe('2min @ All-Out');
  });

  it('renders a distance step', () => {
    const mk = (p: number): ParsedWorkout => ({
      dayOfWeek: 0, name: 'x',
      steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 6000, targetType: 'pace', targetPaceMinPerKm: p, targetPaceMaxPerKm: p }],
    });
    expect(workoutToShareText(mk(255), mk(264), mk(276))).toBe('6km @ 4:15 (4:24) ((4:36))');
  });

  it('returns null for a rest day', () => {
    const grouped: GroupedWeeklyPlans = {
      group1: { workouts: [{ dayOfWeek: 0, name: 'rest', steps: [] }] },
      group2: { workouts: [] },
      group3: { workouts: [] },
    };
    expect(shareTextForDay(grouped, 0)).toBeNull();
    expect(shareTextForDay(grouped, 3)).toBeNull();
  });
});

describe('shareTextForDay — two sessions in one day', () => {
  // This used to be a `.find()`, so a two-a-day shared only its morning run and
  // the evening session vanished from the text the athletes paste into WhatsApp.
  const km = (meters: number, pace: number) => ({
    order: 1,
    type: 'active' as const,
    durationType: 'distance' as const,
    durationValue: meters,
    targetType: 'pace' as const,
    targetPaceMinPerKm: pace,
    targetPaceMaxPerKm: pace,
  });

  const day = (pace1: number, pace2: number): ParsedWorkout[] => [
    {
      dayOfWeek: 2, name: 'בוקר', partKind: 'morning', partIndex: 1, partCount: 2,
      workoutKey: 'day-2-part-1-morning', steps: [km(8000, pace1)],
    },
    {
      dayOfWeek: 2, name: 'ערב - אופציה', partKind: 'evening', partIndex: 2, partCount: 2,
      optional: true, workoutKey: 'day-2-part-2-evening', steps: [km(6000, pace2)],
    },
  ];

  const grouped: GroupedWeeklyPlans = {
    group1: { workouts: day(270, 285) }, // 4:30 / 4:45
    group2: { workouts: day(280, 295) },
    group3: { workouts: day(290, 305) },
  };

  it('shares both sessions, each under its own heading', () => {
    const text = shareTextForDay(grouped, 2);
    expect(text).toBe(
      'בוקר:\n8km @ 4:30 (4:40) ((4:50))\n\nערב (אופציה):\n6km @ 4:45 (4:55) ((5:05))'
    );
  });

  it('pairs the groups by workoutKey, not by position', () => {
    // A group can legitimately carry a different number of sessions for the day
    // (an optional evening run only the fast group gets). Pairing by index would
    // print group ❷'s morning paces under group ❶'s evening steps.
    const lopsided: GroupedWeeklyPlans = {
      group1: { workouts: day(270, 285) },
      group2: { workouts: [day(280, 295)[1]] }, // evening only
      group3: { workouts: [] },
    };
    const text = shareTextForDay(lopsided, 2);
    expect(text).toContain('בוקר:\n8km @ 4:30\n');       // no ❷ pace to add
    expect(text).toContain('ערב (אופציה):\n6km @ 4:45 (4:55)'); // matched by key
  });

  it('adds no heading to an ordinary single-session day', () => {
    const single: GroupedWeeklyPlans = {
      group1: { workouts: [{ dayOfWeek: 4, name: 'Easy', steps: [km(10_000, 300)] }] },
      group2: { workouts: [] },
      group3: { workouts: [] },
    };
    expect(shareTextForDay(single, 4)).toBe('10km @ 5:00');
  });
});
