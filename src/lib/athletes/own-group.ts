import { resolveGroup } from '@/lib/utils';

/**
 * The caller's own pace group, for GET /api/athletes/me (perf S1): השבוע and the
 * profile used to download 30 feed items just to learn it. Identity goes through
 * resolveGroup — the one source of truth — never re-derived inline.
 */
export function ownGroup(row: { group_id?: string | null; groups?: { name?: string | null } | null }) {
  if (!row.group_id) return null;
  const name = row.groups?.name ?? null;
  const g = resolveGroup(name);
  return { id: String(row.group_id), name, index: g.index >= 0 ? g.index + 1 : null, displayName: g.displayName, level: g.level };
}
