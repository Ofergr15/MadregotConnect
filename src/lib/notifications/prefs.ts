// Per-user notification category preferences. Categories map to the push
// categories in src/lib/push.ts. A missing key = opted IN (receive everything),
// so defaults are all-on and nothing is silenced unless explicitly turned off —
// except for the staff exception below.
export const CATEGORIES = ['workouts', 'coach', 'achievements', 'program', 'teammates', 'news', 'events', 'management'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULTS: Record<Category, boolean> = {
  workouts: true, coach: true, achievements: true, program: true, teammates: true, news: true, events: true, management: true,
};

/**
 * Categories that default to OFF for staff (admin / coach / academy_coach).
 *
 * An admin's notifications should be about things that need them — a sign-up
 * waiting for approval, a bug report, a failed workout delivery. What they
 * actually got was the club's social firehose: kudos_activity alone is two
 * thirds of every row ever written, and an admin follows more people than
 * anyone. The signal was there; it was buried under other people's runs.
 *
 * This is a DEFAULT, not a rule: the toggle is still in Settings and a coach
 * who wants the social pings can turn `teammates` back on, which writes an
 * explicit `true` and wins over this list. That is why it lives here rather
 * than as a hard filter at the send sites — those can't be overridden.
 */
export const STAFF_QUIET_CATEGORIES: readonly Category[] = ['teammates'];

/**
 * The all-categories baseline for this reader — everything on, minus the quiet
 * list for staff. Every "is this muted?" decision goes through here so the
 * send path, the badge counter and the Settings screen can't disagree about
 * what an untouched preference means.
 */
export function defaultsFor(isStaff?: boolean): Record<Category, boolean> {
  if (!isStaff) return { ...DEFAULTS };
  const out = { ...DEFAULTS };
  for (const c of STAFF_QUIET_CATEGORIES) out[c] = false;
  return out;
}

// Only a genuinely-unmigrated column should read as "everything on" — a
// blanket check here used to catch EVERY DB error (a transient hiccup
// included) and silently show all-defaults, which looked exactly like a
// saved "off" preference randomly flipping back to "on" on its own.
export function isMigrationMissing(error: { message?: string; code?: string } | null): boolean {
  return !!error && (/notification_prefs/.test(error.message || '') || error.code === '42703');
}

/**
 * What actually sits in `athletes.notification_prefs`: the category booleans,
 * plus the athlete's notification `language` (see notifications/locale.ts for
 * why the language is stored here rather than in a column or the UI's locale
 * cookie). Anything reading a category out of this object must tolerate the
 * extra key — `computeMutedAthleteIds` and `isKindMuted` both do, since they
 * only ever look up known category names.
 */
export type SavedPrefs = Partial<Record<Category, boolean>> & { language?: string };

// Merge a partial saved map over this reader's defaults so any category they
// have never touched still reads as its baseline (see defaultsFor — all-on for
// an athlete, social-quiet for staff). `language` passes straight through when
// set — it has no default here on purpose, so the client can tell "never chose
// one" apart from "chose Hebrew".
export function mergeWithDefaults(
  saved: SavedPrefs | null | undefined,
  isStaff?: boolean,
): Record<Category, boolean> & { language?: string } {
  return { ...defaultsFor(isStaff), ...(saved || {}) };
}

/**
 * Which preference toggle governs each notification `kind`.
 *
 * scheduled_notifications records `kind`; a push carries `category`. The two
 * were never connected, so the app-icon badge — which counts rows in that
 * table — had no way to skip a notification the athlete had muted. Muting
 * "אימוני חברי הקבוצה" stopped the pushes but the badge still climbed for
 * every one of them, and kudos_activity alone is two thirds of all rows ever
 * written. This map is that missing connection; keep it in step with the
 * `category:` passed at each send site.
 */
export const KIND_CATEGORY: Record<string, Category> = {
  // Other people's activity — the social pings.
  kudos_activity: 'teammates',
  kudos: 'teammates',
  like: 'teammates',
  comment: 'teammates',
  mention: 'teammates',
  follow: 'teammates',
  // Your own training.
  training_before: 'workouts',
  activity_sync_editor: 'workouts',
  workout_detected: 'workouts',
  post_workout_prompt: 'workouts',
  shoe_limit: 'workouts',
  badge: 'achievements',
  plan_pushed: 'program',
  feedback_reply: 'coach',
  // Club-wide announcements and surveys.
  custom: 'news',
  survey: 'news',
  // Running the club. Staff-only by construction — nothing sends these to an
  // athlete — so the toggle exists to let a coach turn them DOWN, not up.
  signup_request: 'management',
  problem_report: 'management',
  workout_delivery_failed: 'management',
  sync_stalled: 'management',
  // These two predate the channel and used to be sent with no category at all,
  // which made them the only staff alerts no toggle could reach. They go through
  // the same notifyStaff fan-out now, so they belong to the same channel.
  store_order: 'management',
  feedback_alert: 'management',
};

/**
 * True when this kind belongs to a category the athlete explicitly muted.
 *
 * Deliberately absent from KIND_CATEGORY, and so never muted: `approval` (a
 * one-time "you're in" that no toggle governs) and `review_resolved` (a direct
 * answer to a message this person sent us). Both send their push without a
 * category too, so badge and push agree. An unrecognised kind also counts — a
 * kind added later should show up in the badge as an off-by-one, not disappear
 * from it silently.
 *
 * `isStaff` selects the baseline for a category the reader never touched, so a
 * coach's untouched `teammates` reads as muted (see STAFF_QUIET_CATEGORIES).
 * Note there is no early return on a missing `prefs` any more: "no saved
 * preferences at all" is exactly the state every existing coach is in, and it
 * has to resolve to the staff baseline rather than to receive-everything.
 */
export function isKindMuted(
  kind: string,
  prefs: Partial<Record<Category, boolean>> | null | undefined,
  isStaff?: boolean,
): boolean {
  const category = KIND_CATEGORY[kind];
  if (!category) return false;
  const saved = prefs?.[category];
  if (saved === undefined) return defaultsFor(isStaff)[category] === false;
  return saved === false;
}

/**
 * Idempotency-sentinel rows stash their dedup tag in `url` as `#ledger:<tag>`
 * (post-workout prompts, the training-day reminder cron, workout-watch). They
 * are bookkeeping, not messages: GET /api/notifications/inbox has always
 * excluded them, but the badge counters did not, so 77 of them — 26 written
 * with audience_type 'all', hence matching every athlete — were being counted
 * as unread notifications nobody could ever open or clear.
 */
export function isLedgerRow(url: string | null | undefined): boolean {
  return String(url || '').startsWith('#ledger:');
}
