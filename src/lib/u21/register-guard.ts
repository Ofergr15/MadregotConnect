// Abuse/duplicate guards for POST /api/u21/register (see docs/contracts/public-route-abuse.md).
//
// Three layers, cheapest first, none of which needs a new table or an external service:
//  1. serializeByKey — in-instance: two submits of the same email+track on one instance run
//     one after the other, so the second one's dedupe read sees the first one's row.
//  2. recentSubmits — DB, cross-instance: the 10-minute email+track dedupe and the
//     per-email hourly cap, both read from u21_registrations itself.
//  3. dedupe_key + unique index (migration 183, NOT applied) — the only thing that closes the
//     cross-instance read-then-insert race; a 23505 on it is answered as the same 200.

/** Same email + track inside this window = the same submit (no second row). */
export const U21_RESUBMIT_WINDOW_MS = 10 * 60_000;
/** Cross-instance cap: at most this many stored submits per email per hour (any track). */
export const U21_MAX_PER_EMAIL_PER_HOUR = 3;
export const U21_EMAIL_CAP_WINDOW_MS = 60 * 60_000;

/**
 * The value of u21_registrations.dedupe_key: email + track + the 10-minute bucket. A unique
 * index on it (183) makes a concurrent duplicate fail with 23505 instead of inserting. A bucket
 * is coarser than a sliding window — two submits straddling a boundary both land — which the
 * sliding read in recentSubmits still catches outside a race.
 */
export function u21DedupeKey(email: string, track: string, now = Date.now()): string {
  return `${email.toLowerCase()}|${track}|${Math.floor(now / U21_RESUBMIT_WINDOW_MS)}`;
}

const chains = new Map<string, Promise<unknown>>();
/** Run fn after any earlier fn with the same key on this instance has settled. */
export async function serializeByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  chains.set(key, run);
  try {
    return await run;
  } finally {
    if (chains.get(key) === run) chains.delete(key);
  }
}

export interface RecentSubmits { sameTrackRecent: boolean; lastHour: number }

/**
 * One read: this email's rows in the last hour. Null when the read failed (e.g. table
 * missing) — the caller then falls through to the insert, as before (best effort).
 * On its own this is read-then-insert: two concurrent callers both read "nothing".
 */
export async function recentSubmits(db: any, email: string, track: string, now = Date.now()): Promise<RecentSubmits | null> {
  try {
    const { data, error } = await db.from('u21_registrations').select('track, created_at')
      .eq('email', email)
      .gte('created_at', new Date(now - U21_EMAIL_CAP_WINDOW_MS).toISOString())
      .limit(U21_MAX_PER_EMAIL_PER_HOUR + 1);
    if (error || !Array.isArray(data)) return null;
    const since = now - U21_RESUBMIT_WINDOW_MS;
    return {
      sameTrackRecent: data.some((r: any) => r.track === track && Date.parse(r.created_at) >= since),
      lastHour: data.length,
    };
  } catch {
    return null;
  }
}

/**
 * A 23505 on 183's dedupe_key index: a concurrent identical submit got there first. Only that
 * index — any other unique violation (e.g. the primary key) is a real failure and stays a 500.
 */
export const isDedupeConflict = (e: any) =>
  e?.code === '23505' && /dedupe_key/.test(`${e?.message ?? ''} ${e?.details ?? ''}`);
/** dedupe_key column not there yet (183 not pasted): PostgREST schema-cache miss or Postgres undefined column. */
export const isMissingDedupeColumn = (e: any) =>
  (e?.code === 'PGRST204' || e?.code === '42703') && /dedupe_key/.test(String(e?.message ?? ''));
