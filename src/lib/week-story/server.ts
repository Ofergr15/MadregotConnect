import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { buildPlanWeek } from '@/lib/athletes/plan-week';
import { lastWeekSummary } from '@/lib/home/today';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { pickPlan, planRowsFilter } from '@/lib/plans/scope';
import { ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';
import { daySessionWorkouts, mergeDaySessions } from '@/lib/day-session/week-merge';
import { parseRecordUrl, BUCKET_LABEL } from '@/lib/publish/model';
import { loadQualitySession, loadQualityWorkout } from '@/lib/quality-session/server';
import { mainSet, parseParts, partLabel, targetFor } from '@/lib/quality-session/parts';
import { runnersOf } from '@/lib/quality-session/model';
import { displaySplits } from '@/lib/activities/km-splits';
import { markKm, pairKm, planKmPaces, type KmMark } from './long';
import { cleanLayout, memberChoices, pickTheme, pickWorkout, type StoryLayout, type Theme, type WorkoutPick } from './layout';
import { addDays, storyWindow, weekdayOf, type StoryWindow, type WeekNumbers } from './model';

/**
 * "השבוע שלך" — what one athlete's week story is made of (lib/week-story/model.ts for the
 * rules, components/week-story/WeekStory for the slides). Every number comes from the
 * calculation the app already shows elsewhere, so the story and the home's "השבוע שעבר"
 * agree: planWeek + lastWeekSummary for km and plan, the record alerts for records, the
 * quality-session screen's reading of the reps, the pack as the home's pack card ranks it.
 */

type Db = SupabaseClient;
const DAY_MS = 86_400_000;

export interface StoryRecord { label: string; seconds: number | null }
/** `vs`: the set's pace minus the plan's (seconds per km), as the quality screen reads it. */
export interface StoryQuality { label: string; day: number; reps: number[]; target: number[]; vs: number }
/** The long run: per km of the plan's main block, the pace run and the plan's band. */
export interface StoryLong {
  day: number; km: number; name: string; kms: Array<{ p: number; lo: number; hi: number; mark: KmMark }>; onPlan: number;
  /** The run's route for the collage's thumbnail ([lat, lng], at most 60 points), when it has GPS. */
  route?: Array<[number, number]>;
}
export interface StoryPackRow { name: string; km: number; me: boolean; avatarUrl: string | null }
export interface StoryPack { name: string; rank: number; of: number; lastRank: number | null; top: StoryPackRow[] }
export interface StoryClub { km: number; runners: number; records: number; marathons: number }
export interface StoryAcademy { comments: number; score: number | null; nextSessions: number; nextKm: number | null }

export interface WeekStory {
  athleteId: string;
  name: string;
  window: StoryWindow;
  numbers: WeekNumbers;
  /** Planned per day (km, 0 = rest), Sunday first, and which planned days were dropped. */
  plannedKm: number[] | null;
  missed: boolean[];
  biggestInWeeks: number;
  /** The plan weeks' km, oldest first, this one last — for the streak on the cards. */
  weeksKm: number[];
  quality: StoryQuality | null;
  pack: StoryPack | null;
  club: StoryClub | null;
  academy: StoryAcademy | null;
  /** The member chose not to see their pack's table (notification_prefs.weekStory.hidePack). */
  hidePack: boolean;
  long: StoryLong | null;
  /** The workouts this week has (only these can be picked) and the one the slide shows. */
  workouts: WorkoutPick[];
  workout: WorkoutPick | null;
  /** The club's layout (missing column = the default), the background shown, the member's own picks. */
  layout: StoryLayout;
  theme: Theme;
  mine: { workout: WorkoutPick | null; theme: Theme | null; name: string | null };
}

const runCols = 'id, activity_name, activity_type, start_time, distance, duration';

async function runsBetween(db: Db, athleteId: string, from: string, to: string): Promise<RunActivityRow[]> {
  return fetchAllRows<RunActivityRow>((a, b) => db.from('athlete_activities').select(runCols)
    .eq('athlete_id', athleteId).gte('start_time', `${from}T00:00:00`).lt('start_time', `${to}T00:00:00`)
    .order('start_time').order('id').range(a, b));
}

/** The plan this athlete was asked to run that week: their own academy week, else their pack's lane. */
export async function planBreakdownFor(db: Db, athleteId: string, weekStart: string, opts: { ownOnly?: boolean } = {}) {
  const [{ data: rowsRaw }, own] = await Promise.all([
    db.from('weekly_plans').select('parsed_workouts, status, created_at, athlete_id')
      .eq('coach_id', COACH_ID).or(planRowsFilter(athleteId)).eq('week_start_date', weekStart),
    ownPlanRowsCount(athleteId),
  ]);
  const rows = withoutOwnRows(rowsRaw, own);
  const plan = pickPlan(rows, athleteId);
  if (opts.ownOnly && !plan?.athlete_id) return null;
  const dayWorkouts = opts.ownOnly ? [] : await daySessionWorkouts(weekStart);
  if (!plan) return dayWorkouts.length ? buildWeekBreakdown({ workouts: dayWorkouts }) : null;
  let parsed = plan.parsed_workouts;
  if (!plan.athlete_id) {
    const lane = (await groupNumberForAthlete(db as never, athleteId, weekStart)) as Lane;
    const workouts = laneWorkouts(plan.parsed_workouts, lane);
    if (workouts.length) parsed = { workouts };
  }
  return buildWeekBreakdown(dayWorkouts.length ? mergeDaySessions(parsed, dayWorkouts) : parsed);
}

/** The Israeli wall clock of the story week's last moment that counts: now on Saturday, else Saturday night. */
function wallFor(w: StoryWindow, now: Date): number {
  const sat = Date.parse(`${w.weekEnd}T23:59:59Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour === '24' ? 0 : parts.hour), Number(parts.minute), Number(parts.second));
  return Math.min(wall, sat);
}

async function recordsIn(db: Db, athleteId: string, w: StoryWindow): Promise<StoryRecord[]> {
  const { data } = await db.from('scheduled_notifications').select('url, body_he, last_sent_at')
    .eq('audience_id', athleteId).eq('kind', 'record')
    .gte('last_sent_at', `${w.weekStart}T00:00:00`).lt('last_sent_at', `${addDays(w.weekEnd, 1)}T06:00:00`);
  const seen = new Set<string>();
  const out: StoryRecord[] = [];
  for (const r of (data || []) as Array<{ url: string | null; body_he: string | null }>) {
    const p = parseRecordUrl(r.url);
    if (!p || seen.has(p.bucket)) continue;
    seen.add(p.bucket);
    const m = /(\d+:\d{2}(?::\d{2})?)/.exec(r.body_he || '');
    const seconds = m ? m[1].split(':').map(Number).reduce((s, x) => s * 60 + x, 0) : null;
    out.push({ label: BUCKET_LABEL[p.bucket] ?? p.bucket, seconds });
  }
  return out;
}

async function qualityFor(db: Db, athleteId: string, ranDays: string[]): Promise<StoryQuality | null> {
  // Only the days they ran, and the cheap plan lookup first: the full session (every
  // runner's laps that morning) is read for the one day that was a quality morning.
  const plans = await Promise.all(ranDays.map((d) => loadQualityWorkout(db as never, d).catch(() => null)));
  for (const [i, date] of ranDays.entries()) {
    if (!plans[i]) continue;
    let session;
    try { session = await loadQualitySession(db as never, date); } catch { continue; }
    if (!session.workout) continue;
    const mine = runnersOf(session.runs).find((r) => r.run.athleteId === athleteId);
    if (!mine) continue;
    const parsed = parseParts(mine.run.laps);
    const main = mainSet(parsed.parts);
    if (!main || !main.reps.length) continue;
    // Only a set the plan asked for: a run's 1 km auto-laps parse as a set too.
    const tgt = mine.run.pack ? targetFor(main, session.plan[mine.run.pack]) : null;
    if (!tgt?.paces.length) continue;
    const goal = tgt.paces.reduce((a, b) => a + b, 0) / tgt.paces.length;
    return {
      label: partLabel(main), day: weekdayOf(date),
      reps: main.reps.map((r) => Math.round(r.p)), target: tgt.paces.map(Math.round), vs: Math.round(main.p - goal),
    };
  }
  return null;
}

/** The week's long run as the plan set it, against the km they ran that day. */
async function longFor(db: Db, plan: Awaited<ReturnType<typeof planBreakdownFor>>, w: StoryWindow, runs: RunActivityRow[]): Promise<StoryLong | null> {
  const sessions = (plan?.sessions || []).filter((x) => !x.optional);
  const ses = sessions.find((x) => x.type === 'long_run') ?? null;
  if (!ses) return null;
  const band = planKmPaces(ses.steps || []);
  if (!band.length) return null;
  const date = addDays(w.weekStart, ses.dayOfWeek);
  const run = runs.filter((r) => r.start_time.slice(0, 10) === date).sort((a, b) => b.distance - a.distance)[0];
  if (!run?.id) return null;
  const { data } = await db.from('athlete_activities').select('splits, laps, route_preview').eq('id', run.id).maybeSingle();
  const row = data as { splits?: unknown; laps?: unknown; route_preview?: unknown } | null;
  const full = displaySplits(row?.splits, row?.laps).filter((k) => k.distance >= 900 && k.averagePace > 0).map((k) => Math.round(k.averagePace));
  const pairs = pairKm(full, band);
  if (pairs.length < 5) return null;
  const kms = pairs.map((k) => ({ ...k, mark: markKm(k.p, [k.lo, k.hi]) }));
  const pts = Array.isArray((row as { route_preview?: unknown } | null)?.route_preview) ? ((row as { route_preview: Array<{ lat?: number; lng?: number }> }).route_preview) : [];
  const step = Math.max(1, Math.ceil(pts.length / 60));
  const route = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
    .filter((q) => typeof q?.lat === 'number' && typeof q?.lng === 'number').map((q) => [Math.round(q.lat! * 1e5) / 1e5, Math.round(q.lng! * 1e5) / 1e5] as [number, number]);
  return { day: ses.dayOfWeek, km: Math.round(run.distance / 100) / 10, name: ses.name, kms, onPlan: kms.filter((k) => k.mark === 'on').length, ...(route.length >= 2 ? { route } : {}) };
}

/** The club's layout for the weekly story; before migration 170 there is no column, and that is the default. */
async function layoutFor(db: Db): Promise<StoryLayout> {
  try {
    const { data, error } = await db.from('story_feature_settings').select('*').eq('feature', 'weekly').maybeSingle();
    if (error) return cleanLayout(null);
    return cleanLayout((data as { layout?: unknown } | null)?.layout);
  } catch { return cleanLayout(null); }
}

/** Their place in their pack by km, this week and last, as the home's pack card counts it. */
async function packFor(db: Db, athleteId: string, w: StoryWindow): Promise<StoryPack | null> {
  const { data: me } = await db.from('athletes').select('group_id').eq('id', athleteId).maybeSingle();
  const groupId = (me as { group_id?: string | null } | null)?.group_id;
  if (!groupId) return null;
  const [{ data: g }, { data: members }] = await Promise.all([
    db.from('groups').select('name').eq('id', groupId).maybeSingle(),
    db.from('athletes').select('id, name, avatar_url').eq('coach_id', COACH_ID).eq('group_id', groupId).eq('status', 'active'),
  ]);
  const people = (members || []) as Array<{ id: string; name: string | null; avatar_url: string | null }>;
  if (people.length < 2) return null;
  const ids = people.map((p) => p.id);
  const lastStart = addDays(w.weekStart, -7);
  const acts = await fetchAllRows<RunActivityRow & { athlete_id: string }>((a, b) => db.from('athlete_activities')
    .select(`athlete_id, ${runCols}`).in('athlete_id', ids)
    .gte('start_time', `${lastStart}T00:00:00`).lt('start_time', `${addDays(w.weekEnd, 1)}T00:00:00`)
    .order('start_time').order('id').range(a, b));
  const runs = filterQualifyingRuns(acts);
  const km = (from: string, to: string) => {
    const m = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const r of runs) {
      const day = r.start_time.slice(0, 10);
      if (day >= from && day <= to) m.set(r.athlete_id, (m.get(r.athlete_id) || 0) + r.distance / 1000);
    }
    return m;
  };
  const now = km(w.weekStart, w.weekEnd);
  const before = km(lastStart, addDays(w.weekStart, -1));
  const order = (m: Map<string, number>) => [...m.entries()].filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const rankNow = order(now);
  const rankBefore = order(before);
  const at = rankNow.indexOf(athleteId);
  if (at < 0) return null;
  const was = rankBefore.indexOf(athleteId);
  const byId = new Map(people.map((p) => [p.id, p]));
  // The top three and me, as the mockup shows them.
  const shown = [...new Set([...rankNow.slice(0, 3), athleteId])];
  return {
    name: (g as { name?: string } | null)?.name || '',
    rank: at + 1,
    of: rankNow.length,
    lastRank: was >= 0 ? was + 1 : null,
    top: shown.map((id) => ({
      name: (byId.get(id)?.name || '').trim().split(/\s+/)[0],
      km: Math.round((now.get(id) || 0) * 10) / 10,
      me: id === athleteId,
      avatarUrl: byId.get(id)?.avatar_url ?? null,
    })).sort((a, b) => b.km - a.km),
  };
}

/**
 * The whole club in the week: km, runners, records and marathons. The same for everyone,
 * so a warm server reads it once every ten minutes rather than once per member.
 */
const clubMemo = new Map<string, { at: number; club: Promise<StoryClub> }>();
export function clubWeek(db: Db, w: StoryWindow): Promise<StoryClub> {
  const hit = clubMemo.get(w.weekEnd);
  if (hit && Date.now() - hit.at < 600_000) return hit.club;
  const club = readClubWeek(db, w);
  clubMemo.set(w.weekEnd, { at: Date.now(), club });
  club.catch(() => clubMemo.delete(w.weekEnd));
  return club;
}

async function readClubWeek(db: Db, w: StoryWindow): Promise<StoryClub> {
  const { data: members } = await db.from('athletes').select('id').eq('coach_id', COACH_ID).eq('status', 'active');
  const ids = ((members || []) as Array<{ id: string }>).map((m) => m.id);
  const acts = ids.length ? await fetchAllRows<RunActivityRow & { athlete_id: string }>((a, b) => db.from('athlete_activities')
    .select(`athlete_id, ${runCols}`).in('athlete_id', ids)
    .gte('start_time', `${w.weekStart}T00:00:00`).lt('start_time', `${addDays(w.weekEnd, 1)}T00:00:00`)
    .order('start_time').order('id').range(a, b)) : [];
  const runs = filterQualifyingRuns(acts);
  const { count: records } = await db.from('scheduled_notifications').select('id', { count: 'exact', head: true })
    .eq('kind', 'record').gte('last_sent_at', `${w.weekStart}T00:00:00`).lt('last_sent_at', `${addDays(w.weekEnd, 1)}T06:00:00`);
  return {
    km: Math.round(runs.reduce((s, r) => s + r.distance, 0) / 1000),
    runners: new Set(runs.map((r) => r.athlete_id)).size,
    records: records ?? 0,
    marathons: runs.filter((r) => r.distance >= 42_000).length,
  };
}

async function academyFor(db: Db, athleteId: string, w: StoryWindow, activityIds: string[]): Promise<StoryAcademy | null> {
  const [{ computeAcademyWeekAdherence }, { loadBoardMarks }] = await Promise.all([
    import('@/lib/academy/report'), import('@/lib/academy/board-server'),
  ]);
  const [adh, marks, next] = await Promise.all([
    computeAcademyWeekAdherence({ weekStart: w.weekStart, onlyAthleteId: athleteId }).catch(() => null),
    loadBoardMarks(db as never, { athleteId, weekStart: w.weekStart, weekEnd: w.weekEnd, activityIds }).catch(() => null),
    planBreakdownFor(db, athleteId, addDays(w.weekStart, 7), { ownOnly: true }).catch(() => null),
  ]);
  const row = (adh as { athletes?: Array<{ athleteId?: string; week?: { avgScore?: number | null } }> } | null)?.athletes?.[0];
  const comments = marks ? [...marks.commentsByDate.values()].reduce((s, n) => s + n, 0) : 0;
  const sessions = next?.sessions?.filter((s) => !s.optional).length ?? 0;
  const nextKm = next ? Math.round(next.weekTotalMax || next.weekRequiredMin || 0) || null : null;
  return { comments, score: row?.week?.avgScore != null ? Math.round(row.week.avgScore * 100) : null, nextSessions: sessions, nextKm };
}

/**
 * The name to greet them by: the Hebrew one set for their birthday story when there is
 * one (athletes.name is Latin only), else their first name.
 */
async function greetName(db: Db, athleteId: string, latin: string | null): Promise<string> {
  const { data } = await db.from('app_settings').select('value').like('key', `birthday_year:${athleteId}:%`)
    .order('key', { ascending: false }).limit(1);
  try {
    const shown = (JSON.parse((data?.[0] as { value?: string } | undefined)?.value || '{}') as { displayName?: string }).displayName?.trim();
    if (shown) return shown;
  } catch { /* a broken config is no name */ }
  return (latin || '').trim().split(/\s+/)[0];
}

export async function loadWeekStory(db: Db, athleteId: string, today: string, hour: number, now = new Date()): Promise<WeekStory | null> {
  const w = storyWindow(today, hour);
  if (!w) return null;
  const { data: a } = await db.from('athletes').select('id, name, is_academy, notification_prefs')
    .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
  const athlete = a as { name: string | null; is_academy: boolean | null; notification_prefs: Record<string, unknown> | null } | null;
  if (!athlete) return null;

  const acts = await runsBetween(db, athleteId, addDays(w.weekStart, -70), addDays(w.weekEnd, 1));
  const pw = buildPlanWeek(filterQualifyingRuns(acts), wallFor(w, now));
  if (!pw.runs) return null;
  const lastKm = pw.lastDays.reduce((s, k) => s + k, 0);
  const full = pw.weeks.slice(0, -1).map((x) => x.km);
  const biggest = full.length && pw.km > Math.max(...full) ? full.length + 1 : 0;

  const planP = planBreakdownFor(db, athleteId, w.weekStart).catch(() => null);
  const weekRuns = filterQualifyingRuns(acts).filter((r) => r.start_time.slice(0, 10) >= w.weekStart);
  const [name, plan, records, quality, pack, club, academy, long, layout] = await Promise.all([
    greetName(db, athleteId, athlete.name),
    planP,
    recordsIn(db, athleteId, w),
    qualityFor(db, athleteId, pw.days.map((k, i) => (k > 0 ? addDays(w.weekStart, i) : null)).filter((d): d is string => !!d)).catch(() => null),
    athlete.is_academy ? Promise.resolve(null) : packFor(db, athleteId, w).catch(() => null),
    clubWeek(db, w).catch(() => null),
    athlete.is_academy ? academyFor(db, athleteId, w, pw.dayRuns.flat().map((r) => r.id).filter((id): id is string => !!id)).catch(() => null) : Promise.resolve(null),
    planP.then((p) => longFor(db, p, w, weekRuns)).catch(() => null),
    layoutFor(db),
  ]);

  const sum = lastWeekSummary(plan?.dailyDistances, pw.days, pw.dayRuns);
  const prefs = (athlete.notification_prefs?.weekStory || {}) as { hidePack?: boolean };
  const mine = memberChoices(prefs, w.weekEnd);
  const workouts = [quality?.reps.length ? 'quality' : null, long ? 'long' : null].filter(Boolean) as WorkoutPick[];
  return {
    athleteId,
    name,
    window: w,
    numbers: {
      km: Math.round(pw.km * 10) / 10,
      runs: pw.runs,
      seconds: pw.seconds,
      dayKm: pw.days.map((k) => Math.round(k * 10) / 10),
      lastWeekKm: lastKm > 0 ? Math.round(lastKm * 10) / 10 : null,
      planShare: sum.plannedKm > 0 ? Math.min(1.5, pw.km / sum.plannedKm) : null,
      sessionsDone: sum.sessionsPlanned ? sum.sessionsDone : null,
      sessionsPlanned: sum.sessionsPlanned || null,
      records: records.map((r) => ({ label: r.label, seconds: r.seconds ?? 0, previous: null })),
      packRank: pack ? { rank: pack.rank, of: pack.of, lastRank: pack.lastRank } : null,
    },
    plannedKm: sum.plannedKm > 0 ? sum.days.map((d) => d.planned) : null,
    missed: sum.days.map((d) => d.missed),
    biggestInWeeks: biggest,
    weeksKm: pw.weeks.map((x) => x.km),
    quality,
    pack,
    club,
    academy,
    hidePack: prefs.hidePack === true,
    long,
    workouts,
    workout: pickWorkout({ available: workouts, club: layout.workout, member: mine.workout }),
    layout,
    theme: pickTheme(layout.theme, mine.theme),
    mine,
  };
}

export { DAY_MS };
