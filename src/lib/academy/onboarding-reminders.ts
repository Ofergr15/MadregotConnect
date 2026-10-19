// The academy's two reminders on the way into the app (academy-onboarding/
// existing-trainee-flow.html): one mail each, 48 hours after the step was asked of them,
// never after 14 days (by then it is a conversation for the manager, who sees them stuck
// on the funnel and on "מי עבר לאפליקציה"). Once per person, through the tick's ledger.
//
//   form    — an existing trainee's details form sent and not filled in
//   install — accepted (form-first, so a token waits) and the app never opened for them
//             (first_seen_at, the one signal that means it really opened)

import { inviteUrl } from './intake';
import { isSynthetic, REMIND_AFTER_MS, REMIND_UNTIL_MS } from '@/lib/onboarding/join-reminder';
import { notifyAcademyExistingForm, notifyAcademyAccepted, notifyAcademyMoveIn } from '@/lib/email';
import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;
type Ledger = { already: (tag: string) => Promise<boolean>; markFired: (tag: string, n: number) => Promise<void> };

export async function runAcademyOnboardingReminders(supabase: Db, now: Date, ledger: Ledger): Promise<{ form: number; install: number }> {
  const from = new Date(now.getTime() - REMIND_UNTIL_MS).toISOString();
  const to = new Date(now.getTime() - REMIND_AFTER_MS).toISOString();
  let form = 0;
  let install = 0;

  // The form: an 'existing' card invited 2–14 days ago, no answers yet, still on the board.
  const { data: cards } = await supabase.from('academy_candidates')
    .select('id, name, email, athlete_id, invite_token, intake, source, archived_at, accepted_at')
    .eq('source', 'existing').is('archived_at', null).is('accepted_at', null)
    .gte('invited_at', from).lte('invited_at', to);
  for (const c of (cards || []) as Array<{ id: string; name: string; email: string | null; athlete_id: string | null; invite_token: string | null; intake: unknown }>) {
    if (c.intake || !c.invite_token || isSynthetic(c.email)) continue;
    const tag = `academyFormReminder:${c.id}`;
    if (await ledger.already(tag)) continue;
    const mail = await notifyAcademyExistingForm({ email: c.email as string, name: c.name, url: inviteUrl(c.invite_token), candidateId: c.id, athleteId: c.athlete_id, reminder: true });
    await ledger.markFired(tag, mail.ok ? 1 : 0);
    if (mail.ok) form++;
  }

  // The install: accepted 2–14 days ago, and the app never opened for them.
  const { data: accepted } = await supabase.from('academy_candidates')
    .select('id, name, email, athlete_id, source')
    .not('athlete_id', 'is', null).is('archived_at', null)
    .gte('accepted_at', from).lte('accepted_at', to);
  const rows = (accepted || []) as Array<{ id: string; name: string; email: string | null; athlete_id: string; source: string | null }>;
  if (rows.length) {
    const { data: people } = await supabase.from('athletes')
      .select('id, name, email, invite_token, first_seen_at, is_academy').in('id', rows.map((r) => r.athlete_id));
    const byId = new Map(((people || []) as Array<{ id: string; name: string | null; email: string | null; invite_token: string | null; first_seen_at: string | null; is_academy: boolean | null }>).map((p) => [p.id, p]));
    for (const r of rows) {
      const a = byId.get(r.athlete_id);
      const email = r.email || a?.email || null;
      if (!a || !a.is_academy || a.first_seen_at || !a.invite_token || isSynthetic(email)) continue;
      const tag = `academyInstallReminder:${a.id}`;
      if (await ledger.already(tag)) continue;
      const name = r.name || a.name;
      const mail = r.source === 'existing'
        ? await notifyAcademyMoveIn({ email: email as string, name, token: a.invite_token, athleteId: a.id, candidateId: r.id, reminder: true })
        : await notifyAcademyAccepted({ email: email as string, name, token: a.invite_token, athleteId: a.id, candidateId: r.id, reminder: true });
      await ledger.markFired(tag, mail.ok ? 1 : 0);
      if (mail.ok) install++;
    }
  }
  return { form, install };
}
