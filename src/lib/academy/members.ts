// The academy centre's shared vocabulary and derivation rules.
//
// Deliberately free of any Supabase import so both the route that builds the
// payload and the client components that render it can pull the same types and
// the same thresholds — and so the rules below are unit-testable without a
// database. `/api/academy/members` does the querying; everything that turns rows
// into judgements lives here.

/** Why a member is surfaced as needing attention. Codes, not sentences — the UI translates them. */
export type AttentionReason =
  | 'not_approved'
  | 'no_watch'
  | 'inactive'
  | 'no_runs'
  | 'low_adherence'
  | 'no_plan';

/**
 * Order the reasons are reported and rendered in, worst first — a member with no
 * watch at all is a bigger problem than one who is merely behind on this week's
 * plan. Lists that show only one badge show the first one that applies.
 */
export const ATTENTION_ORDER: AttentionReason[] = [
  'not_approved', 'no_watch', 'inactive', 'low_adherence', 'no_runs', 'no_plan',
];

/** A member is "inactive" after this many days with no activity at all. */
export const INACTIVE_DAYS = 14;
/** Below this share of planned workouts completed, a member is flagged. */
export const LOW_ADHERENCE = 0.5;

export interface AcademyMember {
  athleteId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  status: string | null;
  role: string | null;
  approved: boolean;
  hasWatch: boolean;
  hasGarmin: boolean;
  hasStrava: boolean;
  joinedAt: string | null;
  weekKm: number;
  weekRuns: number;
  weekDurationMin: number;
  totalKm: number;
  totalRuns: number;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  plannedCount: number;
  completedCount: number;
  /** null when nothing was planned — distinct from a real 0%. */
  completionRate: number | null;
  attention: AttentionReason[];
}

export interface AcademyGroupSummary {
  groupId: string | null;
  groupName: string | null;
  members: number;
  weekKm: number;
  /** null when nobody in the group had a plan this week. */
  completionRate: number | null;
}

export interface AcademyTeamTotals {
  members: number;
  approved: number;
  connected: number;
  activeThisWeek: number;
  needsAttention: number;
  weekKm: number;
  weekRuns: number;
  weekDurationMin: number;
  totalKm: number;
  totalRuns: number;
  planned: number;
  completed: number;
  completionRate: number | null;
}

export interface AcademyMembersResponse {
  weekStart: string;
  members: AcademyMember[];
  groups: AcademyGroupSummary[];
  team: AcademyTeamTotals;
  pending: { registrations: number; results: number };
}

/**
 * Completed-over-planned, or null when nothing was planned.
 *
 * The null matters: "we never gave them a plan" is a coaching gap and "they did
 * none of their plan" is an athlete problem, and a screen that renders both as
 * 0% sends the coach after the wrong person.
 */
export function completionRateOf(planned: number, completed: number): number | null {
  return planned > 0 ? completed / planned : null;
}

/** Sum a list of one-decimal km values without accumulating float noise. */
function addKm(a: number, b: number): number {
  return Math.round((a + b) * 10) / 10;
}

export interface AttentionInput {
  approved: boolean;
  hasWatch: boolean;
  /** null means no activity has ever been recorded. */
  daysSinceActivity: number | null;
  weekRuns: number;
  plannedCount: number;
  completionRate: number | null;
}

export function deriveAttention(m: AttentionInput): AttentionReason[] {
  const attention: AttentionReason[] = [];
  if (!m.approved) attention.push('not_approved');
  if (!m.hasWatch) attention.push('no_watch');
  // Inactive subsumes "no runs this week" — reporting both would list the same
  // person twice under two headings for one underlying fact.
  if (m.daysSinceActivity === null || m.daysSinceActivity >= INACTIVE_DAYS) attention.push('inactive');
  else if (m.weekRuns === 0) attention.push('no_runs');
  // Likewise: with no plan there is no adherence to be low.
  if (m.plannedCount === 0) attention.push('no_plan');
  else if (m.completionRate !== null && m.completionRate < LOW_ADHERENCE) attention.push('low_adherence');
  return attention;
}

/**
 * Per-group rollup. Groupless members are a real bucket (groupId null) rather
 * than dropped — an unassigned academy athlete is exactly the kind of thing a
 * manager needs to see — and it sorts last because it's an exception list, not
 * a squad.
 */
export function rollupGroups(members: AcademyMember[]): AcademyGroupSummary[] {
  const map = new Map<string, AcademyGroupSummary & { planned: number; completed: number }>();
  for (const m of members) {
    const key = m.groupId || '__none__';
    const g = map.get(key) || {
      groupId: m.groupId, groupName: m.groupName, members: 0, weekKm: 0,
      completionRate: null as number | null, planned: 0, completed: 0,
    };
    g.members += 1;
    g.weekKm = addKm(g.weekKm, m.weekKm);
    g.planned += m.plannedCount;
    g.completed += m.completedCount;
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      members: g.members,
      weekKm: g.weekKm,
      completionRate: completionRateOf(g.planned, g.completed),
    }))
    .sort((x, y) => (x.groupId ? 0 : 1) - (y.groupId ? 0 : 1) || y.members - x.members);
}

export function rollupTeam(members: AcademyMember[]): AcademyTeamTotals {
  const totals = members.reduce(
    (acc, m) => ({
      members: acc.members + 1,
      approved: acc.approved + (m.approved ? 1 : 0),
      connected: acc.connected + (m.hasWatch ? 1 : 0),
      activeThisWeek: acc.activeThisWeek + (m.weekRuns > 0 ? 1 : 0),
      needsAttention: acc.needsAttention + (m.attention.length > 0 ? 1 : 0),
      weekKm: addKm(acc.weekKm, m.weekKm),
      weekRuns: acc.weekRuns + m.weekRuns,
      weekDurationMin: acc.weekDurationMin + m.weekDurationMin,
      totalKm: addKm(acc.totalKm, m.totalKm),
      totalRuns: acc.totalRuns + m.totalRuns,
      planned: acc.planned + m.plannedCount,
      completed: acc.completed + m.completedCount,
    }),
    {
      members: 0, approved: 0, connected: 0, activeThisWeek: 0, needsAttention: 0,
      weekKm: 0, weekRuns: 0, weekDurationMin: 0, totalKm: 0, totalRuns: 0, planned: 0, completed: 0,
    },
  );
  return {
    ...totals,
    // Club-level adherence is planned-weighted, not the mean of per-athlete
    // percentages: an athlete with one planned session must not swing the
    // academy's number as hard as one with six.
    completionRate: completionRateOf(totals.planned, totals.completed),
  };
}

/** The zero payload for an academy with no members yet. */
export function emptyTeamTotals(): AcademyTeamTotals {
  return {
    members: 0, approved: 0, connected: 0, activeThisWeek: 0, needsAttention: 0,
    weekKm: 0, weekRuns: 0, weekDurationMin: 0, totalKm: 0, totalRuns: 0,
    planned: 0, completed: 0, completionRate: null,
  };
}
