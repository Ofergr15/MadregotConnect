/**
 * Challenge award-evaluation engine (roadmap #13, Phase 4 — see
 * supabase/migrations/062_challenges.sql). Mirrors lib/badges/award-engine.ts:
 * `checkAndAwardChallenges` is the one place that decides whether an athlete
 * (or, for a 'group' challenge, their whole pace group) has hit a challenge's
 * target within its date window, and awards the underlying badge via the
 * SAME `awardBadge` helper badges uses — a completed challenge inherits the
 * feed post + push for free, no duplicated logic.
 *
 * Call sites (fire-and-forget, best-effort, same places as
 * checkAndAwardBadges): after Garmin/Strava activity sync. Challenges are
 * inherently time-boxed, so — unlike badges — this does NOT need a daily cron
 * sweep: nothing changes for a challenge between one athlete's activity syncs.
 */
import { createServerClient } from '@/lib/supabase/server';
import { awardBadge, type BadgeRow } from '@/lib/badges/award-engine';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';

export type ChallengeMetric = 'distance_km' | 'workout_count' | 'elevation_m';
export type ChallengeScope = 'individual' | 'group';

export interface ChallengeRow {
  id: string;
  badge_id: string;
  name_he: string;
  name_en: string;
  metric: ChallengeMetric;
  target_value: number;
  scope: ChallengeScope;
  start_date: string;
  end_date: string;
}

interface ActivityForMetric extends RunActivityRow {
  elevation_gain?: number | null;
}

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Sums the given metric across activities within [startDate, endDate]
 * (inclusive, by the activity's local start_time date). Pure — no I/O — so
 * it's unit-testable without a DB. Restricted to qualifying runs throughout
 * (same run-type filter as PRs/badges) so a challenge can't be padded with a
 * walk or an untagged GPS glitch.
 */
export function computeMetricValue(
  metric: ChallengeMetric,
  activities: ActivityForMetric[],
  startDate: string,
  endDate: string,
): number {
  const inWindow = activities.filter((a) => {
    const d = a.start_time.slice(0, 10);
    return d >= startDate && d <= endDate;
  });
  const qualifying = filterQualifyingRuns(inWindow);
  switch (metric) {
    case 'distance_km':
      return qualifying.reduce((sum, a) => sum + (a.distance || 0), 0) / 1000;
    case 'workout_count':
      return qualifying.length;
    case 'elevation_m':
      return qualifying.reduce((sum, a) => sum + (a.elevation_gain || 0), 0);
    default:
      return 0;
  }
}

/**
 * The set of athletes whose activities count toward `athleteId`'s progress
 * on this challenge: just themself for 'individual', or their whole pace
 * group (pooled) for 'group'. Empty for a 'group' challenge when the athlete
 * has no group — a group challenge simply can't apply to them.
 */
async function resolveParticipantIds(
  supabase: SupabaseServer,
  athleteId: string,
  scope: ChallengeScope,
): Promise<string[]> {
  if (scope === 'individual') return [athleteId];
  const { data: self } = await supabase.from('athletes').select('group_id').eq('id', athleteId).maybeSingle();
  const groupId = (self as { group_id?: string | null } | null)?.group_id;
  if (!groupId) return [];
  const { data: members } = await supabase.from('athletes').select('id').eq('group_id', groupId);
  return (members || []).map((m: { id: string }) => m.id);
}

/** `date` (YYYY-MM-DD) shifted by whole days, as YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The participants' activities inside the challenge window.
 *
 * The window is pushed to the server, and that is a correctness fix rather than a
 * tuning one. PostgREST caps a response at 1000 rows and says nothing when it
 * truncates. This read had no date filter and no `.order()` at all, while its only
 * caller immediately narrowed the result to `[start_date, end_date]` — so a
 * few-week challenge was being computed from an arbitrary thousand rows drawn out
 * of a decade of running. Measured 2026-09-13: `athlete_activities` holds 30,278
 * rows across 23 athletes, and 14 athletes are individually past 1000. For a
 * `group`-scope challenge the participant set is a whole pace group, so the
 * shortfall was worst exactly where the feature matters.
 *
 * What that looked like: progress reading far too LOW, frequently 0, a challenge
 * the group had genuinely completed never awarding its badge, and — because an
 * unordered OFFSET-less read is not stable — the bar moving on refresh.
 *
 * Padded a day either side on purpose. `computeMetricValue` remains the authority
 * on the window; it compares `start_time.slice(0, 10)` as text, whereas this is a
 * timestamptz comparison, and `start_time` holds the watch's LOCAL wall clock
 * (Convention A) rather than a true instant. The pad makes this filter a strict
 * superset of what the caller keeps, so no arithmetic disagreement between the two
 * layers can ever drop a run the athlete actually did.
 */
async function fetchActivities(
  supabase: SupabaseServer,
  athleteIds: string[],
  startDate: string,
  endDate: string,
): Promise<ActivityForMetric[]> {
  if (athleteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('athlete_activities')
    .select('activity_type, start_time, distance, duration, elevation_gain')
    .in('athlete_id', athleteIds)
    .gte('start_time', shiftDate(startDate, -1))
    .lt('start_time', shiftDate(endDate, 2));
  if (error) throw error;
  return (data || []) as ActivityForMetric[];
}

/**
 * Live progress for one athlete against one currently-active challenge — the
 * read side for GET /api/challenges. For a 'group' challenge, this is the
 * athlete's WHOLE pace group's pooled progress (matches how it's actually
 * won), not just their own.
 */
export async function computeChallengeProgress(
  supabase: SupabaseServer,
  athleteId: string,
  challenge: ChallengeRow,
): Promise<number> {
  const participantIds = await resolveParticipantIds(supabase, athleteId, challenge.scope);
  if (participantIds.length === 0) return 0;
  const activities = await fetchActivities(supabase, participantIds, challenge.start_date, challenge.end_date);
  return computeMetricValue(challenge.metric, activities, challenge.start_date, challenge.end_date);
}

/**
 * Evaluates every currently-active challenge for one athlete, awarding
 * anything newly completed. For a 'group' challenge that crosses its target,
 * EVERY member of that athlete's group is awarded (not just the one whose
 * sync triggered this check) — `awardBadge`'s unique_violation handling
 * makes re-awarding an already-completed member a safe no-op.
 */
export async function checkAndAwardChallenges(athleteId: string): Promise<{ awarded: string[] }> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from('challenges')
    .select('id, badge_id, name_he, name_en, metric, target_value, scope, start_date, end_date')
    .eq('active', true)
    .lte('start_date', today)
    .gte('end_date', today);
  if (error) return { awarded: [] }; // migration 062 may not be applied yet — degrade gracefully

  const challenges = (rows || []) as ChallengeRow[];
  if (challenges.length === 0) return { awarded: [] };

  // Separate queries + a manual JS join, not an embedded-relation select
  // string — the untyped Supabase client can't infer a proper row type
  // across relations (same reason GET /api/athletes/badges joins in JS).
  const { data: badgeRows } = await supabase
    .from('badges')
    .select('id, code, name_he, name_en, icon, icon_url, rule_type, rule_params')
    .in('id', challenges.map((c) => c.badge_id));
  const badgeById = new Map(((badgeRows || []) as BadgeRow[]).map((b) => [b.id, b]));

  const { data: ownAwards } = await supabase.from('athlete_badges').select('badge_id').eq('athlete_id', athleteId);
  const alreadyAwarded = new Set((ownAwards || []).map((r: { badge_id: string }) => r.badge_id));

  const awarded: string[] = [];

  for (const challenge of challenges) {
    if (alreadyAwarded.has(challenge.badge_id)) continue;
    const badge = badgeById.get(challenge.badge_id);
    if (!badge) continue;

    try {
      const participantIds = await resolveParticipantIds(supabase, athleteId, challenge.scope);
      if (participantIds.length === 0) continue;
      const activities = await fetchActivities(supabase, participantIds, challenge.start_date, challenge.end_date);
      const value = computeMetricValue(challenge.metric, activities, challenge.start_date, challenge.end_date);
      if (value < challenge.target_value) continue;

      const context = { challengeId: challenge.id, finalValue: Math.round(value * 10) / 10 };
      // Individual → just this athlete. Group → every pooled member, since
      // the whole group just won together (existing holders are a harmless
      // no-op via athlete_badges' unique constraint inside awardBadge).
      const toAward = challenge.scope === 'individual' ? [athleteId] : participantIds;
      for (const memberId of toAward) {
        const grantedAward = await awardBadge(supabase, memberId, badge, context);
        if (grantedAward && memberId === athleteId) awarded.push(badge.code);
      }
    } catch {
      // One challenge's data being unavailable must not block the others.
      continue;
    }
  }

  return { awarded };
}
