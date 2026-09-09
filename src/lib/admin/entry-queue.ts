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
  /**
   * When an auth account first existed for this person — `auth.users.created_at`.
   *
   * This is "did they ever START logging in": nothing mints a GoTrue user except a
   * sign-in that actually reached our callback, so a row here means they got that
   * far even if they never landed inside the app. Null when there is no account —
   * and also when the listing couldn't be read, which is what `loginKnown` is for.
   */
  authAccountAt?: string | null;
  /** `auth.users.last_sign_in_at` — the identity layer's last successful login. */
  lastSignInAt?: string | null;
  /**
   * False when the auth listing could not be read at all (a listUsers failure).
   * The login step then renders as unknown rather than as "never started": telling
   * a coach somebody never tried when we simply didn't look is worse than silence.
   */
  loginKnown?: boolean;
  /** Which scored setup tasks are still open, by SETUP_TASK_KEYS name. */
  setupMissing?: string[];
  /**
   * Taken out of the club — `athletes.status = REMOVED_STATUS`, see the block on
   * `isRemoved` below. Their row and their whole history stay; they just stop
   * being a member. Kept out of the flow entirely rather than shown as somebody
   * "stuck at signing up", which is what a removed person would otherwise look
   * like on this screen.
   */
  removed?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// REMOVING SOMEBODY FROM THE CLUB
//
// Soft, and it has to be soft: 25 tables cascade off `athletes(id)` — activities,
// badges, attendance, feed posts, store orders, race matches — so a hard delete
// takes a member's entire history with it and cannot be undone. The app already
// has this instinct elsewhere: DELETE on a badge or a challenge refuses and tells
// you to deactivate instead.
//
// The lever already existed and nothing used it. `status` is not 'active' →
// `membershipFor` returns 'inactive' → the shell renders AccessBlocked, with the
// copy for it already written. Every club-facing query (the leaderboard, standings,
// discover, the plan picker, the admin counts) filters `status = 'active'`, so a
// removed member drops out of all of them for free.
//
// The catch, and the reason this is a named constant rather than an inline string:
// POST /api/auth/resolve-role used to flip ANY non-active status back to 'active'
// on the next sign-in, so a removal would have quietly reinstated itself the next
// time they opened the app. That path now treats this one value as terminal.
// ═════════════════════════════════════════════════════════════════════════════

export const REMOVED_STATUS = 'removed';

export function isRemoved(row: { status?: string | null }): boolean {
  return row.status === REMOVED_STATUS;
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

// ═════════════════════════════════════════════════════════════════════════════
// THE FLOW — the same people, as the route they actually walk.
//
// `EntryStage` above answers "whose problem is this person", which is what the
// approve button needs. It does NOT answer the question a coach asks about a
// specific member: how far did Eli get, and what is the next thing that has to
// happen. Five stages collapsed six different failures into "לא נכנס מעולם", and
// a row of chips beside it invited the reader to reassemble the order themselves.
//
// So the same facts, ordered: signed up → approved → started logging in → got in
// → connected a watch → finished the profile. One step per thing that can fail,
// each with its own evidence:
//
//   signedUp     athletes row               (always true — it is why they're here)
//   approved     approved && !blocked       BOTH doors, as everywhere else here
//   loginStarted auth.users row exists      an OAuth callback minted an identity
//   loggedIn     athletes.last_seen_at      /api/auth/me answered them: they're IN
//   watch        garmin_auth || strava_auth credentials, never `data_source`
//   profile      all 5 scored setup tasks   see lib/onboarding/setup-tasks
//
// loginStarted and loggedIn are deliberately two steps and not one. They come
// apart in production for a real, known reason: an iOS standalone PWA sends the
// Strava login into the in-app browser sheet, whose storage the app cannot see, so
// the member logs in successfully and is still looking at the marketing page
// (migration 082). That person has an auth account, a last_sign_in_at, and no
// last_seen_at — and they are the hardest case to help, because from the coach's
// old screen they were indistinguishable from somebody who never bothered.
//
// NOT MONOTONE, on purpose. The club backfill wrote Garmin credentials for members
// who have never opened the app, so `watch` can be done while `loggedIn` is not.
// The funnel therefore counts how far somebody got WITHOUT a gap (`reached`) and
// the track marks any later step they've already passed, rather than pretending
// the order was obeyed.
// ═════════════════════════════════════════════════════════════════════════════

export const FLOW_STEPS = ['signedUp', 'approved', 'loginStarted', 'loggedIn', 'watch', 'profile'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** One step of one person's track. */
export interface FlowStepState {
  key: FlowStep;
  /** The evidence for this step is present. */
  done: boolean;
  /** We could not tell (only ever the login steps, when listUsers failed). */
  unknown: boolean;
  /** The date the evidence carries, when it has one. */
  at: string | null;
}

export interface MemberFlow {
  steps: FlowStepState[];
  /** The first step with no evidence — the ONE thing to fix. Null when finished. */
  stuckAt: FlowStep | null;
  /** How many steps are done from the start with no gap. 6 = all the way in. */
  reached: number;
}

/**
 * Where somebody is on the flow.
 *
 * `unknown` counts as done for the purpose of moving on: if we couldn't read the
 * auth listing we must not park 25 people on "didn't start logging in" — anybody
 * with a `last_seen_at` demonstrably did, and for the rest the honest answer is a
 * question mark on that step, not a verdict.
 */
export function memberFlow(m: EntryQueueMember): MemberFlow {
  const loginKnown = m.loginKnown !== false;
  // Being inside the app is proof of a login whatever the listing says — the
  // session that stamped last_seen_at cannot exist without one.
  const startedLogin = !!m.authAccountAt || !!m.lastSignInAt || !!m.lastSeenAt;

  const steps: FlowStepState[] = [
    { key: 'signedUp', done: true, unknown: false, at: m.createdAt },
    { key: 'approved', done: m.approved && !m.blocked, unknown: false, at: m.approvedAt },
    {
      key: 'loginStarted',
      done: startedLogin,
      unknown: !loginKnown && !m.lastSeenAt,
      at: m.authAccountAt || m.lastSignInAt || null,
    },
    { key: 'loggedIn', done: !!m.lastSeenAt, unknown: false, at: m.lastSeenAt },
    { key: 'watch', done: m.hasGarmin || m.hasStrava, unknown: false, at: null },
    {
      key: 'profile',
      done: m.setupTotal > 0 && m.setupDone >= m.setupTotal,
      unknown: false,
      at: null,
    },
  ];

  const blocking = steps.find((s) => !s.done && !s.unknown) || null;
  let reached = 0;
  for (const s of steps) {
    if (!s.done && !s.unknown) break;
    reached += 1;
  }
  return { steps, stuckAt: blocking ? blocking.key : null, reached };
}

/**
 * The funnel: how many people got at least this far, with no step skipped.
 *
 * Cumulative rather than per-step, because per-step counts of a non-monotone flow
 * produce the nonsense of "7 connected a watch" sitting under "9 got in" while
 * four of the seven have never logged in at all.
 */
export function flowFunnel(members: EntryQueueMember[]): Record<FlowStep, number> {
  const out = { signedUp: 0, approved: 0, loginStarted: 0, loggedIn: 0, watch: 0, profile: 0 } as Record<FlowStep, number>;
  for (const m of members) {
    const { reached } = memberFlow(m);
    for (let i = 0; i < reached; i += 1) out[FLOW_STEPS[i]] += 1;
  }
  return out;
}

/**
 * The list's groups — the buckets a coach works, one per kind of next action.
 *
 * 'mine' is the only one that needs the coach: approve, or release from the
 * window. The rest need a nudge, and 'ready' needs nothing.
 */
export const FLOW_GROUPS = ['mine', 'login', 'watch', 'profile', 'ready'] as const;
export type FlowGroup = (typeof FLOW_GROUPS)[number];

export function flowGroup(m: EntryQueueMember): FlowGroup {
  const { stuckAt } = memberFlow(m);
  if (!stuckAt) return 'ready';
  if (stuckAt === 'approved') return 'mine';
  if (stuckAt === 'loginStarted' || stuckAt === 'loggedIn') return 'login';
  if (stuckAt === 'watch') return 'watch';
  return 'profile';
}

/**
 * What is actually missing, named — the content of the reminder.
 *
 * The nudge used to pick between two fixed messages ("just the watch left" / "come
 * and finish setting up"), so the member was told to go and find their own gap. The
 * scored tasks were already in the response; this is them, in the order the flow
 * walks, with the login step in front when that is what is broken.
 *
 * 'login' is deliberately exclusive: somebody who cannot get in cannot act on
 * "you're missing a photo", and listing both makes the one thing they CAN do the
 * fourth item in a sentence.
 */
export type MemberGap = 'login' | string;

export function memberGaps(m: EntryQueueMember): MemberGap[] {
  const { stuckAt } = memberFlow(m);
  if (stuckAt === 'loginStarted' || stuckAt === 'loggedIn') return ['login'];
  // 'approved' is not a gap of theirs — it is one of ours, and no reminder to the
  // member can move it.
  if (stuckAt === 'approved') return [];
  return m.setupMissing || [];
}

/** Which group a tap on a funnel step should land in. */
export const GROUP_OF_STEP: Record<FlowStep, FlowGroup> = {
  signedUp: 'mine',
  approved: 'mine',
  loginStarted: 'login',
  loggedIn: 'login',
  watch: 'watch',
  profile: 'profile',
};

/**
 * Furthest-behind first, and inside that, longest-waiting first.
 *
 * The person on step 2 after 69 days is the club's oldest failure, and the queue
 * is worked from the top. `reached` ascending puts them there; `ready` (6) sinks.
 */
export function sortByFlow(members: EntryQueueMember[]): EntryQueueMember[] {
  return [...members]
    .map((m) => ({ m, flow: memberFlow(m) }))
    .sort((a, b) => {
      if (a.flow.reached !== b.flow.reached) return a.flow.reached - b.flow.reached;
      const at = a.m.createdAt || '';
      const bt = b.m.createdAt || '';
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return a.m.name.localeCompare(b.m.name);
    })
    .map((x) => x.m);
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
