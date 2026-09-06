/**
 * Which `weekly_plans.status` values count as "the athletes were asked to run this".
 *
 * `pushed` is the whole week on watches; `partial` is some athletes' pushes having
 * failed, which still means the plan was published. `draft` is the coach mid-edit —
 * days move, pace bands change, workouts get rewritten — so nothing that judges a
 * run, or draws a target band on a chart, may read one.
 *
 * Shared so the three places that attribute a run to a plan (the matcher, the
 * segments route, the feed badge) can't drift apart on what "published" means.
 */
export const PLAN_STATUSES = ['pushed', 'partial'] as const;
