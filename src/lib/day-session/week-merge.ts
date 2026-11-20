import { createServerClient } from '@/lib/supabase/server';
import type { ParsedWorkout } from '@/lib/ai/types';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';
import { fromRow } from './model';
import { fetchAllRows } from '@/lib/supabase/paginate';

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

/** The span read's answer. `ok: false` means the sessions could NOT be read: never "there were none". */
export type DaySessionSpan = { ok: true; byWeek: Map<string, ParsedWorkout[]> } | { ok: false };

/**
 * The same published one-day sessions for MANY plan weeks (the dashboard's week history), keyed by plan week
 * start (Sunday), each list built exactly as daySessionWorkouts builds one week's (shared toWorkouts()).
 * Read-only. PAGED through fetchAllRows (stable order: session_date, id), so a span longer than one
 * PostgREST page (1000 rows) is read whole instead of silently truncated. A read error returns { ok: false }
 * so the caller can say the history lacks one-day sessions, instead of reading absence as zero.
 */
export async function daySessionWorkoutsByWeek(firstWeekStart: string, lastWeekStart: string): Promise<DaySessionSpan> {
  const byWeek = new Map<string, ParsedWorkout[]>();
  if (!firstWeekStart || !lastWeekStart || firstWeekStart > lastWeekStart) return { ok: true, byWeek };
  const db = createServerClient();
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllRows<Record<string, unknown>>((from, to) => db.from('day_sessions').select('*')
      .gte('session_date', firstWeekStart).lte('session_date', addDaysToDateStr(lastWeekStart, 6))
      .not('published_at', 'is', null)
      .order('session_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));
  } catch {
    return { ok: false };
  }
  for (const w of toWorkouts(rows)) {
    const week = planWeekStartOf(w.daySession!.date);
    const list = byWeek.get(week);
    if (list) list.push(w); else byWeek.set(week, [w]);
  }
  return { ok: true, byWeek };
}

/** The plan's workouts (its first pace lane, as the week views read it) plus the one-day sessions on days it leaves empty. */
export function mergeDaySessions(parsed: unknown, days: ParsedWorkout[]): { workouts: ParsedWorkout[] } {
  const plan = extractWorkouts(parsed);
  const taken = new Set(plan.map((w) => w.dayOfWeek));
  return { workouts: [...plan, ...days.filter((d) => !taken.has(d.dayOfWeek))] };
}
