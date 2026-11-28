import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { accessGroupIdsOf } from '@/lib/access-groups/store';
import {
  resolveFeature, type AthleteFacts, type EnablementRow, type FeatureKey, type Resolution,
} from './flags';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const ENABLEMENTS_TABLE = 'feature_enablements';
export const ENABLEMENT_AUDIT_TABLE = 'feature_enablement_audit';

/** Every row for one feature. A missing table (migration 191 not pasted) is "no rows" = off. */
export async function enablementRows(feature: FeatureKey, db: Db = createServerClient()): Promise<EnablementRow[] | null> {
  try {
    const { data, error } = await db
      .from(ENABLEMENTS_TABLE)
      .select('feature, scope_type, scope_id, enabled, set_by, set_at')
      .eq('feature', feature);
    if (error) return isMissingTable(error) ? null : [];
    return (data || []) as EnablementRow[];
  } catch {
    return [];
  }
}

/** Every row for several features in ONE round trip. Same failure rules as enablementRows. */
export async function enablementRowsFor(features: readonly FeatureKey[], db: Db = createServerClient()): Promise<EnablementRow[] | null> {
  return (await readEnablementRows(features, db)).rows;
}

/**
 * Same read, but says whether it FAILED (any error other than "table missing", or a throw).
 * The rows are the same fail-closed answer; `failed` lets a cached caller refuse to let a
 * CDN keep that fallback (features/public, QA 24.11 Q24-5).
 */
export async function readEnablementRows(
  features: readonly FeatureKey[],
  db: Db = createServerClient(),
): Promise<{ rows: EnablementRow[] | null; failed: boolean }> {
  try {
    const { data, error } = await db
      .from(ENABLEMENTS_TABLE)
      .select('feature, scope_type, scope_id, enabled, set_by, set_at')
      .in('feature', features as FeatureKey[]);
    if (error) return isMissingTable(error) ? { rows: null, failed: false } : { rows: [], failed: true };
    return { rows: (data || []) as EnablementRow[], failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

export async function athleteFacts(athleteId: string, db: Db = createServerClient()): Promise<AthleteFacts | null> {
  const [base, accessGroupIds] = await Promise.all([baseFacts(athleteId, db), accessGroupIdsOf(db, athleteId)]);
  return base ? { ...base, accessGroupIds } : null;
}

async function baseFacts(athleteId: string, db: Db): Promise<AthleteFacts | null> {
  const { data } = await db
    .from('athletes')
    .select('id, group_id, role, extra_roles, is_academy')
    .eq('id', athleteId)
    .maybeSingle();
  if (!data) {
    // Pre-127 databases have no extra_roles.
    const { data: d2 } = await db.from('athletes').select('id, group_id, role, is_academy').eq('id', athleteId).maybeSingle();
    if (!d2) return null;
    return { id: String(d2.id), groupId: d2.group_id ? String(d2.group_id) : null, role: d2.role, isAcademy: !!d2.is_academy };
  }
  return {
    id: String(data.id),
    groupId: data.group_id ? String(data.group_id) : null,
    role: data.role,
    extraRoles: (data.extra_roles as string[] | null) ?? [],
    isAcademy: !!data.is_academy,
  };
}

/** The resolver every gated route calls. Fails CLOSED: any doubt is "off". */
export async function featureResolution(feature: FeatureKey, athleteId: string, db: Db = createServerClient()): Promise<Resolution> {
  const [rows, facts] = await Promise.all([enablementRows(feature, db), athleteFacts(athleteId, db)]);
  if (!rows || !facts) return { enabled: false, source: null };
  return resolveFeature(feature, rows, facts);
}

/**
 * Many features for one athlete in TWO round trips (all enablement rows + the athlete), run together.
 * Same answers as calling featureResolution per key — resolveFeature only reads its own feature's rows.
 */
export async function featureResolutions(
  features: readonly FeatureKey[], athleteId: string, db: Db = createServerClient(),
): Promise<Record<string, Resolution>> {
  const [rows, facts] = await Promise.all([enablementRowsFor(features, db), athleteFacts(athleteId, db)]);
  const out: Record<string, Resolution> = {};
  for (const f of features) out[f] = rows && facts ? resolveFeature(f, rows, facts) : { enabled: false, source: null };
  return out;
}

export async function isFeatureEnabled(feature: FeatureKey, athleteId: string | null | undefined, db?: Db): Promise<boolean> {
  if (!athleteId) return false;
  return (await featureResolution(feature, athleteId, db)).enabled;
}

/** Academy-coach links for a page of athletes, best effort. */
export async function academyCoachIds(db: Db, athleteId: string): Promise<string[]> {
  return coachIdsOf(db, athleteId).catch(() => [] as string[]);
}
