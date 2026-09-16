import { PR_BUCKETS, type DistanceBest } from './pr-buckets';

/**
 * Athlete-stated personal records, layered over the derived ones.
 *
 * Every PR the app shows is computed from the run history (see pr-buckets.ts),
 * which is right until the truth isn't in the data: a race run before the athlete
 * joined, a chip time that differs from the watch, or a best the watch invented
 * out of a bad GPS lock. Two reports are exactly that gap — "my records here
 * aren't correct" and "you can't update them, there are old results". So a bucket
 * can carry one stated time, or be hidden, and everything else stays derived.
 *
 * ── THREE RULES ─────────────────────────────────────────────────────────────
 *
 * • The merge is DISPLAY only. The badge engine reads the derived bests and never
 *   this — a badge is the club's claim about something it saw, and a self-reported
 *   time must not be able to award one.
 *
 * • A stated time REPLACES, it does not compete. Taking `min(derived, stated)`
 *   looks safer and is worse: an athlete correcting a bogus 19:30 down from a
 *   mismeasured run would find their real 21:04 ignored in favour of the number
 *   they came to fix. They are stating the truth about their own bucket; that is
 *   the whole feature.
 *
 * • The run link goes away with it. `activityId`, `fromSegment` and `sourceMeters`
 *   describe the derived best, so a stated time carries none of them — a tile
 *   that said "inside a 31 km run" while showing a hand-typed race time would be
 *   inventing provenance.
 */

/** One row of `athlete_pr_overrides` (migration 104), in app shape. */
export interface PrOverride {
  bucketKey: string;
  /** The stated time. Null only when `hidden`. */
  seconds: number | null;
  /** ISO date (YYYY-MM-DD), or null when they remember the time but not the day. */
  achievedOn: string | null;
  /** Where it came from, in their words. */
  note: string | null;
  /** Take the derived best down without replacing it. */
  hidden: boolean;
}

/** Where a PR on screen came from — the tile says so, because it matters. */
export type PrSource = 'auto' | 'manual';

export interface MergedPr extends DistanceBest {
  source: PrSource;
  note: string | null;
}

/**
 * How wrong a stated time has to be before it is refused, per bucket.
 *
 * Bounds rather than free text because the input is a person typing on a phone,
 * and the two mistakes it makes are a factor-of-60 slip (`20:06` entered as
 * `20:06:00`) and a missing digit. Both land far outside these.
 *
 * The floor is a metres-per-second cap, not a table of times: 6.5 m/s is 2:34/km,
 * comfortably faster than any world record at these distances and far faster than
 * anyone in this club, so it rejects the impossible without arguing with anybody's
 * actual result. The ceiling is 10 hours for a marathon at the same ratio, which
 * a walked marathon fits inside.
 */
const MAX_SPEED_MPS = 6.5;
const MIN_SPEED_MPS = 1.1;

export function prSecondsBounds(meters: number): { min: number; max: number } {
  return {
    min: Math.ceil(meters / MAX_SPEED_MPS),
    max: Math.floor(meters / MIN_SPEED_MPS),
  };
}

/** The bucket, or undefined for a key no build of the app knows. */
export function prBucket(key: string) {
  return PR_BUCKETS.find((b) => b.key === key);
}

/**
 * `null` when the time is acceptable for the bucket, otherwise a reason code the
 * route turns into a 400 and the sheet turns into a sentence.
 */
export function prSecondsProblem(bucketKey: string, seconds: number): 'unknown-bucket' | 'too-fast' | 'too-slow' | null {
  const bucket = prBucket(bucketKey);
  if (!bucket) return 'unknown-bucket';
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) return 'too-fast';
  const { min, max } = prSecondsBounds(bucket.meters);
  if (seconds < min) return 'too-fast';
  if (seconds > max) return 'too-slow';
  return null;
}

/**
 * `"41:58"` / `"3:12:40"` / `"41:58.4"` → seconds, or null when it isn't a time.
 *
 * Two fields (minutes, seconds) were the alternative and are worse on a phone: a
 * marathon needs three, a 5K needs two, and a runner types their PR the way they
 * say it. Colons only — a dot is accepted as the last separator because a chip
 * time is often written `41:58.4`, and the fraction is dropped rather than
 * rounding a stated time up.
 */
export function parsePrSeconds(input: string): number | null {
  const trimmed = input.trim().replace(/\.\d+$/, '');
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  // Only the leading field may exceed 59 — "1:75:00" is a typo, not 2:15:00.
  if (parts.slice(1).some((p) => p > 59)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * The bests as they should be shown: derived, with any stated time swapped in and
 * any hidden bucket emptied.
 *
 * An override for a bucket this build has no row for is ignored rather than
 * appended — the caller renders `DistanceBest`s in `PR_BUCKETS` order, and a
 * bucket that doesn't exist has no label, no distance and nothing to compare.
 */
export function applyPrOverrides(bests: DistanceBest[], overrides: PrOverride[]): MergedPr[] {
  const byKey = new Map(overrides.map((o) => [o.bucketKey, o]));
  return bests.map((best) => {
    const override = byKey.get(best.key);
    if (!override) return { ...best, source: 'auto' as const, note: null };

    // Hidden: the bucket reads as "no PR yet", which is what an empty bucket
    // looks like everywhere else — the card filters on `seconds != null`, so no
    // caller needs to learn a third state.
    if (override.hidden || override.seconds == null) {
      return {
        ...best,
        seconds: null,
        date: null,
        activityName: null,
        activityId: null,
        fromSegment: false,
        sourceMeters: null,
        source: 'manual' as const,
        note: override.note ?? null,
      };
    }

    return {
      ...best,
      seconds: override.seconds,
      date: override.achievedOn,
      activityName: null,
      activityId: null,
      fromSegment: false,
      sourceMeters: null,
      source: 'manual' as const,
      note: override.note ?? null,
    };
  });
}
