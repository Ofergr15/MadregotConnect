import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/encryption';
import { israelToday } from '@/lib/utils';
import { getValidStravaToken } from './enrich';
import type { StravaTokens } from './client';

// A member's Strava photo, kept current. The avatar URL is written only when someone
// signs in with Strava (api/strava/callback), and Strava's CDN serves a photo's URL
// only until it is replaced: change the photo on Strava and the stored URL answers
// 403 forever — the app showed initials instead (Shalev, 10-20). Once a day the stored
// Strava photos are probed, and a dead one is re-read from the athlete's own profile.

const CHECKED_KEY = 'strava_avatar_checked_on';
const PROBE_TIMEOUT_MS = 4000;

/** A Strava-hosted photo (not one uploaded to the app or taken from Google). */
export const isStravaPhoto = (url: string | null | undefined): boolean =>
  !!url && /cloudfront\.net\/pictures\/athletes\/|strava\.com\//.test(url);

/**
 * The photo to keep from a Strava profile, or null. Strava answers a member with no
 * photo with its own grey placeholder ("avatar/athlete/large.png") — not a photo,
 * and storing it would replace initials with a grey silhouette.
 */
export function pickStravaPhoto(profile: { profile?: string | null; profile_medium?: string | null } | null): string | null {
  const url = profile?.profile || profile?.profile_medium || null;
  if (!url || !/^https:\/\//.test(url) || /avatar\/athlete\//.test(url)) return null;
  return url;
}

async function alive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    // A timeout or a network error is not proof the photo is gone; try again tomorrow.
    return true;
  }
}

/** Once a day: re-read the Strava photo of every member whose stored one stopped loading. */
export async function refreshStaleStravaAvatars(supabase: SupabaseClient, now = new Date()) {
  const today = israelToday(now);
  const { data: mark } = await supabase.from('app_settings').select('value').eq('key', CHECKED_KEY).maybeSingle();
  if ((mark as { value?: string } | null)?.value === today) return null;
  await supabase.from('app_settings').upsert({ key: CHECKED_KEY, value: today });

  const { data } = await supabase.from('athletes').select('id, avatar_url, strava_auth').not('strava_auth', 'is', null).not('avatar_url', 'is', null);
  const rows = ((data || []) as Array<{ id: string; avatar_url: string; strava_auth: string }>).filter((r) => isStravaPhoto(r.avatar_url));
  const dead = (await Promise.all(rows.map(async (r) => ((await alive(r.avatar_url)) ? null : r)))).filter((r): r is NonNullable<typeof r> => !!r);

  let updated = 0;
  let failed = 0;
  for (const r of dead) {
    try {
      const token = await getValidStravaToken(supabase, r.id, decrypt(r.strava_auth) as StravaTokens);
      if (!token) { failed += 1; continue; }
      const res = await fetch('https://www.strava.com/api/v3/athlete', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      const photo = res.ok ? pickStravaPhoto(await res.json()) : null;
      // No photo any more: drop the dead URL, so the initials are the answer rather than a 403.
      await supabase.from('athletes').update({ avatar_url: photo }).eq('id', r.id);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { checked: rows.length, dead: dead.length, updated, failed };
}
