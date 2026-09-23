/**
 * Runners the club hasn't let in yet (#77, #86).
 *
 * A pending runner can connect Garmin or Strava before anyone approves them,
 * and from that moment their activities, PRs and challenge progress landed in
 * everyone's feed. Search, leaderboards and standings already filtered on
 * `status = 'active'`; the feed, the athlete pages and the pushes did not.
 *
 * "Pending" is `approved = false` — the same reading as membership.ts: a row
 * that was never let in. A runner who WAS approved and later went inactive is
 * not hidden here; their history stays.
 *
 * The data is kept: once approved, everything they synced shows up.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Ids of every athlete still waiting for approval. Empty on a read error — never hide the whole feed. */
export async function pendingAthleteIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from('athletes').select('id').eq('approved', false);
  if (error) {
    console.error('pendingAthleteIds:', error.message);
    return new Set();
  }
  return new Set((data || []).map((r: { id: string }) => r.id));
}

export async function isPendingAthlete(supabase: SupabaseClient, athleteId: string | null | undefined): Promise<boolean> {
  if (!athleteId) return false;
  const { data } = await supabase.from('athletes').select('approved').eq('id', athleteId).maybeSingle();
  return (data as { approved?: boolean | null } | null)?.approved === false;
}

/**
 * Drop the feed rows a pending runner wrote. Rows with no author (club
 * announcements) always stay.
 */
export function withoutPendingAuthors<T extends { author_athlete_id?: string | null }>(rows: T[], pending: Set<string>): T[] {
  if (pending.size === 0) return rows;
  return rows.filter(r => !r.author_athlete_id || !pending.has(r.author_athlete_id));
}

/** Whether the caller may still see a pending runner: themselves, or staff approving them. */
export const seesPending = (caller: { isStaff?: boolean; athleteId?: string | null }, targetId: string) =>
  !!caller.isStaff || caller.athleteId === targetId;
