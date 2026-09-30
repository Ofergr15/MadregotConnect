/**
 * Which runs hold a personal record, read off the club records table (feedback #90:
 * "a new record needs a nicely designed badge inside the workout, top left").
 *
 * The table already carries, for every member and every distance, the run their
 * best was set on. Turned inside out, that is the answer to "is this run someone's
 * record", for every run in the feed at once, from one cached row — no per-card
 * history walk and no new endpoint.
 *
 * A stated time (overrides.ts) has no run behind it, so it marks nothing. A 10K
 * inside a half marathon marks the half marathon, with the 10K named: that is the
 * run the record was set on.
 */
export interface RecordBucketLike {
  key: string;
  entries: Array<{ athleteId: string; activityId: string | null }>;
}

/** activity id → the buckets it is the record for, in the table's order (5K first). */
export function prRunsByActivity(buckets: RecordBucketLike[] | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of buckets ?? []) {
    for (const e of b.entries) {
      if (!e.activityId) continue;
      const keys = out.get(e.activityId);
      if (keys) keys.push(b.key);
      else out.set(e.activityId, [b.key]);
    }
  }
  return out;
}
