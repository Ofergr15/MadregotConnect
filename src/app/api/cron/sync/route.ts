import { NextResponse } from 'next/server';
import { runSyncRequest as garminSync } from '../../garmin/sync-activities/route';
import { runStravaSyncRequest as stravaSync } from '../../strava/sync-activities/route';
import { stravaPollSlice, stravaPollTick } from '@/lib/strava/poll-rotation';
import { snapshotWeeklyKm } from '@/lib/weekly-snapshots';
import { backfillStravaLaps } from '@/lib/strava/backfill-laps';
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
 * Scheduled server-side activity sync — Garmin, a rationed Strava poll, plus two
 * Strava repair passes (routes, and laps on a per-tick budget).
 *
 * The Strava poll was dropped on 2026-08-28 and is back, narrowed. Its original
 * reasons were sound at the time: Garmin is the richer source — polyline, cadence,
 * VO2max, stride length, laps and RPE, none of which the Strava path stored — and
 * the broadcast Strava sync filtered on data_source='strava', matched no one, and
 * returned synced:0 with a green checkmark, which is what hid the broken
 * notifications for so long. What has changed is that three athletes now have
 * Strava and no Garmin, so the pass below is the only scheduled thing that can
 * see their runs at all; it polls those three and nobody else. See
 * lib/strava/poll-rotation for the rationing and the arithmetic behind it.
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
/**
 * One tick of the Strava fallback poll.
 *
 * Deliberately narrow: only athletes with `strava_auth` and NO `garmin_auth`.
 * Everybody else is already polled every five minutes by the Garmin pass above —
 * its broadcast query takes every athlete with a Garmin token whatever their
 * `data_source` says — and cross-source dedup handles a run that reaches both.
 * Widening this to all fourteen Strava athletes would spend the club's shared
 * quota re-asking a question that has already been answered.
 *
 * Per-athlete, not the broadcast path, because the broadcast path syncs every
 * `data_source='strava'` athlete in one call and there is no way to ration it.
 */
async function pollStravaOnlyAthletes() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('athletes')
    .select('id')
    .not('strava_auth', 'is', null)
    .is('garmin_auth', null)
    .returns<Array<{ id: string }>>();
  if (error) throw error;

  // Sorted so the rotation is stable between ticks — PostgREST makes no promise
  // about row order, and an order that changes reshuffles whose turn it is.
  const ids = (data || []).map((a) => a.id).sort();
  const due = stravaPollSlice(ids, stravaPollTick());
  if (due.length === 0) return null;

  let synced = 0;
  const results: Array<{ athleteId: string; synced?: number; error?: string }> = [];
  for (const athleteId of due) {
    try {
      const body = await stravaSync(
        new Request('http://internal/cron', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ athleteId, recentOnly: true }),
        }),
      ).then((r) => r.json());
      synced += body?.synced || 0;
      results.push({ athleteId, synced: body?.synced || 0 });
    } catch (e: any) {
      // One athlete's dead token must not cost the others their poll.
      results.push({ athleteId, error: String(e?.message || e) });
    }
  }
  return { candidates: ids.length, polled: due.length, synced, results };
}

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

  // The athletes the Garmin pass above cannot reach: Strava connected, no Garmin
  // token, so its loop skips them and nothing scheduled ever asks Strava whether
  // they ran. See lib/strava/poll-rotation for why this is a rationed rotation
  // and not simply "sync everyone" — and for why the webhook, when healthy, makes
  // every one of these polls find nothing, which is the outcome we want.
  let stravaPoll: any = null;
  try {
    stravaPoll = await pollStravaOnlyAthletes();
  } catch (e: any) {
    stravaPoll = { error: String(e?.message || e) };
  }

  const totalSynced = (garmin?.synced || 0) + (stravaPoll?.synced || 0);

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

  // Same reachability gap as the routes above, but laps cost 2-3 Strava requests
  // per row and cannot be batched, so this one takes a few rows a tick instead of
  // the whole backlog — ~170 rows drained over about five hours of the window,
  // then silent. Isolated for the same reason: a bonus pass over history must not
  // cost the club its Garmin sync.
  let stravaLaps: any = null;
  try {
    const result = await backfillStravaLaps(createServerClient());
    // Silent on the drained case, so a non-null value in the logs always means
    // the pass did something. `pending` is the number worth watching: it should
    // fall by roughly the budget every tick, and a flat `pending` with a rising
    // `failed` means the queue is stuck rather than draining.
    stravaLaps = result.attempted > 0 ? result : null;
  } catch (e: any) {
    stravaLaps = { error: String(e?.message || e) };
  }

  let snapshot: any = null;
  try {
    snapshot = await snapshotWeeklyKm(1);
  } catch (e: any) {
    snapshot = { error: String(e?.message || e) };
  }

  console.log('[cron/sync] done', { totalSynced, garmin, stravaPoll, stravaRoutes, stravaLaps, snapshot });

  return NextResponse.json({ ok: true, totalSynced, garmin, stravaPoll, stravaRoutes, stravaLaps, snapshot });
}

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
