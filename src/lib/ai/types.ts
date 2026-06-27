export interface ParsedWeeklyPlan {
  workouts: ParsedWorkout[];
}

export interface ParsedWorkout {
  dayOfWeek: number; // 0=Monday, 6=Sunday
  name: string;
  description?: string;
  steps: WorkoutStep[];
}

export interface WorkoutStep {
  order: number;
  type: 'warmup' | 'interval' | 'rest' | 'recovery' | 'cooldown' | 'active';
  durationType: 'distance' | 'time' | 'open';
  durationValue?: number; // meters for distance, seconds for time
  targetType: 'pace' | 'heart_rate' | 'no_target';
  targetZone?: string; // "easy", "threshold", "interval", "tempo", "sprint", "marathon_pace"
  targetPaceMinPerKm?: number; // seconds per km (faster limit)
  targetPaceMaxPerKm?: number; // seconds per km (slower limit)
  repeatCount?: number;
  repeatSteps?: WorkoutStep[];
}
