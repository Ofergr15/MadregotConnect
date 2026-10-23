/**
 * GET /api/activities/analysis?activityId=<uuid>
 *
 * What the run page reads beyond the charts (mockup ~/.cache/madregot/run-page-v4.html,
 * Ofer 2026-10-20): the workout the watch ran — its steps merged out of the laps and scored
 * against the runner's pack target (lib/run-analysis/workout) — the cool-down when it was
 * saved as a run of its own, workouts like it in the last two months, the fastest stretches
 * inside the run, heart rate in each recovery, cadence and stride per rep, the weather and
 * what it cost, and Training Effect when the sync stored it.
 *
 * Same visibility as /api/activities/stream: any verified member; the heart-rate pieces only
 * for whoever may see this runner's heart-rate line.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isPendingAthlete, seesPending } from '@/lib/auth/pending-athletes';
import { loadActivityStream } from '@/lib/garmin/stream-store';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { mayViewHrTrace, readHrTracePublic } from '@/lib/athletes/hr-trace-privacy';
import { COACH_ID } from '@/lib/constants';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { attachLapsForPrs } from '@/lib/prs/attach-laps';
import { applyPrOverrides } from '@/lib/prs/overrides';
import { readPrOverrides } from '@/lib/prs/overrides-store';
import { readPrExclusions } from '@/lib/prs/exclusions-store';
import { classifyWorkout } from '@/lib/plans/session-summary';
import { workoutPlanForGroup } from '@/lib/plans/match-athlete-activities';
import type { ParsedWorkout } from '@/lib/ai/types';
import { bestEffort, heatCostSec, readWorkout, recoveries, technique, type WStep } from '@/lib/run-analysis/workout';

export const dynamic = 'force-dynamic';

const EFFORTS: Array<[string, number]> = [['400', 400], ['1k', 1000], ['mile', 1609], ['5k', 5000], ['10k', 10000]];
const PR_RANGE = { '5k': 5000, '10k': 10000 };

async function weather(lat: number, lng: number, localIso: string): Promise<{ tempC: number; dewC: number; humidity: number; feelsC: number | null } | null> {
  const date = localIso.slice(0, 10); const hour = Number(localIso.slice(11, 13));
  const recent = Date.now() - Date.parse(`${date}T12:00:00Z`) < 6 * 86_400_000;
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const q = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature&timezone=Asia%2FJerusalem&${recent ? 'past_days=7&forecast_days=1' : `start_date=${date}&end_date=${date}`}`;
  try {
    const res = await fetch(`${base}?${q}`, { next: { revalidate: recent ? 3600 : 30 * 86_400 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = await res.json() as { hourly?: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[]; dew_point_2m: number[]; apparent_temperature?: number[] } };
    const h = j.hourly; if (!h) return null;
    const i = h.time.findIndex((t) => t === `${date}T${String(hour).padStart(2, '0')}:00`);
    if (i < 0 || h.temperature_2m[i] == null) return null;
    return { tempC: h.temperature_2m[i], dewC: h.dew_point_2m[i], humidity: h.relative_humidity_2m[i], feelsC: h.apparent_temperature?.[i] ?? null };
  } catch { return null; }
}

/** The club's own line between a long run and a normal one (lib/plans/session-summary). */
const LONG_RUN_M = 20000;

/** Was the plan session this run is matched to a quality one or a long run? */
async function plannedHard(supabase: ReturnType<typeof createServerClient>, activityId: string): Promise<boolean> {
  try {
    const { data: m } = await supabase.from('activity_plan_matches').select('weekly_plan_id, workout_key, group_number').eq('activity_id', activityId).maybeSingle();
    if (!m) return false;
    const { data: plan } = await supabase.from('weekly_plans').select('parsed_workouts').eq('id', m.weekly_plan_id).maybeSingle();
    const w = workoutPlanForGroup(plan?.parsed_workouts, Number(m.group_number) || 1)?.workouts.find((x: ParsedWorkout) => x.workoutKey === m.workout_key);
    if (!w) return false;
    return ['intervals', 'tempo', 'fartlek', 'progressive', 'long_run'].includes(classifyWorkout(w));
  } catch { return false; }
}

export async function GET(request: Request) {
  const activityId = new URL(request.url).searchParams.get('activityId');
  if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) return NextResponse.json({ error: 'activityId (uuid) required' }, { status: 400 });
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  try {
    const { data: row, error } = await supabase.from('athlete_activities')
      .select('id, athlete_id, start_time, distance, duration, average_pace, start_lat, start_lng, laps, executed_workout')
      .eq('id', activityId).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    if (row.athlete_id && !seesPending(caller, row.athlete_id) && (await isPendingAthlete(supabase, row.athlete_id))) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }
    const hrOk = mayActFor(caller, row.athlete_id) || mayViewHrTrace({ isSelfOrStaff: false, runnerAllows: await readHrTracePublic(supabase, row.athlete_id), hiddenOnThisRun: false });

    const [stream, who, groups, te] = await Promise.all([
      loadActivityStream(supabase, row.id),
      supabase.from('athletes').select('group_id').eq('id', row.athlete_id).maybeSingle(),
      supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID),
      // Migration 160; until it is applied the read fails and the card stays away.
      supabase.from('athlete_activities').select('training_effect').eq('id', row.id).maybeSingle(),
    ]);
    const key = paceGroupKeyFor(((groups.data || []) as Array<{ id: string; pace_profile: { marathonGoal?: number | null } | null }>)
      .map((g) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null })), (who.data as { group_id?: string | null } | null)?.group_id);
    const packIndex = { group1: 0, group2: 1, group3: 2 }[key];
    const laps = normalizeStoredLaps(stream?.laps ?? row.laps) as never;
    const workout = readWorkout(laps, row.executed_workout as { steps?: WStep[] } | null, packIndex);

    const series = stream?.series as { t?: number[]; d?: number[]; hr?: number[]; cad?: number[]; v?: number[] } | undefined;
    const tr = series?.t && series?.d && series.t.length === series.d.length ? { t: series.t, d: series.d, hr: hrOk ? series.hr : undefined, cad: series.cad } : null;
    const total = row.distance || 0;

    // The fastest stretches of the run, and the runner's best 5K / 10K to hold them against.
    const efforts = tr ? EFFORTS.filter(([, m]) => total >= m * 1.02).map(([k, m]) => {
      const b = bestEffort(tr, m);
      return b ? { key: k, meters: m, seconds: b.seconds, start: b.start, rep: workout ? workout.reps.findIndex((r) => b.start >= r.start - 20 && b.start + b.seconds <= r.start + r.seconds + 20) + 1 || null : null } : null;
    }).filter(Boolean) : [];
    // The runner's 5K / 10K record BEFORE this run — the same records the profile shows
    // (lib/prs: the fastest stretch inside any run, their own exclusions and stated
    // times), not just whole runs of that length.
    const prs: Record<string, { seconds: number; date: string | null } | null> = {};
    const wanted = Object.keys(PR_RANGE).filter((k) => efforts.some((e) => e!.key === k));
    if (wanted.length) {
      const acts = await fetchAllRows<RunActivityRow & { id: string }>((from, to) => supabase.from('athlete_activities')
        .select('id, activity_name, activity_type, start_time, distance, duration').eq('athlete_id', row.athlete_id)
        .neq('id', row.id).order('start_time', { ascending: false }).order('id').range(from, to));
      const runs = await attachLapsForPrs(supabase, row.athlete_id, filterQualifyingRuns(acts));
      const [excluded, overrides] = await Promise.all([readPrExclusions(supabase, row.athlete_id), readPrOverrides(supabase, row.athlete_id)]);
      const bests = applyPrOverrides(computeDistanceBests(runs, { excluded }), overrides);
      for (const k of wanted) {
        const b = bests.find((x) => x.key === k);
        prs[k] = b?.seconds ? { seconds: b.seconds, date: b.date ? String(b.date).slice(0, 10) : null } : null;
      }
    }

    // The cool-down (or warm-up) saved as a run of its own the same morning.
    const startMs = Date.parse(String(row.start_time).slice(0, 19) + 'Z');
    const endMs = startMs + (row.duration || 0) * 1000;
    const { data: sameDay } = await supabase.from('athlete_activities').select('id, start_time, distance, duration')
      .eq('athlete_id', row.athlete_id).neq('id', row.id)
      .gte('start_time', `${String(row.start_time).slice(0, 10)}T00:00:00`).lte('start_time', `${String(row.start_time).slice(0, 10)}T23:59:59`);
    const linked = (sameDay || []).map((a) => ({ ...a, s: Date.parse(String(a.start_time).slice(0, 19) + 'Z') }))
      .find((a) => (a.distance || 0) <= 6000 && ((a.s >= endMs - 60_000 && a.s - endMs <= 45 * 60_000) || (a.s + (a.duration || 0) * 1000 <= startMs + 60_000 && startMs - (a.s + (a.duration || 0) * 1000) <= 45 * 60_000)));
    const extra = linked ? { id: linked.id, start: String(linked.start_time).slice(11, 16), km: Math.round((linked.distance || 0) / 100) / 10, after: linked.s >= endMs - 60_000 } : null;

    // Workouts like this one in the last nine weeks: reps within 25% of today's length.
    let similar: Array<{ id: string; date: string; title: string; avgPace: number }> = [];
    // A workout read without reps (an old run's steps) has no length to compare: it used to
    // throw here and fail the whole analysis with a 500 (10-23).
    const len = workout?.reps[0]?.meters ?? 0;
    if (workout && len > 0) {
      const { data: past } = await supabase.from('athlete_activities').select('id, start_time, laps, executed_workout')
        .eq('athlete_id', row.athlete_id).neq('id', row.id).not('laps', 'is', null)
        .gte('start_time', new Date(startMs - 63 * 86_400_000).toISOString().slice(0, 10)).lt('start_time', String(row.start_time)).limit(120);
      similar = (past || []).map((a) => {
        const w = readWorkout(normalizeStoredLaps(a.laps) as never, a.executed_workout as { steps?: WStep[] } | null, packIndex);
        const m = w?.reps[0]?.meters;
        return w && m && Math.abs(m - len) / len <= 0.25 ? { id: a.id, date: String(a.start_time).slice(0, 10), title: w.title, avgPace: w.avgPace } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.date.localeCompare(b.date)).slice(-4);
    }

    const cond = row.start_lat && row.start_lng ? await weather(row.start_lat, row.start_lng, String(row.start_time)) : null;
    // "How much faster in other conditions" is for the runs where the pace is the point — a
    // quality session or a long run (Ofer, 2026-10-21) — not every easy jog.
    const paceMatters = !!workout || total >= LONG_RUN_M || (cond ? await plannedHard(supabase, row.id) : false);
    const pace = row.average_pace || (total ? (row.duration || 0) / (total / 1000) : 0);
    const teRow = te.error ? null : (te.data as { training_effect?: { aerobic?: number; anaerobic?: number; label?: string | null; load?: number | null; recoveryHours?: number | null } | null } | null)?.training_effect ?? null;

    return NextResponse.json({
      workout,
      linked: extra,
      similar,
      efforts, prs,
      recovery: tr && workout ? recoveries(tr, workout) : [],
      technique: tr && workout ? technique(tr, workout) : [],
      conditions: cond ? { ...cond, costSec: workout ? heatCostSec(cond.tempC, cond.dewC, workout.avgPace) : heatCostSec(cond.tempC, cond.dewC, pace), calc: paceMatters } : null,
      trainingEffect: teRow,
      hrVisible: hrOk,
    // Without the trace (it lands minutes after the run) the answer is partial: never kept.
    }, { headers: { 'Cache-Control': tr ? 'private, max-age=300' : 'no-store' } });
  } catch (err) {
    console.error('[activities/analysis] failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
