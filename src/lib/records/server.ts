import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { resolveGroup } from '@/lib/utils';
import { ageBand, hidesPace, type BoardPerson, type RecordFacts } from './board';

type Db = ReturnType<typeof createServerClient>;

export interface RosterPerson extends BoardPerson, RecordFacts {
  squadCompare: boolean;
}

/**
 * The active roster with everything the boards filter on. Migration 195
 * (leaderboard_opt_out, squad_compare) may not be pasted yet: a missing column
 * reads as `false`, never as an error.
 */
export async function readRoster(db: Db, todayIso: string): Promise<RosterPerson[]> {
  const base = 'id, name, avatar_url, group_id, gender, birth_date, default_hidden_fields, groups!group_id(name)';
  let rows: any[] | null = null;
  const first = await db.from('athletes').select(`${base}, leaderboard_opt_out, squad_compare`)
    .eq('coach_id', COACH_ID).eq('status', 'active');
  if (first.error && isMissingColumn(first.error)) {
    // Pre-195 (and possibly pre-193 for default_hidden_fields).
    const second = await db.from('athletes').select(base).eq('coach_id', COACH_ID).eq('status', 'active');
    if (second.error && isMissingColumn(second.error)) {
      const third = await db.from('athletes').select('id, name, avatar_url, group_id, gender, birth_date, groups!group_id(name)')
        .eq('coach_id', COACH_ID).eq('status', 'active');
      if (third.error) throw third.error;
      rows = third.data;
    } else if (second.error) throw second.error;
    else rows = second.data;
  } else if (first.error) throw first.error;
  else rows = first.data;

  return (rows || []).map((a: any) => {
    const g = resolveGroup(a.groups?.name ?? null);
    return {
      id: String(a.id),
      name: a.name ?? '',
      avatarUrl: typeof a.avatar_url === 'string' && a.avatar_url ? a.avatar_url : null,
      groupId: a.group_id ? String(a.group_id) : null,
      groupIndex: g.index >= 0 ? g.index + 1 : null,
      optOut: !!a.leaderboard_opt_out,
      hidesPace: hidesPace(a.default_hidden_fields),
      squadCompare: !!a.squad_compare,
      gender: a.gender === 'male' || a.gender === 'female' ? a.gender : null,
      ageBand: ageBand(a.birth_date ?? null, todayIso),
    };
  });
}

/** The caller's own privacy switches, for the tab and Settings → Privacy. */
export function myPrivacy(me: RosterPerson | undefined) {
  return {
    leaderboardOptOut: !!me?.optOut,
    squadCompare: !!me?.squadCompare,
    hidesPace: !!me?.hidesPace,
  };
}

/** activity ids that are an approved official race (race_results, 163). Empty pre-163. */
export async function officialActivityIds(db: Db): Promise<Set<string>> {
  try {
    const { data, error } = await db.from('race_results').select('activity_id').is('deleted_at', null).not('activity_id', 'is', null);
    if (error) return new Set();
    return new Set(((data || []) as { activity_id: string }[]).map((r) => String(r.activity_id)));
  } catch {
    return new Set();
  }
}

/** Best 2000 m benchmark per athlete. */
export async function benchmarkBests(db: Db): Promise<Array<{ athleteId: string; seconds: number; date: string | null }>> {
  const { data, error } = await db.from('benchmark_results')
    .select('athlete_id, time_seconds, test_name, recorded_on')
    .eq('coach_id', COACH_ID).eq('test_name', '2000m').not('athlete_id', 'is', null);
  if (error) return [];
  const best = new Map<string, { athleteId: string; seconds: number; date: string | null }>();
  for (const r of (data || []) as any[]) {
    const s = Number(r.time_seconds);
    if (!Number.isFinite(s) || s <= 0) continue;
    const cur = best.get(r.athlete_id);
    if (!cur || s < cur.seconds) best.set(r.athlete_id, { athleteId: String(r.athlete_id), seconds: Math.round(s), date: r.recorded_on ?? null });
  }
  return [...best.values()];
}
