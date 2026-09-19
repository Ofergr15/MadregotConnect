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
