import { NextResponse } from 'next/server';
import { POST as stravaSync } from '../../strava/sync-activities/route';
import { POST as garminSync } from '../../garmin/sync-activities/route';
import { snapshotWeeklyKm } from '@/lib/weekly-snapshots';

// Give the sync enough time to walk every athlete (Pro plan allows up to 300s).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Scheduled server-side activity sync (Strava + Garmin).
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

  const emptyBody = () =>
    new Request('http://internal/cron', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

  let strava: any;
  try {
    strava = await stravaSync(emptyBody()).then((r) => r.json());
  } catch (e: any) {
    strava = { error: String(e?.message || e) };
  }

  let garmin: any;
  try {
    garmin = await garminSync(emptyBody()).then((r) => r.json());
  } catch (e: any) {
    garmin = { error: String(e?.message || e) };
  }

  const totalSynced = (strava?.synced || 0) + (garmin?.synced || 0);

  let snapshot: any = null;
  try {
    snapshot = await snapshotWeeklyKm(1);
  } catch (e: any) {
    snapshot = { error: String(e?.message || e) };
  }

  console.log('[cron/sync] done', { totalSynced, strava, garmin, snapshot });

  return NextResponse.json({ ok: true, totalSynced, strava, garmin, snapshot });
}

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
