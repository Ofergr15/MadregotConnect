/**
 * The admin's Content hub (#71, phase 2): what the club is being shown right now.
 * One question per challenge: is it running, coming, or over?
 */

export type ChallengePhase = 'active' | 'scheduled' | 'ended';
export const CHALLENGE_PHASES: ChallengePhase[] = ['active', 'scheduled', 'ended'];

/**
 * By its dates first, then the switch: a challenge turned off inside its own
 * window isn't running, so it files under ended rather than showing as live.
 */
export function challengePhase(c: { start_date: string; end_date: string; active: boolean | null }, today: string): ChallengePhase {
  if (c.end_date < today) return 'ended';
  if (c.active === false) return 'ended';
  if (c.start_date > today) return 'scheduled';
  return 'active';
}

/** Whole days from `today` to `day`, both Israel YYYY-MM-DD. Negative when past. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
