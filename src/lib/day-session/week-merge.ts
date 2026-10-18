import { createServerClient } from '@/lib/supabase/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { addDaysToDateStr } from '@/lib/utils';
import { fromRow } from './model';

// A one-day session IN the week, so the screens that show a week show it the way they show
// any planned session — the feed's next-session card (its watch pill, its RSVP, its detail
// sheet), the Program page — instead of a card of its own (Ofer, 2026-10-18: "a small tidy
// card, like always"). Display only: never written to a plan. The plan wins a day it already
// has a session on.

/** The week's published one-day sessions as planner workouts, oldest first. */
export async function daySessionWorkouts(weekStart: string): Promise<ParsedWorkout[]> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').select('*')
    .gte('session_date', weekStart).lte('session_date', addDaysToDateStr(weekStart, 6))
    .not('published_at', 'is', null)
    .order('session_date', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow).filter((s) => s.steps.length).map((s) => ({
    dayOfWeek: new Date(`${s.date}T12:00:00`).getDay(),
    name: s.title,
    workoutKey: `day:${s.date}`,
    steps: s.steps,
    daySession: { date: s.date, quality: s.quality, startTime: s.startTime, place: s.place, hasNutrition: s.nutrition.length > 0, notes: s.description },
  }));
}

/** The plan's workouts (its first pace lane, as the week views read it) plus the one-day sessions on days it leaves empty. */
export function mergeDaySessions(parsed: unknown, days: ParsedWorkout[]): { workouts: ParsedWorkout[] } {
  const plan = extractWorkouts(parsed);
  const taken = new Set(plan.map((w) => w.dayOfWeek));
  return { workouts: [...plan, ...days.filter((d) => !taken.has(d.dayOfWeek))] };
}
