/**
 * The moment an invitation stops being an invitation.
 *
 * `academy_test_invitations` holds an INTENTION and `academy_tests` holds a MEASUREMENT, and
 * migration 112's header says where they meet: `test_id`, which is what "done" means. Until now
 * nothing wrote it. So a trainee could run the test, submit the number, have the coach approve
 * it — and the invitation would sit open forever, the board would keep saying nobody had a
 * result, and the follow-up reminder would eventually tell somebody who had just been approved
 * that they still had not done their test. That last one is the single most trust-destroying
 * message this product can send: it proves the app is not reading what the person actually did.
 *
 * ── WHY THIS IS A PURE DECISION AND NOT FOUR LINES IN THE ROUTE ───────────────────────────
 *
 * Because "does this result answer that invitation" has three real ways to be wrong, and all
 * three are silent:
 *
 *   · WRONG PROTOCOL. An invitation to a 30-minute test that comes back as a 2000m is a
 *     different measurement, not this one — the same reason every read in `lib/academy/tests.ts`
 *     is keyed on protocol. Settling it would close a test that was never run and stop the
 *     reminders for it.
 *   · WRONG DIRECTION IN TIME. A coach entering last March's test while an invitation for next
 *     Tuesday is open is backfilling history, not reporting the appointment. Matching on
 *     athlete alone would mark Tuesday done and cancel its reminder.
 *   · NOT YET APPROVED. A trainee's own submission is `status='pending'` precisely because
 *     nobody has looked at the number, and `done` is a claim that a measurement exists. But
 *     the REMINDERS must stop the moment the number arrives, approved or not — the follow-up
 *     asks "did you run it", and they did. So a pending submission holds the invitation open
 *     and silences the nags, which is the one combination a boolean could not express.
 */

/** An open invitation, as the route reads it. */
export interface OpenInvitation {
  id: string;
  protocol: string;
  /** The Israel calendar day the invitation was created — see WRONG DIRECTION IN TIME. */
  createdDay: string;
  reminderBeforeId: string | null;
  reminderAfterId: string | null;
}

/** The measurement that may or may not answer it. */
export interface RecordedTest {
  id: string;
  protocol: string;
  /** `YYYY-MM-DD`, the day the test was run. */
  date: string;
  /** False for a trainee's own unreviewed submission. */
  approved: boolean;
}

export type Settlement =
  /** Nothing to do, and `reason` says which of the three it was — logged, never shown. */
  | { kind: 'none'; reason: 'no_open_invitation' | 'other_protocol' | 'predates_invitation' }
  /** Mark it done and stop the reminders. */
  | { kind: 'settle'; invitationId: string; testId: string; cancelReminders: string[] }
  /** Leave it open, stop the reminders. A submission nobody has approved yet. */
  | { kind: 'hold'; invitationId: string; cancelReminders: string[] };

/**
 * Both reminders, not just the follow-up.
 *
 * The 12-hour "your test is tomorrow" is as wrong as the nag once a result exists: whatever the
 * row still says about next Tuesday, the person has run it. A reminder for a test that has
 * already happened is the same class of mistake, read a day earlier.
 */
function reminders(open: OpenInvitation): string[] {
  return [open.reminderBeforeId, open.reminderAfterId].filter((id): id is string => !!id);
}

export function settlementFor(open: OpenInvitation | null, test: RecordedTest): Settlement {
  if (!open) return { kind: 'none', reason: 'no_open_invitation' };
  if (open.protocol !== test.protocol) return { kind: 'none', reason: 'other_protocol' };
  // Strictly before the day the invitation was created. The same day is allowed and has to be:
  // a coach who invites somebody in the morning and records the test that afternoon — the
  // phone-call case the route deliberately supports — is answering this invitation.
  if (test.date < open.createdDay) return { kind: 'none', reason: 'predates_invitation' };
  return test.approved
    ? { kind: 'settle', invitationId: open.id, testId: test.id, cancelReminders: reminders(open) }
    : { kind: 'hold', invitationId: open.id, cancelReminders: reminders(open) };
}
