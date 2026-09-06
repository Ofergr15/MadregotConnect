import { revalidateTag } from 'next/cache';

/**
 * Data Cache tag for every read of `weekly_plans`.
 *
 * The plan-reading routes are cached for 300s (a coach publishes about once a
 * week, and the queries are club-global, so nearly every athlete request was a
 * cache hit). Nothing purged that cache, though — so for up to five minutes
 * after a plan was pushed the athlete who went to look for it got the answer
 * from before it existed: a profile with seven empty day tiles and no plan.
 *
 * Tagging the reads and purging on write keeps the hit rate and removes the
 * window. Anything that writes `weekly_plans` must call
 * `revalidateWeeklyPlans()` after the write succeeds.
 */
export const WEEKLY_PLANS_TAG = 'weekly-plans';

export function revalidateWeeklyPlans(): void {
  // `{ expire: 0 }` = don't let anyone be served the pre-write copy. Next now
  // requires this second argument; the alternative, a named `cacheLife` profile
  // like 'max', permits serving stale while it revalidates in the background,
  // which is the exact window we're closing. (`updateTag`, the other "immediate"
  // option, throws outside a Server Action — these are all route handlers.)
  revalidateTag(WEEKLY_PLANS_TAG, { expire: 0 });
}
