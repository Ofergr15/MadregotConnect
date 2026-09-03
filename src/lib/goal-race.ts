// The club's goal race and where we are in the block leading up to it.
//
// Hardcoded on purpose: the club trains for ONE race at a time, and nothing in
// the schema holds a target race — `/api/athletes/races` stores finished
// results, not goals. These three values lived as consts inside
// dashboard/page.tsx until the designer's Profile frame put the same countdown
// card on a second screen; extracted here so the two screens can't drift apart
// (a race date in two files is a race date that eventually disagrees).
//
// When a per-athlete goal race becomes real, this is the one place to replace.
export const GOAL_RACE = {
  /** Key into the `dashboard` message namespace, so the name is translated. */
  nameKey: 'valenciaMarathon',
  date: new Date('2026-12-06T09:00:00'),
  /** First day of the training block — the denominator's origin. */
  blockStart: new Date('2026-08-09T00:00:00'),
  totalWeeks: 17,
} as const;

export interface GoalRaceProgress {
  /** Whole days until race day. 0 once it's here or past. */
  days: number;
  /**
   * 1-based week of the block, clamped to [0, totalWeeks]. 0 means the block
   * hasn't started yet, which callers render as "pre-season" rather than
   * "week 0 of 17".
   */
  week: number;
  totalWeeks: number;
}

/**
 * Days-to-race and week-of-block for a given instant.
 *
 * `now` is injectable so this is testable without freezing the clock, and so a
 * component can tick it. Days floor rather than round: with 1.8 days left the
 * honest answer is "1 more day", not "2".
 */
export function goalRaceProgress(now: number = Date.now()): GoalRaceProgress {
  const msToRace = GOAL_RACE.date.getTime() - now;
  const days = msToRace > 0 ? Math.floor(msToRace / 86_400_000) : 0;
  const weeksElapsed = Math.floor((now - GOAL_RACE.blockStart.getTime()) / 604_800_000);
  return {
    days,
    week: Math.max(0, Math.min(weeksElapsed + 1, GOAL_RACE.totalWeeks)),
    totalWeeks: GOAL_RACE.totalWeeks,
  };
}
