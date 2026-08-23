/**
 * Badge award-evaluation engine (roadmap #11, Phase 3 — see
 * supabase/migrations/059_badges.sql). `checkAndAwardBadges` is the ONE place
 * that decides whether an athlete has newly earned a badge: it walks every
 * ACTIVE badge, skips anything already in `athlete_badges` (awards are
 * permanent — once earned, never re-evaluated), evaluates the badge's
 * `rule_type`, and — for anything newly earned — inserts the award row, a
 * `feed_items` achievement post, and a push notification.
 *
 * Call sites (fire-and-forget, best-effort — a badge check must never break
 * the thing that triggered it):
 *  - after Garmin/Strava activity sync (pr_bucket, cumulative_distance,
 *    cumulative_duration, streak_weeks all move on new activities)
 *  - after a race match is created/confirmed (race_count)
 *  - once/day from /api/cron/badges, scoped to `attendance_perfect_month`
 *    only (the one rule that can only be evaluated once a month has ended)
 *
 * Deliberately NOT implemented as a SQL trigger: the PR/streak/cumulative
 * math already lives in TypeScript (lib/prs/pr-buckets.ts, lib/utils.ts) —
 * duplicating it into PL/pgSQL would mean two places that can drift.
 */
import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { getActivityWeekStart, getPlanWeekStart, computeWeekStreak, activityLocalDateStr } from '@/lib/utils';
import { PR_BUCKETS, PR_RUN_TYPES, filterQualifyingRuns, computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';

// Keep in sync with the CHECK constraint in 059_badges.sql. Only the types
// this engine knows how to evaluate are listed here — a genuinely new
// rule_type needs a code change (by design, per that migration's comment),
// and until then IMPLEMENTED_RULE_TYPES lets us skip it safely rather than
// throwing on an unrecognised catalog row. `cumulative_duration` is the
// admin "Create New Badge" form's time-based option (see
// api/admin/badges/route.ts) — no v1 seed row uses it, but an admin can
// create one at any time, so the engine must already know how to award it.
export type BadgeRuleType =
  | 'pr_bucket'
  | 'cumulative_distance'
  | 'cumulative_duration'
  | 'streak_weeks'
  | 'race_count'
  | 'attendance_perfect_month';

const IMPLEMENTED_RULE_TYPES = new Set<string>([
  'pr_bucket',
  'cumulative_distance',
  'cumulative_duration',
  'streak_weeks',
  'race_count',
  'attendance_perfect_month',
]);

export interface BadgeRow {
  id: string;
  code: string;
  name_he: string;
  name_en: string;
  icon: string;
  icon_url: string | null;
  rule_type: string;
  rule_params: Record<string, unknown>;
}

export interface AwardedBadgeSummary {
  code: string;
  nameEn: string;
}

type SupabaseServer = ReturnType<typeof createServerClient>;

/** Israel wall-clock calendar date parts (year/month/day), DST-aware. */
function israelDateParts(date: Date = new Date()): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * The most recently COMPLETED calendar month (Israel local date), as
 * [firstDayStr, lastDayStr, nextMonthFirstStr] (all YYYY-MM-DD). Exported for
 * unit testing — pure, no I/O.
 */
export function previousCompletedMonthRange(
  now: Date = new Date(),
): { firstDayStr: string; lastDayStr: string; nextMonthFirstStr: string; lastDayNum: number } {
  const { year, month } = israelDateParts(now);
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthKey = `${prevYear}-${pad(prevMonth)}`;
  const lastDayNum = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate(); // day 0 of next month
  const nextMonth = prevMonth === 12 ? 1 : prevMonth + 1;
  const nextYear = prevMonth === 12 ? prevYear + 1 : prevYear;
  return {
    firstDayStr: `${monthKey}-01`,
    lastDayStr: `${monthKey}-${pad(lastDayNum)}`,
    nextMonthFirstStr: `${nextYear}-${pad(nextMonth)}-01`,
    lastDayNum,
  };
}

interface RuleEvalResult {
  awarded: boolean;
  context: Record<string, unknown>;
}

// ─── pr_bucket ────────────────────────────────────────────────────────────
// Reuses lib/prs/pr-buckets.ts — the EXACT same tolerance-window math as
// GET /api/athletes/prs — so a badge fires on the same run that route would
// show as the bucket's PR.
function evalPrBucket(runs: RunActivityRow[], ruleParams: Record<string, unknown>): RuleEvalResult {
  const bucketKey = String(ruleParams.bucket || '');
  if (!PR_BUCKETS.some((b) => b.key === bucketKey)) return { awarded: false, context: {} };
  const best = computeDistanceBests(runs).find((b) => b.key === bucketKey);
  if (!best || best.seconds == null) return { awarded: false, context: {} };
  return {
    awarded: true,
    context: { activityId: best.activityId, date: best.date, seconds: best.seconds },
  };
}

// ─── cumulative_distance ────────────────────────────────────────────────────
function evalCumulativeDistance(totalKm: number, ruleParams: Record<string, unknown>): RuleEvalResult {
  const thresholdKm = Number(ruleParams.km);
  if (!Number.isFinite(thresholdKm) || totalKm < thresholdKm) return { awarded: false, context: {} };
  return { awarded: true, context: { totalKm: Math.round(totalKm * 10) / 10 } };
}

// ─── cumulative_duration ────────────────────────────────────────────────────
// Admin-creatable time-based milestone (api/admin/badges/route.ts). rule_params
// stores the admin-facing unit (hours), NOT seconds — athlete_activities.duration
// is seconds, so convert the threshold up rather than the total down (avoids
// repeated float division on every check).
function evalCumulativeDuration(totalSeconds: number, ruleParams: Record<string, unknown>): RuleEvalResult {
  const thresholdHours = Number(ruleParams.hours);
  if (!Number.isFinite(thresholdHours) || totalSeconds < thresholdHours * 3600) {
    return { awarded: false, context: {} };
  }
  return { awarded: true, context: { totalHours: Math.round((totalSeconds / 3600) * 10) / 10 } };
}

// ─── streak_weeks ───────────────────────────────────────────────────────────
// Same run-type/distance filter as /api/athletes/summary and
// /api/groups/leaderboard (their RUN_TYPES const), feeding the shared
// computeWeekStreak helper — so this streak can never disagree with the
// personal momentum card or the streak leaderboard.
function evalStreakWeeks(streak: number, ruleParams: Record<string, unknown>): RuleEvalResult {
  const thresholdWeeks = Number(ruleParams.weeks);
  if (!Number.isFinite(thresholdWeeks) || streak < thresholdWeeks) return { awarded: false, context: {} };
  return { awarded: true, context: { streakWeeks: streak } };
}

// ─── race_count ─────────────────────────────────────────────────────────────
async function evalRaceCount(
  supabase: SupabaseServer,
  athleteId: string,
  ruleParams: Record<string, unknown>,
): Promise<RuleEvalResult> {
  const thresholdCount = Number(ruleParams.count);
  if (!Number.isFinite(thresholdCount)) return { awarded: false, context: {} };
  try {
    const { data, error } = await supabase
      .from('race_matches')
      .select('activity_id')
      .eq('athlete_id', athleteId)
      .eq('is_race', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    if (rows.length < thresholdCount) return { awarded: false, context: {} };
    return {
      awarded: true,
      context: { raceCount: rows.length, activityId: (rows[0] as { activity_id: string }).activity_id },
    };
  } catch {
    // race_matches (migration 058) may not be applied yet in this env — race
    // count is an optional add-on, so degrade to "not yet earned" (mirrors
    // GET /api/athletes/races's own graceful degrade).
    return { awarded: false, context: {} };
  }
}

// ─── attendance_perfect_month ──────────────────────────────────────────────
// For the most recently COMPLETED calendar month: every team-practice day
// must have an `attending: true` RSVP AND a matching same-day activity (the
// same "confirmed" read-time signal added to GET /api/attendance's
// roster=full branch). Requires at least one team day in the month.
async function evalAttendancePerfectMonth(
  supabase: SupabaseServer,
  athleteId: string,
): Promise<RuleEvalResult> {
  const { firstDayStr, lastDayStr, nextMonthFirstStr, lastDayNum } = previousCompletedMonthRange();
  const monthKey = firstDayStr.slice(0, 7);

  // Team-practice weekdays (0=Sun..6=Sat) — same config source as the
  // reminder crons (app_settings.reminder_config.teamDays; default Tue/Fri).
  const { data: cfgRow } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
  let teamDays: number[] = [2, 5];
  try {
    const cfg = JSON.parse((cfgRow as { value?: string } | null)?.value || '');
    if (Array.isArray(cfg?.teamDays)) teamDays = cfg.teamDays;
  } catch {
    /* default */
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const teamDayDates: string[] = [];
  for (let d = 1; d <= lastDayNum; d++) {
    const dateStr = `${monthKey}-${pad(d)}`;
    const weekday = new Date(`${dateStr}T12:00:00`).getDay();
    if (teamDays.includes(weekday)) teamDayDates.push(dateStr);
  }
  if (teamDayDates.length === 0) return { awarded: false, context: {} }; // no team days → nothing to be "perfect" at

  const keys = teamDayDates.map((dateStr) => ({
    dateStr,
    weekStart: getPlanWeekStart(new Date(`${dateStr}T12:00:00`)),
    dayOfWeek: new Date(`${dateStr}T12:00:00`).getDay(),
  }));
  const weekStarts = [...new Set(keys.map((k) => k.weekStart))];

  const [{ data: rsvps, error: rsvpErr }, { data: acts, error: actErr }] = await Promise.all([
    supabase
      .from('workout_attendance')
      .select('week_start_date, day_of_week, attending')
      .eq('athlete_id', athleteId)
      .in('week_start_date', weekStarts),
    supabase
      .from('athlete_activities')
      .select('start_time')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${firstDayStr}T00:00:00`)
      .lt('start_time', `${nextMonthFirstStr}T00:00:00`),
  ]);
  if (rsvpErr) throw rsvpErr;
  if (actErr) throw actErr;

  const rsvpMap = new Map(
    (rsvps || []).map((r: { week_start_date: string; day_of_week: number; attending: boolean }) => [
      `${r.week_start_date}|${r.day_of_week}`,
      r.attending,
    ]),
  );
  const activityDates = new Set((acts || []).map((a: { start_time: string }) => activityLocalDateStr(a.start_time)));

  const allConfirmed = keys.every((k) => {
    const attending = rsvpMap.get(`${k.weekStart}|${k.dayOfWeek}`);
    return attending === true && activityDates.has(k.dateStr);
  });
  if (!allConfirmed) return { awarded: false, context: {} };

  return { awarded: true, context: { month: monthKey, teamDaysConfirmed: teamDayDates.length } };
}

/**
 * Evaluate every ACTIVE badge (optionally scoped to a subset of rule_types —
 * used by the daily cron to check only attendance_perfect_month) for one
 * athlete, awarding anything newly earned: an `athlete_badges` row, a
 * `feed_items` achievement post, and a push (category: 'achievements').
 *
 * Never throws on a single rule_type's data being unavailable (e.g. an
 * unapplied migration) — that rule is simply skipped for this call. Safe to
 * call as a fire-and-forget side effect after any activity/race event.
 */
export async function checkAndAwardBadges(
  athleteId: string,
  opts: { ruleTypes?: BadgeRuleType[] } = {},
): Promise<{ awarded: AwardedBadgeSummary[] }> {
  const supabase = createServerClient();

  let badgeQuery = supabase.from('badges').select('id, code, name_he, name_en, icon, icon_url, rule_type, rule_params').eq('active', true);
  if (opts.ruleTypes?.length) badgeQuery = badgeQuery.in('rule_type', opts.ruleTypes);
  const { data: badgeRows, error: badgesError } = await badgeQuery;
  if (badgesError) {
    // badges/athlete_badges (migration 059) may not be applied yet in this
    // env — degrade to "no badges" rather than breaking the caller.
    return { awarded: [] };
  }
  const badges = (badgeRows || []) as BadgeRow[];
  const candidates = badges.filter((b) => IMPLEMENTED_RULE_TYPES.has(b.rule_type));
  if (candidates.length === 0) return { awarded: [] };

  const { data: existingRows, error: existingError } = await supabase
    .from('athlete_badges')
    .select('badge_id')
    .eq('athlete_id', athleteId);
  if (existingError) return { awarded: [] };
  const alreadyAwarded = new Set((existingRows || []).map((r: { badge_id: string }) => r.badge_id));

  const toEvaluate = candidates.filter((b) => !alreadyAwarded.has(b.id));
  if (toEvaluate.length === 0) return { awarded: [] };

  // Lazily computed per-athlete data, shared across every badge of the same
  // rule_type (e.g. vol_100km/500km/1000km all reuse one `totalKm`).
  let qualifyingRuns: RunActivityRow[] | null = null;
  const getQualifyingRuns = async (): Promise<RunActivityRow[]> => {
    if (qualifyingRuns) return qualifyingRuns;
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('id, activity_name, activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;
    qualifyingRuns = filterQualifyingRuns((data || []) as RunActivityRow[]);
    return qualifyingRuns;
  };

  let totalKmCache: number | null = null;
  const getTotalKm = async (): Promise<number> => {
    if (totalKmCache != null) return totalKmCache;
    const { data, error } = await supabase.from('athlete_activities').select('distance').eq('athlete_id', athleteId);
    if (error) throw error;
    totalKmCache = (data || []).reduce((sum: number, r: { distance: number | null }) => sum + (r.distance || 0), 0) / 1000;
    return totalKmCache;
  };

  let totalDurationSecCache: number | null = null;
  const getTotalDurationSeconds = async (): Promise<number> => {
    if (totalDurationSecCache != null) return totalDurationSecCache;
    const { data, error } = await supabase.from('athlete_activities').select('duration').eq('athlete_id', athleteId);
    if (error) throw error;
    totalDurationSecCache = (data || []).reduce((sum: number, r: { duration: number | null }) => sum + (r.duration || 0), 0);
    return totalDurationSecCache;
  };

  let streakCache: number | null = null;
  const getStreak = async (): Promise<number> => {
    if (streakCache != null) return streakCache;
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, distance, start_time')
      .eq('athlete_id', athleteId);
    if (error) throw error;
    const weekKeys = new Set<string>();
    for (const a of (data || []) as Array<{ activity_type: string | null; distance: number | null; start_time: string }>) {
      if (!(a.distance && a.distance > 0)) continue;
      if (a.activity_type && !PR_RUN_TYPES.includes(a.activity_type)) continue;
      weekKeys.add(getActivityWeekStart(new Date(a.start_time)));
    }
    streakCache = computeWeekStreak(weekKeys);
    return streakCache;
  };

  const awarded: AwardedBadgeSummary[] = [];

  for (const badge of toEvaluate) {
    let result: RuleEvalResult;
    try {
      switch (badge.rule_type as BadgeRuleType) {
        case 'pr_bucket':
          result = evalPrBucket(await getQualifyingRuns(), badge.rule_params);
          break;
        case 'cumulative_distance':
          result = evalCumulativeDistance(await getTotalKm(), badge.rule_params);
          break;
        case 'cumulative_duration':
          result = evalCumulativeDuration(await getTotalDurationSeconds(), badge.rule_params);
          break;
        case 'streak_weeks':
          result = evalStreakWeeks(await getStreak(), badge.rule_params);
          break;
        case 'race_count':
          result = await evalRaceCount(supabase, athleteId, badge.rule_params);
          break;
        case 'attendance_perfect_month':
          result = await evalAttendancePerfectMonth(supabase, athleteId);
          break;
        default:
          result = { awarded: false, context: {} };
      }
    } catch {
      // One rule_type's data being unavailable must not block the others.
      result = { awarded: false, context: {} };
    }

    if (!result.awarded) continue;

    const grantedAward = await awardBadge(supabase, athleteId, badge, result.context);
    if (grantedAward) awarded.push({ code: badge.code, nameEn: badge.name_en });
  }

  return { awarded };
}

/**
 * Inserts the athlete_badges row + the feed achievement post + the push.
 * Returns false (no-op) if another concurrent call already awarded this
 * badge (unique_violation on athlete_id+badge_id) — the athlete_badges
 * UNIQUE constraint is the actual source of truth for "already earned".
 *
 * Exported for lib/challenges/engine.ts: a completed challenge is awarded
 * through this exact same helper (challenge_completed rule_type), inheriting
 * the feed post + push rather than duplicating that logic.
 */
export async function awardBadge(
  supabase: SupabaseServer,
  athleteId: string,
  badge: BadgeRow,
  context: Record<string, unknown>,
): Promise<boolean> {
  const { error: insertError } = await supabase.from('athlete_badges').insert({
    athlete_id: athleteId,
    badge_id: badge.id,
    context,
  });
  if (insertError) {
    // 23505 = unique_violation → a concurrent evaluation (e.g. the sync path
    // and the cron overlapping) already awarded it a moment earlier.
    if ((insertError as { code?: string }).code === '23505') return false;
    throw insertError;
  }

  // Feed post — EXACT payload contract (a separate task builds the
  // feed-rendering UI against this shape; do not change field names here).
  try {
    await supabase.from('feed_items').insert({
      type: 'achievement',
      author_athlete_id: athleteId,
      occurred_at: new Date().toISOString(),
      payload: {
        badgeCode: badge.code,
        badgeIcon: badge.icon_url || badge.icon,
        badgeNameHe: badge.name_he,
        badgeNameEn: badge.name_en,
      },
    });
  } catch {
    /* best-effort — the award itself already succeeded */
  }

  // Persist + push — category 'achievements'. No actor/icon: badges are a
  // system award, not person-sourced, so the row shows an icon tile (not an
  // avatar) in the Notification Center, and the push falls back to the
  // Madregot app icon per the existing convention in lib/push.ts/sw.ts.
  await notifyAthlete({
    athleteId,
    kind: 'badge',
    title: `🏅 באדג' חדש: ${badge.name_he}`,
    body: 'לחצו לצפייה בהישג שלכם',
    url: '/dashboard/profile',
    tag: `badge-${badge.code}-${athleteId}`,
    category: 'achievements',
  });

  return true;
}
