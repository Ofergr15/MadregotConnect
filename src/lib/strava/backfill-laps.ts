/**
 * Fill in laps (and the streams that come with them) on Strava runs stored
 * without any.
 *
 * Measured on production 2026-09-05: 170 Strava rows have `laps` NULL and 4 have
 * a value. The enrichment that writes them exists and works — it is
 * `enrichStravaActivity` — but the only things that call it are the browser sync
 * and the run chat opening one activity. So a row gets laps when its athlete
 * personally opens that run, and never otherwise. Same reachability gap the
 * geometry backfill was built for, and the same three athletes: 154 rows belong
 * to one of them.
 *
 * Where this differs from `backfillStravaRoutes`, and why it needs a budget: the
 * route arrives free on the activity *list*, so repairing a hundred rows costs a
 * couple of page requests. Laps do not — each row is its own laps call, its own
 * streams call, and a detail call when the watch recorded no laps, so 2-3 Strava
 * requests per row with no way to batch them. At three rows a tick this drains
 * the 170 in roughly five hours of the sync window for about 450 requests total,
 * which sits far inside Strava's 100-per-15-minutes; the same pass without a
 * budget would try 170 rows at once and be rate-limited before it finished one
 * athlete.
 *
 * `laps` is the memo that makes the drained state free: enrichment stores `[]`
 * (not null) when Strava has nothing to give, so "already asked" is expressible
 * and a row is never re-fetched. Once the backlog is gone this is one indexed
 * query returning nothing, before any Strava client is constructed.
 *
 * The failure that would otherwise wreck it is a row Strava no longer has. It
 * would fail every tick, forever, and — because the budget is small — hold three
 * slots that the rest of the backlog needs, so the queue would never move. Hence
 * the 404 branch: an activity Strava answers 404 for is recorded as `[]`, the
 * same "asked, nothing there" the routeless case uses, rather than retried until
 * the end of time. A 429 is the opposite: it stops the pass immediately and
 * changes nothing, because the answer is unknown, not empty.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/encryption';
import { StravaClient, stravaErrorStatus, type StravaTokens } from './client';
import { enrichStravaActivity, getValidStravaToken } from './enrich';

/** Rows per pass. Three rows ≈ 6-9 Strava requests, against a 100/15min ceiling. */
export const DEFAULT_LAPS_BUDGET = 3;
/** Ceiling on the budget a caller may ask for, so the staff trigger can't blow the quota. */
const MAX_LAPS_BUDGET = 25;

export interface LapsBackfillResult {
  /** Rows still missing laps when the pass started — the size of the backlog. */
  pending: number;
  /** Rows this pass attempted (at most the budget). */
  attempted: number;
  /** Rows that got a lap breakdown. */
  filled: number;
  /** Rows Strava confirms have nothing — no laps, or the activity is gone. */
  empty: number;
  /** Rows that failed for a reason worth retrying next pass. */
  failed: number;
  /** True when Strava rate-limited us and the pass stopped early. */
  rateLimited: boolean;
}

interface Target {
  id: string;
  athlete_id: string;
  strava_activity_id: number;
  activity_name: string | null;
  start_time: string | null;
}

const EMPTY: LapsBackfillResult = {
  pending: 0,
  attempted: 0,
  filled: 0,
  empty: 0,
  failed: 0,
  rateLimited: false,
};

/**
 * Record "asked Strava, there is no breakdown" so the row stops matching.
 *
 * `[]` and not null, matching what `enrichStravaActivity` writes for a run with
 * no laps and no splits. It is the only value that distinguishes a settled
 * question from an unasked one, and this path is where a deleted activity gets
 * settled.
 */
async function markEmpty(supabase: SupabaseClient, rowId: string): Promise<void> {
  const { error } = await supabase
    .from('athlete_activities')
    .update({ laps: [] })
    .eq('id', rowId);
  if (error) console.warn(`[laps backfill] could not mark ${rowId} empty:`, error.message);
}

export async function backfillStravaLaps(
  supabase: SupabaseClient,
  options?: { athleteId?: string | null; budget?: number },
): Promise<LapsBackfillResult> {
  const budget = Math.min(Math.max(options?.budget || DEFAULT_LAPS_BUDGET, 1), MAX_LAPS_BUDGET);

  // Deliberately not selecting gps_points or laps themselves: the query is a
  // null test, and the columns it would be testing hold thousands of coordinates
  // on the rows that do have them.
  //
  // Newest first, because a lap breakdown matters most on the run someone just
  // did — and because with a per-tick budget the order is the order the backlog
  // becomes visible in, not just an internal detail.
  let query = supabase
    .from('athlete_activities')
    .select('id, athlete_id, strava_activity_id, activity_name, start_time', { count: 'exact' })
    .eq('source', 'strava')
    .not('strava_activity_id', 'is', null)
    .is('laps', null)
    .order('start_time', { ascending: false, nullsFirst: false })
    .limit(budget);
  if (options?.athleteId) query = query.eq('athlete_id', options.athleteId);

  const { data, error, count } = await query;
  if (error) throw error;
  const targets = (data || []) as unknown as Target[];
  // The quiet path once drained: one indexed query, no Strava client, no request.
  if (!targets.length) return { ...EMPTY };

  const out: LapsBackfillResult = { ...EMPTY, pending: count ?? targets.length };

  // One token per athlete rather than per row. With a budget of three that is
  // usually one athlete anyway, but the pass must not refresh the same token
  // three times when it isn't.
  const clients = new Map<string, StravaClient | null>();
  const clientFor = async (athleteId: string): Promise<StravaClient | null> => {
    const cached = clients.get(athleteId);
    if (cached !== undefined) return cached;

    let client: StravaClient | null = null;
    try {
      const { data: athlete } = await supabase
        .from('athletes')
        .select('strava_auth')
        .eq('id', athleteId)
        .maybeSingle();
      if (athlete?.strava_auth) {
        const auth = decrypt(athlete.strava_auth as string) as StravaTokens;
        const token = await getValidStravaToken(supabase, athleteId, auth);
        if (token) client = new StravaClient(token);
      }
    } catch (e: unknown) {
      console.warn(`[laps backfill] no Strava client for athlete ${athleteId}:`, e);
    }
    clients.set(athleteId, client);
    return client;
  };

  for (const row of targets) {
    const client = await clientFor(row.athlete_id);
    if (!client) {
      // source='strava' but the athlete has since disconnected, or the refresh
      // failed. Nothing to record on the row — reconnecting makes it work again.
      out.attempted++;
      out.failed++;
      continue;
    }

    out.attempted++;
    const stored = await enrichStravaActivity(supabase, client, {
      athleteId: row.athlete_id,
      stravaActivityId: row.strava_activity_id,
      activityName: row.activity_name || 'Run',
      startTimeLocal: row.start_time || new Date().toISOString(),
      rowId: row.id,
    });

    if (stored !== null) {
      // Enrichment already wrote `[]` for a run Strava has no breakdown for, so
      // the row is settled either way and only the tally distinguishes them.
      if (stored > 0) out.filled++;
      else out.empty++;
      continue;
    }

    // Enrichment swallows its errors, so ask once more for the cheapest of the
    // three calls purely to learn *why*. Only on the failure path, which should
    // be rare — and on the one failure worth spending a request to classify,
    // since the answer decides between "settle this row" and "stop the pass".
    let status: number | null = null;
    try {
      await client.getActivityLaps(row.strava_activity_id);
    } catch (e: unknown) {
      status = stravaErrorStatus(e);
    }

    if (status === 429) {
      // Stop, and write nothing. A rate limit says the answer is unknown, which
      // is what `laps` NULL already means, so leaving the row is exactly right.
      out.failed++;
      out.rateLimited = true;
      console.warn('[laps backfill] rate-limited by Strava; stopping this pass', out);
      break;
    }

    if (status === 404) {
      // The activity is gone from Strava. Retrying it forever would hold a slot
      // in every future pass and keep the rest of the backlog from moving.
      await markEmpty(supabase, row.id);
      out.empty++;
      continue;
    }

    out.failed++;
  }

  return out;
}
