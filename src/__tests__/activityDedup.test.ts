import { describe, it, expect } from 'vitest';
import {
  dedupeSameSourceBatch,
  findStoredMatch,
  matchesStoredActivity,
  preferredRecording,
  runsOverlapEnough,
  twinVerdict,
  type BatchCandidate,
  type StoredActivity,
  type StoredTwin,
} from '@/lib/activity-dedup';

/**
 * The cross-source duplicate verdict, as a pure function.
 *
 * Garmin can auto-export a run to Strava, and the two sync paths import
 * independently — each deduping only inside its own id space, so neither ever
 * sees the other's row for the same physical run. Left unchecked, that run is
 * counted twice everywhere `athlete_activities` is summed: cumulative-distance
 * badges, challenges, shoe mileage, teammate notifications.
 *
 * The interesting cases are the edges of the two tolerances, because a fuzzy
 * matcher fails silently in both directions: too tight and the club's totals
 * double, too loose and a real second run of the day disappears. The recorded
 * numbers below are the tolerances themselves (15 minutes, 10%), so a change to
 * either has to come here and be argued for rather than drifting.
 */

const stored = (over: Partial<StoredActivity> = {}): StoredActivity => ({
  start_time: '2026-03-01T06:00:00',
  distance: 10000,
  ...over,
});

describe('matchesStoredActivity', () => {
  it('matches the same run recorded by the other source', () => {
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 10000)).toBe(true);
  });

  it('has no opinion when nothing is stored', () => {
    expect(matchesStoredActivity([], '2026-03-01T06:00:00', 10000)).toBe(false);
  });

  // The two clocks are the athlete's watch and Strava's own record of the same
  // start, which routinely disagree by a few minutes.
  it('tolerates a start-time gap up to fifteen minutes, and no more', () => {
    expect(matchesStoredActivity([stored()], '2026-03-01T06:14:00', 10000)).toBe(true);
    expect(matchesStoredActivity([stored()], '2026-03-01T06:16:00', 10000)).toBe(false);
    // Symmetric: the candidate can be the earlier of the two.
    expect(matchesStoredActivity([stored()], '2026-03-01T05:46:00', 10000)).toBe(true);
  });

  // Two devices measuring one run differ by GPS drift and by where each decided
  // the run ended, but not by a fifth.
  it('tolerates a distance gap up to ten percent, and no more', () => {
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 10900)).toBe(true);
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 11500)).toBe(false);
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 9200)).toBe(true);
  });

  // A double day: the second run must survive. It is close in time to the first
  // only if the window is wrong, and close in distance only if it happens to be.
  it('keeps a genuinely separate run later the same day', () => {
    expect(matchesStoredActivity([stored()], '2026-03-01T18:00:00', 10000)).toBe(false);
  });

  // Same start, wildly different distance: a warm-up logged separately from the
  // session it preceded. Nothing about the clock makes those one run.
  it('keeps a short run that starts at the same moment as a long one', () => {
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 3000)).toBe(false);
  });

  // A row with no distance carries no evidence either way, and dividing by a
  // zero-distance candidate would make every comparison NaN — which compares
  // false, but for the wrong reason.
  it('ignores rows and candidates with no usable distance', () => {
    expect(matchesStoredActivity([stored({ distance: null })], '2026-03-01T06:00:00', 10000)).toBe(false);
    expect(matchesStoredActivity([stored({ distance: 0 })], '2026-03-01T06:00:00', 10000)).toBe(false);
    expect(matchesStoredActivity([stored()], '2026-03-01T06:00:00', 0)).toBe(false);
  });

  // The line above — a zero-distance CANDIDATE is never a duplicate — is correct
  // and was still a hole, so it is worth pinning what it does not cover.
  //
  // Measured 2026-09-08: an athlete's Strava held ten GPS-less recordings
  // (distance 0, HR only), each a second copy of a run already imported from
  // Garmin. This function cannot see that, and no threshold change here would
  // fix it: with no GPS Strava has no timezone to localize with, so
  // start_date_local arrives as UTC and lands hours outside the 15-minute
  // window as well. Both halves fail, independently.
  //
  // The fix is therefore upstream, in the Strava sync: a distance-less recording
  // is not imported at all. If that guard is ever removed, this is the comment
  // explaining why the duplicates it lets in will not be caught here.
  it('cannot catch a GPS-less Strava copy of a Garmin run, by construction', () => {
    const garminRow = stored({ start_time: '2026-07-10T04:04:45', distance: 32024 });
    // Zero distance: refused on the distance test.
    expect(matchesStoredActivity([garminRow], '2026-07-10T04:04:45', 0)).toBe(false);
    // And the timestamp is UTC, not local — 2.5h away from the run it duplicates.
    expect(matchesStoredActivity([garminRow], '2026-07-10T01:36:00', 32024)).toBe(false);
  });

  it('ignores unusable timestamps rather than matching everything', () => {
    expect(matchesStoredActivity([stored({ start_time: null })], '2026-03-01T06:00:00', 10000)).toBe(false);
    expect(matchesStoredActivity([stored({ start_time: 'not a date' })], '2026-03-01T06:00:00', 10000)).toBe(false);
    expect(matchesStoredActivity([stored()], 'not a date', 10000)).toBe(false);
  });

  // The history walk hands this the athlete's whole table — hundreds of rows, one
  // of which might be the twin. Finding it must not depend on where it sits.
  it('finds the one twin among many unrelated runs', () => {
    const many: StoredActivity[] = [
      stored({ start_time: '2026-02-20T06:00:00', distance: 21000 }),
      stored({ start_time: '2026-02-25T17:30:00', distance: 8000 }),
      stored({ start_time: '2026-03-01T06:03:00', distance: 10200 }),
      stored({ start_time: '2026-03-04T06:00:00', distance: 10000 }),
    ];
    expect(matchesStoredActivity(many, '2026-03-01T06:00:00', 10000)).toBe(true);
    expect(matchesStoredActivity(many, '2026-03-02T06:00:00', 10000)).toBe(false);
  });
});

/**
 * WHICH row matched, and what to do about it.
 *
 * Both sources describe the same physical run, and until now the dedupe only
 * answered "is it already here" — so whichever cron ran first decided which
 * version the athlete would see forever. Reported 2026-09-08: a session run as
 * intervals showed even kilometre splits, because the Strava copy landed first
 * and Strava's export doesn't carry the watch's laps.
 */
describe('findStoredMatch', () => {
  const twin = (over: Partial<StoredTwin> = {}): StoredTwin => ({
    id: 'row-1',
    source: 'strava',
    start_time: '2026-03-01T06:00:00',
    distance: 10000,
    ...over,
  });

  it('hands back the row that matched, not just a yes', () => {
    expect(findStoredMatch([twin()], '2026-03-01T06:00:00', 10000)?.id).toBe('row-1');
  });

  it('is null, not undefined, when nothing matched', () => {
    expect(findStoredMatch([twin()], '2026-03-05T06:00:00', 10000)).toBeNull();
  });

  // The boolean and the row answer are one implementation, so they cannot come
  // to disagree about what counts as the same run.
  it('agrees with matchesStoredActivity on every verdict', () => {
    const rows = [twin({ start_time: '2026-03-01T06:00:00', distance: 10000 })];
    for (const [when, dist] of [
      ['2026-03-01T06:00:00', 10000],
      ['2026-03-01T06:14:00', 10900],
      ['2026-03-01T06:16:00', 10000],
      ['2026-03-01T06:00:00', 0],
      ['not a date', 10000],
    ] as Array<[string, number]>) {
      expect(findStoredMatch(rows, when, dist) !== null)
        .toBe(matchesStoredActivity(rows as StoredActivity[], when, dist));
    }
  });

  it('picks the twin out of a crowd of unrelated runs', () => {
    const rows = [
      twin({ id: 'a', start_time: '2026-02-28T06:00:00', distance: 10000 }),
      twin({ id: 'b', start_time: '2026-03-01T06:05:00', distance: 10300 }),
      twin({ id: 'c', start_time: '2026-03-02T06:00:00', distance: 10000 }),
    ];
    expect(findStoredMatch(rows, '2026-03-01T06:00:00', 10000)?.id).toBe('b');
  });
});

describe('twinVerdict', () => {
  const twin = (source: string | null): StoredTwin =>
    ({ id: 'row-1', source, start_time: '2026-03-01T06:00:00', distance: 10000 });

  it('inserts when the run is not here yet', () => {
    expect(twinVerdict(null)).toBe('insert');
  });

  // The point of the whole change: the watch's version replaces Strava's.
  it('upgrades a Strava copy', () => {
    expect(twinVerdict(twin('strava'))).toBe('upgrade');
  });

  // Already here from the watch under another activity id. Rewriting it with an
  // identical payload would churn the row and everything watching it for nothing.
  it('leaves a Garmin row alone', () => {
    expect(twinVerdict(twin('garmin'))).toBe('skip');
  });

  // A row from before the column had a default, or from an importer that isn't
  // one of these two. Overwriting somebody else's data is the worse mistake.
  it('leaves an unknown or missing source alone', () => {
    expect(twinVerdict(twin(null))).toBe('skip');
    expect(twinVerdict(twin('manual'))).toBe('skip');
  });
});

/**
 * The same-device case, and the real session that nearly got deleted by it.
 *
 * Everything above is cross-source. Two GARMIN rows for one run — a watch and a
 * band on the same account — carry two different `garmin_activity_id`s, so the
 * sync's own existence check can't see them and the cross-source check won't
 * either, since neither row is Strava's.
 *
 * The reason this is keyed on time overlap and not on the window is the club-wide
 * scan that found it: 7 same-source pairs, and 5 of them were one athlete's
 * 6 × 2 km rep session — six activities 9-10 minutes apart, ~430 s each, every
 * consecutive pair inside the 15-minute window and within 1% on distance. A
 * dedupe that trusted window-plus-distance would have deleted five real reps.
 * Both measured shapes are pinned below.
 */
describe('runsOverlapEnough', () => {
  const T = new Date('2026-09-09T06:00:00').getTime();

  // Shalev Bahalul, 2026-09-09: watch 16.1 km / 4904 s, band 14.7 km / 4904 s,
  // 47 s apart. ~99% overlap — one run, twice.
  it('calls two devices recording one run the same run', () => {
    expect(runsOverlapEnough(T, 4904, T + 47_000, 4904)).toBe(true);
  });

  // The reps: 430 s of running, then ~9 minutes of standing still.
  it('keeps consecutive reps apart', () => {
    expect(runsOverlapEnough(T, 430, T + 9 * 60_000, 430)).toBe(false);
  });

  // Touching but not overlapping: rep two starts as rep one ends.
  it('rejects back-to-back recordings', () => {
    expect(runsOverlapEnough(T, 600, T + 600_000, 600)).toBe(false);
  });

  // Below MIN_OVERLAP: half of the shorter recording is outside the other.
  it('rejects a half overlap', () => {
    expect(runsOverlapEnough(T, 600, T + 300_000, 600)).toBe(false);
  });

  // Unknown duration must fall back to the window-and-distance verdict — the
  // overlap test may only ever narrow a match, never invent one.
  it('answers yes when either duration is missing', () => {
    expect(runsOverlapEnough(T, null, T, 600)).toBe(true);
    expect(runsOverlapEnough(T, 600, T, undefined)).toBe(true);
    expect(runsOverlapEnough(T, 0, T, 600)).toBe(true);
  });
});

describe('findStoredMatch with durations', () => {
  // The latent cross-source bug the same-device fix also closes: a Strava import
  // of rep #2 used to match the stored Garmin rep #1 and be silently dropped.
  it('no longer swallows a second rep against a stored first one', () => {
    const stored: StoredActivity[] = [
      { start_time: '2026-09-09T06:00:00', distance: 2000, duration: 430 },
    ];
    expect(matchesStoredActivity(stored, '2026-09-09T06:09:00', 2010, 430)).toBe(false);
  });

  it('still matches the same run recorded twice', () => {
    const stored: StoredActivity[] = [
      { start_time: '2026-09-09T06:00:00', distance: 16112, duration: 4904 },
    ];
    expect(matchesStoredActivity(stored, '2026-09-09T06:00:47', 14714, 4904)).toBe(true);
  });
});

describe('preferredRecording', () => {
  const base = { activityId: 100, startTimeLocal: '2026-09-09T06:00:00', distance: 16112, duration: 4904 };

  // Not a close call: a band with no fix derives distance from cadence, which is
  // how one run came back as 14.7 km against the watch's 16.1 km.
  it('prefers the device that had a GPS fix', () => {
    const watch: BatchCandidate = { ...base, activityId: 2, startLatitude: 32.1 };
    const band: BatchCandidate = { ...base, activityId: 1, startLatitude: null };
    expect(preferredRecording(band, watch)).toBe(watch);
    expect(preferredRecording(watch, band)).toBe(watch);
  });

  it('falls back to lap count, then duration', () => {
    const lapped = { ...base, activityId: 2, lapCount: 12 };
    const plain = { ...base, activityId: 1, lapCount: 1 };
    expect(preferredRecording(plain, lapped)).toBe(lapped);

    const longer = { ...base, activityId: 2, duration: 5000 };
    const shorter = { ...base, activityId: 1, duration: 4000 };
    expect(preferredRecording(shorter, longer)).toBe(longer);
  });

  // So the outcome never depends on the order Garmin happened to list them in.
  it('settles a tie by activity id', () => {
    const a = { ...base, activityId: 7 };
    const b = { ...base, activityId: 9 };
    expect(preferredRecording(a, b)).toBe(a);
    expect(preferredRecording(b, a)).toBe(a);
  });
});

describe('dedupeSameSourceBatch', () => {
  const watch = {
    activityId: 24292830250, startTimeLocal: '2026-09-09T06:00:00',
    distance: 16112, duration: 4904, startLatitude: 32.0853, lapCount: 8,
  };
  const band = {
    activityId: 24292828223, startTimeLocal: '2026-09-09T06:00:47',
    distance: 14714, duration: 4904, startLatitude: null, lapCount: 1,
  };

  it('collapses the measured pair and keeps the watch', () => {
    const { keep, dropped } = dedupeSameSourceBatch([watch, band]);
    expect(keep).toEqual([watch]);
    expect(dropped).toEqual([{ kept: watch, dropped: band }]);
  });

  // Order-independent — the band listed first must not win by arriving first.
  it('keeps the watch whichever order Garmin listed them in', () => {
    expect(dedupeSameSourceBatch([band, watch]).keep).toEqual([watch]);
  });

  // The near-miss, verbatim: six reps must all survive.
  it('leaves a rep session intact', () => {
    const reps = Array.from({ length: 6 }, (_, i) => ({
      activityId: 900 + i,
      startTimeLocal: new Date(new Date('2026-09-09T06:00:00').getTime() + i * 9.5 * 60_000)
        .toISOString(),
      distance: 2000 + i,
      duration: 430,
      startLatitude: 32.0853,
      lapCount: 1,
    }));
    const { keep, dropped } = dedupeSameSourceBatch(reps);
    expect(keep).toHaveLength(6);
    expect(dropped).toHaveLength(0);
  });

  it('passes an ordinary batch of unrelated runs straight through', () => {
    const runs = [
      { activityId: 1, startTimeLocal: '2026-09-07T06:00:00', distance: 10000, duration: 3000 },
      { activityId: 2, startTimeLocal: '2026-09-08T06:00:00', distance: 10000, duration: 3000 },
      { activityId: 3, startTimeLocal: '2026-09-09T06:00:00', distance: 21097, duration: 6000 },
    ];
    expect(dedupeSameSourceBatch(runs).keep).toHaveLength(3);
  });

  it('handles an empty batch', () => {
    expect(dedupeSameSourceBatch([])).toEqual({ keep: [], dropped: [] });
  });
});
