// Strava webhook idempotency (round-4 task 95). Strava retries an event it didn't see acked in
// 2 s, and sends `create` then one or more `update`s for the same run within seconds — each one
// used to start a whole-athlete sync. Keyed by the Strava activity id (`object_id`):
//
//   - the same event (activity id + aspect + event_time) seen again → skip (a retry)
//   - `create` for an activity already stored (athlete_activities.strava_activity_id) → skip
//     (the cron or the app-open sync got there first)
//   - an athlete whose sync is already running in this instance → skip (that sync will pick
//     the new activity up; the import upserts on (athlete_id, garmin_activity_id = −strava id))
//   - otherwise → sync
//
// In-memory, per instance: Strava's retries land on a warm instance within seconds, which is
// the case that matters. A cold instance falls through to "already stored", then to the sync's
// own upsert keyed on the Strava id (garmin_activity_id = −strava id, migration 052) — so a
// duplicate can cost a sync, never a duplicate run. An `update` skipped while a sync is in
// flight loses nothing: the sync never rewrites a known row's fields from an update anyway.

export const SEEN_TTL_MS = 10 * 60_000;

export interface StravaEvent {
  object_type?: string;
  aspect_type?: string;
  object_id?: number;
  owner_id?: number;
  event_time?: number;
}

export function eventKey(e: StravaEvent): string | null {
  if (!e.object_id) return null;
  return `${e.object_id}:${e.aspect_type ?? '?'}:${e.event_time ?? 0}`;
}

export function createSeenSet(ttlMs = SEEN_TTL_MS) {
  const seen = new Map<string, number>();
  return {
    /** True the first time a key is seen inside the TTL; false for a repeat. */
    firstTime(key: string, now = Date.now()): boolean {
      for (const [k, t] of seen) if (now - t > ttlMs) seen.delete(k);
      if (seen.has(key)) return false;
      seen.set(key, now);
      return true;
    },
    clear: () => seen.clear(),
  };
}

export type WebhookDecision = 'ignore' | 'sync' | 'skip_retry' | 'skip_stored' | 'skip_inflight';

export function webhookDecision(
  e: StravaEvent,
  facts: { firstTime: boolean; alreadyStored: boolean; inflight: boolean },
): WebhookDecision {
  if (e.object_type !== 'activity' || e.aspect_type === 'delete' || !e.owner_id) return 'ignore';
  if (!facts.firstTime) return 'skip_retry';
  if (e.aspect_type === 'create' && facts.alreadyStored) return 'skip_stored';
  if (facts.inflight) return 'skip_inflight';
  return 'sync';
}
