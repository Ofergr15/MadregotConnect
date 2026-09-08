import { createServerClient } from '@/lib/supabase/server';
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
 * TWO sources, unioned: `role = 'admin'` and `is_super_user`. Narrowed to this
 * on 2026-09-08, deliberately, and the thing it replaced is worth recording
 * because the old list looked more correct than it was.
 *
 * It used to union four sources — APPROVER_EMAILS, any STAFF_ROLES role,
 * `is_super_user` and `is_approver` — on the reasoning that each alone missed
 * somebody real. In practice that resolved to NINE people, because `role='admin'`
 * had been handed out to five ordinary members (and one of the nine was the
 * `Test Coach` fixture row). Every bug report, store order and pain alert went to
 * all of them. An alert that reaches nine people is an alert nobody owns.
 *
 * The union is still two queries rather than one `.or(...)`, and still for the
 * original reason: `is_super_user` is a hand-applied migration (084), so a
 * database without that column has to still get the `role` answer instead of
 * losing the whole select to a 42703.
 *
 * WHAT THIS COSTS, stated plainly because it is a real regression and it was
 * chosen with the cost on the table: a plain `coach` no longer receives any
 * management notification. That includes the workout-feedback alert, which is how
 * a coach finds out one of their athletes reported PAIN, and the sign-up alert,
 * which drops the one coach who is also an approver. If either turns out to
 * matter, the fix is not to widen this function again — it is to give that one
 * caller its own recipient list, so the next narrowing doesn't silently undo it.
 *
 * Returns ids only. Best-effort: a query failure yields an empty list rather
 * than throwing, because every caller is a side-effect on somebody else's
 * successful request.
 */
export async function staffRecipientIds(): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const supabase = createServerClient();
    const sources = [
      supabase.from('athletes').select('id').eq('role', 'admin'),
      supabase.from('athletes').select('id').eq('is_super_user', true),
    ];
    for (const result of await Promise.all(sources)) {
      if (result.error) continue;
      for (const row of (result.data || []) as Array<{ id: string }>) ids.add(row.id);
    }
  } catch { /* best-effort */ }
  return [...ids];
}

/**
 * Send one management notification to everyone staffRecipientIds() names — since
 * 2026-09-08 that is the admins and the super user, not every staff role — and
 * record it in their inbox.
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
