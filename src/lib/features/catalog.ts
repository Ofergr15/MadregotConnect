import {
  CLUB_SCOPE_ID, FEATURES, FEATURE_KEYS, PUBLIC_FEATURE_KEYS, isAdminOnlyFeature, isScopeType,
  type EnablementRow, type FeatureKey,
} from './flags';

/**
 * The rollout screen's catalogue: every flag in FEATURES (the single source — this
 * file adds no keys and no copy of its own) with where it is switched on.
 *
 * Per-athlete rows are COUNTED, never listed: the catalogue is for "how far has this
 * gone out", and who exactly has it is the per-feature enablements screen's job,
 * which trims to the caller's own runners.
 */
export interface CatalogEntry {
  key: FeatureKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Readable signed out (GET /api/features/public). */
  public: boolean;
  /** Only an admin may toggle it (native_mgmt_*). */
  adminOnly: boolean;
  scopes: {
    /** The club-wide row: true / false, or null when there is none (= default). */
    club: boolean | null;
    /** The academy-wide row, same shape. */
    academy: boolean | null;
    roles: Array<{ id: string; enabled: boolean }>;
    squads: Array<{ id: string; enabled: boolean }>;
    athletes: { on: number; off: number };
  };
  /** Anything is switched on anywhere. */
  anyEnabled: boolean;
}

export function buildCatalog(rows: EnablementRow[] | null): CatalogEntry[] {
  const byFeature = new Map<string, EnablementRow[]>();
  for (const r of rows || []) {
    if (!isScopeType(r.scope_type)) continue;
    const list = byFeature.get(r.feature) || [];
    list.push(r);
    byFeature.set(r.feature, list);
  }
  return FEATURE_KEYS.map((key) => {
    const def = FEATURES[key];
    const list = byFeature.get(key) || [];
    const club = list.find((r) => r.scope_type === 'club' && r.scope_id === CLUB_SCOPE_ID);
    const academy = list.find((r) => r.scope_type === 'academy');
    const pick = (t: 'role' | 'squad') => list
      .filter((r) => r.scope_type === t)
      .map((r) => ({ id: r.scope_id, enabled: !!r.enabled }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const athleteRows = list.filter((r) => r.scope_type === 'athlete');
    const scopes = {
      club: club ? !!club.enabled : null,
      academy: academy ? !!academy.enabled : null,
      roles: pick('role'),
      squads: pick('squad'),
      athletes: { on: athleteRows.filter((r) => r.enabled).length, off: athleteRows.filter((r) => !r.enabled).length },
    };
    return {
      key,
      label: def.label,
      description: def.description,
      defaultEnabled: def.defaultEnabled,
      public: PUBLIC_FEATURE_KEYS.includes(key),
      adminOnly: isAdminOnlyFeature(key),
      scopes,
      anyEnabled: def.defaultEnabled || list.some((r) => r.enabled),
    };
  });
}
