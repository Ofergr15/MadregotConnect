// ═════════════════════════════════════════════════════════════════════════════
// FEATURE ENABLEMENT — a gated rollout, OFF unless someone turned it on.
//
// Ofer (2026-11-21), about runner feedback + pain reports: "we won't use it at
// first; we need to see it's right for trainees". So a feature is invisible to an
// athlete until a row in `feature_enablements` (migration 191) says otherwise, and
// the people who may write such a row are scoped by who they are responsible for:
//
//   coach            → an athlete they coach (club coach: any club runner;
//                      academy coach: their own trainees)
//   academy manager  → any academy trainee, one by one, or the whole academy
//   admin / super    → anyone: athlete, squad, role, academy, or the whole club
//
// Precedence is MOST SPECIFIC WINS, and an explicit `enabled: false` is an answer,
// not an absence: a coach can switch one runner off inside a squad an admin turned on.
//
//   athlete > squad > academy > role > club > default (off)
//
// Everything in this file is pure; the DB reads live in ./server.ts.
// ═════════════════════════════════════════════════════════════════════════════

export const FEATURES = {
  /** Post-workout feedback prompts + pain reports (design/feedback-prototype). */
  feedback_pain: { label: 'משוב ודיווח כאב', defaultEnabled: false },
} as const;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(v: unknown): v is FeatureKey {
  return typeof v === 'string' && (FEATURE_KEYS as string[]).includes(v);
}

export const SCOPE_TYPES = ['athlete', 'squad', 'academy', 'role', 'club'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Lower = more specific = wins. */
export const SCOPE_RANK: Record<ScopeType, number> = { athlete: 0, squad: 1, academy: 2, role: 3, club: 4 };

/** The fixed `scope_id` of the two scopes that name no row. */
export const ACADEMY_SCOPE_ID = 'academy';
export const CLUB_SCOPE_ID = '*';

export function isScopeType(v: unknown): v is ScopeType {
  return typeof v === 'string' && (SCOPE_TYPES as readonly string[]).includes(v);
}

export interface EnablementRow {
  feature: string;
  scope_type: ScopeType;
  scope_id: string;
  enabled: boolean;
  set_by?: string | null;
  set_at?: string | null;
}

/** What the resolver needs to know about the athlete. */
export interface AthleteFacts {
  id: string;
  groupId?: string | null;
  role?: string | null;
  extraRoles?: string[] | null;
  isAcademy?: boolean;
}

export interface Resolution {
  enabled: boolean;
  /** The row that decided it, or null for the default. */
  source: { scopeType: ScopeType; scopeId: string; setBy: string | null; setAt: string | null } | null;
}

/** Does this row apply to this athlete at all? */
export function rowApplies(row: EnablementRow, a: AthleteFacts): boolean {
  switch (row.scope_type) {
    case 'athlete': return row.scope_id === a.id;
    case 'squad': return !!a.groupId && row.scope_id === String(a.groupId);
    case 'academy': return !!a.isAcademy && row.scope_id === ACADEMY_SCOPE_ID;
    case 'role': return row.scope_id === a.role || !!a.extraRoles?.includes(row.scope_id);
    case 'club': return row.scope_id === CLUB_SCOPE_ID;
    default: return false;
  }
}

/**
 * Most-specific-wins. Two rows at the same rank can only both apply for `role`
 * (an athlete holding two roles): there an explicit OFF beats ON, the cautious
 * reading of a contradiction.
 */
export function resolveFeature(feature: FeatureKey, rows: EnablementRow[], a: AthleteFacts): Resolution {
  let best: EnablementRow | null = null;
  for (const r of rows) {
    if (r.feature !== feature || !isScopeType(r.scope_type) || !rowApplies(r, a)) continue;
    if (!best) { best = r; continue; }
    const d = SCOPE_RANK[r.scope_type] - SCOPE_RANK[best.scope_type];
    if (d < 0 || (d === 0 && best.enabled && !r.enabled)) best = r;
  }
  if (!best) return { enabled: FEATURES[feature].defaultEnabled, source: null };
  return {
    enabled: !!best.enabled,
    source: { scopeType: best.scope_type, scopeId: best.scope_id, setBy: best.set_by ?? null, setAt: best.set_at ?? null },
  };
}

// ── Who may toggle what ──────────────────────────────────────────────────────

export interface ToggleCaller {
  athleteId: string | null;
  role: string | null;
  roles?: string[] | null;
  isSuperUser: boolean;
}

export interface ToggleTarget {
  scopeType: ScopeType;
  scopeId: string;
  /** For an athlete scope: the target's facts plus whether the caller coaches them. */
  athlete?: { isAcademy: boolean; coachedByCaller: boolean } | null;
}

const has = (c: ToggleCaller, role: string) => c.role === role || !!c.roles?.includes(role);

export function isAdminCaller(c: ToggleCaller): boolean {
  return c.isSuperUser || has(c, 'admin');
}

export function isAcademyManagerCaller(c: ToggleCaller): boolean {
  return has(c, 'academy_manager');
}

/** Which scope types this caller may write at all — what the management screen offers. */
export function allowedScopeTypes(c: ToggleCaller): ScopeType[] {
  if (isAdminCaller(c)) return [...SCOPE_TYPES];
  const out: ScopeType[] = [];
  if (isAcademyManagerCaller(c) || has(c, 'coach') || has(c, 'academy_coach')) out.push('athlete');
  if (isAcademyManagerCaller(c)) out.push('academy');
  return out;
}

/**
 * The one decision every write route asks. A body field never widens it: the
 * route derives `coachedByCaller` and `isAcademy` from the DB, not the request.
 */
export function mayToggle(c: ToggleCaller, t: ToggleTarget): boolean {
  if (isAdminCaller(c)) return true;
  if (t.scopeType === 'academy') return isAcademyManagerCaller(c) && t.scopeId === ACADEMY_SCOPE_ID;
  if (t.scopeType !== 'athlete' || !t.athlete) return false;
  if (c.athleteId && t.scopeId === c.athleteId) return false; // nobody gates themselves in
  if (isAcademyManagerCaller(c) && t.athlete.isAcademy) return true;
  if (t.athlete.coachedByCaller && (has(c, 'coach') || has(c, 'academy_coach'))) return true;
  return false;
}

/**
 * Does this coach coach this athlete? Club coach (`coach`): every club runner who is
 * not an academy trainee, plus academy trainees they are linked to. Academy coach:
 * only linked trainees.
 */
export function coachesAthlete(c: ToggleCaller, a: { isAcademy: boolean; academyCoachIds: string[] }): boolean {
  if (!c.athleteId) return false;
  if (a.academyCoachIds.includes(c.athleteId)) return true;
  return !a.isAcademy && has(c, 'coach');
}

/** Which athletes the caller's management screen lists. */
export function visibleToManager(c: ToggleCaller, a: { isAcademy: boolean; academyCoachIds: string[] }): boolean {
  if (isAdminCaller(c)) return true;
  if (isAcademyManagerCaller(c) && a.isAcademy) return true;
  return coachesAthlete(c, a);
}
