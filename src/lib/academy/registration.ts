// Is the academy taking sign-ups? One switch, on the manager's academy overview,
// for the two public doors that used to read a hard-coded constant each: the
// Instagram landing page (/academy) and the form (/academy-register, and the
// POST behind it).
//
// Stored in app_settings under `academy_registration_open` as 'open' | 'closed'.
// No row means open, which is what the constants said, so nothing changes until
// the manager flips it. A candidate a coach invited personally (funnel → "send the
// form", migration 126) still gets through while it is closed: that link is an
// invitation, not the public door.
//
// Server only.

import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

export const REGISTRATION_KEY = 'academy_registration_open';

/** Anything but an explicit 'closed' is open: a typo must not shut the academy. */
export const parseRegistrationOpen = (value: string | null | undefined) => value !== 'closed';

export async function isRegistrationOpen(supabase: Db): Promise<boolean> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', REGISTRATION_KEY).maybeSingle();
  if (error) return true;
  return parseRegistrationOpen((data as { value?: string } | null)?.value);
}

/** A live funnel invitation: the form is open to its holder whatever the switch says. */
export async function isLiveInvite(supabase: Db, token: string | null | undefined): Promise<boolean> {
  const t = (token || '').trim();
  if (!t || t.length > 128) return false;
  const { data, error } = await supabase
    .from('academy_candidates')
    .select('id, archived_at')
    .eq('invite_token', t)
    .maybeSingle();
  if (error || !data) return false;
  return !(data as { archived_at?: string | null }).archived_at;
}

/** May this visitor register: the door is open, or they hold an invitation. */
export async function mayRegister(supabase: Db, inviteToken?: string | null): Promise<boolean> {
  if (await isRegistrationOpen(supabase)) return true;
  return isLiveInvite(supabase, inviteToken);
}
