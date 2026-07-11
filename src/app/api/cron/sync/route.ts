import { NextResponse } from 'next/server';
import { POST as garminSync } from '../../garmin/sync-activities/route';
import { POST as stravaSync } from '../../strava/sync-activities/route';
import { snapshotWeeklyKm } from '@/lib/weekly-snapshots';

// Give the sync enough time to walk every athlete (Pro plan allows up to 300s).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Scheduled server-side activity sync.
 *
 * Runs on a Vercel Cron (see vercel.json) so the leaderboard and weekly stats
 * stay fresh WITHOUT any athlete needing to open the app. It pulls new
 * Garmin + Strava activities for every connected athlete of the coach.
 *
 * Auth: Vercel automatically attaches `Authorization: Bearer <CRON_SECRET>` to
 * cron invocations when the CRON_SECRET env var is set. We reject anything that
 * doesn't match so the endpoint can't be triggered by the public.
 */
async function runSync(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // The underlying handlers sync ALL connected athletes when called with an
  // empty body (no athleteId). Run them independently so one failing provider
  // doesn't block the other.
  const emptyBody = () =>
    new Request('http://internal/cron', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

  const [garminResult, stravaResult] = await Promise.allSettled([
    garminSync(emptyBody()).then((r) => r.json()),
    stravaSync(emptyBody()).then((r) => r.json()),
  ]);

  const garmin =
    garminResult.status === 'fulfilled'
      ? garminResult.value
      : { error: String(garminResult.reason?.message || garminResult.reason) };
  const strava =
    stravaResult.status === 'fulfilled'
      ? stravaResult.value
      : { error: String(stravaResult.reason?.message || stravaResult.reason) };

  const totalSynced = (garmin?.synced || 0) + (strava?.synced || 0);

  // Persist weekly km per athlete/group so the numbers can be shared later,
  // even if activities change. Never let a snapshot error fail the sync.
  let snapshot: any = null;
  try {
    snapshot = await snapshotWeeklyKm(1);
  } catch (e: any) {
    snapshot = { error: String(e?.message || e) };
  }

  console.log('[cron/sync] done', { totalSynced, garmin, strava, snapshot });

  return NextResponse.json({ ok: true, totalSynced, garmin, strava, snapshot });
}

// Vercel Cron issues GET requests.
export async function GET(request: Request) {
  return runSync(request);
}

// Allow manual triggering via POST too (e.g. from an admin action).
export async function POST(request: Request) {
  return runSync(request);
}
