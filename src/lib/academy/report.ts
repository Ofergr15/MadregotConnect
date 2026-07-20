import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import {
  assessWeek,
  buildPlannedWorkout,
  ActualActivity,
  PlannedWorkout,
  WeekAdherence,
} from './adherence';
import { loadAcademySettings } from './settings-server';

export interface AthleteAdherence {
  athleteId: string;
  name: string;
  week: WeekAdherence;
}

export interface AcademyWeekReport {
  weekStart: string;
  weekEnd: string;
  athletes: AthleteAdherence[];
}

// Sunday-based week start, matching how plans are saved (getCurrentWeekSunday) and
// how the push route dates workouts (week_start_date + dayOfWeek, dayOfWeek 0=Sun).
export function sundayOf(dateStr?: string | null): string {
  const base = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() - base.getUTCDay());
  return base.toISOString().split('T')[0];
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// A weekly_plans.parsed_workouts blob → ParsedWorkout[] (flat or grouped).
function extractWorkouts(parsed: any): ParsedWorkout[] {
  if (!parsed) return [];
  if (Array.isArray(parsed.workouts)) return parsed.workouts;
  for (const key of ['group1', 'group2', 'group3']) {
    if (parsed[key]?.workouts && Array.isArray(parsed[key].workouts)) return parsed[key].workouts;
  }
  for (const val of Object.values(parsed)) {
    if (val && typeof val === 'object' && Array.isArray((val as any).workouts)) return (val as any).workouts;
  }
  return [];
}

/**
 * Compute per-academy-athlete adherence for a week. Shared by the /api/academy/
 * adherence route and the weekly-report cron. Guarded against unmigrated columns.
 */
export async function computeAcademyWeekAdherence(opts: {
  weekStart?: string | null;
  onlyAthleteId?: string | null;
}): Promise<AcademyWeekReport> {
  const weekStart = sundayOf(opts.weekStart);
  const weekEnd = addDaysStr(weekStart, 6);
  const supabase = createServerClient();
  const { tolerances } = await loadAcademySettings();

  // 1) Academy athletes (or a single requested one).
  const athRes = await supabase
    .from('athletes')
    .select('id, name, is_academy')
    .eq('coach_id', COACH_ID);

  let athletes: any[] = athRes.error ? [] : (athRes.data || []).filter((a: any) => a.is_academy);
  if (opts.onlyAthleteId) athletes = athletes.filter(a => a.id === opts.onlyAthleteId);

  if (!athletes.length) return { weekStart, weekEnd, athletes: [] };

  const athleteIds = athletes.map(a => a.id);

  // 2) Planned workouts per athlete — individual plan wins, else shared group plan.
  const indiv = await supabase
    .from('weekly_plans')
    .select('id, athlete_id, week_start_date, parsed_workouts')
    .eq('week_start_date', weekStart)
    .in('athlete_id', athleteIds);
  const individualPlans: any[] = indiv.error ? [] : indiv.data || [];

  // The shared/group plan is the coach-wide one (athlete_id IS NULL) — must NOT
  // pick up another athlete's individual plan for the same week. Fall back to the
  // unscoped query if the athlete_id column isn't migrated.
  let shared = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStart)
    .is('athlete_id', null)
    .order('created_at', { ascending: false });
  if (shared.error) {
    shared = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .eq('week_start_date', weekStart)
      .order('created_at', { ascending: false });
  }
  const sharedPlan = (shared.data || [])[0];
  const sharedWorkouts = sharedPlan ? extractWorkouts(sharedPlan.parsed_workouts) : [];

  const toPlanned = (workouts: ParsedWorkout[]): PlannedWorkout[] => {
    const seen = new Set<number>();
    const out: PlannedWorkout[] = [];
    for (const w of workouts) {
      if (seen.has(w.dayOfWeek)) continue;
      seen.add(w.dayOfWeek);
      out.push(buildPlannedWorkout(w, addDaysStr(weekStart, w.dayOfWeek)));
    }
    return out;
  };

  const plannedByAthlete = new Map<string, PlannedWorkout[]>();
  for (const a of athletes) {
    const own = individualPlans.find(p => p.athlete_id === a.id);
    plannedByAthlete.set(a.id, toPlanned(own ? extractWorkouts(own.parsed_workouts) : sharedWorkouts));
  }

  // 3) Actual activities for the week.
  const acts = await supabase
    .from('athlete_activities')
    .select('id, athlete_id, start_time, distance, duration, moving_duration, average_pace, activity_type')
    .in('athlete_id', athleteIds)
    .gte('start_time', `${weekStart}T00:00:00Z`)
    .lte('start_time', `${weekEnd}T23:59:59Z`);

  const actualByAthlete = new Map<string, ActualActivity[]>();
  for (const r of (acts.data || []) as any[]) {
    const arr = actualByAthlete.get(r.athlete_id) || [];
    arr.push({
      id: r.id,
      date: activityLocalDateStr(r.start_time),
      distance: Number(r.distance) || 0,
      duration: Number(r.duration) || 0,
      movingDuration: r.moving_duration != null ? Number(r.moving_duration) : null,
      averagePace: r.average_pace != null ? Number(r.average_pace) : null,
      activityType: r.activity_type,
    });
    actualByAthlete.set(r.athlete_id, arr);
  }

  // 4) Assess each athlete.
  const result: AthleteAdherence[] = athletes.map(a => ({
    athleteId: a.id,
    name: a.name,
    week: assessWeek(plannedByAthlete.get(a.id) || [], actualByAthlete.get(a.id) || [], tolerances),
  }));

  return { weekStart, weekEnd, athletes: result };
}
