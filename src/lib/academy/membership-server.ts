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
}
