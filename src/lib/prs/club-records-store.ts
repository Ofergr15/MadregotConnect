import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { PR_BUCKETS, type RunActivityRow } from './pr-buckets';
import type { LapLike } from './best-segment';
import type { PrOverride } from './overrides';
import { UNDEFINED_TABLE } from './overrides-store';
import { computeClubRecords, type ClubRecordAthlete, type ClubRecordBucket } from './club-records';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Computing the club records table, and keeping the answer.
 *
 * ── WHY IT IS SNAPSHOTTED AND NOT COMPUTED PER VIEW ─────────────────────────
 * A record is the fastest of every qualifying run the club has ever stored. On
 * the measured history that is ~28,800 runs across two dozen athletes — thirty
 * paged reads plus a laps read of a few megabytes — because a personal best is
 * exactly the thing you cannot answer from a recent window. That is fine once an
 * hour and absurd on every page view, and the table changes at most when somebody
 * finishes a race.
 *
 * So the computed table is stored in `app_settings` under one key and served from
 * there, recomputed when it is older than `TTL_MS`. `app_settings` rather than a
 * table of its own because it needs no migration — the migrations here are pasted
 * into the SQL editor by hand, and a feature that cannot ship until someone does
 * that is a feature that stays unshipped (the same call, for the same reason, as
 * lib/garmin/history-schedule.ts). Nothing here is a source of truth either: the
 * snapshot is derived from `athlete_activities` and `athlete_pr_overrides`, so
 * losing it costs one recomputation.
 *
 * A STALE SNAPSHOT IS SERVED IF A RECOMPUTE FAILS. The records of a running club
 * are not time-sensitive to the minute, and a table that is six hours old is
 * strictly better than an error page.
 */

/** `app_settings.key` holding the computed table. */
export const CLUB_RECORDS_KEY = 'club_records';

/** How old a snapshot may be before a reader triggers a recompute. */
export const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How old it must be before a `refresh=1` is honoured.
 *
 * An athlete who has just entered a race time wants to see themselves in the
 * table now, which is what the flag is for. The floor is what stops a reload
 * button from turning a thirty-query walk into a denial of service on the club's
 * own database — no staff gate needed, since below the floor the request is
 * simply answered from the snapshot it would have produced anyway.
 */
export const REFRESH_FLOOR_MS = 2 * 60 * 1000;

export interface ClubRecordsSnapshot {
  computedAt: string;
  buckets: ClubRecordBucket[];
  /** Athletes considered — surfaced so the page can say what "the club" meant. */
  athleteCount: number;
}

/** The stored snapshot, or null when absent/unparseable. */
export async function readClubRecords(supabase: SupabaseServer): Promise<ClubRecordsSnapshot | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', CLUB_RECORDS_KEY)
    .maybeSingle();
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value);
    return parsed && Array.isArray(parsed.buckets) ? (parsed as ClubRecordsSnapshot) : null;
  } catch {
    return null;
  }
}

async function writeClubRecords(supabase: SupabaseServer, snapshot: ClubRecordsSnapshot): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: CLUB_RECORDS_KEY, value: JSON.stringify(snapshot), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) throw error;
}

export function isStale(snapshot: ClubRecordsSnapshot | null, now = Date.now()): boolean {
  if (!snapshot) return true;
  const at = Date.parse(snapshot.computedAt);
  return !Number.isFinite(at) || now - at > TTL_MS;
}

export function refreshAllowed(snapshot: ClubRecordsSnapshot | null, now = Date.now()): boolean {
  if (!snapshot) return true;
  const at = Date.parse(snapshot.computedAt);
  return !Number.isFinite(at) || now - at > REFRESH_FLOOR_MS;
}

interface RunRow extends RunActivityRow {
  athlete_id: string;
}

/**
 * Read the club's history and compute the table. Expensive on purpose — the
 * callers above decide how often this is allowed to happen.
 *
 * The laps read is club-wide rather than per athlete (which is what
 * attach-laps.ts does for one profile) and narrowed the same way: only rows long
 * enough to contain the smallest bucket, only rows that actually have laps
 * stored. Best-effort for the same reason too — without laps the bests fall back
 * to whole-activity times, which is what the profile showed before segments
 * existed, so a failing laps read costs accuracy and not the page.
 */
export async function computeClubRecordsSnapshot(supabase: SupabaseServer): Promise<ClubRecordsSnapshot> {
  const { data: athleteRows, error: athError } = await supabase
    .from('athletes')
    .select('id, name, group_id, gender')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');
  if (athError) throw athError;

  const athletes: ClubRecordAthlete[] = (athleteRows || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    groupId: a.group_id ?? null,
    gender: a.gender ?? null,
  }));
  const ids = athletes.map((a) => a.id);
  if (ids.length === 0) {
    return { computedAt: new Date().toISOString(), buckets: computeClubRecords({ athletes: [], runsByAthlete: new Map(), overridesByAthlete: new Map() }), athleteCount: 0 };
  }

  // Paged: an unpaginated select stops at PostgREST's 1000-row ceiling without
  // saying so, and here that would silently drop most of the club's history.
  // Ordered by id so the pages are a stable partition rather than two requests
  // disagreeing about where the boundary was — see lib/supabase/paginate.ts.
  const runs = await fetchAllRows<RunRow>((from, to) =>
    supabase
      .from('athlete_activities')
      .select('athlete_id, id, activity_name, activity_type, start_time, distance, duration')
      .in('athlete_id', ids)
      .order('id')
      .range(from, to),
  );

  const runsByAthlete = new Map<string, RunActivityRow[]>();
  for (const run of runs) {
    const list = runsByAthlete.get(run.athlete_id);
    if (list) list.push(run);
    else runsByAthlete.set(run.athlete_id, [run]);
  }

  const smallestBucket = Math.min(...PR_BUCKETS.map((b) => b.meters));
  try {
    const lapRows = await fetchAllRows<{ id: string; laps: LapLike[] | null }>((from, to) =>
      supabase
        .from('athlete_activities')
        .select('id, laps')
        .in('athlete_id', ids)
        .gte('distance', smallestBucket)
        .not('laps', 'is', null)
        .order('id')
        .range(from, to),
    );
    const lapsById = new Map<string, LapLike[]>();
    for (const row of lapRows) {
      if (Array.isArray(row.laps) && row.laps.length > 0) lapsById.set(row.id, row.laps);
    }
    if (lapsById.size > 0) {
      for (const [athleteId, list] of runsByAthlete) {
        runsByAthlete.set(
          athleteId,
          list.map((r) => (r.id && lapsById.has(r.id) ? { ...r, laps: lapsById.get(r.id) } : r)),
        );
      }
    }
  } catch (err) {
    console.warn('Club records: segments unavailable (laps not loaded):', err);
  }

  const overridesByAthlete = new Map<string, PrOverride[]>();
  const { data: overrideRows, error: ovError } = await supabase
    .from('athlete_pr_overrides')
    .select('athlete_id, bucket_key, seconds, achieved_on, note, hidden')
    .in('athlete_id', ids);
  // 42P01: migration 104 not pasted in yet. Same tolerance as the profile read —
  // an absent table means "nobody has stated a record", not a broken page.
  if (ovError && (ovError as { code?: string }).code !== UNDEFINED_TABLE) throw ovError;
  for (const row of (overrideRows || []) as any[]) {
    const list = overridesByAthlete.get(row.athlete_id) || [];
    list.push({
      bucketKey: row.bucket_key,
      seconds: row.seconds,
      achievedOn: row.achieved_on,
      note: row.note,
      hidden: !!row.hidden,
    });
    overridesByAthlete.set(row.athlete_id, list);
  }

  return {
    computedAt: new Date().toISOString(),
    buckets: computeClubRecords({ athletes, runsByAthlete, overridesByAthlete }),
    athleteCount: athletes.length,
  };
}

/**
 * The table, recomputing only when the snapshot is stale (or the caller asked and
 * the floor allows it). Returns the stale snapshot if a recompute throws.
 */
export async function getClubRecords(
  supabase: SupabaseServer,
  opts: { refresh?: boolean } = {},
): Promise<{ snapshot: ClubRecordsSnapshot; recomputed: boolean }> {
  const stored = await readClubRecords(supabase);
  const wants = isStale(stored) || (opts.refresh === true && refreshAllowed(stored));
  if (!wants && stored) return { snapshot: stored, recomputed: false };

  try {
    const fresh = await computeClubRecordsSnapshot(supabase);
    await writeClubRecords(supabase, fresh);
    return { snapshot: fresh, recomputed: true };
  } catch (err) {
    if (stored) {
      console.error('Club records recompute failed; serving stale snapshot:', err);
      return { snapshot: stored, recomputed: false };
    }
    throw err;
  }
}
