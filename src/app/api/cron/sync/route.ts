import { NextResponse } from 'next/server';
import { runSyncRequest as garminSync } from '../../garmin/sync-activities/route';
import { snapshotWeeklyKm } from '@/lib/weekly-snapshots';
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
 * Scheduled server-side activity sync — Garmin only.
 *
 * Strava was dropped deliberately (2026-08-28): all 22 active athletes are
 * data_source='garmin', and the only Strava rows in the database belong to two
 * of Ofer's own accounts, one of them already disconnected. Garmin is also the
 * richer source — it supplies the GPS polyline, cadence, VO2max, stride length,
 * laps and RPE that the feed and the post-workout sheet render, none of which
 * the Strava path ever stored. Calling it every 5 minutes for nobody was pure
 * cost, and it was worse than useless historically: the Strava sync filters on
 * data_source='strava', matched no one, and returned synced:0 with a green
 * checkmark, which is what hid the broken notifications for so long.
 *
 * The existing Strava rows are left untouched, and /api/strava/* (including the
 * webhook) still works if a Strava athlete is ever onboarded again — this only
 * stops the scheduled poll.
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

  let snapshot: any = null;
  try {
    snapshot = await snapshotWeeklyKm(1);
  } catch (e: any) {
    snapshot = { error: String(e?.message || e) };
  }

  console.log('[cron/sync] done', { totalSynced, garmin, snapshot });

  return NextResponse.json({ ok: true, totalSynced, garmin, snapshot });
}

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
