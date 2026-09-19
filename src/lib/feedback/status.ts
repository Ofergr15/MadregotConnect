/**
 * The five states a report can be in, and the one question everybody asks about
 * them: is it done or not.
 *
 * Reported (2d076a9c) as "קשה להבין איזה באגים תוקנו — צריך לסדר את המודול של
 * הבאגים בצורה נוחה יותר להבנה מה תוקן ומה לא, גם עבור הadmin וגם עבור כל user".
 * Two things made that hard, and both are fixed here rather than on either screen:
 *
 *  1. THE TWO SCREENS USED DIFFERENT WORDS. The staff inbox called the states
 *     "חדש / רעיון / ספרינט / נדחה / בוצע" and the athlete's own list called the
 *     same five "התקבל / רעיון לעתיד / בטיפול / לא ייטופל / טופל". Same column in
 *     the same table, two vocabularies — so a coach and a runner talking about one
 *     report were not using the same names for its state. The athlete's wording
 *     won: it is the plainer of the two, and "ספרינט" is our word, not the club's.
 *  2. FIVE FLAT STATES IS NOT AN ANSWER. "Is this fixed?" is a two-way question,
 *     and it was being answered with a five-way taxonomy. `statusPhase` collapses
 *     the five into the two people actually sort by, so both screens can group the
 *     same way without either one inventing its own rule.
 *
 * `denied` counts as resolved. It is not fixed, but it IS closed — nobody is
 * waiting on it — and leaving it in the open pile is what made that pile look
 * like a backlog nobody was touching.
 */

export type FeedbackStatus = 'new' | 'idea' | 'sprint' | 'denied' | 'done';

/** Open work first, and inside each phase the order things really move through. */
export const FEEDBACK_STATUS_ORDER: FeedbackStatus[] = ['new', 'sprint', 'idea', 'done', 'denied'];

/** Whether anybody is still waiting on this one. */
export type FeedbackPhase = 'open' | 'resolved';

const RESOLVED: ReadonlySet<string> = new Set<FeedbackStatus>(['done', 'denied']);

/**
 * Anything unrecognised — including the null a pre-migration row carries — is
 * OPEN. A report whose state we cannot read has certainly not been dealt with,
 * and the failure that hides work is worse than the one that shows too much.
 */
export function statusPhase(status: string | null | undefined): FeedbackPhase {
  return RESOLVED.has(status || '') ? 'resolved' : 'open';
}

export function normalizeStatus(status: string | null | undefined): FeedbackStatus {
  return (FEEDBACK_STATUS_ORDER as string[]).includes(status || '')
    ? (status as FeedbackStatus)
    : 'new';
}

/** next-intl key in the `review` namespace — the plain-language wording. */
export const STATUS_LABEL_KEY: Record<FeedbackStatus, string> = {
  new: 'statusNew',
  sprint: 'statusSprint',
  idea: 'statusIdea',
  done: 'statusDone',
  denied: 'statusDenied',
};

/**
 * Pill colours. Green only for `done`, so "fixed" is the one state with a colour
 * of its own and can be found by scanning rather than by reading — which is what
 * the report asked for. `denied` is deliberately grey: closed, not celebrated.
 */
export const STATUS_PILL: Record<FeedbackStatus, string> = {
  new: 'bg-brand-600/10 text-brand-600',
  sprint: 'bg-band-3/20 text-band-3-ink',
  idea: 'bg-purple-600/10 text-purple-600',
  done: 'bg-accent-600/15 text-accent-900',
  denied: 'bg-page text-ink-400',
};

/** Split a list into the two phases, each keeping the caller's order. */
export function splitByPhase<T>(
  items: T[],
  statusOf: (item: T) => string | null | undefined,
): { open: T[]; resolved: T[] } {
  const open: T[] = [];
  const resolved: T[] = [];
  for (const item of items) {
    (statusPhase(statusOf(item)) === 'resolved' ? resolved : open).push(item);
  }
  return { open, resolved };
}
