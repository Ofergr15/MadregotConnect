import type { createServerClient } from '@/lib/supabase/server';
import { israelToday } from '@/lib/utils';
import { isMissingTable } from '@/lib/supabase/schema-drift';

// What switching `athletes.is_academy` carries beyond the boolean. Shared by the
// two doors that flip it by hand: PUT /api/athletes (the athlete screens) and
// the "רץ אקדמיה" switch on the roles screen.
//
// Academy enrolment carries two facts the boolean alone doesn't: when they
// joined the *academy* (created_at is when they joined the club), and that
// leaving ends the 1:1 pair. Without the second, a coach would keep a phantom
// trainee on their caseload, and re-enrolling someone months later would
// silently restore a pairing nobody chose.
//
// Runs after the flag itself is written, and errors are only logged, so a
// database that predates migration 077 still enrols and removes members normally.
export async function applyAcademyMembership(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  isAcademy: boolean,
): Promise<void> {
  const today = israelToday();
  if (isAcademy) {
    // Only the first time — re-adding someone doesn't restart their history.
    const { error: stampErr } = await supabase
      .from('athletes')
      .update({ academy_joined_on: today })
      .eq('id', athleteId)
      .is('academy_joined_on', null);
    if (stampErr) console.warn('academy_joined_on not set:', stampErr.message);
    return;
  }
  // The coach they leave with goes into the trail FIRST (launch N13): a pairing made
  // without a history row (an accept, a seed, a pre-077 pair) used to end with no record,
  // so "bring back" (manage-server previousCoaches) restored them coachless and their pain
  // alerts went to the managers.
  await recordLeavingCoach(supabase, athleteId, today);
  const { error: histErr } = await supabase
    .from('academy_coach_history')
    .update({ ended_on: today })
    .eq('athlete_id', athleteId)
    .is('ended_on', null);
  const { error: slotErr } = await supabase
    .from('academy_slots')
    .update({ active_to: today })
    .eq('athlete_id', athleteId)
    .is('active_to', null);
  const { error: unpairErr } = await supabase
    .from('athletes')
    .update({ academy_coach_id: null })
    .eq('id', athleteId);
  // Every coach, not just the legacy one (migration 135). Before 135 the table
  // isn't there, which is fine: there is nothing in it to clear.
  const { error: linksErr } = await supabase
    .from('academy_trainee_coaches')
    .delete()
    .eq('athlete_id', athleteId);
  const failed = histErr || slotErr || unpairErr || (linksErr && !isMissingTable(linksErr) ? linksErr : null);
  if (failed) console.warn('academy pairing not cleared:', failed.message);
  // An open test invitation and its two reminders do not survive the removal (N13): they
  // kept nagging someone who is no longer a trainee.
  await cancelOpenInvitations(supabase, athleteId);
}

/** An open history row for the lead coach, so the trail names who they left with. */
async function recordLeavingCoach(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  today: string,
): Promise<void> {
  try {
    const { data: me } = await supabase.from('athletes').select('academy_coach_id').eq('id', athleteId).maybeSingle();
    const lead = (me as { academy_coach_id?: string | null } | null)?.academy_coach_id ?? null;
    if (!lead) return;
    const { data: open } = await supabase
      .from('academy_coach_history')
      .select('coach_id')
      .eq('athlete_id', athleteId)
      .is('ended_on', null);
    if (((open || []) as Array<{ coach_id: string | null }>).some((h) => h.coach_id === lead)) return;
    // One open row per trainee (077's partial unique index): close any other first.
    await supabase.from('academy_coach_history').update({ ended_on: today }).eq('athlete_id', athleteId).is('ended_on', null);
    const { error } = await supabase
      .from('academy_coach_history')
      .insert({ athlete_id: athleteId, coach_id: lead, started_on: today, reason: 'הוסר מהאקדמיה' });
    if (error) console.warn('academy coach history not recorded:', error.message);
  } catch (err) {
    console.warn('academy coach history not recorded:', err);
  }
}

/** Cancel the trainee's open invitation(s) and the reminders armed for them. */
export async function cancelOpenInvitations(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select('id, reminder_before_id, reminder_after_id')
      .eq('athlete_id', athleteId)
      .in('status', ['proposed', 'confirmed', 'other']);
    if (error || !data?.length) return 0;
    const rows = data as Array<{ id: string; reminder_before_id?: string | null; reminder_after_id?: string | null }>;
    const reminders = rows.flatMap((r) => [r.reminder_before_id, r.reminder_after_id]).filter((x): x is string => !!x);
    if (reminders.length) {
      await supabase.from('scheduled_notifications').update({ status: 'cancelled' }).in('id', reminders).eq('status', 'scheduled');
    }
    await supabase
      .from('academy_test_invitations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));
    return rows.length;
  } catch (err) {
    console.warn('academy invitations not cancelled:', err);
    return 0;
  }
}
