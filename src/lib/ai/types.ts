export interface ParsedWeeklyPlan {
  workouts: ParsedWorkout[];
}

export interface ParsedWorkout {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  name: string;
  description?: string;
  /** Stable across all three group variants; used by activity matching and clipboard paths. */
  workoutKey?: string;
  /** 1-based position when a day contains separately recorded workout parts. */
  partIndex?: number;
  partCount?: number;
  /**
   * What kind of part this is. `morning`/`evening` are the two-a-day case the
   * program writes as separate בוקר / ערב blocks — they used to have no value to
   * land on, so the parser folded both sessions into one `single` workout and
   * silently dropped the second one's steps.
   */
  partKind?: 'single' | 'warmup' | 'test' | 'main' | 'cooldown' | 'morning' | 'evening';
  /**
   * The session is offered, not prescribed ("ערב - אופציה"). Kept as its own
   * part rather than flattened into a note or dropped, and labelled as optional
   * wherever the day is rendered.
   */
  optional?: boolean;
  /** Matcher hints derived by the parser and normalized server-side. */
  expectedDistanceM?: number;
  expectedDurationSec?: number;
  distanceToleranceM?: number;
  activityNameTokens?: string[];
  /** Published artifacts. The structured workout remains the source of truth. */
  clipboardImageUrl?: string;
  clipboardText?: string;
  distanceMinKm?: number;
  distanceMaxKm?: number;
  /**
   * What the import repaired by itself, with the values it replaced.
   *
   * An empty array is not the same as absent: absent means the session has never
   * been through the fixer, empty means it has and there is nothing outstanding —
   * either because nothing was wrong or because the coach undid it. See
   * `lib/plans/auto-fix.ts`, which is also what keeps normalization (it runs on
   * read too) from re-applying a fix that was taken back.
   */
  autoFixes?: AutoFix[];
  steps: WorkoutStep[];
}

/** A repair the import made to a step, and what the step said before it. */
export interface AutoFix {
  /** A time range collapsed to one figure, restored from the step's own note. */
  code: 'timeRange';
  /** Indices from `workout.steps` down through `repeatSteps` — `order` is not unique. */
  stepPath: number[];
  fromSec: number;
  toSec: { min: number; max: number };
}

export interface GroupPace {
  min: number; // seconds per km
  max: number; // seconds per km
}

export interface GroupHeartRate {
  min: number; // percent of max HR
  max: number; // percent of max HR
}

export interface WorkoutStep {
  order: number;
  type: 'warmup' | 'interval' | 'rest' | 'recovery' | 'cooldown' | 'active';
  durationType: 'distance' | 'time' | 'open';
  durationValue?: number; // meters for distance, seconds for time
  /**
   * The far end of a time step written as a range ("40-50 דק׳"): `durationValue`
   * holds 2400 and this holds 3000. Set by the import's auto-fix (see
   * `lib/plans/auto-fix.ts`) so the athlete's board can print the range the coach
   * wrote instead of the single figure the parse had to choose. Only ever set on
   * `durationType: 'time'`; a Garmin push still uses `durationValue`, since a
   * watch can only be given one number.
   */
  durationMaxValue?: number;
  targetType: 'pace' | 'heart_rate' | 'no_target';
  targetZone?: string; // "easy", "threshold", "interval", "tempo", "sprint", "marathon_pace"
  targetPaceMinPerKm?: number; // seconds per km (faster limit) — Group ❶
  targetPaceMaxPerKm?: number; // seconds per km (slower limit) — Group ❶
  group2Pace?: GroupPace; // Group ❷ pace
  group3Pace?: GroupPace; // Group ❸ pace
  targetHrMinPct?: number; // Group ❶
  targetHrMaxPct?: number; // Group ❶
  group2HeartRate?: GroupHeartRate;
  group3HeartRate?: GroupHeartRate;
  notes?: string;
  repeatCount?: number;
  repeatSteps?: WorkoutStep[];
}

export interface GroupedWeeklyPlans {
  group1: ParsedWeeklyPlan;
  group2: ParsedWeeklyPlan;
  group3: ParsedWeeklyPlan;
}
