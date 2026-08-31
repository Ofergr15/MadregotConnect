// Per-user notification category preferences. Categories map to the push
// categories in src/lib/push.ts. A missing key = opted IN (receive everything),
// so defaults are all-on and nothing is silenced unless explicitly turned off.
export const CATEGORIES = ['workouts', 'coach', 'achievements', 'program', 'teammates', 'news', 'events'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULTS: Record<Category, boolean> = {
  workouts: true, coach: true, achievements: true, program: true, teammates: true, news: true, events: true,
};

// Only a genuinely-unmigrated column should read as "everything on" — a
// blanket check here used to catch EVERY DB error (a transient hiccup
// included) and silently show all-defaults, which looked exactly like a
// saved "off" preference randomly flipping back to "on" on its own.
export function isMigrationMissing(error: { message?: string; code?: string } | null): boolean {
  return !!error && (/notification_prefs/.test(error.message || '') || error.code === '42703');
}

// Merge a partial saved map over the all-on defaults so any category the
// athlete has never touched still reads as enabled.
export function mergeWithDefaults(saved: Partial<Record<Category, boolean>> | null | undefined): Record<Category, boolean> {
  return { ...DEFAULTS, ...(saved || {}) };
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
};

/**
 * True when this kind belongs to a category the athlete explicitly muted.
 *
 * Deliberately absent from KIND_CATEGORY, and so never muted: `approval` (a
 * one-time "you're in" that no toggle governs) and `store_order` (a coach-only
 * alert). Both send their push without a category too, so badge and push agree.
 * An unrecognised kind also counts — a kind added later should show up in the
 * badge as an off-by-one, not disappear from it silently.
 */
export function isKindMuted(
  kind: string,
  prefs: Partial<Record<Category, boolean>> | null | undefined,
): boolean {
  if (!prefs) return false;
  const category = KIND_CATEGORY[kind];
  return !!category && prefs[category] === false;
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
