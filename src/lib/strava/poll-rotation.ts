/**
 * Which Strava athletes to poll on this tick.
 *
 * ── WHY THERE IS A POLL AT ALL ──────────────────────────────────────────────
 * The 5-minute cron syncs Garmin, and Garmin only: the Strava poll was dropped
 * on 2026-08-28 because it filtered on `data_source='strava'`, matched nobody,
 * and cost a round trip per athlete to return synced:0. Strava's side was meant
 * to be covered by the webhook, which is instant and free.
 *
 * The premise no longer holds. Fourteen athletes have Strava connected and three
 * of them have NO Garmin at all — and the Garmin cron skips an athlete without
 * `garmin_auth`, so for those three nothing scheduled runs. Their runs land only
 * when they personally open the app, which is what a member reported (528e04a8,
 * "my workouts don't come in from Strava"): his rows arrive in batches, hours
 * after the run, several at the same second — the signature of a sync triggered
 * by a login, not by a run.
 *
 * So this is a safety net under the webhook, not a replacement for it. If the
 * subscription is healthy the poll finds every activity already stored and writes
 * nothing; if it is dead — pointing at a retired domain, or never registered —
 * a run still arrives within about ten minutes instead of whenever the athlete
 * next opens the app.
 *
 * ── WHY IT IS RATIONED ──────────────────────────────────────────────────────
 * Strava allows 100 requests per 15 minutes and 1,000 per day for the whole app,
 * shared with enrichment (2-3 calls per new run), the two backfill passes and
 * every athlete's own login sync. A poll of every candidate on every tick would
 * be 3 x 12 x 18 = 648 calls a day spent almost entirely on confirming that
 * nothing changed, leaving too little for the calls that do carry data.
 *
 * So a tick polls at most `budget` athletes, and the slice rotates. The cost is
 * then fixed no matter how many athletes connect Strava — what grows is how long
 * a run can sit unseen, which is the right thing to trade away: this is the
 * fallback path, and the fallback being 10 minutes late instead of 5 costs
 * nobody anything.
 */

/** Athletes polled per tick. 2 x 12 ticks/hour x 18 hours = 432 calls a day. */
export const STRAVA_POLL_BUDGET = 2;

/** The cron's period, and so the unit the rotation advances in. */
export const STRAVA_POLL_TICK_MS = 5 * 60 * 1000;

/** Which tick a moment belongs to. Stateless on purpose — a lambda remembers nothing between invocations, and a `last_polled_at` column would be a migration and a write per poll to answer a question arithmetic already answers. */
export function stravaPollTick(now = Date.now()): number {
  return Math.floor(now / STRAVA_POLL_TICK_MS);
}

/**
 * The `budget` athletes whose turn it is, wrapping around the end of the list.
 *
 * `ids` must arrive in a stable order (sort them) or the rotation reshuffles on
 * every tick and stops being fair — some athletes would be polled twice in a row
 * while others waited. With a stable order every athlete is polled once per
 * ceil(ids.length / budget) ticks, and no athlete is ever skipped twice.
 */
export function stravaPollSlice(ids: string[], tick: number, budget = STRAVA_POLL_BUDGET): string[] {
  if (ids.length === 0 || budget <= 0) return [];
  if (budget >= ids.length) return [...ids];
  // Positive modulo: a tick index is never negative in practice, but a negative
  // start index would silently return an empty slice rather than misbehave
  // visibly, and a poll that quietly stops polling is the failure mode this
  // whole file exists to fix.
  const start = ((tick * budget) % ids.length + ids.length) % ids.length;
  const slice: string[] = [];
  for (let i = 0; i < budget; i++) slice.push(ids[(start + i) % ids.length]);
  return slice;
}
