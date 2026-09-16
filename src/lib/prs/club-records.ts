import { computeDistanceBests, filterQualifyingRuns, PR_BUCKETS, type RunActivityRow } from './pr-buckets';
import { applyPrOverrides, type PrOverride } from './overrides';

/**
 * The club's records, one ranked table per distance.
 *
 * Two reports ask for this in the same words: "it'd be nice to have a table with
 * everyone's records" (a798197f) and "tables with everyone's personal records by
 * distance" (f6c7b8dc). Today a PR is only visible on one profile at a time, so
 * the club has no shared answer to "who is the fastest 10K in the group" — which
 * in a running club is most of the point of being in one.
 *
 * ── WHY THIS IS A PURE FUNCTION OVER ALREADY-FETCHED RUNS ────────────────────
 * The per-athlete route (/api/athletes/prs) does the reading itself, athlete by
 * athlete. Doing that twenty-four times over would be twenty-four paged history
 * walks plus twenty-four laps reads. The route above this reads the club's runs
 * ONCE and hands the grouped rows in here, and the arithmetic — which is the part
 * that has to agree exactly with the profile — stays testable without a database.
 *
 * `computeDistanceBests` + `applyPrOverrides` are called per athlete, in that
 * order, for exactly that reason: a record in this table is the same number the
 * athlete's own profile shows, including a time they stated by hand. If it were
 * derived-only, the first thing anyone would notice is that the table disagrees
 * with the profile it links to.
 *
 * The badge engine still never sees any of this — see overrides.ts.
 */

/** An athlete as this table needs them: who to name and where to link. */
export interface ClubRecordAthlete {
  id: string;
  name: string;
  groupId?: string | null;
  gender?: 'male' | 'female' | null;
}

export interface ClubRecordEntry {
  athleteId: string;
  name: string;
  groupId: string | null;
  gender: 'male' | 'female' | null;
  seconds: number;
  /** ISO date of the record, or null when a stated time carried no date. */
  date: string | null;
  /** The run it was set on — absent for a stated time (see overrides.ts). */
  activityId: string | null;
  activityName: string | null;
  fromSegment: boolean;
  source: 'auto' | 'manual';
  note: string | null;
}

export interface ClubRecordBucket {
  key: string;
  label: string;
  meters: number;
  /** Fastest first. Empty when nobody in the club has that distance yet. */
  entries: ClubRecordEntry[];
}

export interface ClubRecordsInput {
  athletes: ClubRecordAthlete[];
  /** athlete id → their runs (unfiltered is fine; this filters). */
  runsByAthlete: Map<string, RunActivityRow[]>;
  /** athlete id → their stated PRs. Missing means none. */
  overridesByAthlete: Map<string, PrOverride[]>;
}

/**
 * Ranked records per bucket.
 *
 * Ties break on the EARLIER date, so the person who got there first is listed
 * first. Two identical times to the second are rare enough that any rule is
 * arbitrary — but an arbitrary rule that is stable beats list order, which would
 * be the roster's order and would silently reshuffle when someone joins.
 */
export function computeClubRecords({ athletes, runsByAthlete, overridesByAthlete }: ClubRecordsInput): ClubRecordBucket[] {
  const buckets: ClubRecordBucket[] = PR_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    meters: b.meters,
    entries: [],
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const athlete of athletes) {
    const runs = filterQualifyingRuns(runsByAthlete.get(athlete.id) || []);
    if (runs.length === 0 && !overridesByAthlete.get(athlete.id)?.length) continue;

    const bests = applyPrOverrides(computeDistanceBests(runs), overridesByAthlete.get(athlete.id) || []);
    for (const best of bests) {
      if (best.seconds == null) continue;
      byKey.get(best.key)?.entries.push({
        athleteId: athlete.id,
        name: athlete.name,
        groupId: athlete.groupId ?? null,
        gender: athlete.gender ?? null,
        seconds: best.seconds,
        date: best.date,
        activityId: best.activityId,
        activityName: best.activityName,
        fromSegment: best.fromSegment,
        source: best.source,
        note: best.note,
      });
    }
  }

  for (const bucket of buckets) {
    bucket.entries.sort((a, b) => a.seconds - b.seconds || (a.date || '').localeCompare(b.date || ''));
  }
  return buckets;
}

/**
 * Where an athlete stands in each table — the profile links here, so it can say
 * "3rd in the club at 10K" instead of just offering a page.
 *
 * 1-based, and absent for a bucket they have no time in.
 */
export function clubRankFor(buckets: ClubRecordBucket[], athleteId: string): Record<string, { rank: number; of: number }> {
  const ranks: Record<string, { rank: number; of: number }> = {};
  for (const bucket of buckets) {
    const index = bucket.entries.findIndex((e) => e.athleteId === athleteId);
    if (index >= 0) ranks[bucket.key] = { rank: index + 1, of: bucket.entries.length };
  }
  return ranks;
}
