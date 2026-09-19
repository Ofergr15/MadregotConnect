import { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import { settlementFor, type RecordedTest, type Settlement } from './settleInvitation';

/**
 * Writing the meeting point: `academy_test_invitations.test_id`.
 *
 * The decision itself is pure and lives in `./settleInvitation`; this is the four reads and
 * three writes around it.
 *
 * ── IT MUST NEVER FAIL THE THING THAT CALLED IT ───────────────────────────────────────────
 *
 * Every error here is swallowed and logged. Recording a test and approving one are the primary
 * acts; settling the invitation is bookkeeping that happens to also stop two notifications. If
 * migration 112 is not pasted in yet — and every migration in this repo is pasted in by hand,
 * so there is always a window — then `academy_test_invitations` does not exist, and a coach
 * approving a number must not see "failed to approve" because of a table that has nothing to do
 * with the number. The cost of swallowing is an invitation left open, which is exactly the state
 * the whole product was in before this function existed; the cost of throwing is a coach who
 * cannot approve tests.
 */
/** A test a trainee submitted and nobody has approved. */
export interface PendingSubmission { id: string; protocol: string; date: string; submittedAt: string }

/**
 * The unapproved submissions for these athletes, one per athlete.
 *
 * One and not all, because the partial unique index allows a single open invitation per athlete,
 * so at most one submission can be answering it. Where somebody has submitted twice — two
 * protocols, or a correction, which migration 105's unique index turns into an upsert — the
 * latest is the one the coach is about to look at.
 *
 * Degrades to "none" on purpose. Pre-108 there is no `status` column and therefore no pending row
 * anywhere in the table, and a screen that fails to load over a column it only wanted for a label
 * is trading the whole thing for a nicety.
 */
export async function pendingSubmissionsByAthlete(
  supabase: ReturnType<typeof createServerClient>,
  athleteIds: readonly string[],
): Promise<Map<string, PendingSubmission>> {
  const out = new Map<string, PendingSubmission>();
  if (athleteIds.length === 0) return out;
  const { data, error } = await supabase
    .from('academy_tests')
    .select('id, athlete_id, protocol, test_date, submitted_at, status')
    .in('athlete_id', [...athleteIds])
    .eq('status', 'pending')
    .order('test_date', { ascending: true });
  if (error || !data) {
    if (error && !isMissingTable(error) && !isMissingColumn(error)) {
      console.error('pendingSubmissionsByAthlete read failed:', error);
    }
    return out;
  }
  for (const r of data) {
    const raw = r as unknown as Record<string, unknown>;
    const date = String(raw.test_date ?? '').slice(0, 10);
    if (!date) continue;
    // Ascending, so the last write wins and the map holds the most recent submission.
    out.set(String(raw.athlete_id), {
      id: String(raw.id),
      protocol: String(raw.protocol || '30min'),
      date,
      // Falling back to the test's own day: pre-108 rows have no `submitted_at`, and this
      // field's job is "there is a result waiting", not a precise timestamp.
      submittedAt: typeof raw.submitted_at === 'string' ? raw.submitted_at : date,
    });
  }
  return out;
}

/**
 * Whether that submission is the answer to THIS invitation — the settle's own rule, reused.
 *
 * `settlementFor` with `approved: false` returns `hold` for exactly the submissions that would
 * settle the invitation once approved: right protocol, not predating it. Calling it rather than
 * re-comparing the fields is the point — every screen that says "waiting for approval" says it
 * about precisely the rows approval will close.
 */
export function submittedAtFor(
  submission: PendingSubmission | undefined,
  invite: { protocol: string; createdAt: string },
): string | null {
  if (!submission) return null;
  const settlement = settlementFor(
    {
      id: 'lookup',
      protocol: invite.protocol,
      // The Israel calendar day, because a test's date is one.
      createdDay: israelToday(new Date(invite.createdAt)),
      reminderBeforeId: null,
      reminderAfterId: null,
    },
    { id: submission.id, protocol: submission.protocol, date: submission.date, approved: false },
  );
  return settlement.kind === 'hold' ? submission.submittedAt : null;
}

export async function settleInvitationForTest(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  test: RecordedTest,
): Promise<Settlement | null> {
  try {
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select('id, protocol, created_at, reminder_before_id, reminder_after_id')
      .eq('athlete_id', athleteId)
      // The partial unique index allows exactly one of these, so there is no ordering question
      // and no second row to disambiguate. `done` and `cancelled` are deliberately excluded:
      // a correction to an already-settled test must not re-settle it and must not resurrect
      // and re-cancel reminders that were dealt with when it first came in.
      .in('status', ['proposed', 'confirmed', 'other'])
      .maybeSingle();
    if (error) {
      if (isMissingTable(error) || isMissingColumn(error)) return null;
      console.error('settleInvitationForTest read failed:', error);
      return null;
    }

    const settlement = settlementFor(
      data
        ? {
          id: String(data.id),
          protocol: String(data.protocol || '30min'),
          // The Israel calendar day, because `test.date` is one: comparing a date to a UTC
          // timestamp would make an invitation created at 23:00 look like tomorrow's.
          createdDay: israelToday(new Date(String(data.created_at))),
          reminderBeforeId: data.reminder_before_id ?? null,
          reminderAfterId: data.reminder_after_id ?? null,
        }
        : null,
      test,
    );
    if (settlement.kind === 'none') return settlement;

    // Reminders first. If the second write fails, an invitation stays open with its nags
    // silenced — annoying. In the other order a failure leaves a settled invitation whose
    // follow-up still fires, which is the message migration 112's header calls the worst one
    // this product can send.
    if (settlement.cancelReminders.length > 0) {
      const { error: cancelError } = await supabase
        .from('scheduled_notifications')
        .update({ status: 'cancelled' })
        .in('id', settlement.cancelReminders)
        // Never un-send. A row the scanner has already delivered stays `sent`, because
        // rewriting it to cancelled would make the history claim a message that arrived on
        // somebody's phone never went out.
        .eq('status', 'scheduled');
      if (cancelError) console.error('settleInvitationForTest reminder cancel failed:', cancelError);
    }

    if (settlement.kind === 'settle') {
      const { error: doneError } = await supabase
        .from('academy_test_invitations')
        .update({
          status: 'done',
          test_id: settlement.testId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settlement.invitationId);
      if (doneError) console.error('settleInvitationForTest settle failed:', doneError);
    }

    return settlement;
  } catch (err) {
    console.error('settleInvitationForTest error:', err);
    return null;
  }
}
