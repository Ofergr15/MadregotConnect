/**
 * The query layer behind GET /api/coach/roster — one payload for סקירה and רצים.
 *
 * Grading is not re-implemented: plans go through `extractWorkouts` /
 * `plannedForWeek` (report.ts, same lane resolution as the compliance table),
 * every week through `assessWeek` with the coach's tolerances and the matcher's
 * attribution, and a quality session's pace through `resolveDominantPace` — the
 * function the feed badge and the run detail use — on stored laps and the
 * watch's own step list. The rules that turn those grades into flags are in
 * `attention.ts` (pure, tested).
 *
 * Every read is paged or bounded (Supabase caps a select at 1000 rows and
 * reports the cut as success). Kilometres come from `fetchWeeklyVolume`, never
 * from `weekly_km_snapshots`.
 */

import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import {
  activityLocalDateStr, activityWeekOfPlanWeek, addDaysToDateStr, getActivityWeekStart, israelDateAnchor,
  israelToday, memberPackName, planWeekStartOf, resolveGroup, shiftWeekStart,
} from '@/lib/utils';
import { assessWeek, type ActualActivity, type PlannedWorkout, type WorkoutAdherence } from '@/lib/academy/adherence';
import { extractWorkouts, plannedForWeek } from '@/lib/academy/report';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { withoutTwins } from '@/lib/academy/twins';
import { isMissingMatchesTable } from '@/lib/plans/match-athlete-activities';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { gradePlanBlocks, traceFromLaps } from '@/lib/academy/execution';
import { dominantWatchStep, gradeWatchSteps } from '@/lib/academy/watch-steps';
import { resolveDominantPace } from '@/lib/plan-execution/dominant-pace';
import { stepLaps } from '@/lib/plan-execution/resolve';
import type { ExecutedWorkout } from '@/lib/garmin/executed-workout';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { Lane } from '@/lib/academy/group-lane';
import { ROUTED_KINDS, routingMatrix, ROUTABLE_ROLES } from '@/lib/notifications/routing';
import {
  attentionRank, BAND_WEEKS, clubKmToDate, clubTotals, compareAttention, easyTooFast, isNewMember, isRepeatPain,
  missedStreak, normalizeAvailability, normalizeSetBy, painSpot, populationsOf, qualityTooSlow, sessionKind, stripCell,
  type Availability, type AvailabilitySetBy, type BandFlag, type ClubTotals, type GradedPaceSession, type StripState,
} from './attention';

type Db = ReturnType<typeof createServerClient>;

// ── Contract ─────────────────────────────────────────────────────────────────

export interface StripDay {
  dow: number;
  date: string;
  s: StripState;
  /** Km run that day (all runs), null when none. */
  km: number | null;
  plannedKm: number;
  name: string | null;
}

export interface RosterRunner {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** 1..3, or null for no club pack (academy-only / ungrouped). */
  squad: number | null;
  pack: string | null;
  /** The raw group label when it is a "SUB h:mm" name. */
  sub: string | null;
  groupId: string | null;
  academy: boolean;
  isNew: boolean;
  joined: string | null;
  availability: Availability;
  availabilitySetBy: AvailabilitySetBy | null;
  lists: string[];
  populations: string[];
  /** Plan week (Sun–Sat) km to date, and its targets. */
  planKm: number;
  toDateTarget: number;
  weekTarget: number;
  /** Activity week (Monday) km — equals fetchWeeklyVolume for that week. */
  kmWeek: number;
  strip: StripDay[];
  missedRun: number;
  lastRun: string | null;
  offBand: BandFlag | null;
  slowBand: BandFlag | null;
  pain: { date: string; detail: string | null; where: string | null; rpe: number | null; repeat: boolean } | null;
  weekExec: { done: number; of: number; pct: number | null };
  /** Per graded plan week, oldest first: assessWeek.avgScore as %, null before the runner joined. */
  accuracy: Array<{ week: string; pct: number | null; done: number; of: number }>;
  plannedToday: boolean;
  ranToday: boolean;
  todayName: string | null;
  attention: number;
}

export interface RosterPayload {
  meta: {
    today: string;
    planWeek: string;
    activityWeek: string;
    nextPlanWeek: string;
    bandWeeks: string[];
    listsAvailable: boolean;
    availabilityAvailable: boolean;
  };
  squads: Array<{ squad: number; pack: string; sub: string | null; groupId: string }>;
  lists: Array<{ id: string; name: string; note: string | null; count: number }>;
  club: ClubTotals & { km: number; kmPrevSamePoint: number; runners: number; todaySession: string | null };
  nextWeekPublished: boolean;
  routing: Array<{ kind: string; label: string; roles: string[] | null }>;
  runners: RosterRunner[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const r1 = (m: number) => Math.round(m / 100) / 10;
const midKm = (p: PlannedWorkout) => (p.distanceMin + p.distanceMax) / 2000;

const ATHLETE_COLS = 'id, name, avatar_url, group_id, is_academy, created_at, status, approved, role, groups!group_id(name)';

/** The athletes, with availability when migration 186 is in; without it, everyone is active. */
async function readAthletes(db: Db): Promise<{ rows: any[]; availability: boolean }> {
  const withAvail = await db
    .from('athletes')
    .select(`${ATHLETE_COLS}, availability, availability_set_by`)
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');
  if (!withAvail.error) return { rows: withAvail.data || [], availability: true };
  const plain = await db.from('athletes').select(ATHLETE_COLS).eq('coach_id', COACH_ID).eq('status', 'active');
  if (plain.error) throw plain.error;
  return { rows: plain.data || [], availability: false };
}

/** Lists and memberships; `null` when migration 186 isn't applied. */
export async function readLists(db: Db): Promise<{ lists: any[]; members: Array<{ list_id: string; athlete_id: string }> } | null> {
  const lists = await db.from('athlete_lists').select('id, name, note, created_at').order('created_at');
  if (lists.error) return null;
  const members = await db.from('athlete_list_members').select('list_id, athlete_id');
  if (members.error) return null;
  return { lists: lists.data || [], members: (members.data || []) as any[] };
}

/** Members who log in to the app (not a staff account with no training). */
function isRosterMember(a: any): boolean {
  if (a.approved === false) return false;
  return true;
}

/**
 * Pace of a completed QUALITY session over its dominant block / watch step, or
 * `unknown` when no stretch could be located. Never the whole-run average: when
 * `resolveDominantPace` returns no `paceScope`, this answers unknown.
 */
export function blockPaceOf(
  raw: ParsedWorkout,
  w: WorkoutAdherence,
  row: { laps: unknown; executed_workout?: unknown } | undefined,
  lane: Lane,
  paceSec: number,
): GradedPaceSession {
  const unknown: GradedPaceSession = { status: 'unknown', pace: null, bandMin: w.pace.plannedMin, bandMax: w.pace.plannedMax, date: w.date };
  if (!row) return unknown;
  const laps = normalizeStoredLaps(row.laps);
  const executed = (row.executed_workout as ExecutedWorkout | null) ?? null;
  const watched = executed ? gradeWatchSteps(executed, laps, lane, paceSec) : null;
  const trace = watched && dominantWatchStep(watched) ? null : traceFromLaps(laps);
  const blocks = trace ? gradePlanBlocks(flattenPlannedSteps(raw), trace, paceSec) : null;
  const ranLaps = executed ? stepLaps({ laps: row.laps, executed_workout: executed }, laps) : laps;
  if (ranLaps !== laps) return unknown; // same rule as the feed: the steps run aren't the plan's
  const { pace, paceScope } = resolveDominantPace(w.pace, watched, blocks);
  if (!paceScope) return unknown;
  return { status: pace.status, pace: pace.actual, bandMin: pace.plannedMin, bandMax: pace.plannedMax, date: w.date };
}

// ── The loader ───────────────────────────────────────────────────────────────

export async function computeRoster(
  db: Db,
  opts: { week?: string | null; now?: Date; onlyAthleteId?: string | null; weeksBack?: number } = {},
): Promise<RosterPayload> {
  const realToday = israelToday(opts.now);
  const currentPlanWeek = planWeekStartOf(realToday);
  const planWeek = opts.week ? planWeekStartOf(opts.week) : currentPlanWeek;
  const isCurrent = planWeek === currentPlanWeek;
  // A past week is closed: every day of it is judged.
  const today = isCurrent ? realToday : planWeek < currentPlanWeek ? addDaysToDateStr(planWeek, 6) : addDaysToDateStr(planWeek, -1);
  // The Monday week the coach is standing in — on a Sunday that is the week
  // closing tonight, not the Monday inside the new plan week.
  const activityWeek = isCurrent ? getActivityWeekStart(israelDateAnchor(opts.now)) : activityWeekOfPlanWeek(planWeek);
  const bandWeeks = Array.from({ length: BAND_WEEKS }, (_, i) => shiftWeekStart(planWeek, i - (BAND_WEEKS - 1)));
  // The weeks graded: at least the rule window, more for the runner page's accuracy bars.
  const nGraded = Math.max(BAND_WEEKS, opts.weeksBack ?? BAND_WEEKS);
  const gradedWeeks = Array.from({ length: nGraded }, (_, i) => shiftWeekStart(planWeek, i - (nGraded - 1)));
  const nextPlanWeek = shiftWeekStart(planWeek, 1);
  const from = gradedWeeks[0] < addDaysToDateStr(activityWeek, -7) ? gradedWeeks[0] : addDaysToDateStr(activityWeek, -7);
  const to = addDaysToDateStr(planWeek, 7) > addDaysToDateStr(activityWeek, 6) ? addDaysToDateStr(planWeek, 6) : addDaysToDateStr(activityWeek, 6);

  const [{ rows: athleteRows, availability: availabilityAvailable }, groupsRes, sharedRes, settings, listsRes, matrix] = await Promise.all([
    readAthletes(db),
    db.from('groups').select('id, name'),
    db
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .in('week_start_date', [...gradedWeeks, nextPlanWeek])
      .is('athlete_id', null)
      .order('created_at', { ascending: false }),
    loadAcademySettings(),
    readLists(db),
    routingMatrix(db).catch(() => null),
  ]);
  const tolerances = settings.tolerances;
  const athletes = athleteRows.filter(isRosterMember).filter((a) => !opts.onlyAthleteId || a.id === opts.onlyAthleteId);
  const ids = athletes.map((a) => a.id);
  const groupNames = new Map<string, string>(((groupsRes.data || []) as any[]).map((g) => [g.id, g.name]));

  const sharedByWeek = new Map<string, any>();
  for (const p of (sharedRes.data || []) as any[]) if (!sharedByWeek.has(p.week_start_date)) sharedByWeek.set(p.week_start_date, p);

  const [indivRows, actRows, feedbackRows, volume] = ids.length ? await Promise.all([
    fetchAllRows<any>((a, b) => db
      .from('weekly_plans')
      .select('id, athlete_id, week_start_date, parsed_workouts, created_at')
      .in('athlete_id', ids)
      .in('week_start_date', gradedWeeks)
      .order('created_at', { ascending: false })
      .range(a, b)).catch(() => []),
    fetchAllRows<any>((a, b) => db
      .from('athlete_activities')
      .select('id, athlete_id, start_time, distance, duration, moving_duration, average_pace, average_hr, activity_type, source')
      .in('athlete_id', ids)
      .gte('start_time', `${from}T00:00:00Z`)
      .lte('start_time', `${to}T23:59:59Z`)
      .order('id')
      .range(a, b)),
    fetchAllRows<any>((a, b) => db
      .from('workout_feedback')
      .select('athlete_id, pain, pain_detail, difficulty, created_at')
      .in('athlete_id', ids)
      .gte('created_at', `${addDaysToDateStr(today, -35)}T00:00:00Z`)
      .order('created_at', { ascending: false })
      .range(a, b)).catch(() => []),
    fetchWeeklyVolume(db, { athleteIds: ids, weeks: 1, currentWeekStart: activityWeek }),
  ]) : [[], [], [], { weeks: [activityWeek], byAthlete: new Map() }];

  const indivByKey = new Map<string, any>();
  for (const p of indivRows) {
    const key = `${p.athlete_id}|${p.week_start_date}`;
    if (!indivByKey.has(key)) indivByKey.set(key, p);
  }

  // Attribution from the matcher, for every plan in play.
  const planIds = [...new Set([...indivByKey.values(), ...sharedByWeek.values()].map((p) => p.id))];
  const attribution = new Map<string, Map<string, string[]>>(); // `${athlete}|${planId}` → key → ids
  if (planIds.length && ids.length) {
    const res = await fetchAllRows<any>((a, b) => db
      .from('activity_plan_matches')
      .select('athlete_id, weekly_plan_id, workout_key, activity_id')
      .in('athlete_id', ids)
      .in('weekly_plan_id', planIds)
      .range(a, b)).catch((e) => { if (!isMissingMatchesTable(e)) throw e; return []; });
    for (const m of res) {
      const k = `${m.athlete_id}|${m.weekly_plan_id}`;
      const map = attribution.get(k) || new Map<string, string[]>();
      map.set(m.workout_key, [...(map.get(m.workout_key) || []), m.activity_id]);
      attribution.set(k, map);
    }
  }

  const runs = withoutTwins(actRows as any[]);
  const actsByAthlete = new Map<string, ActualActivity[]>();
  const rawRowById = new Map<string, any>();
  for (const r of runs) {
    rawRowById.set(r.id, r);
    const list = actsByAthlete.get(r.athlete_id) || [];
    list.push({
      id: r.id,
      date: activityLocalDateStr(r.start_time),
      distance: Number(r.distance) || 0,
      duration: Number(r.duration) || 0,
      movingDuration: r.moving_duration != null ? Number(r.moving_duration) : null,
      averagePace: r.average_pace != null ? Number(r.average_pace) : null,
      averageHr: r.average_hr != null ? Number(r.average_hr) : null,
      activityType: r.activity_type,
    });
    actsByAthlete.set(r.athlete_id, list);
  }

  // Lists
  const listMembers = new Map<string, string[]>();
  for (const m of listsRes?.members || []) listMembers.set(m.athlete_id, [...(listMembers.get(m.athlete_id) || []), m.list_id]);

  // Pass 1: grade every athlete's three plan weeks; collect the quality sessions
  // whose block pace needs the laps.
  type Graded = { week: string; planId: string | null; planned: PlannedWorkout[]; raw: Map<string, ParsedWorkout>; adh: ReturnType<typeof assessWeek> };
  const gradedByAthlete = new Map<string, Graded[]>();
  const qualityNeeds: Array<{ athleteId: string; raw: ParsedWorkout; w: WorkoutAdherence; lane: Lane }> = [];
  const laneOf = (a: any): Lane => {
    const idx = resolveGroup(a.group_id ? groupNames.get(a.group_id) : null).index;
    return (idx >= 0 ? idx + 1 : 2) as Lane;
  };
  for (const a of athletes) {
    const joined = a.created_at ? String(a.created_at).slice(0, 10) : null;
    const lane = laneOf(a);
    const acts = actsByAthlete.get(a.id) || [];
    const weeks: Graded[] = gradedWeeks.map((week) => {
      const plan = indivByKey.get(`${a.id}|${week}`) ?? sharedByWeek.get(week);
      const { planned: all, rawByDate } = plannedForWeek(extractWorkouts(plan?.parsed_workouts, lane), week);
      // A member's sessions before they joined are not theirs to miss.
      const planned = all.filter((p) => !joined || p.date >= joined);
      const end = addDaysToDateStr(week, 6);
      const adh = assessWeek(planned, acts.filter((x) => x.date >= week && x.date <= end), tolerances,
        plan ? attribution.get(`${a.id}|${plan.id}`) : undefined);
      return { week, planId: plan?.id ?? null, planned, raw: rawByDate, adh };
    });
    gradedByAthlete.set(a.id, weeks);
    for (const g of weeks.slice(-BAND_WEEKS)) {
      for (const w of g.adh.workouts) {
        const raw = g.raw.get(w.date);
        if (!raw || !w.completed || !w.actual || w.planned.optional || w.date > today) continue;
        if (sessionKind(raw) === 'quality') qualityNeeds.push({ athleteId: a.id, raw, w, lane });
      }
    }
  }

  // The laps and step lists, only for the quality sessions (the widest columns).
  const lapRows = new Map<string, any>();
  const needIds = [...new Set(qualityNeeds.map((q) => q.w.actual!.id))];
  for (let i = 0; i < needIds.length; i += 200) {
    const chunk = needIds.slice(i, i + 200);
    const res = await db.from('athlete_activities').select('id, laps, executed_workout').in('id', chunk);
    const data = res.error
      ? (await db.from('athlete_activities').select('id, laps').in('id', chunk)).data
      : res.data;
    for (const r of (data || []) as any[]) lapRows.set(r.id, r);
  }
  const blockByActivity = new Map<string, GradedPaceSession>();
  for (const q of qualityNeeds) {
    blockByActivity.set(q.w.actual!.id, blockPaceOf(q.raw, q.w, lapRows.get(q.w.actual!.id), q.lane, tolerances.paceSec));
  }

  // Feedback (pain) per athlete.
  const fbByAthlete = new Map<string, any[]>();
  for (const f of feedbackRows) fbByAthlete.set(f.athlete_id, [...(fbByAthlete.get(f.athlete_id) || []), f]);

  const squadsSeen = new Map<number, { squad: number; pack: string; sub: string | null; groupId: string }>();
  let todaySession: string | null = null;

  const runners: RosterRunner[] = athletes.map((a) => {
    const allWeeks = gradedByAthlete.get(a.id)!;
    const weeks = allWeeks.slice(-BAND_WEEKS);
    const cur = weeks[weeks.length - 1];
    const acts = actsByAthlete.get(a.id) || [];
    const joined = a.created_at ? String(a.created_at).slice(0, 10) : null;
    const groupName = a.groups?.name ?? (a.group_id ? groupNames.get(a.group_id) : null) ?? null;
    const rg = groupName ? resolveGroup(groupName) : null;
    const squad = rg && rg.index >= 0 ? rg.index + 1 : null;
    const sub = groupName && /^SUB\b/i.test(groupName.trim()) ? groupName.trim() : null;
    if (squad && a.group_id && !squadsSeen.has(squad)) squadsSeen.set(squad, { squad, pack: memberPackName(groupName), sub, groupId: a.group_id });
    const availability = availabilityAvailable ? normalizeAvailability(a.availability) : 'active';
    const isNew = isNewMember(a.created_at, today);
    const listIds = listMembers.get(a.id) || [];

    const prescribed = cur.adh.workouts.filter((w) => !w.planned.optional);
    const strip: StripDay[] = Array.from({ length: 7 }, (_, dow) => {
      const date = addDaysToDateStr(planWeek, dow);
      const w = prescribed.find((x) => x.date === date) ?? null;
      const dayActs = acts.filter((x) => x.date === date && x.distance > 0);
      const km = dayActs.length ? r1(dayActs.reduce((t, x) => t + x.distance, 0)) : null;
      return {
        dow, date,
        s: stripCell({ date, today, planned: w, ran: dayActs.length > 0, joined }),
        km,
        plannedKm: w ? Math.round(midKm(w.planned) * 10) / 10 : 0,
        name: w?.name ?? null,
      };
    });

    const toDate = prescribed.filter((w) => w.date < today || (w.date === today && w.completed));
    const weekExec = {
      done: toDate.filter((w) => w.completed).length,
      of: toDate.length,
      pct: toDate.length ? Math.round((toDate.reduce((t, w) => t + w.score, 0) / toDate.length) * 100) : null,
    };
    const allSessions = weeks.flatMap((g) => g.adh.workouts.map((w) => ({ date: w.date, completed: w.completed, optional: w.planned.optional })));
    const missedRun = missedStreak(allSessions, today, joined);

    const easy: GradedPaceSession[] = [];
    const quality: GradedPaceSession[] = [];
    for (const g of weeks) for (const w of g.adh.workouts) {
      const raw = g.raw.get(w.date);
      if (!raw || !w.completed || w.planned.optional || w.date > today) continue;
      const kind = sessionKind(raw);
      // An easy session's pace row is only a verdict when one band covers it (comparedMin set).
      if (kind === 'easy') easy.push({
        status: w.pace.comparedMin != null ? w.pace.status : 'unknown',
        pace: w.pace.actual, bandMin: w.pace.plannedMin, bandMax: w.pace.plannedMax, date: w.date,
      });
      if (kind === 'quality' && w.actual) quality.push(blockByActivity.get(w.actual.id) ?? { status: 'unknown', pace: null, bandMin: null, bandMax: null, date: w.date });
    }

    const fbs = fbByAthlete.get(a.id) || [];
    const pains = fbs.filter((f) => f.pain);
    const latestPain = pains[0] && String(pains[0].created_at).slice(0, 10) >= addDaysToDateStr(today, -14) ? pains[0] : null;
    const pain = latestPain ? {
      date: String(latestPain.created_at).slice(0, 10),
      detail: latestPain.pain_detail ?? null,
      where: painSpot(latestPain.pain_detail ?? null),
      rpe: latestPain.difficulty ?? null,
      repeat: isRepeatPain(pains.map((p) => ({ createdAt: p.created_at, detail: p.pain_detail ?? null }))),
    } : null;

    const todayW = prescribed.find((w) => w.date === today) ?? null;
    if (todayW && !todaySession && squad === 1) todaySession = todayW.name;
    const planActs = acts.filter((x) => x.date >= planWeek && x.date <= today);
    const row: RosterRunner = {
      id: a.id,
      name: a.name || '',
      avatarUrl: a.avatar_url || null,
      squad,
      pack: groupName ? memberPackName(groupName) : null,
      sub,
      groupId: a.group_id ?? null,
      academy: !!a.is_academy,
      isNew,
      joined,
      availability,
      availabilitySetBy: availabilityAvailable ? normalizeSetBy(a.availability_set_by) : null,
      lists: listIds,
      populations: populationsOf({ squad, academy: !!a.is_academy, isNew, availability, listIds }),
      planKm: r1(filterQualifyingRuns(planActs as any[]).reduce((t: number, x: any) => t + x.distance, 0)),
      toDateTarget: Math.round(prescribed.filter((w) => w.date <= today).reduce((t, w) => t + midKm(w.planned), 0) * 10) / 10,
      weekTarget: Math.round(prescribed.reduce((t, w) => t + midKm(w.planned), 0) * 10) / 10,
      kmWeek: r1(volume.byAthlete.get(a.id)?.[0]?.meters ?? 0),
      strip,
      missedRun,
      lastRun: acts.map((x) => x.date).filter((d) => d <= today).sort().pop() ?? null,
      offBand: easyTooFast(easy),
      slowBand: qualityTooSlow(quality),
      pain,
      weekExec,
      accuracy: allWeeks.map((g) => {
        const closed = g.adh.workouts.filter((w) => !w.planned.optional && (w.date < today || (w.date === today && w.completed)));
        const before = !!joined && addDaysToDateStr(g.week, 6) < joined;
        return {
          week: g.week,
          pct: before || !closed.length ? null : Math.round((closed.reduce((t, w) => t + w.score, 0) / closed.length) * 100),
          done: closed.filter((w) => w.completed).length,
          of: closed.length,
        };
      }),
      plannedToday: !!todayW,
      ranToday: !!todayW?.completed,
      todayName: todayW?.name ?? null,
      attention: 0,
    };
    return row;
  });
  for (const r of runners) {
    // Out runners carry no flags beyond their status: they're not expected to run.
    if (r.availability !== 'active') { r.offBand = null; r.slowBand = null; r.missedRun = 0; }
    r.attention = attentionRank(r);
  }
  runners.sort(compareAttention);

  const totals = clubTotals(runners.map((r) => ({
    availability: r.availability,
    weekDone: r.weekExec.done,
    weekOf: r.weekExec.of,
    weekScore: (r.weekExec.pct ?? 0) / 100,
    plannedToday: r.plannedToday,
    ranToday: r.ranToday,
    populations: r.populations,
  })));
  const clubKm = clubKmToDate(
    filterQualifyingRuns(runs as any[]).map((r: any) => ({ day: activityLocalDateStr(r.start_time), meters: Number(r.distance) || 0 })),
    activityWeek,
    today,
  );

  const lists = (listsRes?.lists || []).map((l: any) => ({
    id: l.id, name: l.name, note: l.note ?? null,
    count: (listsRes?.members || []).filter((m) => m.list_id === l.id && ids.includes(m.athlete_id)).length,
  }));

  return {
    meta: { today, planWeek, activityWeek, nextPlanWeek, bandWeeks, listsAvailable: !!listsRes, availabilityAvailable },
    squads: [...squadsSeen.values()].sort((x, y) => x.squad - y.squad),
    lists,
    club: { ...totals, ...clubKm, runners: runners.length, todaySession },
    nextWeekPublished: sharedByWeek.has(nextPlanWeek),
    routing: ROUTED_KINDS.map((k) => ({
      kind: k.kind,
      label: k.label,
      roles: matrix?.[k.kind] ? ROUTABLE_ROLES.filter((r) => matrix[k.kind][r] === true) : null,
    })),
    runners,
  };
}

