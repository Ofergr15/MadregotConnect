import { NextResponse } from 'next/server';
import { runSyncRequest as garminSync } from '../../garmin/sync-activities/route';
import { snapshotWeeklyKm } from '@/lib/weekly-snapshots';
import { backfillStravaRoutes } from '@/lib/strava/backfill-routes';
import { createServerClient } from '@/lib/supabase/server';
import { israelNow } from '@/lib/utils';

// Give the sync enough time to walk every athlete (Pro plan allows up to 300s).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Runs every 5 minutes, but only during Israeli waking hours — nobody uploads a
// run at 03:00, and each pass costs a Garmin round trip per athlete.
export const FIRST_HOUR = 5;   // 05:00 Israel — the club's earliest runs start ~05:00
export const LAST_HOUR = 23;   // exclusive, so the last pass is 22:55

/**
 * Whether an Israeli wall-clock hour is inside the sync window.
 *
 * Exported and pure so the skip branch is actually testable — live, it can only
 * be observed before 05:00 or after 23:00 Israel, and Vercel keeps no historical
 * logs to check it after the fact.
 */
export function isWithinSyncWindow(hour: number): boolean {
  return hour >= FIRST_HOUR && hour < LAST_HOUR;
}

/**
 * Scheduled server-side activity sync — Garmin, plus a Strava route repair.
 *
 * The Strava *poll* stays dropped (2026-08-28), for its original reasons: Garmin
 * is the richer source — polyline, cadence, VO2max, stride length, laps and RPE,
 * none of which the Strava path stored — and polling it every 5 minutes for
 * athletes who are all data_source='garmin' was pure cost. Worse, the Strava sync
 * filters on data_source='strava', matched no one, and returned synced:0 with a
 * green checkmark, which is what hid the broken notifications for so long.
 *
 * `backfillStravaRoutes` (added 2026-09-04) is not that poll. It fetches no
 * activity a row does not already exist for, and it retires the premise of the
 * paragraph above — "the only Strava rows belong to two of Ofer's own accounts"
 * stopped being true: there are 170 Strava runs with no stored route, 154 of them
 * one athlete's, and 112 of them advertising `has_polyline` with nothing to draw.
 *
 * It belongs on a schedule rather than only behind the staff PATCH because the
 * sync path that would otherwise repair a row runs *solely* when that athlete
 * personally opens the app — and for an athlete whose data_source is 'garmin' but
 * who has Strava rows, never at all. Leaving it manual means the backlog waits on
 * one person's next login.
 *
 * The cost is why this is safe here: the route comes off the activity list, so a
 * repair is a few page requests per athlete however many rows it fixes, and once
 * the backlog is drained one indexed query returns no rows and no Strava call is
 * made at all. It fixes the gap, then goes quiet.
 *
 * Auth: Vercel attaches `Authorization: Bearer <CRON_SECRET>` when set.
 */
async function runSync(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Vercel crons fire on a fixed UTC schedule while Israel shifts between UTC+2
  // and UTC+3, so vercel.json deliberately spans an hour wider than intended on
  // each side and the real window is enforced here in Israeli wall-clock. A
  // manual POST/GET is exempt so the endpoint stays usable for a forced sync.
  const isVercelCron = request.headers.get('user-agent')?.includes('vercel-cron') ?? false;
  const { hour } = israelNow();
  if (isVercelCron && !isWithinSyncWindow(hour)) {
    return NextResponse.json({ ok: true, skipped: `${hour}:00 Israel is outside ${FIRST_HOUR}:00-${LAST_HOUR}:00` });
  }

  const emptyBody = () =>
    new Request('http://internal/cron', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

  let garmin: any;
  try {
    garmin = await garminSync(emptyBody()).then((r) => r.json());
  } catch (e: any) {
    garmin = { error: String(e?.message || e) };
  }

  const totalSynced = garmin?.synced || 0;

  // Never let the Strava repair break the Garmin sync — it is a bonus pass over
  // history, and a Strava outage or a revoked token must not cost the club its
  // scheduled Garmin sync.
  let stravaRoutes: any = null;
  try {
    const result = await backfillStravaRoutes(createServerClient());
    // Stay silent on the overwhelmingly common drained case, so a non-zero
    // `stravaRoutes` in the logs always means something actually happened.
    stravaRoutes = result.targets > 0 ? result : null;
  } catch (e: any) {
    stravaRoutes = { error: String(e?.message || e) };
  }

  let snapshot: any = null;
  try {
    snapshot = await snapshotWeeklyKm(1);
  } catch (e: any) {
    snapshot = { error: String(e?.message || e) };
  }

  console.log('[cron/sync] done', { totalSynced, garmin, stravaRoutes, snapshot });

  return NextResponse.json({ ok: true, totalSynced, garmin, stravaRoutes, snapshot });
}

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
