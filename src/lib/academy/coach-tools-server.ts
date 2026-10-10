/**
 * The reads and writes behind the coach tools (lib/academy/coach-tools.ts decides; this
 * fetches and saves). Server-only.
 *
 * Every read degrades rather than throws, the academy's rule: the tables are migrated by
 * hand, and migration 141 (`academy_coach_decisions`) ships AFTER this code. Without it the
 * suggestions still appear and a pace update still re-resolves the planned weeks; what is
 * missing is the record — no "your coach updated your paces" card, no cross-device snooze,
 * and later copies do not know about the update. `stored: false` says so to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { revalidateWeeklyPlans } from '@/lib/plans/cache';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import type { ParsedWorkout } from '@/lib/ai/types';
import { thresholdPaceSec } from './tests';
import { computeAcademyWeekAdherence, type WorkoutAdherenceRow } from './report';
import { complianceOf } from './compliance';
import { loadAcademySettings } from './settings-server';
import type { PaceUpdateCard } from './coach-tools-payload';
import {
  activeAdjust, applyPaceAdjust, isLongRun, paceKindOf, squareLabel,
  type CoachDecision, type DecisionKind, type PaceAdjust, type PaceSession, type TraineeNote, type WeekOfSessions,
} from './coach-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const DECISIONS_TABLE = 'academy_coach_decisions';

/** How many plan weeks back the evidence reaches (this week included). */
export const EVIDENCE_WEEKS = 6;

// ── The test each trainee is measured against ─────────────────────────────────────────

export interface TestBasis {
  thresholdSec: number;
  testDate: string;
}

/**
 * The newest approved, non-excluded 30-minute test per trainee — the same rule as
 * `loadThresholds` in book-server.ts, with its date, because the date is what resets the
 * suggestions.
 */
export async function loadTestBasis(supabase: Db, athleteIds: string[]): Promise<Record<string, TestBasis | null>> {
  const out: Record<string, TestBasis | null> = Object.fromEntries(athleteIds.map(id => [id, null]));
  if (!athleteIds.length) return out;
  const read = (columns: string) => supabase
    .from('academy_tests')
    .select(columns)
    .in('athlete_id', athleteIds)
    .eq('protocol', '30min')
    .order('test_date', { ascending: false });
  let { data, error }: { data: any[] | null; error: unknown } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason, status');
  if (error && isMissingColumn(error)) {
    ({ data, error } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason'));
  }
  if (error || !data) return out;
  for (const row of data as any[]) {
    if (out[row.athlete_id]) continue;
    if (row.excluded_reason) continue;
    if ((row.status ?? 'approved') !== 'approved') continue;
    const pace = thresholdPaceSec({ durationSec: row.duration_sec, distanceM: row.distance_m });
    if (pace && pace > 0) out[row.athlete_id] = { thresholdSec: Math.round(pace), testDate: String(row.test_date).slice(0, 10) };
  }
  return out;
}

// ── Decisions (migration 141) ─────────────────────────────────────────────────────────

export async function loadDecisions(supabase: Db, athleteIds: string[]): Promise<{ stored: boolean; rows: CoachDecision[] }> {
  if (!athleteIds.length) return { stored: true, rows: [] };
  try {
    const { data, error } = await supabase
      .from(DECISIONS_TABLE)
      .select('athlete_id, kind, action, basis_test_date, week_start, changes, reason, created_at, coach:athletes!coach_id(name)')
      .in('athlete_id', athleteIds)
      .order('created_at', { ascending: true });
    if (error) {
      if (!isMissingTable(error)) console.error('academy_coach_decisions read failed:', error);
      return { stored: false, rows: [] };
    }
    return {
      stored: true,
      rows: ((data || []) as any[]).map(r => ({
        athleteId: String(r.athlete_id),
        kind: r.kind as DecisionKind,
        action: String(r.action),
        basisTestDate: r.basis_test_date ? String(r.basis_test_date).slice(0, 10) : null,
        weekStart: r.week_start ? String(r.week_start).slice(0, 10) : null,
        changes: (r.changes && typeof r.changes === 'object' ? r.changes : null) as PaceAdjust | null,
        reason: r.reason ?? null,
        createdAt: String(r.created_at),
        coachName: (Array.isArray(r.coach) ? r.coach[0]?.name : r.coach?.name) ?? null,
      })),
    };
  } catch (err) {
    console.error('academy_coach_decisions read threw:', err);
    return { stored: false, rows: [] };
  }
}

export interface DecisionRow {
  athleteId: string;
  coachId: string | null;
  kind: DecisionKind;
  action: string;
  basisTestDate: string | null;
  weekStart: string | null;
  changes?: PaceAdjust | null;
  /** What the trainee card and the history say: structured, the words are the client's. */
  evidence?: unknown;
}

/** True when written; false when 141 is not there (or the write failed — logged). */
export async function recordDecision(supabase: Db, row: DecisionRow): Promise<boolean> {
  try {
    const { error } = await supabase.from(DECISIONS_TABLE).insert({
      athlete_id: row.athleteId,
      coach_id: row.coachId,
      kind: row.kind,
      action: row.action,
      basis_test_date: row.basisTestDate,
      week_start: row.weekStart,
      changes: row.changes ?? {},
      evidence: row.evidence ?? {},
    });
    if (error) {
      if (!isMissingTable(error)) console.error('academy_coach_decisions write failed:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('academy_coach_decisions write threw:', err);
    return false;
  }
}

// ── Evidence: the last weeks, graded ──────────────────────────────────────────────────

export interface TraineeEvidence {
  /** Own-plan weeks only, newest first. */
  weeks: WeekOfSessions[];
  /** Completed sessions with a readable work pace, for the pace detector. */
  paceSessions: PaceSession[];
}

/** The pace of the work as run against the band it was planned in, as the week board reads it. */
function workReading(row: WorkoutAdherenceRow): { planned: number; actual: number } | null {
  const wp = row.workPace;
  if (wp && wp.actual > 0 && wp.min > 0) {
    // The week board's guard: a reading off the warmup is not the work.
    if (row.pace.plannedMin == null || Math.abs(wp.min - row.pace.plannedMin) <= 10) {
      return { planned: (wp.min + (wp.max || wp.min)) / 2, actual: wp.actual };
    }
  }
  // The rep search's reading of the WORK band (workPaceOf takes the first verifiable block,
  // which on a structured session is the warmup): the requirement written at the work band.
  const work = row.pace.plannedMin
    ? (row.detail?.efforts?.requirements ?? []).find(q => q.verifiable && q.paces.length > 0
      && Math.abs(q.paceMin - (row.pace.plannedMin as number)) <= 10)
    : null;
  if (work) {
    return { planned: (work.paceMin + work.paceMax) / 2, actual: work.paces.reduce((a, b) => a + b, 0) / work.paces.length };
  }
  if (row.pace.actual && row.pace.plannedMin && row.pace.comparedMin != null && row.pace.comparedMin === row.pace.plannedMin) {
    return { planned: (row.pace.plannedMin + (row.pace.plannedMax ?? row.pace.plannedMin)) / 2, actual: row.pace.actual };
  }
  return null;
}

/**
 * The last `EVIDENCE_WEEKS` plan weeks of these trainees, graded by the same engine as the
 * week board (so a red square here is the red strip there), reduced to what the detectors
 * read. Only weeks the trainee has their OWN plan in: a club week is graded against a
 * squad's lane, not against this trainee's paces.
 */
export async function loadEvidence(
  supabase: Db,
  athleteIds: string[],
  thresholds: Record<string, number | null>,
  today = israelToday(),
): Promise<Record<string, TraineeEvidence>> {
  const out: Record<string, TraineeEvidence> = Object.fromEntries(athleteIds.map(id => [id, { weeks: [], paceSessions: [] }]));
  if (!athleteIds.length) return out;
  const thisWeek = planWeekStartOf(today);
  const weeks = Array.from({ length: EVIDENCE_WEEKS }, (_, i) => addDaysToDateStr(thisWeek, -7 * i));

  const { data: own } = await supabase
    .from('weekly_plans')
    .select('athlete_id, week_start_date')
    .in('athlete_id', athleteIds)
    .gte('week_start_date', weeks[weeks.length - 1])
    .lte('week_start_date', thisWeek);
  const hasOwn = new Set(((own || []) as any[]).map(r => `${r.athlete_id}:${String(r.week_start_date).slice(0, 10)}`));

  const reports = await Promise.all(weeks.map(weekStart => computeAcademyWeekAdherence({
    weekStart, onlyAthleteIds: athleteIds, keepDetail: true,
  }).catch((err) => { console.error('coach-tools evidence week failed:', weekStart, err); return null; })));

  reports.forEach((report, wi) => {
    const weekStart = weeks[wi];
    for (const a of report?.athletes ?? []) {
      if (!hasOwn.has(`${a.athleteId}:${weekStart}`)) continue;
      const T = thresholds[a.athleteId] ?? null;
      const bucket = out[a.athleteId];
      if (!bucket) continue;
      const sessions = a.week.workouts.map((row) => {
        const raw = row.detail?.workout;
        const plannedM = (row.distance.plannedMin + row.distance.plannedMax) / 2 || null;
        const color = complianceOf({
          date: row.date,
          today,
          completed: row.completed,
          plannedM,
          actualM: row.distance.actual,
          plannedSec: row.duration.planned || null,
          actualSec: row.duration.actual,
          plannedInTime: !row.duration.estimated && !(plannedM && plannedM > 0),
        }).color;
        if (row.completed && T) {
          const reading = workReading(row);
          if (reading) {
            bucket.paceSessions.push({
              date: row.date,
              kind: paceKindOf(reading.planned, T),
              plannedSec: Math.round(reading.planned),
              actualSec: Math.round(reading.actual),
              avgHr: row.actual?.averageHr ?? null,
            });
          }
        }
        return {
          date: row.date,
          dayOfWeek: new Date(`${row.date}T12:00:00Z`).getUTCDay(),
          label: raw ? squareLabel(raw, T) : row.name,
          color,
          isLong: raw ? isLongRun(raw, T) : false,
          plannedM,
        };
      });
      bucket.weeks.push({ weekStart, sessions });
    }
  });
  return out;
}

// ── The trainee's own words ───────────────────────────────────────────────────────────

/**
 * What a trainee wrote recently: the comments and pain flags on their runs, and their
 * messages in those threads. (The academy chat lives in Stream; it is not read here, so a
 * note written only in the chat does not preselect — the coach still reads it there.)
 */
export async function loadNotes(supabase: Db, athleteIds: string[], sinceIso: string): Promise<Record<string, TraineeNote[]>> {
  const out: Record<string, TraineeNote[]> = Object.fromEntries(athleteIds.map(id => [id, []]));
  if (!athleteIds.length) return out;
  const [fb, msgs] = await Promise.all([
    supabase.from('workout_feedback')
      .select('id, athlete_id, comment, pain, pain_detail, created_at')
      .in('athlete_id', athleteIds)
      .gte('created_at', sinceIso),
    supabase.from('workout_feedback_messages')
      .select('sender_athlete_id, body, created_at')
      .in('sender_athlete_id', athleteIds)
      .gte('created_at', sinceIso),
  ]);
  for (const r of (fb.error ? [] : fb.data || []) as any[]) {
    const text = [r.comment, r.pain_detail].filter(Boolean).join(' · ');
    if (text || r.pain) out[r.athlete_id]?.push({ text: text || '', at: String(r.created_at), pain: !!r.pain });
  }
  for (const r of (msgs.error ? [] : msgs.data || []) as any[]) {
    if (r.body) out[r.sender_athlete_id]?.push({ text: String(r.body), at: String(r.created_at) });
  }
  return out;
}

// ── Writing a week ────────────────────────────────────────────────────────────────────

export interface WeekWrite {
  athleteId: string;
  weekStart: string;
  /** The whole week as it should be stored. */
  workouts: ParsedWorkout[];
  /** The days to (re)send to the watch. Empty = save only. */
  pushDays: number[];
}

export interface WeekWriteResult {
  athleteId: string;
  weekStart: string;
  status: 'sent' | 'saved' | 'failed';
  /** Where a failure happened: the plan row, or the watch (the plan is saved). */
  stage?: 'save' | 'push';
  detail?: string | null;
}

/** The newest plan row of a trainee's week (the one adherence and the watch read). */
async function planRowOf(supabase: Db, athleteId: string, weekStart: string): Promise<{ id: string; workouts: ParsedWorkout[]; status: string | null } | null> {
  const { data } = await supabase
    .from('weekly_plans')
    .select('id, parsed_workouts, status, created_at')
    .eq('coach_id', COACH_ID)
    .eq('athlete_id', athleteId)
    .eq('week_start_date', weekStart)
    .order('created_at', { ascending: false })
    .limit(1);
  const row = (data || [])[0] as any;
  if (!row) return null;
  const workouts = (row.parsed_workouts as { workouts?: ParsedWorkout[] } | null)?.workouts;
  return { id: String(row.id), workouts: Array.isArray(workouts) ? workouts : [], status: row.status ?? null };
}

/**
 * Save one trainee's week (update the newest row, else insert) and send the asked days
 * through `pushWeekToAthlete` — the same door as the book's send and "לשלוח שוב".
 */
export async function writeWeek(supabase: Db, write: WeekWrite, opts: { cleanDayOnce?: boolean } = {}): Promise<WeekWriteResult> {
  const parsed = normalizeParsedWorkouts({ workouts: write.workouts });
  const existing = await planRowOf(supabase, write.athleteId, write.weekStart);
  const saved = existing
    ? await supabase.from('weekly_plans').update({ parsed_workouts: parsed }).eq('id', existing.id).select('id').single()
    : await supabase.from('weekly_plans').insert({
      coach_id: COACH_ID,
      week_start_date: write.weekStart,
      original_input: '[built in-app]',
      parsed_workouts: parsed,
      status: 'draft',
      athlete_id: write.athleteId,
    }).select('id').single();
  if (saved.error || !saved.data) {
    return { athleteId: write.athleteId, weekStart: write.weekStart, status: 'failed', stage: 'save', detail: saved.error?.message ?? null };
  }
  const planId = String(saved.data.id);
  revalidateWeeklyPlans();
  const days = new Set(write.pushDays);
  const toSend = parsed.workouts.filter(w => days.has(w.dayOfWeek));
  if (!toSend.length) return { athleteId: write.athleteId, weekStart: write.weekStart, status: 'saved' };

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, garmin_auth, is_academy, group_id, groups!group_id(pace_profile)')
    .eq('id', write.athleteId)
    .maybeSingle();
  if (!(athlete as any)?.garmin_auth) return { athleteId: write.athleteId, weekStart: write.weekStart, status: 'saved' };
  const settings = await loadAcademySettings();
  const push = await pushWeekToAthlete({
    supabase: supabase as any,
    athlete: athlete as any,
    plannedWorkouts: toSend,
    weekStartDate: write.weekStart,
    planId,
    paceTarget: !!(athlete as any).is_academy && settings.paceAlerts,
    cleanDayOnce: !!opts.cleanDayOnce,
  });
  if (push.status === 'success') {
    const others = parsed.workouts.some(w => !days.has(w.dayOfWeek));
    await supabase.from('weekly_plans').update({ status: others ? 'partial' : 'pushed' }).eq('id', planId);
    return { athleteId: write.athleteId, weekStart: write.weekStart, status: 'sent' };
  }
  return { athleteId: write.athleteId, weekStart: write.weekStart, status: 'failed', stage: 'push', detail: push.error ?? null };
}

/** Days of a week from `today` on: a session already past is history, not a plan. */
export function daysFrom(weekStart: string, today: string): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter(d => addDaysToDateStr(weekStart, d) >= today);
}

/**
 * A pace update reaching the plan: every stored week from `fromWeek` on, each session at
 * the `target` update (idempotent, coach-tools.ts `applyPaceAdjust`), and the sessions
 * already on the watch sent again so the watch has the new paces too.
 */
export async function reresolveFuturePlans(supabase: Db, input: {
  athleteId: string;
  fromWeek: string;
  thresholdSec: number;
  target: PaceAdjust;
  today?: string;
  cleanDayOnce?: boolean;
}): Promise<{ weeks: string[]; sent: number; failed: number }> {
  const today = input.today ?? israelToday();
  const { data } = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .eq('athlete_id', input.athleteId)
    .gte('week_start_date', input.fromWeek)
    .order('created_at', { ascending: false });
  const newest = new Map<string, any>();
  for (const r of (data || []) as any[]) {
    const w = String(r.week_start_date).slice(0, 10);
    if (!newest.has(w)) newest.set(w, r);
  }
  const weeks: string[] = [];
  let sent = 0, failed = 0;
  for (const [weekStart, row] of newest) {
    const workouts = ((row.parsed_workouts as { workouts?: ParsedWorkout[] } | null)?.workouts) ?? [];
    if (!workouts.length) continue;
    const next = workouts.map(w => applyPaceAdjust(w, input.thresholdSec, input.target));
    // Saved when any marker moved; sent again only where a pace actually changed (an easy
    // run under a reps update keeps its paces and just records the update it is at).
    if (next.every((w, i) => w === workouts[i])) continue;
    const changedDays = next
      .filter((w, i) => JSON.stringify(w.steps) !== JSON.stringify(workouts[i].steps))
      .map(w => w.dayOfWeek);
    // Only what is already on the watch goes again; a draft week stays a draft.
    const { data: deliveries } = await supabase
      .from('workout_deliveries')
      .select('workout_date, status')
      .eq('plan_id', row.id)
      .eq('athlete_id', input.athleteId);
    const onWatch = new Set(((deliveries || []) as any[]).filter(d => d.status === 'success').map(d => String(d.workout_date).slice(0, 10)));
    const pushDays = changedDays.filter(d => {
      const date = addDaysToDateStr(weekStart, d);
      return date >= today && onWatch.has(date);
    });
    const res = await writeWeek(supabase, { athleteId: input.athleteId, weekStart, workouts: next, pushDays }, { cleanDayOnce: input.cleanDayOnce });
    weeks.push(weekStart);
    if (res.status === 'sent') sent += pushDays.length;
    if (res.status === 'failed') failed += 1;
  }
  return { weeks: weeks.sort(), sent, failed };
}

/** Workouts per week for these trainees over these weeks (the newest row of each). */
export async function weekCounts(supabase: Db, athleteIds: string[], weeks: string[]): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = Object.fromEntries(athleteIds.map(id => [id, {}]));
  if (!athleteIds.length || !weeks.length) return out;
  const { data } = await supabase
    .from('weekly_plans')
    .select('athlete_id, week_start_date, parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .in('athlete_id', athleteIds)
    .in('week_start_date', weeks)
    .order('created_at', { ascending: false });
  const seen = new Set<string>();
  for (const r of (data || []) as any[]) {
    const w = String(r.week_start_date).slice(0, 10);
    const key = `${r.athlete_id}:${w}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = ((r.parsed_workouts as { workouts?: unknown[] } | null)?.workouts ?? []).length;
    if (out[r.athlete_id]) out[r.athlete_id][w] = n;
  }
  return out;
}

// ── The trainee's card ────────────────────────────────────────────────────────────────

/** The card shows from the update until two weeks after it took effect. */
export const CARD_WEEKS = 2;

/**
 * "<coach> עדכן את הקצבים שלך" for the trainee's academy home, or null: the newest pace
 * update made against their current test, while it is fresh. Never throws — the home must
 * load without 141.
 */
export async function loadPaceUpdateCard(supabase: Db, athleteId: string, today = israelToday()): Promise<{
  card: PaceUpdateCard | null;
  adjust: PaceAdjust;
  fromWeek: string | null;
}> {
  const none = { card: null, adjust: {}, fromWeek: null };
  try {
    const [basis, decided] = await Promise.all([loadTestBasis(supabase, [athleteId]), loadDecisions(supabase, [athleteId])]);
    const b = basis[athleteId];
    if (!b || !decided.stored) return none;
    const now = activeAdjust(decided.rows, b.testDate);
    if (!now.last || !now.fromWeek) return none;
    const live = today >= now.fromWeek ? now : { ...now, adjust: {} };
    const { data } = await supabase
      .from(DECISIONS_TABLE)
      .select('evidence, created_at, week_start, coach:athletes!coach_id(name)')
      .eq('athlete_id', athleteId)
      .eq('kind', 'pace')
      .in('action', ['apply', 'half'])
      .eq('basis_test_date', b.testDate)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = (data || [])[0] as any;
    const until = addDaysToDateStr(now.fromWeek, 7 * CARD_WEEKS);
    if (!row || today >= until) return { card: null, adjust: live.adjust, fromWeek: now.fromWeek };
    const ev = (row.evidence ?? {}) as { direction?: string; moved?: number; of?: number; kinds?: Array<{ kind: string; fromSec: number; toSec: number }> };
    const kinds = (ev.kinds ?? [])
      .filter(k => ['reps', 'tempo', 'easy'].includes(k.kind) && k.fromSec > 0 && k.toSec > 0 && k.fromSec !== k.toSec)
      .map(k => ({ kind: k.kind as 'reps' | 'tempo' | 'easy', fromSec: Math.round(k.fromSec), toSec: Math.round(k.toSec) }));
    if (!kinds.length) return { card: null, adjust: live.adjust, fromWeek: now.fromWeek };
    return {
      card: {
        coachName: (Array.isArray(row.coach) ? row.coach[0]?.name : row.coach?.name) ?? null,
        createdAt: String(row.created_at),
        fromWeek: String(row.week_start).slice(0, 10),
        direction: ev.direction === 'slower' ? 'slower' : 'faster',
        moved: Number(ev.moved) || 0,
        of: Number(ev.of) || 0,
        kinds,
      },
      adjust: live.adjust,
      fromWeek: now.fromWeek,
    };
  } catch (err) {
    console.error('pace update card failed:', err);
    return none;
  }
}

/**
 * The pace update in force for each trainee in the plan week `weekStart` — what the book's
 * day flow resolves with. `{}` before the week the update applies from, without migration
 * 139, or on any failed read: the book then resolves exactly as it always has.
 */
export async function loadPaceAdjusts(supabase: Db, athleteIds: string[], weekStart: string): Promise<Record<string, PaceAdjust>> {
  const out: Record<string, PaceAdjust> = Object.fromEntries(athleteIds.map(id => [id, {}]));
  if (!athleteIds.length) return out;
  try {
    const [basis, decided] = await Promise.all([loadTestBasis(supabase, athleteIds), loadDecisions(supabase, athleteIds)]);
    if (!decided.stored || !decided.rows.length) return out;
    for (const id of athleteIds) {
      const a = activeAdjust(decided.rows.filter(d => d.athleteId === id), basis[id]?.testDate ?? null);
      if (a.fromWeek && weekStart >= a.fromWeek) out[id] = a.adjust;
    }
  } catch (err) {
    console.error('pace adjusts read failed (resolving without them):', err);
  }
  return out;
}
