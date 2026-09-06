import { createServerClient } from '@/lib/supabase/server';
import { APPROVER_EMAILS, STAFF_ROLES } from '@/lib/constants';
import {
  localesForAthletes,
  persistNotifications,
  sendPushLocalized,
  subscriptionsForAthletes,
  type NotificationCategory,
} from '@/lib/push';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';

type PushCopy = { title: string; body: string };

/**
 * Who counts as "the people running the club" for a management notification.
 *
 * Three independent sources, unioned, because each one alone misses somebody
 * real:
 *
 *  - `is_super_user` / `is_approver` (migration 084) — the flags the app
 *    actually gates admin surfaces on.
 *  - APPROVER_EMAILS — the legacy allowlist, still the only thing that marks
 *    the club account.
 *  - a staff `role` — a coach is a coach whether or not anyone remembered to
 *    stamp a flag on their row.
 *
 * The email list cannot be the whole answer, which is what every existing
 * staff fan-out on this codebase assumed. A Strava-only login gets a synthetic
 * `strava_*@strava.madregot.local` address, so it matches no literal on that
 * list — the club's own admin signs in that way and was therefore unreachable
 * by the store-order and feedback alerts that claim to notify "the coaches".
 *
 * Returns ids only. Best-effort: a query failure yields an empty list rather
 * than throwing, because every caller is a side-effect on somebody else's
 * successful request.
 */
export async function staffRecipientIds(): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const supabase = createServerClient();
    // One query per source rather than a single `.or(...)`: the flag columns are
    // hand-applied migrations, so a tenant without them must still get the role
    // and email answers instead of losing the whole select to a 42703.
    const sources = [
      supabase.from('athletes').select('id').in('email', APPROVER_EMAILS),
      supabase.from('athletes').select('id').in('role', STAFF_ROLES),
      supabase.from('athletes').select('id').eq('is_super_user', true),
      supabase.from('athletes').select('id').eq('is_approver', true),
    ];
    for (const result of await Promise.all(sources)) {
      if (result.error) continue;
      for (const row of (result.data || []) as Array<{ id: string }>) ids.add(row.id);
    }
  } catch { /* best-effort */ }
  return [...ids];
}

/**
 * Send one management notification to every staff member, and record it in
 * their inbox.
 *
 * This is the fan-out that `store/orders` and `workout-feedback` each had their
 * own copy of. Both copies resolved recipients by email (see above, they were
 * missing the admin), and the two disagreed on everything else: one persisted an
 * inbox row and one didn't, so a coach who missed the push had no way to find
 * out an athlete had reported pain.
 *
 * Send-before-persist, like every other fan-out here: sendPushDetailed's badge
 * count adds +1 for "the notification being delivered right now" on the
 * assumption its row isn't in the DB yet, so persisting first double-counts.
 * Sending first also yields the real per-recipient delivery count for the rows.
 *
 * Entirely best-effort. Never throws — a notification failure must not fail the
 * sign-up, the bug report or the cron tick that triggered it.
 */
export async function notifyStaff(opts: {
  /** scheduled_notifications.kind — must have a KIND_CATEGORY entry (see prefs.ts). */
  kind: string;
  url: string;
  tag: string;
  category: NotificationCategory;
  /** Who caused this, when it was a person. Null for a cron/system alert. */
  actorAthleteId?: string | null;
  copy: (locale: NotificationLocale) => PushCopy;
  /**
   * Override the push icon — used to show the photo of the athlete the alert is
   * about ("who is this about" at a glance on the lock screen). Push only; the
   * inbox row renders the actor's avatar from `actorAthleteId`.
   */
  icon?: string;
  /**
   * Skip the durable inbox row and send the push only. For repeating health
   * alerts (a stalled sync re-checked every day) where a row per occurrence
   * would bury the inbox in the same sentence.
   */
  pushOnly?: boolean;
}): Promise<{ recipients: number; sent: number }> {
  try {
    const recipients = await staffRecipientIds();
    if (recipients.length === 0) return { recipients: 0, sent: 0 };

    const subs = await subscriptionsForAthletes(recipients);
    let byAthlete: Record<string, number> = {};
    let sent = 0;
    if (subs.length > 0) {
      // `category` is what lets a coach turn this channel down in Settings —
      // filterByCategory in push.ts drops anyone who has.
      const result = await sendPushLocalized(subs, (locale) => ({
        ...opts.copy(locale),
        url: opts.url,
        tag: opts.tag,
        category: opts.category,
        ...(opts.icon ? { icon: opts.icon } : {}),
      }));
      sent = result.sent;
      byAthlete = result.byAthlete;
    }

    if (!opts.pushOnly) {
      // A staff member with no subscription still gets an inbox row, so the
      // language is resolved from the recipient ids rather than from `subs`.
      const rowLocales = await localesForAthletes(recipients);
      await persistNotifications(
        recipients.map((athleteId) => ({
          athleteId,
          kind: opts.kind,
          actorAthleteId: opts.actorAthleteId ?? null,
          ...opts.copy(rowLocales.get(athleteId) ?? DEFAULT_NOTIFICATION_LOCALE),
          url: opts.url,
        })),
        byAthlete,
      );
    }
    return { recipients: recipients.length, sent };
  } catch {
    return { recipients: 0, sent: 0 }; // best-effort
  }
}
