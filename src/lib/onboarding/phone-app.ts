import { createServerClient } from '@/lib/supabase/server';
import { joinLinkV2 } from '@/lib/install/flag';

// "Has this member opened the app on a phone yet?" — what decides the computer's
// "the app on your phone isn't installed yet" strip (components/onboarding/PhoneAppStrip).
//
// The truth is athletes.phone_app_opened_at (migration 136), stamped by the app the
// first time it runs on a phone (PhoneOpenBeacon). Until 136 is applied, and for
// members who were here before the strip existed, it errs towards NOT nagging: a
// push subscription is proof enough of a phone, and anyone first seen before the
// strip shipped is an existing member, who must never be told their phone app is
// missing.
export const PHONE_STRIP_SINCE = '2026-10-09T00:00:00Z';

export async function phoneAppState(athleteId: string, pushCount: number, origin: string): Promise<{ opened: boolean; link: string | null }> {
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('phone_app_opened_at, first_seen_at, invite_token').eq('id', athleteId).maybeSingle();
  if (error || !data) {
    const { data: d2 } = await db.from('athletes').select('invite_token').eq('id', athleteId).maybeSingle();
    const token = (d2 as { invite_token?: string | null } | null)?.invite_token ?? null;
    return { opened: true, link: token ? joinLinkV2(origin, token, true) : null };
  }
  const row = data as { phone_app_opened_at: string | null; first_seen_at: string | null; invite_token: string | null };
  const newcomer = !!row.first_seen_at && row.first_seen_at >= PHONE_STRIP_SINCE;
  const opened = !!row.phone_app_opened_at || pushCount > 0 || !newcomer;
  return { opened, link: row.invite_token ? joinLinkV2(origin, row.invite_token, true) : null };
}
