/** The payload of GET /api/academy/week-board — screen 4 and 5 of the workout book v3. */

import type { WorkoutStep } from '@/lib/ai/types';
import type { Compliance, WeekTotals } from './compliance';

export interface WeekBoardWorkout {
  date: string;
  dayOfWeek: number;
  name: string;
  compliance: Compliance;
  plannedM: number | null;
  actualM: number | null;
  plannedSec: number | null;
  actualSec: number | null;
  /** The work band's centre as planned, and what was run, sec/km. */
  plannedPace: number | null;
  actualPace: number | null;
  /** Delivered to Garmin (a `workout_deliveries` success for that date). */
  onWatch: boolean;
  /** The planned steps at this trainee's own paces — what their watch was given. */
  steps: WorkoutStep[];
  note: string | null;
  activityId: string | null;
}

export interface WeekBoard {
  weekStart: string;
  weekEnd: string;
  today: string;
  athlete: { id: string; name: string };
  coachName: string | null;
  totals: WeekTotals;
  workouts: WeekBoardWorkout[];
  canPlan: boolean;
}
