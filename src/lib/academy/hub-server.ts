/**
 * Reader for GET /api/academy/hub. Every optional table degrades to empty (migrations are
 * hand-applied); the rules live in service-promises / capacity / hub so coach and manager
 * counts come from one function.
 */
import { createServerClient } from '@/lib/supabase/server';
import { getPlanWeekStart, shiftWeekStart, getActivityWeekStart } from '@/lib/utils';
import { coachIdsByTrainee } from './trainee-coaches';
import { monthKey } from '@/lib/finance/summary';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import {
  traineePromises, countPromises, oldestUnansweredHours, daysSinceContact, medianReplyHours, planDeadline,
  type TraineePromises, type PromiseCounts,
} from './service-promises';
import { capacityOf, loadState, type LoadState } from './capacity';
import { pipeline, roundBuckets, type HubView, type PipelineCounts } from './hub';

type Db = ReturnType<typeof createServerClient>;

export interface HubTrainee extends TraineePromises {
  name: string;
  coachIds: string[];
  paused: boolean;
  pauseReason: string | null;
  waitingHours: number | null;
  daysSinceContact: number | null;
  hasNextPlan: boolean;
  painOpen: boolean;
}

export interface HubCoach {
  id: string; name: string; active: number; capacity: number; state: LoadState; broken: number;
}

export interface HubPayload {
  view: HubView;
  views: HubView[];
  weekStart: string;
  nextWeekStart: string;
  nextWeekDeadline: string;
  trainees: HubTrainee[];
  counts: PromiseCounts;
  coaches?: HubCoach[];
  pipeline?: PipelineCounts;
  roundBuckets?: Array<{ fromSec: number; count: number }>;
  /** Manager only (doc p.3–4 "שייכות ושימור"): counts, never names or amounts. */
  retention?: RetentionCounts;
  me?: TraineeSelf;
}

export interface RetentionCounts {
  /** Active (not paused) trainees this month. */
  active: number;
  /** Of them, a payment is recorded for this month (academy_payments.period). */
  paidThisMonth: number;
  /** Of them, registered to a club event dated this month (Zoom, community event, race). */
  attendedEventThisMonth: number;
}

/** Pure: the three counts from the active ids and two id sets. */
export function retentionCounts(activeIds: string[], paid: Set<string>, attended: Set<string>): RetentionCounts {
  return {
    active: activeIds.length,
    paidThisMonth: activeIds.filter((id) => paid.has(id)).length,
    attendedEventThisMonth: activeIds.filter((id) => attended.has(id)).length,
  };
}

export interface TraineeSelf {
  coach: { id: string; name: string; medianReplyHours: number | null; lastWroteAt: string | null } | null;
  reportOpenFor: string | null;
  lastReport: { workoutDate: string; readAt: string | null; planAdjustedAfter: boolean } | null;
  nextWeekReady: boolean;
  watch: 'pushed' | 'pending' | 'not_connected';
  benchmarks: Array<{ date: string; seconds: number }>;
  weeklyKm: Array<{ weekStart: string; km: number }>;
}

async function safe<T>(p: PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  try { const r = await p; return r.error ? fallback : (r.data ?? fallback); } catch { return fallback; }
}

export async function readHub(opts: {
  view: HubView; views: HubView[]; callerId: string | null; scope: Set<string> | null; now?: Date;
}): Promise<HubPayload> {
  const supabase: Db = createServerClient();
  const now = opts.now ?? new Date();
  const weekStart = getPlanWeekStart(now);
  const nextWeekStart = shiftWeekStart(weekStart, 1);

  // Who is in this view: a trainee sees only themself; a coach their pairs; a manager everyone.
  let athletes = await safe<any[]>(
    supabase.from('athletes').select('id, name, availability, academy_pause_reason, academy_capacity, role, extra_roles, garmin_auth:has_garmin, created_at').eq('is_academy', true),
    [],
  );
  if (!athletes.length) {
    athletes = await safe<any[]>(supabase.from('athletes').select('id, name, garmin_auth:has_garmin, created_at').eq('is_academy', true), []);
  }
  const inView = athletes.filter((a) =>
    opts.view === 'trainee' ? a.id === opts.callerId : (opts.scope == null || opts.scope.has(a.id)));
  const ids = inView.map((a) => a.id as string);
  const links = ids.length ? await coachIdsByTrainee(supabase, ids) : new Map<string, string[]>();

  const [plans, reports, coachFb] = ids.length ? await Promise.all([
    safe<any[]>(supabase.from('weekly_plans').select('id, athlete_id, week_start_date, created_at').in('athlete_id', ids).gte('week_start_date', shiftWeekStart(weekStart, -12)), []),
    safe<any[]>(supabase.from('academy_trainee_reports').select('athlete_id, workout_date, pain, created_at, read_at').in('athlete_id', ids).gte('created_at', new Date(now.getTime() - 60 * 86400000).toISOString()), []),
    safe<any[]>(supabase.from('academy_workout_feedback').select('athlete_id, author_id, created_at, sent_at').in('athlete_id', ids).gte('created_at', new Date(now.getTime() - 60 * 86400000).toISOString()), []),
  ]) : [[], [], []];

  const by = <T extends { athlete_id: string }>(rows: T[], id: string) => rows.filter((r) => r.athlete_id === id);
  const trainees: HubTrainee[] = inView.map((a) => {
    const coachIds = links.get(a.id) || [];
    const myReports = by(reports, a.id);
    const replies = by(coachFb, a.id).map((f) => f.sent_at || f.created_at);
    const waiting = oldestUnansweredHours(myReports.map((r) => r.created_at), replies, now);
    const last = replies.sort().at(-1) || null;
    const paused = a.availability === 'paused';
    const hasNextPlan = by(plans, a.id).some((p) => p.week_start_date === nextWeekStart);
    const input = { athleteId: a.id, coachIds, paused, hasNextPlan, waitingHours: waiting, daysSinceContact: daysSinceContact(last, now) };
    return {
      ...traineePromises(input, nextWeekStart, now),
      name: a.name, coachIds, paused, pauseReason: a.academy_pause_reason ?? null,
      waitingHours: waiting, daysSinceContact: input.daysSinceContact, hasNextPlan,
      painOpen: myReports.some((r) => r.pain && (!last || r.created_at > last)),
    };
  });

  const payload: HubPayload = {
    view: opts.view, views: opts.views, weekStart, nextWeekStart,
    nextWeekDeadline: planDeadline(nextWeekStart).toISOString(),
    trainees, counts: countPromises(trainees),
  };

  if (opts.view === 'manager') {
    const coachRows = athletes.length ? await safe<any[]>(
      supabase.from('athletes').select('id, name, academy_capacity').in('role', ['academy_coach', 'coach', 'admin']), []) : [];
    const active = new Map<string, number>();
    for (const t of trainees) if (!t.paused) for (const c of t.coachIds) active.set(c, (active.get(c) || 0) + 1);
    payload.coaches = coachRows
      .filter((c) => active.has(c.id) || c.academy_capacity != null)
      .map((c) => {
        const n = active.get(c.id) || 0; const cap = capacityOf(c.academy_capacity);
        return { id: c.id, name: c.name, active: n, capacity: cap, state: loadState(n, cap), broken: payload.counts.byCoach[c.id] || 0 };
      });
    const registered = await safe<any[]>(supabase.from('academy_candidates').select('id').is('accepted_at', null), []);
    payload.pipeline = pipeline(trainees.map((t) => ({ coachIds: t.coachIds, paused: t.paused, hasAnyPlan: by(plans, t.athleteId).length > 0 })), registered.length);
    const tests = await safe<any[]>(supabase.from('benchmark_results').select('athlete_id, time_seconds, test_name').in('athlete_id', ids), []);
    payload.roundBuckets = roundBuckets(tests.filter((t) => /2000/.test(String(t.test_name || ''))).map((t) => Number(t.time_seconds)));
    // Retention (doc p.3 "שייכות ושימור"): payment recorded this month + an event this month. Both reads
    // degrade to empty (tables hand-migrated); the counts then read 0, never an error.
    const activeIds = trainees.filter((t) => !t.paused).map((t) => t.athleteId);
    // The calendar month we're in, not the month of the plan week's Sunday (wrong on the 1st-6th).
    const month = monthKey(now);   // Israel calendar month; academy_payments.period is a DATE (YYYY-MM-01)
    const [y, m] = month.split('-').map(Number);
    const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;   // a real date, not "-31"
    const paidRows = activeIds.length ? await safe<any[]>(supabase.from('academy_payments').select('athlete_id').eq('period', `${month}-01`).in('athlete_id', activeIds), []) : [];
    const monthEvents = await safe<any[]>(supabase.from('events').select('id').gte('date', `${month}-01`).lt('date', nextMonth), []);
    const regRows = activeIds.length && monthEvents.length
      ? await safe<any[]>(supabase.from('event_registrations').select('athlete_id').eq('status', 'registered')
        .in('event_id', monthEvents.map((e) => e.id)).in('athlete_id', activeIds), [])
      : [];
    payload.retention = retentionCounts(activeIds, new Set(paidRows.map((r) => String(r.athlete_id))), new Set(regRows.map((r) => String(r.athlete_id))));
  }

  if (opts.view === 'trainee' && opts.callerId) payload.me = await readSelf(supabase, opts.callerId, inView[0], trainees[0], reports, coachFb, plans, now, weekStart);
  return payload;
}

async function readSelf(
  supabase: Db, id: string, row: any, t: HubTrainee | undefined, reports: any[], coachFb: any[], plans: any[], now: Date, weekStart: string,
): Promise<TraineeSelf> {
  const coachId = t?.coachIds[0] ?? null;
  const coach = coachId ? await safe<any>(supabase.from('athletes').select('id, name').eq('id', coachId).maybeSingle(), null) : null;
  const pairs = reports.map((r) => {
    const reply = coachFb.map((f) => f.sent_at || f.created_at).filter((x) => x >= r.created_at).sort()[0];
    return reply ? { reportAt: r.created_at, replyAt: reply } : null;
  }).filter(Boolean) as Array<{ reportAt: string; replyAt: string }>;
  const lastReport = [...reports].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const planAfter = lastReport ? plans.some((p) => p.week_start_date === weekStart && p.created_at > lastReport.created_at) : false;
  const nextReady = !!t?.hasNextPlan;
  const delivered = await safe<any[]>(supabase.from('workout_deliveries').select('status').eq('athlete_id', id).gte('workout_date', weekStart), []);
  const watch = !row?.garmin_auth ? 'not_connected' : delivered.some((d) => d.status === 'sent' || d.status === 'delivered') ? 'pushed' : 'pending';
  const benchmarks = (await safe<any[]>(supabase.from('benchmark_results').select('recorded_on, time_seconds, test_name').eq('athlete_id', id).order('recorded_on'), []))
    .filter((b) => /2000/.test(String(b.test_name || ''))).map((b) => ({ date: b.recorded_on, seconds: Number(b.time_seconds) }));
  let weeklyKm: TraineeSelf['weeklyKm'] = [];
  try {
    const v = await fetchWeeklyVolume(supabase, { athleteIds: [id], weeks: 12, currentWeekStart: getActivityWeekStart(now) });
    weeklyKm = (v.byAthlete.get(id) || []).map((w) => ({ weekStart: w.weekStart, km: Math.round(w.meters / 100) / 10 }));
  } catch { /* volume is decoration on this screen */ }
  return {
    coach: coach ? { id: coach.id, name: coach.name, medianReplyHours: medianReplyHours(pairs), lastWroteAt: coachFb.map((f) => f.sent_at || f.created_at).sort().at(-1) ?? null } : null,
    reportOpenFor: null,
    lastReport: lastReport ? { workoutDate: lastReport.workout_date, readAt: lastReport.read_at ?? null, planAdjustedAfter: planAfter } : null,
    nextWeekReady: nextReady,
    watch,
    benchmarks,
    weeklyKm,
  };
}
