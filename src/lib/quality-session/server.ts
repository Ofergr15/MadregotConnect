// Server half of the quality session: is the date a quality day (from the
// uploaded plan), and the morning's runs with their reps. Shared by
// GET /api/quality-session and the 7:30 stage of /api/cron/tick.

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getPlanWeekStart } from '@/lib/utils';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { classifyWorkout } from '@/lib/plans/session-summary';
import { isOptionalWorkout } from '@/lib/plans/normalize-plan';
import { buildSession, type ActivityRow, type AthleteRow, type AttendanceRow, type GroupRow } from '@/lib/pack-stories/build';
import { sessionLabel } from '@/lib/pack-stories/model';
import type { Pack } from '@/lib/pack-stories/model';
import type { PlanRep, PlanTargets } from './parts';
import { QUALITY_TYPES, detectReps, fromMinutes, repPace, toMinutes, type QsSession, type QualityWorkout } from './model';

type Db = ReturnType<typeof createServerClient>;

/**
 * The day's quality session, or null. The morning one: an evening part or an
 * optional extra is never the club's session, and a day with a warm-up / main /
 * cool-down split is a quality day when any of its parts is.
 */
export function qualityWorkout(workouts: ParsedWorkout[] | null | undefined, dow: number): QualityWorkout | null {
  const day = (workouts || [])
    .filter(w => w.dayOfWeek === dow && w.partKind !== 'evening' && !isOptionalWorkout(w))
    .sort((a, b) => (a.partIndex ?? 1) - (b.partIndex ?? 1));
  for (const w of day) {
    const type = classifyWorkout(w);
    if (QUALITY_TYPES.includes(type)) return { name: (w.name || '').trim(), type };
  }
  return null;
}


const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The latest uploaded plan of the date's week, as stored. */
async function loadPlan(supabase: Db, date: string): Promise<unknown> {
  const { data: plan, error } = await supabase
    .from('weekly_plans')
    .select('parsed_workouts')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', getPlanWeekStart(new Date(`${date}T12:00:00`)))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return plan?.parsed_workouts ?? null;
}

const workoutOf = (stored: unknown, date: string): QualityWorkout | null => {
  for (const workouts of planWorkoutLists(stored)) {
    const found = qualityWorkout(workouts, dowOf(date));
    if (found) return found;
  }
  return null;
};

/** The date's quality session from the latest uploaded plan of its week, or null. */
export async function loadQualityWorkout(supabase: Db, date: string): Promise<QualityWorkout | null> {
  return workoutOf(await loadPlan(supabase, date), date);
}

/**
 * Each pack's work steps on the day's morning, repeats spelled out, with its own
 * paces (a per-pack plan holds each pack's pace in its own copy). An older
 * single plan is every pack's.
 */
export function planTargets(stored: unknown, dow: number): PlanTargets {
  const v = (stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
  const perPack = ([1, 2, 3] as Pack[]).some(n => v[`group${n}`]);
  const out: PlanTargets = {};
  for (const n of [1, 2, 3] as Pack[]) {
    const lists = planWorkoutLists(perPack ? { [`group${n}`]: v[`group${n}`] } : stored);
    const day = (lists[0] || []).filter(w => w.dayOfWeek === dow && w.partKind !== 'evening' && !isOptionalWorkout(w));
    const reps = day.flatMap(w => workReps(w.steps || []));
    if (reps.length) out[n] = reps;
  }
  return out;
}

function workReps(steps: WorkoutStep[]): PlanRep[] {
  const out: PlanRep[] = [];
  const one = (s: WorkoutStep, float: number | null) => {
    if (s.type !== 'interval' || (s.durationType !== 'time' && s.durationType !== 'distance') || !s.durationValue) return;
    out.push({ unit: s.durationType, value: s.durationValue, pace: s.targetPaceMinPerKm ?? null, float });
  };
  for (const s of steps) {
    if (s.repeatSteps?.length) {
      const rec = s.repeatSteps.find(x => (x.type === 'recovery' || x.type === 'active') && x.targetPaceMinPerKm);
      for (let k = 0; k < Math.max(1, s.repeatCount || 1); k++) for (const x of s.repeatSteps) one(x, rec?.targetPaceMinPerKm ?? null);
    } else one(s, null);
  }
  return out;
}

/**
 * The plan's workout lists. A stored plan is one per pack, { group1: { workouts }, … },
 * and an older one a single { workouts } or a bare list; a quality morning is one
 * when any pack's plan says so.
 */
export function planWorkoutLists(value: unknown): ParsedWorkout[][] {
  if (Array.isArray(value)) return [value as ParsedWorkout[]];
  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, { workouts?: unknown } | unknown>;
  if (Array.isArray((v as { workouts?: unknown }).workouts)) return [(v as { workouts: ParsedWorkout[] }).workouts];
  return Object.keys(v)
    .filter(k => /^group\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map(k => (v[k] as { workouts?: unknown } | null)?.workouts)
    .filter((w): w is ParsedWorkout[] => Array.isArray(w));
}

/**
 * The 7:30 push for the date, or null when the plan does not call it a quality
 * day. One wording for the tick and for the screen's "send it to me".
 */
export async function qualityPush(supabase: Db, date: string): Promise<{ title: string; body: string } | null> {
  const workout = await loadQualityWorkout(supabase, date);
  if (!workout) return null;
  const { count } = await supabase.from('athlete_activities').select('id', { count: 'exact', head: true })
    .gte('start_time', `${date}T00:00:00`).lt('start_time', `${date}T12:00:00`).gte('distance', 1000);
  const n = count || 0;
  return {
    title: `📸 ${workout.name || 'אימון האיכות'} של הבוקר`,
    body: n ? `${n} כבר סיימו. לבחור רץ מכל דבוקה ולשתף.` : 'לבחור רץ מכל דבוקה ולשתף.',
  };
}

/** The day's runs, placed in packs the way the pack stories place them, with their reps. */
export async function loadQualitySession(supabase: Db, date: string): Promise<QsSession> {
  // Attendance weeks start on Sunday; the day is an offset into the week.
  const dow = dowOf(date);
  // start_time is local wall-clock time stored as +00:00, so a naive day range is the local day.
  const [acts, att, aths, grps, stored] = await Promise.all([
    supabase.from('athlete_activities')
      .select('id, athlete_id, start_time, distance, duration, average_pace, average_hr, laps')
      .gte('start_time', `${date}T00:00:00`)
      .lt('start_time', `${addDays(date, 1)}T00:00:00`),
    supabase.from('workout_attendance')
      .select('athlete_id, group_label')
      .eq('week_start_date', addDays(date, -dow))
      .eq('day_of_week', dow)
      .eq('attending', true),
    supabase.from('athletes').select('id, name, group_id'),
    supabase.from('groups').select('id, name'),
    loadPlan(supabase, date),
  ]);
  const failed = [acts, att, aths, grps].find(r => r.error);
  if (failed?.error) throw failed.error;

  const workout = workoutOf(stored, date);
  const rows = ((acts.data || []) as Array<Omit<ActivityRow, 'gps_points'>>).map(r => ({ ...r, gps_points: null }));
  const lapsById = new Map(rows.map(r => [r.id, normalizeStoredLaps(r.laps)]));
  const athleteOf = new Map(rows.map(r => [r.id, r.athlete_id]));
  const base = buildSession(date, rows, (att.data || []) as AttendanceRow[], (aths.data || []) as AthleteRow[], (grps.data || []) as GroupRow[]);

  return {
    date,
    label: sessionLabel(date),
    workout,
    plan: workout ? planTargets(stored, dow) : {},
    runs: base.runs.map(r => {
      const laps = detectReps(lapsById.get(r.id) || []);
      return {
        id: r.id, athleteId: athleteOf.get(r.id) || r.id, name: r.name, pack: r.pack, dup: r.dup,
        start: r.start, end: fromMinutes(toMinutes(r.start) + r.dur / 60),
        dist: r.dist, dur: r.dur, pace: r.pace,
        repPace: repPace(laps), laps,
      };
    }),
  };
}
