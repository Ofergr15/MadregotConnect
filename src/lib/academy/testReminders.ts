import {
  FOLLOW_UP_DAYS_AFTER,
  REMINDER_HOURS_BEFORE,
  protocolLabel,
  reminderTimes,
  slotDayLabel,
  slotLabel,
} from './testInvite';

/**
 * The two reminders a confirmed test invitation arms, as rows rather than as a schedule.
 *
 * `testInvite.ts` already answers WHEN each one is due (`reminderTimes`) and whether the second
 * is still owed (`followUpOwed`). This module answers WHAT gets sent and, in its server sibling,
 * who writes and cancels the rows — the one piece migration 112 designed and nobody built, and
 * the piece the flow map still lists as the last unbuilt capability in the academy.
 *
 * ── WHY THESE ARE ROWS IN `scheduled_notifications` ──────────────────────────────────────
 *
 * Migration 112's header says it: a second reminder engine would be a second place to look when
 * a message arrives that should not have, and a second thing to remember to cancel. So a
 * confirmed invitation writes two ordinary `once_at` rows addressed to one athlete, and the
 * invitation keeps their ids in `reminder_before_id` / `reminder_after_id`.
 *
 * ── AND WHY THE FOLLOW-UP IS EXPRESSED BY CANCELLING ─────────────────────────────────────
 *
 * The second reminder says "your test has not been recorded". Sending that to somebody who ran
 * it is the single most trust-destroying message this product can send: it proves the app is not
 * reading what they actually did. A `scheduled_notifications` row fires unconditionally, so the
 * condition lives in its absence — `settleInvitationForTest` cancels the row the moment a result
 * arrives, and every path that un-confirms an invitation cancels both (see the server module).
 *
 * The dispatcher re-reads the invitation before sending anyway. Two guards for one message is
 * not belt-and-braces theatre: the cancel is a best-effort write in a path that logs its own
 * failures, and this is the message that must not survive one.
 */

/** 12 hours before the slot: "your test is tomorrow morning". */
export const REMINDER_BEFORE_KIND = 'academy_test_before';

/** Two days after it, if nothing came in: "we have not seen a result". */
export const REMINDER_AFTER_KIND = 'academy_test_after';

/**
 * Both kinds, for the one dispatcher that has to find them and the one scanner that must not.
 *
 * `/api/cron/notifications` already scans this table for due rows, and the five-minute tick
 * already calls it — so delivery timing is not the reason these two are handled separately. The
 * reason is that that scanner sends every due row unconditionally, and one of these two rows
 * says "we have no result for your test". That claim has to be re-checked against the invitation
 * in the instant before it goes out; a row cannot carry a condition. The broadcast scanner also
 * sends everything as `category: 'news'`, which would put a message about your own training in
 * the wrong mute toggle.
 *
 * So `dispatchDueTestReminders` owns these kinds and the broadcast scanner skips them by kind.
 * Exactly one owner: two scanners over the same rows would race to send the same push twice.
 */
export const ACADEMY_REMINDER_KINDS: readonly string[] = [REMINDER_BEFORE_KIND, REMINDER_AFTER_KIND];

/** Where the tap lands: the trainee's own academy screen, which holds the invitation card. */
export const REMINDER_URL = '/dashboard/academy';

export interface PlannedReminder {
  which: 'before' | 'after';
  kind: string;
  /** ISO instant the row becomes due. */
  runAt: string;
  titleHe: string;
  bodyHe: string;
  titleEn: string;
  bodyEn: string;
}

/** What the invitation has to say about itself for a reminder to be writable. */
export interface RemindableInvite {
  protocol: string;
  confirmedSlot?: string | null;
}

function beforeCopy(invite: RemindableInvite, slot: string): { titleHe: string; bodyHe: string; titleEn: string; bodyEn: string } {
  const when = slotLabel(slot) ?? '';
  return {
    titleHe: `${protocolLabel(invite.protocol)} — ${when}`,
    // The one coaching sentence that changes the result. Going out too hard is the standard
    // failure and it produces a threshold that is too SLOW, which then prices every workout in
    // the first block too easy — so the reminder is not just "it's tomorrow".
    bodyHe: 'לא לפתוח חזק. חימום קל, ואז הקצב הכי מהיר שאתה יכול להחזיק לכל האורך.',
    titleEn: `Test — ${when}`,
    bodyEn: 'Do not start hard. Easy warm-up, then the fastest pace you can hold the whole way.',
  };
}

function afterCopy(slot: string): { titleHe: string; bodyHe: string; titleEn: string; bodyEn: string } {
  const day = slotDayLabel(slot) ?? '';
  return {
    // Not "you did not do your test". The app does not know that — it knows it has no result,
    // and the two are different claims. One of them is survivable when it is wrong.
    titleHe: 'לא קיבלנו תוצאה לטסט',
    bodyHe: `הטסט היה ב${day}. אם רצת — אפשר להזין את המספרים עכשיו; אם לא יצא, נקבע מחדש.`,
    titleEn: 'No test result yet',
    bodyEn: `Your test was on ${day}. If you ran it, you can enter the numbers now; if not, we will set a new time.`,
  };
}

/**
 * The reminders worth writing for this invitation, right now.
 *
 * A reminder already past its time is DROPPED rather than written, and that is the whole reason
 * this is a function and not two rows built from `reminderTimes`. A trainee who confirms a slot
 * three hours out would otherwise get "your test is tomorrow" on the next five-minute tick,
 * about a test they just this second agreed to, because the row's due time is already behind the
 * clock. The person is holding the phone that confirmed it; there is nothing to remind them of.
 *
 * `after` survives that rule in the same case, which is correct: in three hours' time the test
 * will have happened or it will not, and two days later that difference is worth a message.
 */
export function plannedReminders(
  invite: RemindableInvite,
  now: string,
  hoursBefore: number = REMINDER_HOURS_BEFORE,
  daysAfter: number = FOLLOW_UP_DAYS_AFTER,
): PlannedReminder[] {
  const slot = invite.confirmedSlot;
  const times = reminderTimes(slot, hoursBefore, daysAfter);
  const t = Date.parse(now);
  if (!times || !slot || !Number.isFinite(t)) return [];

  const out: PlannedReminder[] = [];
  if (Date.parse(times.before) > t) {
    out.push({ which: 'before', kind: REMINDER_BEFORE_KIND, runAt: times.before, ...beforeCopy(invite, slot) });
  }
  if (Date.parse(times.after) > t) {
    out.push({ which: 'after', kind: REMINDER_AFTER_KIND, runAt: times.after, ...afterCopy(slot) });
  }
  return out;
}

/**
 * The `scheduled_notifications` row for one planned reminder.
 *
 * `schedule_type: 'once_at'` with `next_run_at` set, because `next_run_at` is the column the
 * scanner actually drives off — `scheduled_at` alone would write a row that is documented as
 * due and never becomes due.
 */
export function reminderRow(planned: PlannedReminder, athleteId: string): Record<string, unknown> {
  return {
    kind: planned.kind,
    title_he: planned.titleHe,
    body_he: planned.bodyHe,
    title_en: planned.titleEn,
    body_en: planned.bodyEn,
    url: REMINDER_URL,
    audience_type: 'athlete',
    audience_id: athleteId,
    schedule_type: 'once_at',
    scheduled_at: planned.runAt,
    next_run_at: planned.runAt,
    status: 'scheduled',
    created_by: 'academy-test-invitation',
  };
}

/**
 * Whether a due reminder row should still go out, given the invitation behind it.
 *
 * Pure so that the one rule protecting the trainee from the follow-up is testable without a
 * database. Both kinds require the invitation to still be confirmed for this slot; the
 * follow-up additionally refuses once any result is linked.
 *
 * A missing invitation returns false: the row is an orphan (the invitation was deleted, or the
 * id link never landed), and "send a reminder about an appointment nobody can find" is not a
 * recoverable message.
 */
export function reminderStillOwed(
  kind: string,
  invite: { status: string; testId?: string | null } | null,
): boolean {
  if (!invite) return false;
  if (invite.status !== 'confirmed') return false;
  if (kind === REMINDER_AFTER_KIND && invite.testId) return false;
  return true;
}
