import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { shoeLimitCopy } from '@/lib/notifications/copy';

/**
 * Checks one shoe's accumulated mileage against its limit/alert-before
 * threshold and fires at most one push per threshold (alerted_near_at /
 * alerted_over_at guard each). Called after any new activity is attributed
 * to a shoe (manual log, Garmin sync, Strava sync) — best-effort, never
 * throws, so a failure here can't break the activity insert itself.
 */
export async function checkShoeAlert(shoeId: string): Promise<void> {
  try {
    const supabase = createServerClient();
    const { data: shoe } = await supabase.from('shoes').select('*').eq('id', shoeId).maybeSingle();
    if (!shoe || shoe.retired || shoe.distance_limit_km == null) return;

    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('distance')
      .eq('shoe_id', shoeId);
    const totalKm = (acts || []).reduce((sum: number, a: { distance: number | null }) => sum + (a.distance || 0), 0) / 1000;

    const limit = Number(shoe.distance_limit_km);
    // != null, not `|| 50` — an explicit 0 ("only alert exactly at the
    // limit") is a legitimate stored value, not a falsy "unset".
    const alertBefore = shoe.alert_before_km != null ? Number(shoe.alert_before_km) : 50;
    const nearThreshold = limit - alertBefore;
    const kmRounded = Math.round(totalKm);
    const limitRounded = Math.round(limit);

    if (!shoe.alerted_over_at && totalKm >= limit) {
      await supabase.from('shoes').update({ alerted_over_at: new Date().toISOString() }).eq('id', shoeId);
      await notifyAthlete({
        athleteId: shoe.athlete_id,
        kind: 'shoe_limit',
        copy: (locale) => shoeLimitCopy(locale, {
          name: shoe.name, km: kmRounded, limit: limitRounded, reached: true,
        }),
        url: '/dashboard/settings',
        category: 'workouts',
      });
    } else if (!shoe.alerted_near_at && totalKm >= nearThreshold) {
      await supabase.from('shoes').update({ alerted_near_at: new Date().toISOString() }).eq('id', shoeId);
      await notifyAthlete({
        athleteId: shoe.athlete_id,
        kind: 'shoe_limit',
        copy: (locale) => shoeLimitCopy(locale, {
          name: shoe.name, km: kmRounded, limit: limitRounded, reached: false,
        }),
        url: '/dashboard/settings',
        category: 'workouts',
      });
    }
  } catch { /* best-effort — never break the activity insert that triggered this */ }
}
