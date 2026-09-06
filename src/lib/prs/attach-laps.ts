import { PR_BUCKETS, type RunActivityRow } from './pr-buckets';
import type { LapLike } from './best-segment';

/**
 * Fills in `laps` on the runs that could contain a PR segment.
 *
 * ── WHY A SECOND QUERY AND NOT JUST `select('…, laps')` ─────────────────────
 * `laps` is the second-heaviest column on the row (only gps_points is bigger):
 * ~3.5 KB per activity, and the Strava-shaped ones carry a nested athlete and
 * activity object on EVERY lap. The activity select it would ride along with is
 * the one the profile's whole stats payload is built from — totals, the weekly
 * table, the trend, the recent-runs list — and none of that wants laps. On the
 * measured history that select goes from 26 KB to 98 KB with laps in it, on a
 * route already flagged for latency.
 *
 * Narrowing it to the rows that can matter is most of the win: a run shorter than
 * the smallest bucket cannot contain a segment of any bucket's distance, and a
 * row with no laps stored has nothing to contribute (most don't yet — the laps
 * backfill drains on a cron).
 *
 * Best-effort by design. If this query fails the caller still gets whole-activity
 * PRs, which is what it had before segments existed — a slow or failing laps read
 * must not take the profile down with it.
 */
export async function attachLapsForPrs<T extends RunActivityRow & { id?: string }>(
  supabase: { from: (table: string) => any },
  athleteId: string,
  runs: T[],
): Promise<T[]> {
  const smallestBucket = Math.min(...PR_BUCKETS.map((b) => b.meters));
  const eligible = runs.some((r) => r.id && r.distance >= smallestBucket);
  if (!eligible) return runs;

  try {
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('id, laps')
      .eq('athlete_id', athleteId)
      .gte('distance', smallestBucket)
      .not('laps', 'is', null);
    if (error) throw error;

    const byId = new Map<string, LapLike[]>();
    for (const row of (data || []) as Array<{ id: string; laps: LapLike[] | null }>) {
      if (Array.isArray(row.laps) && row.laps.length > 0) byId.set(row.id, row.laps);
    }
    if (byId.size === 0) return runs;

    return runs.map((r) => (r.id && byId.has(r.id) ? { ...r, laps: byId.get(r.id) } : r));
  } catch (err) {
    console.warn('PR segments unavailable (laps not loaded):', err);
    return runs;
  }
}
