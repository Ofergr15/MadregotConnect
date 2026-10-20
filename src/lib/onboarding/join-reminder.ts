// The reminders an approved applicant gets when they have not come in
// (onboarding v2). 48 hours after approval, and again on day 5, still 'invited', never seen: one mail
// back to their own join link, which opens the install guide. Once per person
// (the tick's ledger), and never after 14 days — by then it is a conversation for
// the approver, who sees them in the entry queue's "never entered" stage.
//
// For EVERY approval since 2026-10-19 — it used to be only the super user's, while
// v2 was tried. The mail's link opens the v2 install guide on that phone either way
// (joinLinkV2), and whoever approved them, an approved person who never came in is
// the same person lost (Chen Becher, approved 10-16, never opened it).

import { groupDisplayName } from '@/lib/utils';
import { notifyJoinReminder } from '@/lib/email';
import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;
export const REMIND_AFTER_MS = 48 * 3_600_000;
// A second and last one on day 5 for whoever the first did not bring in (Ofer 2026-10-20:
// "no holes for people who forget they signed up"). Same mail, same link.
export const REMIND_AGAIN_MS = 5 * 24 * 3_600_000;
export const REMIND_UNTIL_MS = 14 * 24 * 3_600_000;

export function isSynthetic(email: string | null | undefined): boolean {
  return !email || /@strava\.madregot\.local$/i.test(email);
}

export async function runJoinReminders(
  supabase: Db,
  now: Date,
  ledger: { already: (tag: string) => Promise<boolean>; markFired: (tag: string, n: number) => Promise<void> },
): Promise<number> {
  const { data: requests, error } = await supabase
    .from('signup_requests')
    .select('athlete_id, approved_by, approved_at')
    .eq('status', 'approved')
    .not('athlete_id', 'is', null)
    .lte('approved_at', new Date(now.getTime() - REMIND_AFTER_MS).toISOString())
    .gte('approved_at', new Date(now.getTime() - REMIND_UNTIL_MS).toISOString());
  if (error || !requests?.length) return 0;

  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, email, status, last_seen_at, invite_token, group_id')
    .in('id', [...new Set(requests.map(r => r.athlete_id as string))]);
  const approvedAt = new Map(requests.map(r => [r.athlete_id as string, Date.parse(r.approved_at as string)]));
  let sent = 0;
  for (const a of athletes || []) {
    // "Has not come in" is never seen, not the status: saving the details on /join makes
    // the row active before any sign-in, so Chen Becher (saved 10-20, never signed in)
    // dropped out of the reminders while still outside.
    if ((a.status !== 'invited' && a.status !== 'active') || a.last_seen_at || !a.invite_token || isSynthetic(a.email)) continue;
    const first = `joinReminder:${a.id}`;
    let tag = first;
    if (await ledger.already(first)) {
      // The first went out: the second is due from day 5, once.
      if (now.getTime() - (approvedAt.get(a.id) ?? now.getTime()) < REMIND_AGAIN_MS) continue;
      tag = `joinReminder2:${a.id}`;
      if (await ledger.already(tag)) continue;
    }
    let groupName: string | null = null;
    if (a.group_id) {
      const { data: g } = await supabase.from('groups').select('name').eq('id', a.group_id).maybeSingle();
      groupName = g?.name ? groupDisplayName(g.name) : null;
    }
    const mail = await notifyJoinReminder({ email: a.email as string, token: a.invite_token as string, groupName, athleteId: a.id });
    await ledger.markFired(tag, mail.ok ? 1 : 0);
    if (mail.ok) sent++;
  }
  return sent;
}
