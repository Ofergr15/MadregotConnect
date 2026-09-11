import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAllRows, PAGE_SIZE, MAX_ROWS } from '@/lib/supabase/paginate';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';

/**
 * The personal-records card showed the wrong bests for the club's highest-volume
 * athletes, and nothing in the bucket math was wrong.
 *
 * PostgREST refuses to return more than `db-max-rows` (1000 here) for a request
 * with no `.range()`, and it does so silently — no error, no truncation flag the
 * Supabase client surfaces. The PR routes read the athlete's history ordered
 * `start_time DESC`, so the thousand rows they got were the most RECENT thousand
 * and the years before that simply did not exist as far as the card was
 * concerned. 14 of the 20 athletes with activities are over that line.
 *
 * These tests use one real history's shape: an athlete with 3,870 activities
 * whose 5K best is recent and whose 10K, half and marathon bests are all past
 * row 1000. The distances and durations are the stored values from those runs;
 * the names are not.
 *
 * The fake below is deliberately a model of the SERVER, not of the client: it
 * caps every response at 1000 rows whether or not a range was asked for, which
 * is the behaviour that made this bug invisible. A fake that returned everything
 * would pass against the broken code.
 */

const CAP = 1000;

interface HistoryRow extends RunActivityRow {
  id: string;
}

/**
 * A query object that resolves to rows the way PostgREST does. Awaiting it
 * without a range gives the first `CAP` rows; `.range(from, to)` gives that
 * window, clamped to `CAP`. Records the windows it was asked for so a test can
 * check the walk is a partition rather than an overlapping mess.
 */
function fakePostgrest<T>(rows: T[]) {
  const windows: Array<[number, number]> = [];
  const q = {
    windows,
    select: () => q,
    eq: () => q,
    gte: () => q,
    not: () => q,
    order: () => q,
    range(from: number, to: number) {
      windows.push([from, to]);
      const end = Math.min(to, from + CAP - 1);
      return Promise.resolve({ data: rows.slice(from, end + 1), error: null });
    },
    // Awaiting the builder itself = a request with no Range header.
    then<R>(resolve: (v: { data: T[]; error: null }) => R) {
      return Promise.resolve(resolve({ data: rows.slice(0, CAP), error: null }));
    },
  };
  return q;
}

/** An easy run: long enough to be a real activity, in no PR bucket's window. */
const filler = (i: number): HistoryRow => ({
  id: `filler-${i}`,
  activity_name: 'easy',
  activity_type: 'running',
  start_time: new Date(Date.UTC(2026, 8, 1) - i * 86_400_000).toISOString(),
  distance: 8000,
  duration: 2160,
});

/**
 * The four efforts the card was showing, all inside the newest 1000 rows, and
 * the three genuinely faster ones that sit behind them in the same history.
 */
const RECENT = {
  fiveK: { id: 'recent-5k', distance: 5044, duration: 990 },
  tenK: { id: 'recent-10k', distance: 10054, duration: 2103 },
  half: { id: 'recent-hm', distance: 21198, duration: 4506 },
  full: { id: 'recent-fm', distance: 42501, duration: 9491 },
};
const OLD = {
  tenK: { id: 'old-10k', distance: 10063, duration: 2052 },
  half: { id: 'old-hm', distance: 21303, duration: 4379 },
  full: { id: 'old-fm', distance: 42716, duration: 9295 },
};

/** 3,870 rows, newest first, with the real bests at the indices they really sit at. */
function fullHistory(): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (let i = 0; i < 3870; i++) rows.push(filler(i));
  const place = (index: number, effort: { id: string; distance: number; duration: number }) => {
    rows[index] = { ...rows[index], ...effort, activity_name: effort.id };
  };
  place(10, RECENT.fiveK);
  place(179, RECENT.tenK);
  place(347, RECENT.half);
  place(500, RECENT.full);
  place(1233, OLD.full);
  place(1293, OLD.half);
  place(1766, OLD.tenK);
  return rows;
}

/** The scaled bucket time, written the way pr-buckets.ts writes it. */
const scaled = (effort: { distance: number; duration: number }, meters: number) =>
  Math.round(effort.duration * (meters / effort.distance));

function bestsFrom(rows: HistoryRow[]) {
  const bests = computeDistanceBests(filterQualifyingRuns(rows));
  return (key: string) => bests.find((b) => b.key === key)!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAllRows', () => {
  it('reads past the 1000-row response cap that an unpaginated select stops at', async () => {
    const rows = fullHistory();

    // What the routes did before: await the builder, get exactly 1000 rows back,
    // and have no way of knowing 2,870 more existed.
    const unpaginated = await fakePostgrest(rows);
    expect(unpaginated.data).toHaveLength(CAP);

    const all = await fetchAllRows<HistoryRow>((from, to) => fakePostgrest(rows).range(from, to));
    expect(all).toHaveLength(rows.length);
    expect(all.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('asks for consecutive non-overlapping windows and stops on the short page', async () => {
    const rows = fullHistory();
    const asked: Array<[number, number]> = [];
    const all = await fetchAllRows<HistoryRow>((from, to) => {
      asked.push([from, to]);
      return fakePostgrest(rows).range(from, to);
    });
    expect(all).toHaveLength(3870);
    // 3,870 rows is four requests: three full pages and a 870-row tail that ends
    // the walk. A fifth request would mean the short page was not treated as the
    // end of the result set.
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it('ends on an exact multiple of the page size without dropping or repeating a row', async () => {
    // The boundary case: a full last page is indistinguishable from "there is
    // more", so it costs one extra empty request. Getting this wrong either loses
    // the tail or loops.
    const rows = Array.from({ length: 2 * PAGE_SIZE }, (_, i) => ({ id: `r${i}` }));
    const asked: number[] = [];
    const all = await fetchAllRows<{ id: string }>((from, to) => {
      asked.push(from);
      return fakePostgrest(rows).range(from, to);
    });
    expect(all).toHaveLength(2 * PAGE_SIZE);
    expect(new Set(all.map((r) => r.id)).size).toBe(2 * PAGE_SIZE);
    expect(asked).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE]);
  });

  it('stops at the safety ceiling and says so instead of returning a quietly short answer', async () => {
    // A caller that forgot to filter by athlete must not page a whole table into
    // memory. The old 1000-row cap was wrong mostly because it was SILENT.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const endless = { id: 'x' };
    const all = await fetchAllRows<{ id: string }>(() =>
      Promise.resolve({ data: Array.from({ length: PAGE_SIZE }, () => endless), error: null }),
    );
    expect(all).toHaveLength(MAX_ROWS);
    expect(warn).toHaveBeenCalled();
  });

  it('propagates a query error rather than returning the rows it managed to read', async () => {
    const boom = { message: 'nope' };
    await expect(
      fetchAllRows<{ id: string }>((from) =>
        Promise.resolve(
          from === 0 ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `r${i}` })), error: null } : { data: null, error: boom },
        ),
      ),
    ).rejects.toBe(boom);
  });
});

describe('personal records over a truncated vs a complete history', () => {
  it('reproduces the reported bug: the newest 1000 activities hide the older bests', async () => {
    const rows = fullHistory();
    const truncated = (await fakePostgrest(rows)).data;
    const best = bestsFrom(truncated);

    // 34:52, 1:14:45 and 2:37:03 — the three numbers the athlete said were wrong.
    expect(best('10k').seconds).toBe(scaled(RECENT.tenK, 10000));
    expect(best('hm').seconds).toBe(scaled(RECENT.half, 21097));
    expect(best('fm').seconds).toBe(scaled(RECENT.full, 42195));
    // And the tell that made it look like a computation bug rather than a missing
    // -rows bug: the 5K was RIGHT, because that one PB happens to be recent. Any
    // fix has to explain why only some buckets were wrong.
    expect(best('5k').seconds).toBe(scaled(RECENT.fiveK, 5000));
  });

  it('gives the real bests once the whole history is read', async () => {
    const rows = fullHistory();
    const all = await fetchAllRows<HistoryRow>((from, to) => fakePostgrest(rows).range(from, to));
    const best = bestsFrom(all);

    // 33:59, 1:12:17 and 2:33:02, each from a race the truncated read could not see.
    expect(best('10k').seconds).toBe(scaled(OLD.tenK, 10000));
    expect(best('10k').activityName).toBe(OLD.tenK.id);
    expect(best('hm').seconds).toBe(scaled(OLD.half, 21097));
    expect(best('hm').activityName).toBe(OLD.half.id);
    expect(best('fm').seconds).toBe(scaled(OLD.full, 42195));
    expect(best('fm').activityName).toBe(OLD.full.id);

    // Unchanged, and it has to be: a fix that moved a bucket whose best was
    // already correct would be a second bug.
    expect(best('5k').seconds).toBe(scaled(RECENT.fiveK, 5000));
    expect(best('5k').activityName).toBe(RECENT.fiveK.id);

    // Each older best really is faster than what was on the card — the point of
    // the whole exercise, not a coincidence of these fixtures.
    expect(scaled(OLD.tenK, 10000)).toBeLessThan(scaled(RECENT.tenK, 10000));
    expect(scaled(OLD.half, 21097)).toBeLessThan(scaled(RECENT.half, 21097));
    expect(scaled(OLD.full, 42195)).toBeLessThan(scaled(RECENT.full, 42195));
  });

  it('counts every run in the history, not the first thousand', async () => {
    // `totalRuns` on the PRs payload and `buildAllTimeTotals` on the profile
    // stats route are the same read. The truncated version reported this
    // athlete's lifetime distance as 8,749 km against a real 33,062.
    const rows = fullHistory();
    const truncated = filterQualifyingRuns((await fakePostgrest(rows)).data);
    const all = filterQualifyingRuns(await fetchAllRows<HistoryRow>((from, to) => fakePostgrest(rows).range(from, to)));
    expect(truncated).toHaveLength(CAP);
    expect(all).toHaveLength(3870);
    const km = (rs: HistoryRow[]) => Math.round(rs.reduce((s, r) => s + r.distance, 0) / 1000);
    expect(km(all)).toBeGreaterThan(km(truncated) * 3);
  });
});
