/**
 * Seed workout for the Test Runner activity.
 * Coach shorthand (what we'd paste into the plan) + structured segments that
 * mirror a Garmin Connect "clipboard" workout card.
 */

export const TEST_ACTIVITY_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

/** Coach-facing prompt — the thing @aicoach should reason about. */
export const TEST_PLANNED_TEXT =
  '2ק״מ חימום + 5×1000מ @ 3:30 (3:40) ((3:50)) עם 400מ ריצה קלה בין לבין + 2ק״מ שחרור';

export type WorkoutSegmentKind =
  | 'warmup'
  | 'interval'
  | 'recovery'
  | 'cooldown'
  | 'easy'
  | 'rest'
  | 'repeat';

export interface WorkoutSegment {
  kind: WorkoutSegmentKind;
  /** Garmin-style step label shown on the clipboard */
  label: string;
  /** Detail line under the label (distance/time/pace) */
  detail: string;
  reps?: number;
  distanceM?: number;
  durationSec?: number;
  /** Group 1 target pace (sec/km) */
  targetPaceSec?: number;
  note?: string;
  /** Nested steps for a repeat block */
  steps?: WorkoutSegment[];
  /**
   * Indent level for clipboard rendering (1 = inside a Repeat block).
   * Set by {@link flattenClipboardSteps}; not part of the stored plan.
   */
  indent?: number;
}

export interface PlannedWorkout {
  title: string;
  /** Coach shorthand prompt */
  prompt: string;
  segments: WorkoutSegment[];
}

/**
 * Structured plan matching the seeded test activity laps
 * (2k warmup → 5×(1000 + 400 recovery) → ~2k cooldown).
 * Clipboard rendering uses the expanded Garmin-like step list.
 */
export const TEST_PLANNED_WORKOUT: PlannedWorkout = {
  title: 'אינטרוולים 1000מ',
  prompt: TEST_PLANNED_TEXT,
  segments: [
    {
      kind: 'warmup',
      label: 'Warm Up',
      detail: 'Lap Button Press',
      note: 'עד לחיצת לפ',
    },
    {
      kind: 'warmup',
      label: 'Warm Up',
      detail: '2 km, 5:00',
      distanceM: 2000,
      targetPaceSec: 300,
    },
    {
      kind: 'rest',
      label: 'Rest',
      detail: '2:00, הליכה',
      durationSec: 120,
      note: 'הליכה',
    },
    {
      kind: 'repeat',
      label: 'Repeat',
      detail: '5 Times',
      reps: 5,
      steps: [
        {
          kind: 'interval',
          label: 'Run',
          detail: '1000 m, 3:30 (3:40) ((3:50))',
          distanceM: 1000,
          targetPaceSec: 210, // Group 1
        },
        {
          kind: 'recovery',
          label: 'Recover',
          detail: '400 m, ריצה קלה',
          distanceM: 400,
        },
      ],
    },
    {
      kind: 'cooldown',
      label: 'Cool Down',
      detail: '2 km, קל',
      distanceM: 2000,
    },
  ],
};

/**
 * Flatten repeat blocks into the step rows Garmin shows:
 * Repeat header first, then nested steps (indented), once — not expanded N times.
 */
export function flattenClipboardSteps(workout: PlannedWorkout): WorkoutSegment[] {
  const out: WorkoutSegment[] = [];
  for (const seg of workout.segments) {
    if (seg.kind === 'repeat' && seg.steps?.length) {
      out.push({
        kind: 'repeat',
        label: seg.label,
        detail: seg.detail,
        reps: seg.reps,
        indent: 0,
      });
      for (const child of seg.steps) {
        out.push({ ...child, indent: 1, steps: undefined });
      }
    } else {
      out.push({ ...seg, indent: 0 });
    }
  }
  return out;
}
