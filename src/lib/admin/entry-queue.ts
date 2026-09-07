import { maintenanceBlocks, type MaintenanceState } from '@/lib/maintenance-rule';

// ═════════════════════════════════════════════════════════════════════════════
// "Who is waiting to get in, and what is their state?"
//
// There are TWO independent doors into this app and nothing ever showed them
// together:
//
//   1. `athletes.approved` — a signup an approver has to accept.
//   2. the maintenance allowlist — a deliberate gate the club runs for days at a
//      time. 19 of 28 members are behind it right now, on purpose.
//
// So "why can't Dana get in" had two possible answers on two different screens,
// and approving her did nothing at all while a window was open: she moved from
// "not approved" to "approved and still blocked", which looks identical from her
// phone. That is the bug this module exists to make impossible — a single stage
// per person, computed from both doors, in the order an admin would work them.
//
// Pure: the API route feeds it rows, the panel renders what comes back. Nothing
// here reads the network or the DOM (src/__tests__/entryQueue.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

/** Stages in the order an admin works them — see STAGE_ORDER. */
export type EntryStage =
  /** Signed up, nobody has accepted them yet. */
  | 'pending'
  /** Approved, and the maintenance window is what's still holding them out. */
  | 'blocked'
  /** Nothing is holding them out and they have never opened the app. */
  | 'never'
  /** They're in, but the setup checklist isn't done. */
  | 'setup'
  /** In, connected, notified. Nothing to do. */
  | 'ready';

export const STAGE_ORDER: EntryStage[] = ['pending', 'blocked', 'never', 'setup', 'ready'];

/** One member as the panel needs them — the API route's response shape. */
export interface EntryQueueMember {
  id: string;
  name: string;
  /**
   * Their REAL address, or null. A Strava signup never provides one and the
   * synthetic `strava_<id>@strava.madregot.local` is not an address anybody can
   * be reached at, so it is stripped rather than displayed as if it were.
   */
  email: string | null;
  groupName: string | null;
  approved: boolean;
  approvedAt: string | null;
  /** `athletes.last_seen_at`, stamped by /api/auth/me — a real "they opened it". */
  lastSeenAt: string | null;
  createdAt: string | null;
  /** The maintenance window is holding them out right now. */
  blocked: boolean;
  /** Credentials present — NOT `data_source`, which is set for all 28 members. */
  hasGarmin: boolean;
  hasStrava: boolean;
  /** Rows in push_subscriptions: whether they can be told anything. */
  hasPush: boolean;
  setupDone: number;
  setupTotal: number;
  stage: EntryStage;
}

/**
 * A pending `signup_requests` row with NO athlete row behind it yet.
 *
 * Everybody else in this queue is an athlete, so the queue is built from
 * `athletes`. A /register applicant isn't one until they're approved, which made
 * them invisible to an athletes-driven screen — they only ever appeared on the
 * separate בקשות הרשמה tab. They are the one thing that tab held that nothing
 * else did, so they come along.
 */
export interface PendingSignupRequest {
  id: string;
  email: string;
  /** 'register' | 'strava-login' | 'club-backfill' | null — how they got here. */
  source: string | null;
  createdAt: string | null;
  groupId: string | null;
}

/** The count per stage, in STAGE_ORDER — what the bar at the top is drawn from. */
export function stageCounts(members: EntryQueueMember[]): Record<EntryStage, number> {
  const out: Record<EntryStage, number> = { pending: 0, blocked: 0, never: 0, setup: 0, ready: 0 };
  for (const m of members) out[m.stage] += 1;
  return out;
}

/**
 * The four things that actually stop somebody from getting value out of the app,
 * as filters that stack. Not "statuses": a person can be all four at once, which
 * is why these are checkboxes over the list and not a fifth bucket.
 */
export const ENTRY_FILTERS = ['noPush', 'noWatch', 'neverEntered', 'noGroup'] as const;
export type EntryFilter = (typeof ENTRY_FILTERS)[number];

export function matchesFilter(m: EntryQueueMember, filter: EntryFilter): boolean {
  switch (filter) {
    case 'noPush':
      return !m.hasPush;
    case 'noWatch':
      return !m.hasGarmin && !m.hasStrava;
    case 'neverEntered':
      return !m.lastSeenAt;
    case 'noGroup':
      return !m.groupName;
  }
}

/** AND, not OR: "no watch AND no notifications" is the person to chase first. */
export function matchesFilters(m: EntryQueueMember, filters: readonly EntryFilter[]): boolean {
  return filters.every((f) => matchesFilter(m, f));
}

/** What the stage is computed from. Everything else on the row is decoration. */
export interface EntryStageInput {
  approved: boolean;
  blocked: boolean;
  lastSeenAt: string | null;
  /** Real credentials, not `data_source` — nothing syncs without them. */
  hasWatch: boolean;
  /** A push subscription row: whether anything can reach them at all. */
  hasPush: boolean;
}

export function entryStage(m: EntryStageInput): EntryStage {
  // Approval first, and deliberately ahead of the window: an unapproved member is
  // not a member yet, so "blocked by maintenance" is not the useful thing to say
  // about them. Both are released by the same tap anyway (POST /api/admin/approve).
  if (!m.approved) return 'pending';
  if (m.blocked) return 'blocked';
  if (!m.lastSeenAt) return 'never';
  // Watch and notifications only — NOT the full setup score. Photo and shirt size
  // are missing for most of the club and always will be; holding people in a
  // "stuck" bucket over them would make the bucket meaningless. These two are the
  // ones that decide whether the app does anything for them: no credentials means
  // nothing syncs, no subscription means nothing can reach them.
  if (!m.hasWatch || !m.hasPush) return 'setup';
  return 'ready';
}

/**
 * Whether this person is waiting on the CLUB rather than on themselves.
 *
 * The distinction the panel's default filter is built on: 'pending' and 'blocked'
 * need an admin to act, the rest need a nudge at most.
 */
export function isWaitingOnUs(stage: EntryStage): boolean {
  return stage === 'pending' || stage === 'blocked';
}

/** Handles worth writing to the allowlist: the id always, a real address if any. */
export function entryHandles(athlete: { id: string; email?: string | null }): string[] {
  return [athlete.id, athlete.email]
    .map((h) => String(h || '').toLowerCase().trim())
    // `.local` is the synthetic JWT domain. Writing one would put an entry on the
    // list that can never match the person it was meant to let in — the shape of
    // the 2026-09-07 lockout.
    .filter((h) => h && !h.endsWith('.local'));
}

/** Is this an address a human could be reached at, or the synthetic Strava one? */
export function realEmail(email: string | null | undefined): string | null {
  const value = String(email || '').trim();
  if (!value || value.toLowerCase().endsWith('.local')) return null;
  return value;
}

/**
 * By stage, then by who has waited longest inside it.
 *
 * Oldest-first because the queue is worked from the top and the person who signed
 * up a week ago is the one the club has failed for a week.
 */
export function sortEntryQueue(members: EntryQueueMember[]): EntryQueueMember[] {
  return [...members].sort((a, b) => {
    const byStage = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    if (byStage !== 0) return byStage;
    const at = a.createdAt || '';
    const bt = b.createdAt || '';
    if (at && bt) return at.localeCompare(bt);
    // A row with no created_at sorts last rather than jumping the queue.
    if (at) return -1;
    if (bt) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Convenience for the route: the same block rule the API gate uses. */
export function isBlockedByMaintenance(
  athlete: { id: string; email?: string | null },
  state: MaintenanceState,
): boolean {
  return maintenanceBlocks({ athleteId: athlete.id, athleteEmail: athlete.email }, state);
}
