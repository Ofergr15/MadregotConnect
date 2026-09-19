import { describe, expect, it } from 'vitest';
import { settlementFor, type OpenInvitation } from '@/lib/academy/settleInvitation';

/**
 * Which result closes which invitation.
 *
 * Every case here is a way of being silently wrong: settling a test that was never run, closing
 * an appointment because somebody backfilled last March, or claiming a measurement exists when
 * nobody has checked the number yet. The reminders are the part with teeth — a follow-up asking
 * "did you run your test" after the coach has approved it is the message migration 112's header
 * calls the worst one this product can send.
 */

const open: OpenInvitation = {
  id: 'inv-1',
  protocol: '30min',
  createdDay: '2026-09-14',
  reminderBeforeId: 'rem-before',
  reminderAfterId: 'rem-after',
};

const test30 = { id: 'test-1', protocol: '30min', date: '2026-09-20', approved: true };

describe('settlementFor', () => {
  it('settles the invitation an approved result answers, and stops both reminders', () => {
    expect(settlementFor(open, test30)).toEqual({
      kind: 'settle',
      invitationId: 'inv-1',
      testId: 'test-1',
      cancelReminders: ['rem-before', 'rem-after'],
    });
  });

  it('holds an unapproved submission open but still stops the reminders', () => {
    // They ran it. Nobody has checked the number, so it is not done — but nothing should be
    // asking them whether they ran it.
    expect(settlementFor(open, { ...test30, approved: false })).toEqual({
      kind: 'hold',
      invitationId: 'inv-1',
      cancelReminders: ['rem-before', 'rem-after'],
    });
  });

  it('does not settle a different protocol', () => {
    // A 2000m is a different measurement, not this one. Closing the 30-minute invitation would
    // stop the reminders for a test nobody has run.
    expect(settlementFor(open, { ...test30, protocol: '2000m' })).toEqual({
      kind: 'none', reason: 'other_protocol',
    });
  });

  it('does not settle a test run before the invitation existed', () => {
    // Backfilled history, not an answer to next week's appointment.
    expect(settlementFor(open, { ...test30, date: '2026-03-02' })).toEqual({
      kind: 'none', reason: 'predates_invitation',
    });
  });

  it('settles a test recorded on the very day the invitation was created', () => {
    // The phone-call case: invited in the morning, run and recorded that afternoon.
    const same = settlementFor(open, { ...test30, date: '2026-09-14' });
    expect(same.kind).toBe('settle');
  });

  it('does nothing when the athlete has no open invitation', () => {
    expect(settlementFor(null, test30)).toEqual({ kind: 'none', reason: 'no_open_invitation' });
  });

  it('asks for no reminder cancellations when none were ever scheduled', () => {
    // The state every row is in today, with dispatch not built yet: the settle must still
    // happen, with an empty list rather than two nulls handed to an `in()`.
    const settlement = settlementFor(
      { ...open, reminderBeforeId: null, reminderAfterId: null },
      test30,
    );
    expect(settlement).toEqual({
      kind: 'settle', invitationId: 'inv-1', testId: 'test-1', cancelReminders: [],
    });
  });

  it('cancels only the reminder that exists', () => {
    const settlement = settlementFor({ ...open, reminderBeforeId: null }, test30);
    expect(settlement.kind === 'settle' && settlement.cancelReminders).toEqual(['rem-after']);
  });
});
