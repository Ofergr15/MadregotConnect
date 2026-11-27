import type { createServerClient } from '@/lib/supabase/server';
import { resolveGroup } from '@/lib/utils';
import type { Lane } from '@/lib/academy/group-lane';
import { COACH_ID } from '@/lib/constants';
import { paceGroupMap, type PaceGroupKey } from '@/lib/plans/pace-group';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Which pack a member was in on a given day (migration 145).
 *
 * A run is judged against the pack its runner was in WHEN they ran it. Reading
 * athletes.group_id instead — the pack today — re-scored a moved member's whole
 * history against the new pack's paces. Members who never moved have no rows, so
 * they resolve to group_id exactly as before.
 */

export interface PackHistoryRow {
  athlete_id: string;
  group_id: string | null;
  from_date: string;
  created_at?: string | null;
}

/** The start of "always": the previous pack's row written on a first move. */
export const PACK_HISTORY_EPOCH = '2000-01-01';

/**
 * The group in effect on `date` (YYYY-MM-DD): the latest row starting on or before
 * it, a later write winning a same-day tie (two moves in one afternoon). No row
 * that early — or no rows at all — is the current group.
 */
export function packOn(rows: PackHistoryRow[], currentGroupId: string | null, date: string): string | null {
  let best: PackHistoryRow | null = null;
  for (const r of rows) {
    if (r.from_date > date) continue;
    if (
      !best
      || r.from_date > best.from_date
      || (r.from_date === best.from_date && (r.created_at ?? '') > (best.created_at ?? ''))
    ) best = r;
  }
  return best ? best.group_id : currentGroupId;
}

/** Group name → lane, the same rule every reader used: unknown is lane 2. */
export function laneOfName(name: string | null | undefined): Lane {
  const index = resolveGroup(name).index;
  return (index >= 0 ? index + 1 : 2) as Lane;
}

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === 'PGRST205' || error.code === '42P01' || /athlete_pack_history/i.test(error.message || ''));

export async function readPackHistory(supabase: SupabaseServer, athleteIds: string[]): Promise<PackHistoryRow[]> {
  if (athleteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('athlete_pack_history')
    .select('athlete_id, group_id, from_date, created_at')
    .in('athlete_id', athleteIds);
  // Before 145 is pasted, and on any read failure, nobody has history: everyone
  // resolves to their current pack, which is what the app did until now.
  if (error) return [];
  return (data || []) as PackHistoryRow[];
}

/**
 * `(athleteId, date) => lane` for a set of athletes, in three reads that go out
 * together (athletes, groups, history) — the feed calls this on its critical path.
 */
export async function loadPackLanes(
  supabase: SupabaseServer,
  athleteIds: string[],
): Promise<(athleteId: string, date: string) => Lane> {
  const ids = [...new Set(athleteIds)];
  if (ids.length === 0) return () => 2;
  const [athletesRes, groupsRes, history] = await Promise.all([
    supabase.from('athletes').select('id, group_id').in('id', ids),
    supabase.from('groups').select('id, name, coach_id, pace_profile'),
    readPackHistory(supabase, ids),
  ]);
  const current = new Map((athletesRes.data || []).map((a: { id: string; group_id: string | null }) => [a.id, a.group_id]));
  type GroupRow = { id: string; name: string | null; coach_id?: string | null; pace_profile?: { marathonGoal?: string | number | null } | null };
  const groupRows = (groupsRes.data || []) as GroupRow[];
  const nameById = new Map(groupRows.map((g) => [g.id, g.name]));
  const keyById = laneKeysLikeTheWatch(groupRows);
  const byAthlete = new Map<string, PackHistoryRow[]>();
  for (const r of history) {
    const list = byAthlete.get(r.athlete_id);
    if (list) list.push(r); else byAthlete.set(r.athlete_id, [r]);
  }
  return (athleteId, date) => {
    const groupId = packOn(byAthlete.get(athleteId) || [], current.get(athleteId) ?? null, date);
    if (!groupId) return laneOfName(null);
    // The lane the WATCH got its paces from (pace-group.ts), so a run is graded
    // against the targets that were on the wrist. Grading by name alone put a
    // pack-3 runner whose group isn't named "SUB 2:45"/"Group 3" on lane 2.
    const key = keyById[groupId];
    return key ? LANE_OF_KEY[key] : laneOfName(nameById.get(groupId));
  };
}

const LANE_OF_KEY: Record<PaceGroupKey, Lane> = { group1: 1, group2: 2, group3: 3 };

/** group id → plan variant, by the same rule and over the same groups the watch push uses. */
export function laneKeysLikeTheWatch(
  groups: Array<{ id: string; coach_id?: string | null; pace_profile?: { marathonGoal?: string | number | null } | null }>,
): Record<string, PaceGroupKey> {
  const clubGroups = groups.filter((g) => g.coach_id === undefined || g.coach_id === COACH_ID);
  // Ranking means something only when every pack states a goal; otherwise keep the name rule.
  const hasGoal = (g: (typeof clubGroups)[number]) => {
    const goal = g.pace_profile?.marathonGoal;
    return goal !== null && goal !== undefined && goal !== '';
  };
  if (clubGroups.length === 0 || !clubGroups.every(hasGoal)) return {};
  return paceGroupMap(clubGroups.map((g) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null })));
}

/**
 * Write a move. Called by both places a pack changes (a coach's move in PUT
 * /api/athletes, a member's Saturday change in the tick), AFTER group_id is updated.
 *
 * On a member's first move the previous pack is written from the epoch first, so
 * the days before `fromDate` still resolve to it. Best effort: a failure here
 * leaves the move itself in place and only costs the history of this one change.
 */
export async function recordPackChange(
  supabase: SupabaseServer,
  p: { athleteId: string; fromGroupId: string | null; toGroupId: string | null; fromDate: string; by: 'coach' | 'self' },
): Promise<void> {
  if (p.fromGroupId === p.toGroupId) return;
  try {
    const { count, error } = await supabase
      .from('athlete_pack_history')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', p.athleteId);
    if (isMissingTable(error)) return;
    const rows: Array<Record<string, unknown>> = [];
    if (!count && p.fromGroupId) {
      rows.push({ athlete_id: p.athleteId, group_id: p.fromGroupId, from_date: PACK_HISTORY_EPOCH, changed_by: 'seed' });
    }
    rows.push({ athlete_id: p.athleteId, group_id: p.toGroupId, from_date: p.fromDate, changed_by: p.by });
    await supabase.from('athlete_pack_history').insert(rows);
  } catch { /* best effort — see above */ }
}

/**
 * Which pack a leader marked each runner present with, per (athlete, date) — the
 * attendance evidence a run's graded lane may move on (ran-lane.ts, Q27-2). Only a
 * leader's 'present' mark counts: a 'watch' auto-mark is inferred from the run's start
 * time, which every pack sharing a meeting point would match equally. Two packs on one
 * day is no answer. Empty when the table (216) is missing or unreadable.
 */
export async function loadAttendedLanes(
  supabase: SupabaseServer,
  athleteIds: string[],
  dates: string[],
): Promise<(athleteId: string, date: string) => Lane | null> {
  const ids = [...new Set(athleteIds)];
  const days = [...new Set(dates)];
  const none = () => null;
  if (!ids.length || !days.length) return none;
  try {
    const [marks, groupsRes] = await Promise.all([
      supabase.from('pack_attendance').select('athlete_id, session_date, pack_id')
        .in('athlete_id', ids).in('session_date', days).eq('status', 'present').eq('source', 'leader'),
      supabase.from('groups').select('id, name, coach_id, pace_profile'),
    ]);
    if (marks.error || !marks.data?.length) return none;
    type GroupRow = { id: string; name: string | null; coach_id?: string | null; pace_profile?: { marathonGoal?: string | number | null } | null };
    const groupRows = (groupsRes.data || []) as GroupRow[];
    const keyById = laneKeysLikeTheWatch(groupRows);
    const nameById = new Map(groupRows.map((g) => [g.id, g.name]));
    const laneOf = (packId: string): Lane => (keyById[packId] ? LANE_OF_KEY[keyById[packId]] : laneOfName(nameById.get(packId)));
    const byKey = new Map<string, Set<Lane>>();
    for (const r of marks.data as Array<{ athlete_id: string; session_date: string; pack_id: string }>) {
      const k = `${r.athlete_id}|${String(r.session_date).slice(0, 10)}`;
      const set = byKey.get(k) ?? new Set<Lane>();
      set.add(laneOf(r.pack_id));
      byKey.set(k, set);
    }
    return (athleteId, date) => {
      const set = byKey.get(`${athleteId}|${date}`);
      return set && set.size === 1 ? [...set][0] : null;
    };
  } catch {
    return none;
  }
}
