import type { createServerClient } from '@/lib/supabase/server';
import { fetchWeeklyVolume, weekAxis, type WeekBucket } from './weekly-volume';
import type { WeekStartDay } from '@/lib/utils';

/**
 * Per-(athlete, week) cache for one athlete's weekly volume — task 100, behind
 * `WEEKLY_VOLUME_CACHE=1` (default off).
 *
 * The profile's year view asks for ~540 weeks of buckets on every open, and nearly all of them
 * are weeks that can no longer change. Each week's bucket is cached on its own, under the
 * athlete's `activities_changed_at` stamp (migration 270 — bumped by a trigger on every insert,
 * update and delete of their activities). A new or edited run moves the stamp, the next read
 * misses, and every instance sees the same stamp — so invalidation is exact without the ~35 code
 * paths that write activities each having to remember to call something.
 *
 * Deliberately per-instance memory, not `lib/cache/shared.ts`: that cache's rule is that nothing
 * from `athlete_activities` ever goes in it. This one is keyed by athlete id, read only after
 * the route's own auth gate, and never leaves the server.
 *
 * Fails open to the uncached read: flag off, migration 270 not pasted (stamp read fails), or a
 * stamp that is still NULL (never bumped) all read straight through.
 */

type Db = ReturnType<typeof createServerClient>;
type Env = Record<string, string | undefined>;

export function weeklyVolumeCacheEnabled(env: Env = process.env): boolean {
  return env.WEEKLY_VOLUME_CACHE === '1';
}

const MAX_ENTRIES = 20_000; // ~25 athletes × 540 weeks, with headroom; oldest evicted first.
const store = new Map<string, { stamp: string; bucket: WeekBucket }>();

const keyOf = (athleteId: string, startDay: WeekStartDay, weekStart: string) => `${athleteId}|${startDay}|${weekStart}`;

/** Tests only. */
export function clearWeeklyVolumeCache(): void { store.clear(); }
export function weeklyVolumeCacheSize(): number { return store.size; }

/** The athlete's change stamp, or null when it can't be used (column missing, never bumped, error). */
export async function readActivitiesStamp(db: Db, athleteId: string): Promise<string | null> {
  try {
    const { data, error } = await db.from('athletes').select('activities_changed_at').eq('id', athleteId).maybeSingle();
    if (error || !data) return null;
    const stamp = (data as { activities_changed_at?: string | null }).activities_changed_at;
    return typeof stamp === 'string' && stamp ? stamp : null;
  } catch {
    return null;
  }
}

function put(k: string, v: { stamp: string; bucket: WeekBucket }) {
  store.delete(k);
  store.set(k, v);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Same answer as `fetchWeeklyVolume(db, { athleteIds: [athleteId], ... }).byAthlete.get(athleteId)`.
 * `fetch` is injectable for tests.
 */
export async function cachedAthleteWeeks(
  db: Db,
  opts: { athleteId: string; weeks: number; currentWeekStart: string; startDay: WeekStartDay },
  deps: { env?: Env; fetch?: typeof fetchWeeklyVolume } = {},
): Promise<WeekBucket[]> {
  const fetchVolume = deps.fetch ?? fetchWeeklyVolume;
  const readThrough = async () => {
    const { byAthlete } = await fetchVolume(db, {
      athleteIds: [opts.athleteId], weeks: opts.weeks, currentWeekStart: opts.currentWeekStart, startDay: opts.startDay,
    });
    return byAthlete.get(opts.athleteId) || [];
  };
  if (!weeklyVolumeCacheEnabled(deps.env)) return readThrough();

  const stamp = await readActivitiesStamp(db, opts.athleteId);
  if (!stamp) return readThrough();

  const axis = weekAxis(opts.currentWeekStart, opts.weeks);
  const hits = axis.map((w) => {
    const e = store.get(keyOf(opts.athleteId, opts.startDay, w));
    return e && e.stamp === stamp ? e.bucket : null;
  });
  if (hits.every((h) => h !== null)) return hits.map((h) => ({ ...h! }));

  const fresh = await readThrough();
  for (const b of fresh) put(keyOf(opts.athleteId, opts.startDay, b.weekStart), { stamp, bucket: { ...b } });
  return fresh;
}
