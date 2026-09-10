import { createServerClient } from '@/lib/supabase/server';
import {
  localesForAthletes,
  persistNotifications,
  sendPushLocalized,
  subscriptionsForAthletes,
  type NotificationCategory,
} from '@/lib/push';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { recipientsForKind } from '@/lib/notifications/routing';

type PushCopy = { title: string; body: string };

/**
 * The FALLBACK recipient list for a management notification: who counts as "the
 * people running the club" when nothing has been configured.
 *
 * Since migration 099 the live answer comes from `notification_routing` via
 * `recipientsForKind()` — see routing.ts, and Control Room → התראות for the
 * screen that edits it. This function is what answers when that table has no rows
 * for the kind (the migration isn't applied yet, or can't be read), because an
 * unapplied migration must never silence a bug report.
 *
 * ONE source: `role = 'admin'`. `is_super_user` is a fallback within the fallback,
 * used only when no admin row exists at all, so an alert can never resolve to
 * nobody.
 *
 * This has now been narrowed twice, and both narrowings are worth recording
 * because each old list looked more correct than it was.
 *
 * It first unioned four sources — APPROVER_EMAILS, any STAFF_ROLES role,
 * `is_super_user` and `is_approver` — on the reasoning that each alone missed
 * somebody real. In practice that resolved to NINE people, because `role='admin'`
 * had been handed out to five ordinary members (and one of the nine was the
 * `Test Coach` fixture row). Every bug report, store order and pain alert went to
 * all of them. An alert that reaches nine people is an alert nobody owns.
 *
 * On 2026-09-08 it became `role='admin'` ∪ `is_super_user`, which read as two
 * ways of saying "an admin". They are not: `is_super_user` is a PERMISSION flag
 * (it grants impersonation and the admin surfaces), and using it as a mailing
 * list mails a person's every account rather than their admin one. Measured on
 * 2026-09-09: two recipients, `Madregot Admin` (admin + super) and `Ofer
 * Grosfeld` (`role='runner'`, super) — the club owner's own RUNNER account. So
 * every bug report wrote two inbox rows and sent two pushes, and the copies were
 * indistinguishable, which is exactly what got reported ("I get bug reports on
 * every account instead of only on admin").
 *
 * The fallback is a separate, second query rather than one `.or(...)` for the
 * original reason plus a new one: `is_super_user` is a hand-applied migration
 * (084), so a database without that column must still get the `role` answer
 * instead of losing the whole select to a 42703 — and now the normal path is one
 * query, with the second reached only in the degenerate no-admin case.
 *
 * WHAT THIS COSTS, stated plainly because both narrowings were chosen with the
 * cost on the table: a plain `coach` receives no management notification, and
 * now neither does a super-user who isn't an admin. That includes the
 * workout-feedback alert, which is how a coach finds out one of their athletes
 * reported PAIN, and the sign-up alert, which drops the one coach who is also an
 * approver. If either turns out to matter, the fix is not to widen this function
 * a third time — it is to give that one caller its own recipient list, so the
 * next narrowing doesn't silently undo it.
 *
 * Returns ids only. Best-effort: a query failure yields an empty list rather
 * than throwing, because every caller is a side-effect on somebody else's
 * successful request.
 */
export async function staffRecipientIds(): Promise<string[]> {
  const dedupe = (rows: unknown) => [...new Set(((rows || []) as Array<{ id: string }>).map((r) => r.id))];
  try {
    const supabase = createServerClient();
    const admins = await supabase.from('athletes').select('id').eq('role', 'admin');
    if (!admins.error) {
      const ids = dedupe(admins.data);
      if (ids.length > 0) return ids;
    }
    // No admin row (or no readable `role`): fall back rather than notify nobody.
    const supers = await supabase.from('athletes').select('id').eq('is_super_user', true);
    if (supers.error) return [];
    return dedupe(supers.data);
  } catch { /* best-effort */ }
  return [];
}

/**
 * Send one management notification to everyone this kind is ROUTED to — see
 * `notification_routing` / routing.ts, editable from Control Room → התראות — and
 * record it in their inbox. Falls back to `staffRecipientIds()` (the admins) for a
 * kind with no routing rows, so this works identically before migration 099 is
 * applied.
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
    // `null` = this kind isn't in the routing table (migration not applied, or
    // unreadable) → the hardcoded list. `[]` = routed to nobody on purpose, which
    // is a choice the screen allows and this must honour rather than "helpfully"
    // falling back to the admins.
    const routed = await recipientsForKind(opts.kind);
    const recipients = routed ?? (await staffRecipientIds());
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
