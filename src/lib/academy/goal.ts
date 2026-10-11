// A trainee's goal: the race, its day, and the time they want (mockup
// academy-existing-trainees: "מטרה · מרוץ וזמן", and the trainee's own "המטרה שלך").
//
// Pure. Migration 144's `academy_goals` holds it, one row per trainee, because a trainee who
// was in the academy before the funnel has no candidate row for the characterization's goal
// fields to hang off, and the characterization has no goal TIME at all. The characterization
// is still read as the fallback (goal-server.ts), so a trainee who came through the call keeps
// the goal they gave there until somebody writes a new one.

import { GOAL_TYPES, type Characterization, type GoalType } from './characterization';

export interface Goal {
  goalType: GoalType | null;
  targetRace: string | null;
  /** `YYYY-MM-DD`, the race's calendar day. */
  targetRaceDate: string | null;
  /** Finish time, seconds. */
  goalTimeSec: number | null;
}

export const EMPTY_GOAL: Goal = { goalType: null, targetRace: null, targetRaceDate: null, goalTimeSec: null };

const GOAL_KEYS = new Set<string>(GOAL_TYPES.map(g => g.value));
/** 10 minutes to 10 hours: a 5K to a slow marathon, with room. Outside it is a typo. */
export const GOAL_TIME_SEC = { min: 600, max: 36_000 };

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

export function hasGoal(g: Goal | null | undefined): boolean {
  return !!g && (!!g.goalType || !!g.targetRace || !!g.targetRaceDate || !!g.goalTimeSec);
}

/** A row (snake or camel case) as a goal; anything unreadable is "no answer". */
export function readGoal(row: Record<string, unknown> | null | undefined): Goal {
  if (!row) return EMPTY_GOAL;
  const type = text(row.goal_type ?? row.goalType);
  const date = text(row.target_race_date ?? row.targetRaceDate);
  const time = Number(row.goal_time_sec ?? row.goalTimeSec);
  return {
    goalType: type && GOAL_KEYS.has(type) ? (type as GoalType) : null,
    targetRace: text(row.target_race ?? row.targetRace),
    targetRaceDate: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    goalTimeSec: Number.isFinite(time) && time >= GOAL_TIME_SEC.min && time <= GOAL_TIME_SEC.max ? Math.round(time) : null,
  };
}

/** The characterization's goal half, as a goal (no time: the call never asked one). */
export function goalFromCharacterization(c: Pick<Characterization, 'goalType' | 'targetRace' | 'targetRaceDate'> | null | undefined): Goal {
  return c ? { goalType: c.goalType, targetRace: c.targetRace, targetRaceDate: c.targetRaceDate, goalTimeSec: null } : EMPTY_GOAL;
}

export type GoalIssue = 'goalType' | 'targetRaceDate' | 'goalTimeSec';

/**
 * A goal as posted, validated: the fields that were sent but are not readable come back as
 * issues (the route answers 400 naming them), rather than being saved as "no answer" — a race
 * date the coach typed and the server silently dropped is a goal that vanished.
 */
export function parseGoalBody(body: Record<string, unknown>): { goal: Goal; issues: GoalIssue[] } {
  const goal = readGoal(body);
  const issues: GoalIssue[] = [];
  const sent = (k: string) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  if (sent('goalType') && !goal.goalType) issues.push('goalType');
  if (sent('targetRaceDate') && !goal.targetRaceDate) issues.push('targetRaceDate');
  if (sent('goalTimeSec') && !goal.goalTimeSec) issues.push('goalTimeSec');
  return { goal, issues };
}

/** `3:15:00` / `48:30` for a goal time. */
export function goalTimeText(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
