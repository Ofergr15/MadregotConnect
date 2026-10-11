/** The payload of GET /api/academy/week-board — screen 4 and 5 of the workout book v3. */

import type { WorkoutStep } from '@/lib/ai/types';
import type { Compliance, WeekTotals } from './compliance';
import type { OffLine } from './board';
import type { RowMarks } from './board-server';

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
  // ── trainee-experience-v2 screen 2 (all optional: an older payload, and the coach's
  //    screen, read without them) ──
  /** ⚡ of the run (activity_loads), rounded. Null: not run, or no load could be priced. */
  load?: number | null;
  /** ⚡ the plan asks for, at the threshold valid today (the same number /api/academy/load sums). */
  plannedLoad?: number | null;
  /** The footer: 🙂 feel, 💬 count, 🏅 PR bucket — only the true ones. */
  marks?: RowMarks;
  /** "▼ 6.2 ק״מ במקום 8", on a session run a bit or far off the plan. */
  offLine?: OffLine | null;
  /** The trainee's own note on the run (the questionnaire's free text). */
  comment?: string | null;
  /** An optional session ("ערב - אופציה"): not counted in the week's planned load. */
  optional?: boolean;
}

/** A day of the week with nothing planned: a thin "מנוחה" row. */
export interface WeekBoardRestDay {
  date: string;
  rest: true;
}

export interface WeekBoard {
  weekStart: string;
  weekEnd: string;
  today: string;
  athlete: { id: string; name: string };
  coachName: string | null;
  /** The coach's gender, for the verbs that name them ("Rina מקבלת התראה"). Optional: older payloads. */
  coachGender?: string | null;
  /** The trainee's 30-minute threshold — what the steps are drawn against. Null: no test. */
  thresholdSec: number | null;
  /** The threshold the steps' paces were written for: the trainee's own, or a club lane's. */
  referenceSec: number;
  /** No plan of their own this week — the board shows the senior groups' week. */
  fromClub: boolean;
  totals: WeekTotals & {
    /** ⚡ planned this week and done so far (v2; absent on an older payload). */
    plannedLoad?: number | null;
    doneLoad?: number | null;
  };
  workouts: WeekBoardWorkout[];
  /** The days with no session (v2). Empty when the week has no plan at all. */
  restDays?: WeekBoardRestDay[];
  /** The load numbers mean something yet (lib/academy/pmc.ts loadStatus is `ok`): the ⚡ tile shows. */
  loadOk?: boolean;
  canPlan: boolean;
}
