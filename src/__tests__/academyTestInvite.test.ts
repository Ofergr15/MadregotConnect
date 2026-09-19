import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_DAYS_AFTER,
  REMINDER_HOURS_BEFORE,
  daysPhrase,
  followUpOwed,
  futureSlots,
  hoursPhrase,
  inviteState,
  protocolInstructions,
  protocolLabel,
  reminderPromise,
  reminderTimes,
  slotDayLabel,
  slotLabel,
  type TestInvitation,
} from '@/lib/academy/testInvite';

// Israel wall-clock instants, written with the offset so the test says what it means. September
// is IDT (+03:00). 2026-09-17 is a Thursday.
const THU_07 = '2026-09-17T07:00:00+03:00';
const FRI_07 = '2026-09-18T07:00:00+03:00';
const SUN_18 = '2026-09-20T18:00:00+03:00';

const invite = (over: Partial<TestInvitation> = {}): TestInvitation => ({
  id: 'i1',
  athleteId: 'a1',
  protocol: '30min',
  proposedSlots: [THU_07, FRI_07, SUN_18],
  status: 'proposed',
  ...over,
});

describe('counting in Hebrew', () => {
  // The dual is the whole reason this is a function. `2 ימים` and `2 שעות` are both wrong, and
  // both are what a template produces.
  it('agrees with itself across all three forms', () => {
    expect(daysPhrase(1)).toBe('יום');
    expect(daysPhrase(2)).toBe('יומיים');
    expect(daysPhrase(3)).toBe('3 ימים');
    expect(hoursPhrase(1)).toBe('שעה');
    expect(hoursPhrase(2)).toBe('שעתיים');
    expect(hoursPhrase(12)).toBe('12 שעות');
  });

  it('puts no numeral on the dual', () => {
    // `2 יומיים` reads as "two two-days".
    expect(daysPhrase(2)).not.toContain('2');
    expect(hoursPhrase(2)).not.toContain('2');
  });

  it('says היום rather than 0 ימים', () => {
    expect(daysPhrase(0)).toBe('היום');
  });

  it('builds the promise from the same constants the scheduler uses', () => {
    // The sentence on the screen and the behaviour must not be able to drift apart.
    expect(reminderPromise()).toBe('תזכורת תישלח 12 שעות לפני, ועוד אחת אם הטסט לא בוצע יומיים אחרי.');
  });

  it('still reads correctly if the constants are ever changed to the awkward numbers', () => {
    // 1 and 2 are exactly the values a naive template gets wrong, so they are pinned.
    expect(reminderPromise(2, 1)).toBe('תזכורת תישלח שעתיים לפני, ועוד אחת אם הטסט לא בוצע יום אחרי.');
    expect(reminderPromise(1, 3)).toBe('תזכורת תישלח שעה לפני, ועוד אחת אם הטסט לא בוצע 3 ימים אחרי.');
  });
});

describe('naming a slot', () => {
  it('reads the Israel wall clock, not the server clock', () => {
    expect(slotLabel(THU_07)).toBe('יום ה׳ · 07:00');
    expect(slotLabel(SUN_18)).toBe('יום א׳ · 18:00');
  });

  it('gives the day on its own for the confirm button', () => {
    expect(slotDayLabel(THU_07)).toBe('יום ה׳');
  });

  it('pads a single-digit hour', () => {
    // `7:00` beside `18:00` in a row of chips is a column that does not line up.
    expect(slotLabel('2026-09-17T09:05:00+03:00')).toBe('יום ה׳ · 09:05');
  });

  it('is null rather than Invalid Date on junk', () => {
    expect(slotLabel('not a time')).toBeNull();
    expect(slotDayLabel('')).toBeNull();
  });

  it('names the same instant by Israel time even when written in UTC', () => {
    // 04:00Z in September is 07:00 in Israel. A slot stored as UTC must not render as 04:00.
    expect(slotLabel('2026-09-17T04:00:00Z')).toBe('יום ה׳ · 07:00');
  });
});

describe('offering only times that can still happen', () => {
  it('drops a slot that has gone by', () => {
    // The coach proposed Thursday; the trainee opens the app on Friday afternoon.
    expect(futureSlots([THU_07, FRI_07, SUN_18], '2026-09-18T15:00:00+03:00')).toEqual([SUN_18]);
  });

  it('keeps the order it was given', () => {
    expect(futureSlots([THU_07, FRI_07, SUN_18], '2026-09-16T00:00:00+03:00')).toEqual([THU_07, FRI_07, SUN_18]);
  });

  it('treats the slot itself as gone once the minute arrives', () => {
    expect(futureSlots([THU_07], THU_07)).toEqual([]);
  });

  it('returns nothing rather than everything for an unreadable clock', () => {
    expect(futureSlots([THU_07], 'nonsense')).toEqual([]);
  });
});

describe('what the screen is showing', () => {
  const before = '2026-09-16T09:00:00+03:00';

  it('is waiting for an answer while an offered time is still ahead', () => {
    expect(inviteState(invite(), before)).toBe('awaiting_answer');
  });

  it('expires when nobody answered and every offered time has gone', () => {
    // Nobody said no. That is a different fact from a refusal and needs its own state, because
    // the useful action is to offer new times rather than to record a drop-out.
    expect(inviteState(invite(), '2026-09-25T09:00:00+03:00')).toBe('expired');
  });

  it('counts down to a confirmed slot', () => {
    expect(inviteState(invite({ status: 'confirmed', confirmedSlot: THU_07 }), before)).toBe('confirmed');
  });

  it('is still TODAY two hours after the hour has passed', () => {
    // The run may be syncing, or he may do it at lunch. Calling this overdue at 07:01 makes
    // the screen cry wolf on the one morning it most needs to be trusted.
    const state = inviteState(invite({ status: 'confirmed', confirmedSlot: THU_07 }), '2026-09-17T09:00:00+03:00');
    expect(state).toBe('today');
  });

  it('is still TODAY at a minute to midnight', () => {
    const state = inviteState(invite({ status: 'confirmed', confirmedSlot: THU_07 }), '2026-09-17T23:59:00+03:00');
    expect(state).toBe('today');
  });

  it('is overdue once the day it was scheduled for is over', () => {
    const state = inviteState(invite({ status: 'confirmed', confirmedSlot: THU_07 }), '2026-09-18T07:30:00+03:00');
    expect(state).toBe('overdue');
  });

  it('keeps asking for another time as its own state', () => {
    // The most engaged answer short of yes, and it needs the coach. Folding it into cancelled
    // would hide the one person actively trying to comply.
    expect(inviteState(invite({ status: 'other', requestedNote: 'עובד במשמרות' }), before)).toBe('other_requested');
  });

  it('is done and cancelled regardless of the clock', () => {
    expect(inviteState(invite({ status: 'done', testId: 't1' }), before)).toBe('done');
    expect(inviteState(invite({ status: 'cancelled' }), '2026-09-01T00:00:00+03:00')).toBe('cancelled');
  });

  it('falls back to awaiting an answer when a confirmed row has no readable slot', () => {
    // The DB CHECK forbids this, so reaching it means the constraint was bypassed. Offering
    // the trainee a time to re-pick is the only useful thing left; crashing the screen is not.
    expect(inviteState(invite({ status: 'confirmed', confirmedSlot: null }), before)).toBe('awaiting_answer');
  });
});

describe('when the reminders are due', () => {
  it('puts the first one the promised number of hours before', () => {
    const times = reminderTimes(THU_07)!;
    expect(Date.parse(THU_07) - Date.parse(times.before)).toBe(REMINDER_HOURS_BEFORE * 3_600_000);
  });

  it('puts the follow-up the promised number of days after', () => {
    const times = reminderTimes(THU_07)!;
    expect(Date.parse(times.after) - Date.parse(THU_07)).toBe(FOLLOW_UP_DAYS_AFTER * 86_400_000);
  });

  it('is null rather than a guess for an unschedulable slot', () => {
    // A wrong reminder time is a push notification at 03:00.
    expect(reminderTimes(null)).toBeNull();
    expect(reminderTimes('soon')).toBeNull();
  });
});

describe('never nagging somebody who did the test', () => {
  const confirmed = invite({ status: 'confirmed', confirmedSlot: THU_07 });
  const wellAfter = '2026-09-20T07:00:00+03:00';

  it('owes the follow-up when the test was confirmed and never reported', () => {
    expect(followUpOwed(confirmed, wellAfter)).toBe(true);
  });

  it('does NOT owe it once a result is linked', () => {
    // The message says "you have not done your test". Sending that to somebody who did it
    // proves the app is not reading what they ran, and no later apology recovers it.
    expect(followUpOwed({ ...confirmed, testId: 't1' }, wellAfter)).toBe(false);
  });

  it('does NOT owe it for a closed or withdrawn invitation', () => {
    expect(followUpOwed({ ...confirmed, status: 'done', testId: 't1' }, wellAfter)).toBe(false);
    expect(followUpOwed({ ...confirmed, status: 'cancelled' }, wellAfter)).toBe(false);
    expect(followUpOwed({ ...confirmed, status: 'other' }, wellAfter)).toBe(false);
  });

  it('does NOT owe it before the follow-up time, even though the screen already says overdue', () => {
    // These are deliberately two different decisions. Being honest with the person looking at
    // the screen is not the same event as interrupting somebody who is not looking.
    const nextMorning = '2026-09-18T07:30:00+03:00';
    expect(inviteState(confirmed, nextMorning)).toBe('overdue');
    expect(followUpOwed(confirmed, nextMorning)).toBe(false);
  });

  it('does NOT owe it while the invitation is still unanswered', () => {
    // Nobody agreed to a time, so there is no test to have missed.
    expect(followUpOwed(invite(), wellAfter)).toBe(false);
  });
});

describe('telling the trainee what to run', () => {
  it('names the protocol', () => {
    expect(protocolLabel('30min')).toBe('טסט 30 דקות');
    expect(protocolLabel('2000m')).toBe('טסט 2000 מטר');
  });

  it('does not invent a label for a protocol it does not know', () => {
    expect(protocolLabel('cooper')).toBe('טסט cooper');
  });

  it('warns against the failure that makes the test useless', () => {
    // Going out too hard produces a threshold that is too SLOW, which prices the whole first
    // block too easy. The trainee cannot see that happening, so the screen has to say it.
    expect(protocolInstructions('30min')).toContain('לא לפתוח חזק');
    expect(protocolInstructions('30min')).toContain('חימום');
  });

  it('gives the 2000m its own instructions', () => {
    expect(protocolInstructions('2000m')).toContain('2000');
    expect(protocolInstructions('2000m')).not.toContain('30 דקות ריצה רצופה');
  });
});
