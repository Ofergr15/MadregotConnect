import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/schema-drift';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

// Access groups, migration 222 — owner-made groups of people with a screen set each.
// Design: review-2026-11-20/access-groups-design.md. Every read here FAILS SAFE to "no
// groups": an unpasted 222 must leave feature resolution exactly as it was.

export const ACCESS_GROUPS_TABLE = 'access_groups';
export const ACCESS_GROUP_MEMBERS_TABLE = 'access_group_members';
export const ACCESS_GROUP_AUDIT_TABLE = 'access_group_audit';

/** Owner-picked colours; the composer offers these and the server accepts any #RRGGBB. */
export const GROUP_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const MAX_GROUP_NAME = 60;
export const MAX_MEMBERS_PER_CALL = 300;

export function cleanGroupName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= MAX_GROUP_NAME ? s : null;
}

export function cleanColor(v: unknown): string | null {
  return typeof v === 'string' && GROUP_COLOR_RE.test(v) ? v.toUpperCase() : null;
}

/** Group ids one athlete belongs to. Missing table / error → []. */
export async function accessGroupIdsOf(db: Db, athleteId: string): Promise<string[]> {
  try {
    const { data, error } = await db.from(ACCESS_GROUP_MEMBERS_TABLE).select('group_id').eq('athlete_id', athleteId);
    if (error) return [];
    return ((data || []) as Array<{ group_id: string }>).map((r) => String(r.group_id));
  } catch {
    return [];
  }
}

/** athlete id → group ids, for every membership. Missing table / error → empty map. */
export async function accessGroupMap(db: Db): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const { data, error } = await db.from(ACCESS_GROUP_MEMBERS_TABLE).select('group_id, athlete_id');
    if (error) return out;
    for (const r of (data || []) as Array<{ group_id: string; athlete_id: string }>) {
      const k = String(r.athlete_id);
      out.set(k, [...(out.get(k) ?? []), String(r.group_id)]);
    }
  } catch { /* fail safe */ }
  return out;
}

export function migrationPending(error: unknown): boolean {
  return isMissingTable(error);
}
