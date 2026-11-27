import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { shoeLimitCopy } from '@/lib/notifications/copy';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { isFeatureEnabled } from '@/lib/features/server';
import { dueShoeAlert, effectiveLimitKm, kmByShoe, type ShoeActivity } from '@/lib/shoes/mileage';

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
    if (!shoe || shoe.retired) return;
    // No limit of its own: only the default-off retire alert gives it one (lib/shoes/mileage).
    const retireAlertOn = shoe.distance_limit_km == null
      ? await isFeatureEnabled('shoe_retire_alert', shoe.athlete_id).catch(() => false)
      : false;
    const limit = effectiveLimitKm(shoe.distance_limit_km, retireAlertOn);
    if (limit == null) return;

    // Paged (Supabase caps a select at 1000 rows) and twins counted once.
    const acts = await fetchAllRows<ShoeActivity>((from, to) => supabase
      .from('athlete_activities')
      .select('id, shoe_id, athlete_id, start_time, distance, duration, source')
      .eq('shoe_id', shoeId)
      .order('start_time', { ascending: true })
      .range(from, to));
    // The query already filtered on shoe_id; stamp it so a row the select didn't return it on still counts.
    const totalKm = kmByShoe(acts.map((a) => ({ ...a, shoe_id: shoeId }))).get(shoeId) || 0;

    const due = dueShoeAlert({
      totalKm, limitKm: limit, alertBeforeKm: shoe.alert_before_km,
      alertedNear: !!shoe.alerted_near_at, alertedOver: !!shoe.alerted_over_at, retired: !!shoe.retired,
    });
    const kmRounded = Math.round(totalKm);
    const limitRounded = Math.round(limit);

    if (due === 'over') {
      await supabase.from('shoes').update({ alerted_over_at: new Date().toISOString() }).eq('id', shoeId);
      await notifyAthlete({
        athleteId: shoe.athlete_id,
        kind: 'shoe_limit',
        copy: (locale) => shoeLimitCopy(locale, {
          name: shoe.name, km: kmRounded, limit: limitRounded, reached: true,
        }),
        url: '/dashboard/profile', // ShoeManager lives on the profile's landing screen
        category: 'workouts',
      });
    } else if (due === 'near') {
      await supabase.from('shoes').update({ alerted_near_at: new Date().toISOString() }).eq('id', shoeId);
      await notifyAthlete({
        athleteId: shoe.athlete_id,
        kind: 'shoe_limit',
        copy: (locale) => shoeLimitCopy(locale, {
          name: shoe.name, km: kmRounded, limit: limitRounded, reached: false,
        }),
        url: '/dashboard/profile', // ShoeManager lives on the profile's landing screen
        category: 'workouts',
      });
    }
  } catch (err) {
    // Best-effort — never break the activity insert that triggered this.
    console.error('checkShoeAlert failed:', err);
  }
}
