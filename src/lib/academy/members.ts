// The academy centre's shared vocabulary and derivation rules.
//
// Deliberately free of any Supabase import so both the route that builds the
// payload and the client components that render it can pull the same types and
// the same thresholds — and so the rules below are unit-testable without a
// database. `/api/academy/members` does the querying; everything that turns rows
// into judgements lives here.

import { canResolvePaces, sortBands, type AcademyBand } from './bands';

/** Why a member is surfaced as needing attention. Codes, not sentences — the UI translates them. */
export type AttentionReason =
  | 'not_approved'
  | 'no_coach'
  | 'no_band'
  | 'no_watch'
  | 'inactive'
  | 'no_runs'
  | 'low_adherence'
  | 'no_plan';

/**
 * Order the reasons are reported and rendered in, worst first — a member with no
 * watch at all is a bigger problem than one who is merely behind on this week's
 * plan. Lists that show only one badge show the first one that applies.
 *
 * `no_coach` sits second because in a 1:1 academy an unpaired trainee isn't
 * training at all: nobody writes their plan and nobody meets them. Only an
 * unreviewed registration outranks it, and that one is a different queue.
 *
 * `no_band` follows immediately, because it blocks the same thing for a different
 * reason: without a goal band there are no paces to resolve, so the planner
 * cannot send this trainee a workout even though someone is responsible for them.
 */
export const ATTENTION_ORDER: AttentionReason[] = [
  'not_approved', 'no_coach', 'no_band', 'no_watch', 'inactive', 'low_adherence', 'no_runs', 'no_plan',
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
  /** The dedicated 1:1 coach. Null means nobody is responsible for this trainee. */
  academyCoachId: string | null;
  /** Resolved for display; null when unpaired, or when the coach isn't a club athlete. */
  academyCoachName: string | null;
  /**
   * The trainee's goal band (דבוקה). Null means unassigned — which blocks the
   * planner, because a band is where their paces come from.
   */
  band: AcademyBand | null;
  /**
   * Per-athlete pace override in sec/km, or null to follow the band. Kept beside
   * the band rather than pre-resolved into one number so the UI can say which of
   * the two a coach is about to change.
   */
  paceOffsetSec: number | null;
  status: string | null;
  role: string | null;
  approved: boolean;
  hasWatch: boolean;
  hasGarmin: boolean;
  hasStrava: boolean;
  /** When they joined the *club*, as a timestamp. */
  joinedAt: string | null;
  /**
   * When they joined the academy, as a plain 'YYYY-MM-DD'. Kept apart from
   * `joinedAt` rather than overloading it: a club member of two years can be a
   * month into the academy, and the two dates answer different questions.
   */
  academyJoinedOn: string | null;
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

/**
 * Per-coach rollup — the manager's load view, and the source of the directory's
 * coach filter chips.
 *
 * A coach with no trainees is not dropped: in a 1:1 academy, spare coach hours
 * are exactly what a manager is looking for when a new trainee enrols, so an
 * idle coach is a positive signal rather than an empty row. That's why the route
 * seeds this from the staff roster and not only from the members it found.
 */
export interface AcademyCoachSummary {
  /** Null is the unpaired bucket — trainees with no dedicated coach. */
  coachId: string | null;
  coachName: string | null;
  trainees: number;
  /**
   * How many of this coach's trainees have no resolvable paces — no band, or a
   * band whose offset nobody has set. These are the ones the planner cannot send
   * a workout to, so it is the number a manager can actually act on. It replaced
   * a count of standing weekly appointments, which the academy does not have.
   */
  unpaced: number;
  weekKm: number;
  /** null when nobody this coach holds had a plan this week. */
  completionRate: number | null;
}

/** A staff account that may be assigned as a dedicated coach. */
export interface AcademyCoachRef {
  coachId: string;
  coachName: string;
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
  /** Empty before migration 077 is applied, and for a coach seeing only their own. */
  coaches: AcademyCoachSummary[];
  /**
   * The academy's goal bands, with a live trainee count each. Sent to everyone
   * who can see the directory — a coach needs the band names to read their own
   * trainees, not only the manager who assigns them. Empty before 077.
   */
  bands: AcademyBand[];
  team: AcademyTeamTotals;
  pending: { registrations: number; results: number };
  /**
   * What the caller was allowed to see. `'coach'` means the payload was filtered
   * to their own trainees server-side, which the UI must know rather than infer:
   * the totals are then *their* totals, not the academy's, and offering an
   * "assign a coach" action over a list you can't see all of is a trap.
   */
  scope: 'academy' | 'coach';
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
  /** Whether a dedicated 1:1 coach has been assigned. */
  hasCoach?: boolean;
  /**
   * Whether the academy has any coach to pair with at all.
   *
   * Guards a false alarm: an academy that hasn't named its coaches yet would
   * otherwise flag every single trainee, which is one setup task reported
   * twenty-six times. The directory says that once, at the top.
   */
  academyHasCoaches?: boolean;
  /**
   * Whether a goal band (דבוקה) has been assigned.
   *
   * Only the trainee's own assignment, deliberately — not whether their band's
   * paces have been set. An unpriced band is one academy-level setting that would
   * otherwise flag every trainee in it, the same false alarm `academyHasCoaches`
   * guards against. That gap surfaces through the per-coach `unpaced` count.
   */
  hasBand?: boolean;
}

export function deriveAttention(m: AttentionInput): AttentionReason[] {
  const attention: AttentionReason[] = [];
  // Setup gaps are only worth reporting for an approved member: chasing the coach
  // or the goal of someone whose registration hasn't been reviewed is premature,
  // and `not_approved` already has the manager's attention.
  if (!m.approved) {
    attention.push('not_approved');
  } else {
    if (m.academyHasCoaches && m.hasCoach === false) attention.push('no_coach');
    if (m.hasBand === false) attention.push('no_band');
  }
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

/**
 * Per-coach rollup, seeded with every coach the academy has.
 *
 * `roster` is what makes an idle coach visible. Rolling up from members alone
 * would answer "how loaded is each coach who already has someone?" — the manager
 * assigning a new trainee needs the opposite: who has room. Seeding at zero also
 * keeps the filter chips stable while a coach's last trainee is reassigned.
 *
 * Unpaired trainees are their own bucket (coachId null) and sort last, the same
 * convention `rollupGroups` uses for the groupless: it's an exception list, not
 * a caseload.
 */
export function rollupCoaches(
  members: AcademyMember[],
  roster: AcademyCoachRef[] = [],
): AcademyCoachSummary[] {
  type Row = AcademyCoachSummary & { planned: number; completed: number };
  const map = new Map<string, Row>();
  const blank = (coachId: string | null, coachName: string | null): Row => ({
    coachId, coachName, trainees: 0, unpaced: 0, weekKm: 0,
    completionRate: null, planned: 0, completed: 0,
  });

  for (const c of roster) map.set(c.coachId, blank(c.coachId, c.coachName));

  for (const m of members) {
    const key = m.academyCoachId || '__none__';
    const row = map.get(key) || blank(m.academyCoachId, m.academyCoachName);
    // A coach met through a member but missing from the roster still gets named
    // — better a caseload attributed to someone than one silently pooled into
    // "unpaired", which would read as a gap that isn't there.
    if (!row.coachName && m.academyCoachName) row.coachName = m.academyCoachName;
    row.trainees += 1;
    if (!canResolvePaces(m.paceOffsetSec, m.band)) row.unpaced += 1;
    row.weekKm = addKm(row.weekKm, m.weekKm);
    row.planned += m.plannedCount;
    row.completed += m.completedCount;
    map.set(key, row);
  }

  return [...map.values()]
    .map((c) => ({
      coachId: c.coachId,
      coachName: c.coachName,
      trainees: c.trainees,
      unpaced: c.unpaced,
      weekKm: c.weekKm,
      completionRate: completionRateOf(c.planned, c.completed),
    }))
    .sort((x, y) =>
      (x.coachId ? 0 : 1) - (y.coachId ? 0 : 1)
      || y.trainees - x.trainees
      || (x.coachName || '').localeCompare(y.coachName || ''));
}

/**
 * The academy's bands with a live trainee count each, seeded from the band list.
 *
 * Seeded rather than rolled up from members for the same reason `rollupCoaches`
 * is: a band with nobody in it is still a band the manager can assign into, and
 * a list that appears and disappears as its last trainee moves is unusable as a
 * picker. Unlike coaches there is no null bucket here — "no band" is an attention
 * reason on the trainee, not a band of its own.
 */
export function rollupBands(members: AcademyMember[], bands: AcademyBand[]): AcademyBand[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    if (m.band) counts.set(m.band.id, (counts.get(m.band.id) || 0) + 1);
  }
  return sortBands(bands).map((b) => ({ ...b, trainees: counts.get(b.id) || 0 }));
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
