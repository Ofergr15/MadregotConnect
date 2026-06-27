export interface ParsedWeeklyPlan {
  workouts: ParsedWorkout[];
}

export interface ParsedWorkout {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  name: string;
  description?: string;
  steps: WorkoutStep[];
}

export interface GroupPace {
  min: number; // seconds per km
  max: number; // seconds per km
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
  notes?: string;
  repeatCount?: number;
  repeatSteps?: WorkoutStep[];
}

export interface GroupedWeeklyPlans {
  group1: ParsedWeeklyPlan;
  group2: ParsedWeeklyPlan;
  group3: ParsedWeeklyPlan;
}
