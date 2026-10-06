// The manager's people tab: grouping the roster by coach, who left, which
// applications may be deleted, and the bulk-action body. Pure — shared by the
// routes under /api/academy/members/* and the AcademyMembers screen, and unit
// tested without a database.
//
// Nothing in here imports Supabase, so the client can pull it in for free.

import { memberCoachIds, memberCoachNames, type AcademyMember } from './members';

// ── Grouping the roster by coach ────────────────────────────────────────────

export interface CoachSection {
  /** Null is the unpaired bucket, which always comes last. */
  coachId: string | null;
  coachName: string | null;
  members: AcademyMember[];
}

/**
 * The list as the manager reads it: one section per coach, the busiest first,
 * then the trainees nobody coaches — last, because it is the exception the
 * manager has to act on and the screen highlights it there.
 *
 * Only approved members: an applicant is not anyone's trainee yet, and sits in
 * the "pending" filter instead.
 */
export function groupByCoach(members: AcademyMember[]): CoachSection[] {
  const byCoach = new Map<string, CoachSection>();
  const unpaired: AcademyMember[] = [];
  for (const m of members) {
    // A shared trainee sits under EACH of their coaches (the row says "משותף").
    const ids = memberCoachIds(m);
    const names = memberCoachNames(m);
    if (!ids.length) { unpaired.push(m); continue; }
    ids.forEach((coachId, i) => {
      const s = byCoach.get(coachId) ?? { coachId, coachName: names[i] || null, members: [] };
      if (!s.coachName && names[i]) s.coachName = names[i];
      s.members.push(m);
      byCoach.set(coachId, s);
    });
  }
  const byName = (a: AcademyMember, b: AcademyMember) => a.name.localeCompare(b.name);
  const sections = [...byCoach.values()]
    .map((s) => ({ ...s, members: [...s.members].sort(byName) }))
    .sort((a, b) => b.members.length - a.members.length || (a.coachName || '').localeCompare(b.coachName || ''));
  if (unpaired.length) sections.push({ coachId: null, coachName: null, members: [...unpaired].sort(byName) });
  return sections;
}

/**
 * The OTHER coaches of a trainee, seen from one coach's section — "גם אצל Guy".
 * Empty for a trainee with one coach (or none), which is when no tag shows.
 */
export function otherCoachNames(m: AcademyMember, sectionCoachId: string | null): string[] {
  const ids = memberCoachIds(m);
  const names = memberCoachNames(m);
  return ids.map((id, i) => (id === sectionCoachId ? null : names[i] || null)).filter((n): n is string => !!n);
}

// ── What a row says under the name ──────────────────────────────────────────

export type RowLine =
  | { kind: 'inactive'; days: number }
  | { kind: 'never_ran' }
  | { kind: 'no_watch' }
  | { kind: 'new'; days: number }
  | { kind: 'week'; since: string | null; done: number; planned: number }
  | { kind: 'since'; since: string | null };

/**
 * One line, the most useful thing to know about this trainee. An attention
 * reason the manager can act on wins over the routine "since July · 3/4 this
 * week"; a trainee who joined in the last fortnight is "new", which is why they
 * have no history yet rather than a problem.
 */
export function rowLine(m: AcademyMember, todayIso: string): RowLine {
  const joinedDays = m.academyJoinedOn ? daysBetween(m.academyJoinedOn, todayIso) : null;
  if (!m.hasWatch) return { kind: 'no_watch' };
  if (m.daysSinceActivity !== null && m.daysSinceActivity >= 5) return { kind: 'inactive', days: m.daysSinceActivity };
  if (joinedDays !== null && joinedDays <= 14 && (memberCoachIds(m).length === 0 || m.plannedCount === 0)) {
    return { kind: 'new', days: joinedDays };
  }
  if (m.daysSinceActivity === null && m.totalRuns === 0) return { kind: 'never_ran' };
  if (m.plannedCount > 0) {
    return { kind: 'week', since: m.academyJoinedOn, done: m.completedCount, planned: m.plannedCount };
  }
  return { kind: 'since', since: m.academyJoinedOn };
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD' (or ISO). Never negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Whole months between two dates, for "4 months in the academy". */
export function monthsBetween(from: string, to: string): number {
  return Math.floor(daysBetween(from, to) / 30.44);
}

// ── Who left ────────────────────────────────────────────────────────────────

export interface LeftMember {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  /** When their last coaching pair closed — the best record of the day they left. Null when they never had one. */
  leftOn: string | null;
  joinedOn: string | null;
  /** Who coached them last, so "bring back" can restore the pair. */
  previousCoachId: string | null;
  previousCoachName: string | null;
  monthsIn: number | null;
}

export interface LeftSourceRow {
  id: string;
  name: string;
  avatar_url?: string | null;
  is_academy?: boolean | null;
  approved?: boolean | null;
  status?: string | null;
  academy_joined_on?: string | null;
}

export interface HistoryRow {
  athlete_id: string;
  coach_id: string | null;
  started_on: string;
  ended_on: string | null;
}

/**
 * Who left the academy. Nothing records "left" as a fact of its own — the
 * removal flips `is_academy` off and closes the coaching pair — so it is read
 * back from the two traces that survive it:
 *
 *   • `academy_joined_on`, stamped the first time someone is added and never
 *     cleared, so a non-member who has it was a member once; and
 *   • `academy_coach_history`, whose rows survive the removal, which also covers
 *     the trainees the funnel's accept let in without stamping the join date.
 *
 * The day they left is the last pair's `ended_on`. Someone removed while
 * unpaired has no such row, and their date is honestly unknown.
 *
 * Not a removed account (status 'removed'), and not somebody whose club
 * membership is itself unapproved — that is a different list.
 */
export function deriveLeft(
  rows: LeftSourceRow[],
  history: HistoryRow[],
  coachNames: Map<string, string>,
  todayIso: string,
): LeftMember[] {
  const byAthlete = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const list = byAthlete.get(h.athlete_id) ?? [];
    list.push(h);
    byAthlete.set(h.athlete_id, list);
  }
  const out: LeftMember[] = [];
  for (const r of rows) {
    if (r.is_academy) continue;
    if (r.status === 'removed' || r.approved === false) continue;
    const hist = (byAthlete.get(r.id) ?? []).slice().sort((a, b) => a.started_on.localeCompare(b.started_on));
    if (!r.academy_joined_on && hist.length === 0) continue;
    const last = hist[hist.length - 1] ?? null;
    const ended = hist.map((h) => h.ended_on).filter((d): d is string => !!d).sort();
    const leftOn = ended.length ? ended[ended.length - 1] : null;
    const joinedOn = r.academy_joined_on || hist[0]?.started_on || null;
    out.push({
      athleteId: r.id,
      name: r.name,
      avatarUrl: r.avatar_url || null,
      leftOn,
      joinedOn,
      previousCoachId: last?.coach_id ?? null,
      previousCoachName: last?.coach_id ? coachNames.get(last.coach_id) ?? null : null,
      monthsIn: joinedOn ? monthsBetween(joinedOn, leftOn || todayIso) : null,
    });
  }
  // Most recent leavers first; the undated at the end.
  return out.sort((a, b) => (b.leftOn || '').localeCompare(a.leftOn || '') || a.name.localeCompare(b.name));
}

// ── The people payload (GET /api/academy/members/people) ──

export interface PendingApplicant {
  /** Stable key for the list: the athlete when there is one, else the card. */
  key: string;
  athleteId: string | null;
  candidateId: string | null;
  name: string;
  appliedAt: string | null;
  /** An approved club member who applied — accepted, never deleted. */
  clubMember: boolean;
  /** Whether "delete the application" is offered. The DELETE re-checks everything. */
  deletable: boolean;
}

export interface AddableMember {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string | null;
  groupName: string | null;
}

export interface AcademyPeopleResponse {
  left: LeftMember[];
  pending: PendingApplicant[];
  addable: AddableMember[];
}

// ── Deleting an application ─────────────────────────────────────────────────

export interface ApplicantRow {
  id: string;
  approved?: boolean | null;
  approved_at?: string | null;
  status?: string | null;
  role?: string | null;
  extra_roles?: string[] | null;
  onboarding_status?: string | null;
  garmin_auth?: unknown;
  strava_auth?: unknown;
  academy_coach_id?: string | null;
  academy_joined_on?: string | null;
}

export type DeleteRefusal =
  | 'approved'
  | 'not_form_account'
  | 'staff'
  | 'connected'
  | 'has_data'
  | 'coaches_someone'
  | 'paired';

/** Roles a form-created account can carry. Anything else is somebody's real account. */
const APPLICANT_ROLES = new Set(['academy_user', 'runner']);

/**
 * May the account the academy form opened be deleted? Only when nothing about it
 * says it is a real person's club account. `ok: false` carries the first reason.
 *
 * Every table that references `athletes` cascades or nulls on delete (see the
 * route), so "refuse when unsure" is the whole safety: the row is deleted only if
 *
 *   • it was never approved (no `approved`, no `approved_at`), and is still the
 *     form's own `academy_pending` row with status 'invited';
 *   • it holds no staff role and coaches nobody;
 *   • no watch was ever connected;
 *   • it was never paired with a coach or stamped as joined; and
 *   • `dataRows` — the caller's count across the data tables — is zero.
 */
export function applicationDeletable(
  row: ApplicantRow,
  facts: { dataRows: number; coachesSomeone: boolean },
): { ok: true } | { ok: false; reason: DeleteRefusal } {
  // Strictly `false`: a row whose gate reads null or is missing is not one to delete.
  if (row.approved !== false || row.approved_at) return { ok: false, reason: 'approved' };
  if (row.onboarding_status !== 'academy_pending' || (row.status && row.status !== 'invited')) {
    return { ok: false, reason: 'not_form_account' };
  }
  const roles = [row.role || 'runner', ...(row.extra_roles || [])];
  if (roles.some((r) => !APPLICANT_ROLES.has(r))) return { ok: false, reason: 'staff' };
  if (facts.coachesSomeone) return { ok: false, reason: 'coaches_someone' };
  if (row.garmin_auth || row.strava_auth) return { ok: false, reason: 'connected' };
  if (row.academy_coach_id || row.academy_joined_on) return { ok: false, reason: 'paired' };
  if (facts.dataRows > 0) return { ok: false, reason: 'has_data' };
  return { ok: true };
}

// ── The bulk body ───────────────────────────────────────────────────────────

// 'coach' REPLACES the set (coachIds, or the legacy single coachId / null);
// 'addCoach' and 'removeCoach' add or drop ONE coach across many trainees, leaving
// their other coaches alone (migration 135: a trainee can have several).
export const BULK_ACTIONS = ['coach', 'addCoach', 'removeCoach', 'band', 'remove', 'add', 'restore'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const MAX_BULK = 100;

export interface BulkRequest {
  athleteIds: string[];
  action: BulkAction;
  /** `null` unpairs ('coach'); for 'add' the coach to start with, or none. */
  coachId: string | null;
  /**
   * 'coach' only: the whole new set, first = the legacy coach. `null` when the
   * caller sent the single `coachId` instead (then the set is [coachId] or []).
   */
  coachIds: string[] | null;
  bandId: string | null;
  /** Whether to push the trainee and the coach. */
  notify: boolean;
  /** Only for 'coach' and 'band': whether the field was sent at all. */
  hasCoach: boolean;
  hasBand: boolean;
}

/** Parse and validate the body; a string is the 400 message. */
export function parseBulk(body: unknown): BulkRequest | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const action = String(b.action || '') as BulkAction;
  if (!(BULK_ACTIONS as readonly string[]).includes(action)) return 'Unknown action';
  const raw = Array.isArray(b.athleteIds) ? b.athleteIds : [];
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))];
  if (!ids.length) return 'athleteIds is required';
  if (ids.length > MAX_BULK) return `At most ${MAX_BULK} at a time`;
  const hasCoach = Object.prototype.hasOwnProperty.call(b, 'coachId');
  const hasBand = Object.prototype.hasOwnProperty.call(b, 'bandId');
  const idOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const coachId = idOrNull(b.coachId);
  const bandId = idOrNull(b.bandId);
  const coachIds = Array.isArray(b.coachIds)
    ? [...new Set(b.coachIds.map(idOrNull).filter((x): x is string => !!x))]
    : null;
  if (Object.prototype.hasOwnProperty.call(b, 'coachIds') && !Array.isArray(b.coachIds)) return 'coachIds must be an array';
  if (action === 'coach' && !hasCoach && !coachIds) return 'coachId or coachIds is required; pass null or [] to unpair';
  if ((action === 'addCoach' || action === 'removeCoach') && !coachId) return 'coachId is required';
  if (coachIds && coachIds.some((c) => ids.includes(c))) return 'A trainee cannot be their own coach';
  if (action === 'band' && !hasBand) return 'bandId is required; pass null to clear';
  if (coachId && ids.includes(coachId)) return 'A trainee cannot be their own coach';
  return {
    athleteIds: ids, action, coachId, coachIds: action === 'coach' ? coachIds : null,
    bandId, notify: b.notify === true, hasCoach, hasBand,
  };
}

// ── Sharing the form link ───────────────────────────────────────────────────

/**
 * An Israeli phone as wa.me wants it: digits only, country code, no leading 0.
 * '054-123 4567' → '972541234567'. Anything that isn't plausibly a phone gives
 * null, and the share opens WhatsApp's own contact picker instead.
 */
export function waPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits) return null;
  let d = digits.replace(/^00/, '');
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function waShareUrl(phone: string | null | undefined, text: string): string {
  const p = waPhone(phone);
  return `https://wa.me/${p ?? ''}?text=${encodeURIComponent(text)}`;
}
