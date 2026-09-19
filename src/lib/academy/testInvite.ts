/**
 * The test that has been scheduled for a trainee and not yet run.
 *
 * Funnel step 6, which is where candidates are lost — not by deciding against the academy but
 * by genuinely meaning to run a hard 30 minutes on Thursday and then not doing it, with
 * nobody asking again. Everything here exists to make the asking automatic and to make the
 * screen honest about which of several silences is happening.
 *
 * ── WHY THE COUNTS ARE BUILT AND NOT INTERPOLATED ───────────────────────────────────────
 *
 * Hebrew agreement for a count is THREE-way, not two. One is `יום`, two is the dual `יומיים`
 * — with no numeral at all — and three or more is `3 ימים`. Same for hours: `שעה`,
 * `שעתיים`, `12 שעות`. So `${n} ימים` is wrong twice, and the wrongness is invisible while
 * the constants happen to be 12 and 2, which is exactly how it ships.
 *
 * That is also why these return whole phrases rather than a number for a component to splice
 * next to a noun: at n=2 there IS no number to render, so a `<bdi dir="ltr">{n}</bdi>` beside
 * a Hebrew unit cannot express the correct string. The house rule against concatenating a
 * number and a Hebrew unit and the grammar agree here.
 *
 * ── NOTHING HERE SENDS ANYTHING ─────────────────────────────────────────────────────────
 *
 * The reminder times are computed; dispatch is the scheduler's job (`scheduled_notifications`,
 * migration 027). The one rule this module encodes about the follow-up is `followUpOwed`: a
 * nag about an un-run test must never reach somebody who ran it.
 */

import { israelNow } from '@/lib/utils';
import { DAY_LABELS } from './characterization';

/** Hours before the test that the first reminder goes out. From the flow mockup. */
export const REMINDER_HOURS_BEFORE = 12;

/**
 * Days after the test slot that the follow-up goes out, if no result arrived. From the flow
 * mockup, and the reason the whole feature is worth building: the trainee who forgets is not
 * a trainee who quit, and today nothing distinguishes them.
 */
export const FOLLOW_UP_DAYS_AFTER = 2;

export type InviteStatus = 'proposed' | 'confirmed' | 'other' | 'done' | 'cancelled';

/**
 * What the trainee's screen is actually showing. Derived, never stored — the same row means
 * something different on Wednesday and on Saturday, and a stored state would be a second
 * fact about the same appointment that can disagree with the clock.
 */
export type InviteState =
  /** Sent, unanswered, and at least one offered time is still in the future. */
  | 'awaiting_answer'
  /** Sent, unanswered, and every offered time has gone by. Nobody said no; nobody said yes. */
  | 'expired'
  /** Answered yes, and the slot is still ahead. */
  | 'confirmed'
  /** The slot is today and the hour has passed. Still today's test, not yet a failure. */
  | 'today'
  /** The slot's whole day is over and no result arrived. */
  | 'overdue'
  /** The athlete cannot make any offered time and has asked for another. Waiting on staff. */
  | 'other_requested'
  | 'done'
  | 'cancelled';

export interface TestInvitation {
  id: string;
  athleteId: string;
  protocol: string;
  /** Ordered; the first is the slot being asked for, the rest are alternatives. */
  proposedSlots: readonly string[];
  confirmedSlot?: string | null;
  status: InviteStatus;
  requestedNote?: string | null;
  testId?: string | null;
}

/**
 * A count of days, agreeing with itself. `1` → `יום`, `2` → `יומיים`, `5` → `5 ימים`.
 *
 * The dual returns no numeral on purpose. `2 יומיים` reads as "two two-days".
 */
export function daysPhrase(n: number): string {
  const days = Math.max(0, Math.round(n));
  if (days === 0) return 'היום';
  if (days === 1) return 'יום';
  if (days === 2) return 'יומיים';
  return `${days} ימים`;
}

/** The same three-way agreement for hours. `1` → `שעה`, `2` → `שעתיים`, `12` → `12 שעות`. */
export function hoursPhrase(n: number): string {
  const hours = Math.max(0, Math.round(n));
  if (hours === 1) return 'שעה';
  if (hours === 2) return 'שעתיים';
  return `${hours} שעות`;
}

/**
 * The double-reminder promise, in the trainee's words.
 *
 * Said out loud on the screen rather than left as a surprise, because a reminder nobody was
 * promised reads as the app nagging and a reminder that was promised reads as the app doing
 * its job. Built from the same constants the scheduler uses, so the sentence cannot drift
 * from the behaviour.
 */
export function reminderPromise(
  hoursBefore: number = REMINDER_HOURS_BEFORE,
  daysAfter: number = FOLLOW_UP_DAYS_AFTER,
): string {
  return `תזכורת תישלח ${hoursPhrase(hoursBefore)} לפני, ועוד אחת אם הטסט לא בוצע ${daysPhrase(daysAfter)} אחרי.`;
}

/** `2026-09-17T07:00:00+03:00` → `יום ה׳ · 07:00`, in Israel wall-clock. */
export function slotLabel(instant: string): string | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const { weekday, hour, minute } = israelNow(new Date(t));
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `יום ${DAY_LABELS[weekday]} · ${hh}:${mm}`;
}

/** Just the day name, for the confirm button and the "does Thursday not suit you?" line. */
export function slotDayLabel(instant: string): string | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  return `יום ${DAY_LABELS[israelNow(new Date(t)).weekday]}`;
}

/**
 * The offered slots that have not already gone by.
 *
 * The coach proposes Thursday 07:00 and the trainee opens the app on Friday afternoon. A chip
 * offering a time in the past is worse than no chip: tapping it schedules a test for
 * yesterday, and the screen then counts down to an appointment that cannot happen.
 */
export function futureSlots(slots: readonly string[], now: string): string[] {
  const t = Date.parse(now);
  if (!Number.isFinite(t)) return [];
  return slots.filter(s => {
    const ts = Date.parse(s);
    return Number.isFinite(ts) && ts > t;
  });
}

/**
 * The end of the Israel calendar day containing `instant`, as an epoch millisecond value.
 *
 * Read off the Israel wall clock rather than by adding a fixed UTC offset, so it is right in
 * both IST and IDT. It is an hour out on the two days a year the clocks actually change,
 * because those days are 23 and 25 hours long — which moves the overdue boundary from midnight
 * to 23:00 or 01:00 twice a year. Left alone knowingly: the cost is a state label an hour
 * early or late on a day nobody is testing at midnight, and the fix is a full tz library.
 */
function endOfIsraelDay(instant: number): number {
  const { hour, minute } = israelNow(new Date(instant));
  return instant + ((23 - hour) * 60 + (60 - minute)) * 60_000;
}

/**
 * What the screen is showing, given the row and the clock.
 *
 * The `today` state is the one worth arguing about: a test scheduled for 07:00 that has not
 * been reported by 09:00 is not late — the run may be syncing, or the person may be running
 * it at lunch instead. Calling that overdue at 07:01 makes the screen cry wolf on the busiest
 * possible morning. It becomes overdue when the day it was scheduled for is over, which needs
 * no tolerance constant and is the line a human would draw.
 */
export function inviteState(invite: TestInvitation, now: string): InviteState {
  if (invite.status === 'done') return 'done';
  if (invite.status === 'cancelled') return 'cancelled';
  if (invite.status === 'other') return 'other_requested';

  const t = Date.parse(now);

  if (invite.status === 'confirmed') {
    const slot = invite.confirmedSlot ? Date.parse(invite.confirmedSlot) : NaN;
    // A confirmed invitation with an unreadable slot is the DB constraint having been
    // bypassed. Treated as still waiting on an answer rather than crashing the screen: the
    // trainee can then re-pick a time, which is the only useful thing left to offer.
    if (!Number.isFinite(slot) || !Number.isFinite(t)) return 'awaiting_answer';
    if (slot > t) return 'confirmed';
    return t <= endOfIsraelDay(slot) ? 'today' : 'overdue';
  }

  return futureSlots(invite.proposedSlots, now).length > 0 ? 'awaiting_answer' : 'expired';
}

/**
 * When the two reminders are due for a confirmed slot.
 *
 * Returns null for anything unschedulable rather than a best guess: a reminder at the wrong
 * time is a push notification at 03:00, and silence is better than that.
 */
export function reminderTimes(
  confirmedSlot: string | null | undefined,
  hoursBefore: number = REMINDER_HOURS_BEFORE,
  daysAfter: number = FOLLOW_UP_DAYS_AFTER,
): { before: string; after: string } | null {
  const slot = confirmedSlot ? Date.parse(confirmedSlot) : NaN;
  if (!Number.isFinite(slot)) return null;
  return {
    before: new Date(slot - hoursBefore * 3_600_000).toISOString(),
    after: new Date(slot + daysAfter * 86_400_000).toISOString(),
  };
}

/**
 * Whether the follow-up nag is still owed.
 *
 * The one rule in this module that protects the trainee from the app. The follow-up says "you
 * have not done your test" — sending that to somebody who did it proves the app is not
 * reading what they actually ran, and no later apology recovers it. So every condition that
 * could mean "it happened" is a no: a result linked, the status closed, or the invitation
 * withdrawn.
 *
 * Deliberately not `state === 'overdue'`. The nag is due at slot + FOLLOW_UP_DAYS_AFTER,
 * which is later than the moment the screen starts calling it overdue, and the two must not
 * be the same decision — the screen being honest with the person looking at it is not the
 * same event as the app interrupting somebody who is not.
 */
export function followUpOwed(invite: TestInvitation, now: string): boolean {
  if (invite.testId) return false;
  if (invite.status !== 'confirmed') return false;
  const times = reminderTimes(invite.confirmedSlot);
  const t = Date.parse(now);
  if (!times || !Number.isFinite(t)) return false;
  return t >= Date.parse(times.after);
}

/**
 * How to run the test, for the trainee who has never run one.
 *
 * On the screen and not in a coach's WhatsApp message, because getting this wrong wastes the
 * test in a way the trainee cannot see: going out too hard is the standard failure and it
 * produces a threshold that is too SLOW, which then prices every workout in the first block
 * too easy. The person then trains under their ability for two months on the strength of one
 * badly paced Thursday.
 */
export function protocolInstructions(protocol: string): string {
  if (protocol === '2000m') {
    return 'חימום קל של 15 דקות, ואז 2000 מטר בכל הכוח — מסלול שטוח או מסלול אתלטיקה, בלי עצירות. סיום: 10 דקות שחרור.';
  }
  return 'חימום קל של 15 דקות, ואז 30 דקות ריצה רצופה בקצב הכי מהיר שאתה יכול להחזיק לכל האורך — לא לפתוח חזק. שטוח כמה שאפשר, בלי עצירות. סיום: 10 דקות שחרור.';
}

/** `'30min'` → `טסט 30 דקות`. The label the trainee sees for what they were asked to run. */
export function protocolLabel(protocol: string): string {
  if (protocol === '2000m') return 'טסט 2000 מטר';
  const minutes = /^(\d+)min$/.exec(protocol)?.[1];
  return minutes ? `טסט ${minutes} דקות` : `טסט ${protocol}`;
}
