import type { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { pickBilingual } from '@/lib/notifications/copy';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import {
  ACADEMY_REMINDER_KINDS,
  plannedReminders,
  reminderRow,
  reminderStillOwed,
  type RemindableInvite,
} from './testReminders';

type Client = ReturnType<typeof createServerClient>;

/**
 * Arming, disarming and actually sending the two test reminders.
 *
 * The rules are all in `./testReminders`; this is the reads and writes around them, and it
 * follows `settle-invitation-server.ts`'s posture exactly: **every error is swallowed and
 * logged.** Confirming a test time is the primary act. A trainee who taps "יום ה׳ 07:00" must
 * not see "failed" because `scheduled_notifications` refused an insert, and — since every
 * migration in this repo is pasted in by hand, so there is always a window — must not see it
 * because migration 112's two id columns are not there yet either.
 *
 * The cost of swallowing is an invitation with no reminders, which is the state the whole
 * product was in before this file existed. The cost of throwing is a trainee who cannot
 * confirm a time.
 */

/** The two ids migration 112 keeps on the invitation. */
export interface ReminderIds {
  before: string | null;
  after: string | null;
}

const NONE: ReminderIds = { before: null, after: null };

/**
 * Cancel reminder rows by id — never delete, and never un-send.
 *
 * `.eq('status', 'scheduled')` is the second half: a row the scanner has already delivered
 * stays `sent`, because rewriting it to `cancelled` would make the history claim a message that
 * arrived on somebody's phone never went out. Same rule as the settle path, for the same reason.
 */
export async function disarmTestReminders(
  supabase: Client,
  ids: Array<string | null | undefined>,
): Promise<void> {
  const live = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (live.length === 0) return;
  try {
    const { error } = await supabase
      .from('scheduled_notifications')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', live)
      .eq('status', 'scheduled');
    if (error) console.error('disarmTestReminders failed:', error);
  } catch (err) {
    console.error('disarmTestReminders error:', err);
  }
}

/** The ids currently on an invitation, or nulls if the columns are not there yet. */
export async function reminderIdsFor(supabase: Client, invitationId: string): Promise<ReminderIds> {
  try {
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select('reminder_before_id, reminder_after_id')
      .eq('id', invitationId)
      .maybeSingle();
    if (error) {
      if (!isMissingTable(error) && !isMissingColumn(error)) {
        console.error('reminderIdsFor failed:', error);
      }
      return NONE;
    }
    const row = data as { reminder_before_id?: string | null; reminder_after_id?: string | null } | null;
    return { before: row?.reminder_before_id ?? null, after: row?.reminder_after_id ?? null };
  } catch (err) {
    console.error('reminderIdsFor error:', err);
    return NONE;
  }
}

/**
 * Write the reminders for a freshly confirmed invitation, and link them to it.
 *
 * Cancels whatever was armed before, ALWAYS, and that ordering is the point: re-confirming to a
 * different time is a single PATCH, and leaving the old rows scheduled would nag about a slot
 * that no longer exists — including the follow-up, which would ask "where is your result?" two
 * days after a time the trainee already moved.
 *
 * Returns the ids it wrote so the caller can persist them in the same update it is already
 * making. A reminder whose id never reaches the invitation is a reminder nothing can cancel,
 * so if the link write fails the caller's log is where that shows up — see the route.
 */
export async function armTestReminders(
  supabase: Client,
  invite: RemindableInvite & { id: string; athleteId: string },
  previous: ReminderIds = NONE,
  now: string = new Date().toISOString(),
): Promise<ReminderIds> {
  await disarmTestReminders(supabase, [previous.before, previous.after]);

  const planned = plannedReminders(invite, now);
  if (planned.length === 0) return NONE;

  const ids: ReminderIds = { before: null, after: null };
  for (const reminder of planned) {
    try {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .insert(reminderRow(reminder, invite.athleteId))
        .select('id')
        .single();
      if (error) {
        console.error('armTestReminders insert failed:', error);
        continue;
      }
      const id = (data as { id?: string } | null)?.id;
      if (id) ids[reminder.which] = id;
    } catch (err) {
      console.error('armTestReminders error:', err);
    }
  }
  return ids;
}

/** The invitation a due reminder row belongs to, found through the id column that points at it. */
async function inviteBehind(
  supabase: Client,
  column: 'reminder_before_id' | 'reminder_after_id',
  rowId: string,
): Promise<{ status: string; testId: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select('id, status, test_id')
      .eq(column, rowId)
      .maybeSingle();
    if (error) {
      if (!isMissingTable(error) && !isMissingColumn(error)) {
        console.error('inviteBehind failed:', error);
      }
      return null;
    }
    const row = data as { status?: string; test_id?: string | null } | null;
    if (!row) return null;
    return { status: String(row.status || ''), testId: row.test_id ?? null };
  } catch (err) {
    console.error('inviteBehind error:', err);
    return null;
  }
}

export interface DispatchResult {
  sent: number;
  /** Rows that were due and were cancelled instead of sent, because the test had happened. */
  withheld: number;
}

/**
 * Send the test reminders that have come due. Called from `/api/cron/tick` (every five minutes),
 * next to the broadcast scanner that same tick already invokes.
 *
 * Beside it rather than inside it: that scanner sends every due row unconditionally and with
 * `category: 'news'`. Both are wrong here — see `ACADEMY_REMINDER_KINDS`, and the re-read below.
 *
 * ── THE RE-READ ──────────────────────────────────────────────────────────────────────────
 *
 * Every due row is checked against its invitation before anything is sent, and a row that is no
 * longer owed is cancelled rather than left to be re-examined on the next tick. The cancel that
 * should have happened when the result arrived is a best-effort write in a path that only logs
 * its failures, and the message this guards against — "we have no result for your test", to
 * somebody who ran it — is the one this product cannot take back.
 */
export async function dispatchDueTestReminders(
  supabase: Client,
  now: string = new Date().toISOString(),
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, withheld: 0 };
  try {
    const { data, error } = await supabase
      .from('scheduled_notifications')
      .select('id, kind, title_he, body_he, title_en, body_en, url, audience_type, audience_id, sent_count')
      .in('kind', ACADEMY_REMINDER_KINDS as string[])
      .eq('status', 'scheduled')
      .lte('next_run_at', now);
    if (error) {
      if (!isMissingTable(error)) console.error('dispatchDueTestReminders read failed:', error);
      return result;
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const kind = String(row.kind);
      try {
        const column = kind === ACADEMY_REMINDER_KINDS[0] ? 'reminder_before_id' : 'reminder_after_id';
        const invite = await inviteBehind(supabase, column, id);
        if (!reminderStillOwed(kind, invite)) {
          await disarmTestReminders(supabase, [id]);
          result.withheld += 1;
          continue;
        }

        const subs = await resolveAudience(String(row.audience_type || 'athlete'), (row.audience_id as string) || null);
        const { sent } = await sendPushLocalized(subs, locale => ({
          title: pickBilingual(locale, { he: row.title_he as string, en: row.title_en as string | null }) || 'Madregot',
          body: pickBilingual(locale, { he: row.body_he as string, en: row.body_en as string | null }),
          url: String(row.url || '/dashboard/academy'),
          // One tag per row, so the follow-up cannot replace the before-reminder on the lock
          // screen — they say different things and both are worth reading.
          tag: `notif-${id}`,
          // 'workouts', matching KIND_CATEGORY: this is a message about the athlete's own
          // training, and the badge counter has to agree with the send path about that.
          category: 'workouts',
        }));

        // Marked sent whatever the push count was, INCLUDING zero. A trainee with no push
        // subscription still has an inbox, and re-examining the row on the next tick — every
        // five minutes, forever — would be the only outcome of treating 0 as a failure.
        await supabase
          .from('scheduled_notifications')
          .update({
            status: 'sent',
            last_sent_at: now,
            sent_count: (Number(row.sent_count) || 0) + sent,
            updated_at: now,
          })
          .eq('id', id);
        result.sent += 1;
      } catch (err) {
        // One bad reminder must not block the rest, and must not block the tick.
        console.error('dispatchDueTestReminders failed for', id, err);
      }
    }
  } catch (err) {
    console.error('dispatchDueTestReminders error:', err);
  }
  return result;
}
