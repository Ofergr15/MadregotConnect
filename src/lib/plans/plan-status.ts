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

/**
 * The status a coach's SEND leaves on a trainee's plan row, whether or not a watch got it
 * (launch report BL6 / N5). A trainee on Strava only, a newcomer with no watch, or one whose
 * Garmin push failed was left on 'draft' — and every reader above skips a draft, so the
 * board said "✓ לפי התוכנית" while run detail showed no plan at all. The send IS the
 * publication; 'draft' stays for composer edits nobody sent. `partial` when other days of
 * the week were not part of this send (or the push did not land), `pushed` otherwise.
 */
export function sentPlanStatus(opts: { otherDays: boolean; delivered?: boolean }): 'pushed' | 'partial' {
  return opts.otherDays || opts.delivered === false ? 'partial' : 'pushed';
}
