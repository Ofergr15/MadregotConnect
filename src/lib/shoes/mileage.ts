// Shoe mileage from the activities themselves (night task 59).
//
// A shoe's km is the sum of the runs attributed to it (athlete_activities.shoe_id),
// with Garmin/Strava TWINS counted once. The ingest dedupe upgrades a Strava row in
// place when Garmin delivers the same run (lib/activity-dedup.ts), but older rows
// predate it and both copies can carry the shoe — which doubled that run on the
// shoe and fired the "time to replace" push early. The read-time twin rule is the
// academy's (lib/academy/twins.ts), so the shoe and the week chart agree.
//
// Retire alert: a shoe with a limit alerts as before. A shoe WITHOUT a limit gets
// DEFAULT_RETIRE_KM only when the default-off flag `shoe_retire_alert` is on for
// its owner — so nobody gets a new push until someone turns it on.

import { withoutTwins } from '@/lib/academy/twins';

export const DEFAULT_RETIRE_KM = 700;
export const DEFAULT_ALERT_BEFORE_KM = 50;

export interface ShoeActivity {
  id: string;
  shoe_id: string | null;
  athlete_id?: string | null;
  start_time: string;
  distance: number | null;
  duration?: number | null;
  source?: string | null;
}

/** km per shoe id, twins counted once (the richer source's copy is kept). */
export function kmByShoe(acts: readonly ShoeActivity[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of withoutTwins(acts.filter((x) => !!x.shoe_id))) {
    out.set(a.shoe_id!, (out.get(a.shoe_id!) || 0) + (Number(a.distance) || 0) / 1000);
  }
  return out;
}

/** The limit a shoe is judged against: its own, else the default when the flag is on, else none. */
export function effectiveLimitKm(distanceLimitKm: number | null | undefined, retireAlertOn: boolean): number | null {
  if (distanceLimitKm != null) return Number(distanceLimitKm);
  return retireAlertOn ? DEFAULT_RETIRE_KM : null;
}

export type ShoeAlert = 'over' | 'near' | null;

/** Which (single) alert is due, given what has already been sent. */
export function dueShoeAlert(p: {
  totalKm: number; limitKm: number | null; alertBeforeKm: number | null | undefined;
  alertedNear: boolean; alertedOver: boolean; retired: boolean;
}): ShoeAlert {
  if (p.retired || p.limitKm == null) return null;
  const before = p.alertBeforeKm != null ? Number(p.alertBeforeKm) : DEFAULT_ALERT_BEFORE_KM;
  if (!p.alertedOver && p.totalKm >= p.limitKm) return 'over';
  if (!p.alertedNear && p.totalKm >= p.limitKm - before) return 'near';
  return null;
}
