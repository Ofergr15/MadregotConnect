import type { WatchProvider } from './types';

/**
 * "Fetch the runs that just happened", per provider.
 *
 * Garmin is PULLED: we hold the athlete's account token and ask Garmin for new
 * activities (the existing sync handler, called in-process exactly as the
 * workout-watch cron always did). Apple is PUSHED: there is no Apple server to
 * ask, so the athlete's iPhone uploads each run to `POST /api/device/activities`
 * when HealthKit wakes it, and those rows are simply already in
 * `athlete_activities` by the time the cron scans it.
 *
 * Returns each pulled provider's own answer, untouched, so a caller that used to
 * report the Garmin sync's JSON still reports exactly that.
 */
export type PullResult = Partial<Record<WatchProvider, unknown>>;

export async function pullRecentActivities({ suppressPush }: { suppressPush: boolean }): Promise<PullResult> {
  const out: PullResult = {};
  try {
    const { runSyncRequest: syncPost } = await import('@/app/api/garmin/sync-activities/route');
    out.garmin = await syncPost(new Request('http://internal/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suppressPush }),
    })).then(r => r.json()).catch(() => null);
  } catch {
    // sync best-effort — the caller still scans the DB
    out.garmin = null;
  }
  return out;
}
