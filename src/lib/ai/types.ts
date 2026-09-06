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
  steps: WorkoutStep[];
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
