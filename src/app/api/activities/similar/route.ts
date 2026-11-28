/**
 * GET /api/activities/similar?id=<activityId>&scope=same|type|all
 *
 * Sessions like this one, for the native run-detail screen's comparison chart: the
 * runner's own past runs in the last 120 days, oldest→newest (at most 8), with this run
 * appended last as `today: true`.
 *
 * - A quality run (the watch's workout has reps, lib/run-analysis/workout):
 *   `same` = rep length within 25% AND rep count ±1; `type` = rep length within 25%;
 *   `all` = any quality run.
 * - An easy / long run (no reps): `same` = distance ±15%; `type` = ±30%;
 *   `all` = any non-quality run of at least 60% of today's distance.
 *
 * SELF-OR-STAFF (`mayActFor`), a hard 403 otherwise — it is a pace history on a named
 * person, the same class as the plan verdict. Masking: `pace` hidden on this run's feed
 * item → `{ sessions: [], masked: true }`; `heart_rate` hidden → every HR field null.
 * A failed hidden-stats read fails closed (lib/activities/hidden-stats).
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { readHiddenStats } from '@/lib/activities/hidden-stats';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { COACH_ID } from '@/lib/constants';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { readWorkout, type Workout, type WStep } from '@/lib/run-analysis/workout';
import { matchesScope, paceAtHrOf, type SimilarScope, type SimilarSession } from '@/lib/run-analysis/similar';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const SCOPES: SimilarScope[] = ['same', 'type', 'all'];
const WINDOW_DAYS = 120;
const MAX_SESSIONS = 8;

interface Row {
  id: string; athlete_id: string; start_time: string; activity_name: string | null; activity_type: string | null;
  distance: number | null; duration: number | null; moving_duration: number | null;
  average_pace: number | null; average_hr: number | null; laps: unknown; executed_workout: unknown;
}

const isRun = (t: string | null) => !t || /run/i.test(t);

function shape(row: Row, w: Workout | null, hideHr: boolean): SimilarSession {
  const dist = Number(row.distance) || 0;
  const moving = Number(row.moving_duration ?? row.duration) || 0;
  const quality = !!w && w.reps.length > 0;
  const graded = quality && w!.reps.some((r) => r.onTarget != null);
  return {
    id: row.id,
    date: String(row.start_time).slice(0, 10),
    title: quality ? w!.title : row.activity_name || '',
    distanceM: Math.round(dist),
    avgPace: quality ? w!.avgPace : dist > 0 && moving > 0 ? Math.round(moving / (dist / 1000)) : row.average_pace ?? null,
    avgHr: hideHr ? null : quality ? w!.avgHr : row.average_hr ?? null,
    repPaces: quality ? w!.reps.map((r) => r.pace).filter((p): p is number => p != null) : [],
    repsOnTarget: graded ? w!.hit : null,
    repsTotal: quality ? w!.reps.length : null,
    paceAtHr: null,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const scope = (searchParams.get('scope') || 'same') as SimilarScope;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 });
    if (!SCOPES.includes(scope)) return NextResponse.json({ error: 'scope must be same|type|all' }, { status: 400 });
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const SELECT = 'id, athlete_id, start_time, activity_name, activity_type, distance, duration, moving_duration, average_pace, average_hr, laps, executed_workout';
    const { data: row, error } = await supabase.from('athlete_activities').select(SELECT).eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to read activity', details: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    const todayRow = row as unknown as Row;
    if (!mayActFor(caller, todayRow.athlete_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const hidden = await readHiddenStats(supabase, id);
    if (hidden.has('pace')) return NextResponse.json({ kind: null, scope, sessions: [], masked: true });
    const hideHr = hidden.has('heart_rate');

    const [who, groups] = await Promise.all([
      supabase.from('athletes').select('group_id').eq('id', todayRow.athlete_id).maybeSingle(),
      supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID),
    ]);
    const key = paceGroupKeyFor(((groups.data || []) as Array<{ id: string; pace_profile: { marathonGoal?: number | null } | null }>)
      .map((g) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null })), (who.data as { group_id?: string | null } | null)?.group_id);
    const packIndex = ({ group1: 0, group2: 1, group3: 2 } as Record<string, number>)[key] ?? 0;
    const read = (r: Row) => readWorkout(normalizeStoredLaps(r.laps as never) as never, r.executed_workout as { steps?: WStep[] } | null, packIndex);
    const facts = (r: Row, w: Workout | null) => ({
      quality: !!w && w.reps.length > 0,
      repLen: w?.reps[0]?.meters ?? 0,
      repCount: w?.reps.length ?? 0,
      distanceM: Number(r.distance) || 0,
    });

    const todayW = read(todayRow);
    const todayFacts = facts(todayRow, todayW);
    const kind = todayFacts.quality ? 'quality' : 'easy';

    const startMs = Date.parse(String(todayRow.start_time).slice(0, 19) + 'Z');
    const { data: past, error: pastErr } = await supabase.from('athlete_activities').select(SELECT)
      .eq('athlete_id', todayRow.athlete_id).neq('id', id)
      .gte('start_time', new Date(startMs - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10))
      .lt('start_time', String(todayRow.start_time))
      .order('start_time', { ascending: false }).limit(400);
    if (pastErr) return NextResponse.json({ error: 'Failed to read history', details: pastErr.message }, { status: 500 });

    // Newest first, so the cap keeps the most recent matches; then put in date order.
    const picked: SimilarSession[] = [];
    for (const r of (past || []) as unknown as Row[]) {
      if (picked.length >= MAX_SESSIONS) break;
      if (!isRun(r.activity_type)) continue;
      const w = read(r);
      if (matchesScope(scope, todayFacts, facts(r, w))) picked.push(shape(r, w, hideHr));
    }
    picked.sort((a, b) => a.date.localeCompare(b.date));
    const sessions: SimilarSession[] = [...picked, { ...shape(todayRow, todayW, hideHr), today: true }];

    // Pace-at-HR only for an easy run, only for the ≤9 rows returned, in one read.
    if (kind === 'easy' && !hideHr) {
      const { data: streams } = await supabase.from('activity_streams').select('activity_id, series').in('activity_id', sessions.map((s) => s.id));
      const byId = new Map(((streams || []) as Array<{ activity_id: string; series: unknown }>).map((s) => [s.activity_id, s.series]));
      for (const s of sessions) s.paceAtHr = paceAtHrOf(byId.get(s.id) as never);
    }

    return NextResponse.json({ kind, scope, sessions, masked: false });
  } catch (error: any) {
    console.error('[activities/similar] failed:', error);
    return NextResponse.json(internalErrorBody('Failed'), { status: 500 });
  }
}
