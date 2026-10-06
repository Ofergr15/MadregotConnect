// The one reminder an approved applicant gets when they have not come in
// (onboarding v2). 48 hours after approval, still 'invited', never seen: one mail
// back to their own join link, which opens the install guide. Once per person
// (the tick's ledger), and never after 14 days — by then it is a conversation for
// the approver, who sees them in the entry queue's "never entered" stage.
//
// Only for v2 approvals while it is tried: an approval by the super user is what
// sent them the v2 link in the first place (lib/install/flag).

import { ONBOARDING_V2_FOR_ALL } from '@/lib/install/flag';
import { SUPER_USER_EMAIL } from '@/lib/constants';
import { groupDisplayName } from '@/lib/utils';
import { notifyJoinReminder } from '@/lib/email';
import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;
export const REMIND_AFTER_MS = 48 * 3_600_000;
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
  const v2 = requests.filter(r => ONBOARDING_V2_FOR_ALL || (r.approved_by || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase());
  if (!v2.length) return 0;

  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, email, status, last_seen_at, invite_token, group_id')
    .in('id', v2.map(r => r.athlete_id as string));
  let sent = 0;
  for (const a of athletes || []) {
    if (a.status !== 'invited' || a.last_seen_at || !a.invite_token || isSynthetic(a.email)) continue;
    const tag = `joinReminder:${a.id}`;
    if (await ledger.already(tag)) continue;
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
