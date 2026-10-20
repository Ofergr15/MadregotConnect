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
  // The first page alone — most walks end there, in one trip. Only a FULL first page
  // means more, and then the rest go out eight at a time instead of one by one: each
  // page is a whole round trip to the database (~0.25 s from the functions today), so a
  // 4,000-run history was four trips in a row (2026-10-20 speed pass).
  const first = await page(0, PAGE_SIZE - 1);
  if (first.error) throw first.error;
  const rows = first.data || [];
  if (rows.length < PAGE_SIZE) return rows;
  const rest = await fetchFrom(page, PAGE_SIZE, 8);
  return rest === null ? rows : rows.concat(rest);
}

/** Pages from `offset` on, `concurrency` at a time, until one comes back short. */
async function fetchFrom<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  start: number,
  concurrency: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = start; offset < MAX_ROWS; offset += PAGE_SIZE * concurrency) {
    const batch = await Promise.all(Array.from({ length: concurrency }, (_, i) => {
      const from = offset + i * PAGE_SIZE;
      return page(from, from + PAGE_SIZE - 1);
    }));
    for (const { data, error } of batch) {
      if (error) throw error;
      const got = data || [];
      for (const row of got) {
        if (out.length + start >= MAX_ROWS) break;
        out.push(row);
      }
      if (out.length + start >= MAX_ROWS) break;
      // A short page is the end of the result set. A full one is not proof there
      // is more, but guessing wrong is the bug this file exists to kill.
      if (got.length < PAGE_SIZE) return out;
    }
    if (out.length + start >= MAX_ROWS) break;
  }
  console.warn(`fetchAllRows hit the ${MAX_ROWS}-row safety ceiling; the result is truncated`);
  return out;
}

/**
 * fetchAllRows with no first-page probe: for a walk known to be long (the club's whole
 * run history — the leaderboard, the coach's pulse), every page goes out `concurrency`
 * at a time from the start.
 */
export async function fetchAllRowsParallel<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  concurrency = 8,
): Promise<T[]> {
  return fetchFrom(page, 0, concurrency);
}
