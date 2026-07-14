import { NextResponse } from 'next/server';
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
} from '@/lib/academy/adherence';

export const dynamic = 'force-dynamic';

// Monday-based week start (matches getActivityWeekStart / leaderboard convention).
function mondayOf(dateStr?: string | null): string {
  const base = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  const day = base.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1;
  base.setUTCDate(base.getUTCDate() - diff);
  return base.toISOString().split('T')[0];
}

function addDaysStr(dateStr: string, days: number): string {
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

// dayOfWeek in ParsedWorkout is 0=Sunday..6=Saturday. Our week runs Mon..Sun,
// so map to an offset from Monday.
function dateForDayOfWeek(weekStartMonday: string, dayOfWeek: number): string {
  const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDaysStr(weekStartMonday, offsetFromMonday);
}

interface AthleteAdherence {
  athleteId: string;
  name: string;
  week: WeekAdherence;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = mondayOf(searchParams.get('weekStart'));
    const weekEnd = addDaysStr(weekStart, 6);
    const onlyAthleteId = searchParams.get('athleteId');

    const supabase = createServerClient();

    // 1) Academy athletes (or a single requested one). Fall back gracefully if the
    //    is_academy column hasn't been migrated yet.
    let athletesQuery = supabase
      .from('athletes')
      .select('id, name, is_academy')
      .eq('coach_id', COACH_ID);
    const primary = await athletesQuery;

    let athletes: any[] = [];
    if (primary.error) {
      // Column missing → nothing is academy yet.
      athletes = [];
    } else {
      athletes = (primary.data || []).filter((a: any) => a.is_academy);
    }
    if (onlyAthleteId) athletes = athletes.filter(a => a.id === onlyAthleteId);

    if (!athletes.length) {
      return NextResponse.json({ weekStart, weekEnd, athletes: [] as AthleteAdherence[] });
    }

    const athleteIds = athletes.map(a => a.id);

    // 2) Planned workouts for the week, per athlete. An academy athlete's individual
    //    plan (weekly_plans.athlete_id) takes precedence; otherwise fall back to the
    //    coach/group plan for that week. Load both, prefer individual.
    const plannedByAthlete = new Map<string, PlannedWorkout[]>();

    // Individual academy plans for the week (athlete_id set). Guarded — the column
    // may not exist on older DBs.
    let individualPlans: any[] = [];
    const indiv = await supabase
      .from('weekly_plans')
      .select('id, athlete_id, week_start_date, parsed_workouts')
      .eq('week_start_date', weekStart)
      .in('athlete_id', athleteIds);
    if (!indiv.error) individualPlans = indiv.data || [];

    // Shared group/coach plan for the week (used when an athlete has no individual plan).
    const shared = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .eq('week_start_date', weekStart)
      .order('created_at', { ascending: false });
    const sharedPlan = (shared.data || [])[0];
    const sharedWorkouts = sharedPlan ? extractWorkouts(sharedPlan.parsed_workouts) : [];

    const toPlanned = (workouts: ParsedWorkout[]): PlannedWorkout[] => {
      // De-dupe by dayOfWeek (keep first), then build planned metrics per date.
      const seen = new Set<number>();
      const out: PlannedWorkout[] = [];
      for (const w of workouts) {
        if (seen.has(w.dayOfWeek)) continue;
        seen.add(w.dayOfWeek);
        out.push(buildPlannedWorkout(w, dateForDayOfWeek(weekStart, w.dayOfWeek)));
      }
      return out;
    };

    for (const a of athletes) {
      const own = individualPlans.find(p => p.athlete_id === a.id);
      const workouts = own ? extractWorkouts(own.parsed_workouts) : sharedWorkouts;
      plannedByAthlete.set(a.id, toPlanned(workouts));
    }

    // 3) Actual activities for the week (all athletes at once).
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
      week: assessWeek(plannedByAthlete.get(a.id) || [], actualByAthlete.get(a.id) || []),
    }));

    return NextResponse.json({ weekStart, weekEnd, athletes: result });
  } catch (error: any) {
    console.error('Academy adherence error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute adherence' }, { status: 500 });
  }
}
