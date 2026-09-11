/**
 * Read EVERY row a query matches, not just the first thousand.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ──────────────────────────────────────
 * PostgREST enforces a server-side `db-max-rows` ceiling, and on this project it
 * is 1000. A query with no `.range()` does not error when it hits that ceiling
 * and does not tell the caller anything — it returns 1000 rows and a
 * `Content-Range` header nobody reads. So `select(...).eq('athlete_id', id)`
 * reads like "their whole history" in the code and silently means "up to a
 * thousand rows of it".
 *
 * That is not a corner case in this club. 14 of the 20 athletes with any
 * activities have more than 1000, the heaviest has 3,870 going back to 2019, and
 * because the PR routes ordered `start_time DESC` the thousand rows kept were
 * always the NEWEST — the truncation deleted exactly the years an old personal
 * best lives in. On that athlete's profile the 10K best showed 34:52 while a run
 * he had literally named "Massive 10k PB in Valencia!" sat at 33:59 outside the
 * window, the half showed 1:14:45 against a real 1:12:17, the marathon 2:37:03
 * against 2:33:02, and the all-time total read 8,749 km instead of 33,062. He
 * reported it as "my records here are wrong", which is precisely what it was.
 *
 * This is the same shape of bug as the Garmin history sync that only ever
 * fetched page 0 (see lib/garmin/history-backfill.ts): the arithmetic was always
 * right, the row set was not, and it hurt the highest-volume athletes worst
 * while looking perfectly fine for everyone else.
 *
 * ── HOW TO USE IT ───────────────────────────────────────────────────────────
 * Pass a callback that builds the query for one window. It is called once per
 * page with an inclusive `from`/`to` to hand straight to `.range()`:
 *
 *   const rows = await fetchAllRows<Row>((from, to) =>
 *     supabase.from('athlete_activities')
 *       .select('id, distance')
 *       .eq('athlete_id', id)
 *       .order('id')
 *       .range(from, to));
 *
 * ── ORDER IS NOT OPTIONAL ───────────────────────────────────────────────────
 * The callback MUST impose a total order, and the last key in it must be unique
 * (`id` here). Without a deterministic sort PostgREST may return rows in any
 * order per request, so a paged walk can hand back one row twice and skip
 * another — which surfaces as a wrong kilometre total rather than as an error.
 * A non-unique sort key alone is not enough: ordering by `start_time` when two
 * runs share a timestamp leaves their relative position free, and a page
 * boundary that falls between them can duplicate or drop one. Callers that need
 * `start_time DESC` for other reasons should add `.order('id')` after it as a
 * tiebreak. `fetchWeeklyVolume` in lib/athletes/weekly-volume.ts made this same
 * argument before this helper existed.
 */

/** What one page of a Supabase/PostgREST select resolves to. */
interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/** Matches PostgREST's `db-max-rows` on this project. A larger value is silently clamped by the server, which would end the walk early. */
export const PAGE_SIZE = 1000;

/**
 * A ceiling on how many rows one walk will accumulate, as a safety valve rather
 * than a product decision: a caller that forgets to filter by athlete would
 * otherwise page the whole activities table into memory. 100k is ~3x the entire
 * table today and ~25x the busiest single athlete, so it cannot truncate anyone
 * real — and if it ever does, it says so in the log instead of quietly returning
 * a short answer the way the 1000-row cap did.
 */
export const MAX_ROWS = 100_000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) out.push(row);
    // A short page is the end of the result set. A full one is not proof there
    // is more, but the next request costs one round trip to find out and
    // guessing wrong is the bug this file exists to kill.
    if (rows.length < PAGE_SIZE) return out;
  }
  console.warn(`fetchAllRows hit the ${MAX_ROWS}-row safety ceiling; the result is truncated`);
  return out;
}
