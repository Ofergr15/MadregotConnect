import { createServerClient } from '@/lib/supabase/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';
import { fromRow } from './model';

// A one-day session IN the week, so the screens that show a week show it the way they show
// any planned session — the feed's next-session card (its watch pill, its RSVP, its detail
// sheet), the Program page — instead of a card of its own (Ofer, 2026-10-18: "a small tidy
// card, like always"). Display only: never written to a plan. The plan wins a day it already
// has a session on.

function toWorkouts(data: Record<string, unknown>[]): ParsedWorkout[] {
  return data.map(fromRow).filter((s) => s.steps.length).map((s) => ({
    dayOfWeek: new Date(`${s.date}T12:00:00`).getDay(),
    name: s.title,
    workoutKey: `day:${s.date}`,
    steps: s.steps,
    daySession: { date: s.date, quality: s.quality, startTime: s.startTime, place: s.place, hasNutrition: s.nutrition.length > 0, notes: s.description },
  }));
}

/** The week's published one-day sessions as planner workouts, oldest first. */
export async function daySessionWorkouts(weekStart: string): Promise<ParsedWorkout[]> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').select('*')
    .gte('session_date', weekStart).lte('session_date', addDaysToDateStr(weekStart, 6))
    .not('published_at', 'is', null)
    .order('session_date', { ascending: true });
  if (error || !data) return [];
  return toWorkouts(data as Record<string, unknown>[]);
}

/**
 * The same published one-day sessions for MANY plan weeks in ONE read (the dashboard's week history),
 * keyed by plan week start (Sunday), each list built exactly as daySessionWorkouts builds one week's.
 * Read-only. On a read error it returns an empty map, the same "no one-day sessions" answer as above.
 */
export async function daySessionWorkoutsByWeek(firstWeekStart: string, lastWeekStart: string): Promise<Map<string, ParsedWorkout[]>> {
  const out = new Map<string, ParsedWorkout[]>();
  if (!firstWeekStart || !lastWeekStart || firstWeekStart > lastWeekStart) return out;
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').select('*')
    .gte('session_date', firstWeekStart).lte('session_date', addDaysToDateStr(lastWeekStart, 6))
    .not('published_at', 'is', null)
    .order('session_date', { ascending: true });
  if (error || !data) return out;
  for (const w of toWorkouts(data as Record<string, unknown>[])) {
    const week = planWeekStartOf(w.daySession!.date);
    const list = out.get(week);
    if (list) list.push(w); else out.set(week, [w]);
  }
  return out;
}

/** The plan's workouts (its first pace lane, as the week views read it) plus the one-day sessions on days it leaves empty. */
export function mergeDaySessions(parsed: unknown, days: ParsedWorkout[]): { workouts: ParsedWorkout[] } {
  const plan = extractWorkouts(parsed);
  const taken = new Set(plan.map((w) => w.dayOfWeek));
  return { workouts: [...plan, ...days.filter((d) => !taken.has(d.dayOfWeek))] };
}
