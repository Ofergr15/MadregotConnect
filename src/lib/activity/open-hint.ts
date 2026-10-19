'use client';

/**
 * What the screen that opens a run already knows about it, handed to the run page.
 *
 * The run page is reached by the activity id alone, so its personal-records card
 * (/api/athletes/<athlete>/records/run/<run>) used to wait for the run's details just
 * to learn whose run it is: a second round trip, ~0.5 s, before the card could ask.
 * A feed card knows the athlete, so it leaves the answer here on the way out and
 * the page starts that request at once. In memory only, one entry per run, read once.
 */
const hints = new Map<string, string>();

export function hintActivityAthlete(activityId: string, athleteId: string | null | undefined): void {
  if (activityId && athleteId) hints.set(activityId, athleteId);
}

export function takeActivityAthlete(activityId: string): string | null {
  const a = hints.get(activityId) ?? null;
  hints.delete(activityId);
  return a;
}

/** The records card's request key, shared by the card and the early start. */
export const runRecordsKey = (athleteId: string, activityId: string) => `/api/athletes/${athleteId}/records/run/${activityId}`;
