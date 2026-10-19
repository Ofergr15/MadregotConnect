import { teammateHref } from '@/lib/athletes/profile-link';

/**
 * What a runner's progress stack shows, for whom (2026-10-19, Ofer: "draw on what regular
 * trainees already have — weekly charts, improvement, PRs — don't reinvent the wheel").
 *
 * One answer for the three places the stack appears — a trainee's own progress tab, and a
 * trainee's page for their coach and the academy manager — so they cannot disagree about
 * what a viewer may see. Every part is the club runner's own component and API; this only
 * picks among them.
 *
 *   week          MyWeekCard — the ring, the days, ten weeks, this month / this year
 *   records       PrSection over /api/athletes/[id]/stats (member-visible, as on a teammate's profile)
 *   improvement   PaceAtHrCard — pace at the same heart rate; its API is self-or-staff, so
 *                 a teammate (peer) never gets it
 *   runs          the athlete's own feed, runs only, the last few, then "לכל הריצות"
 */
export type ProgressViewer = 'owner' | 'staff' | 'peer';

export interface ProgressParts {
  week: boolean;
  records: boolean;
  improvement: boolean;
  runs: boolean;
  /** How many runs before "לכל הריצות". */
  runsMax: number;
  /** Where "לכל הריצות" goes: your own profile, or the athlete's profile. */
  runsHref: string | null;
}

export function progressParts(athleteId: string, viewer: ProgressViewer): ProgressParts {
  return {
    week: true,
    records: true,
    improvement: viewer !== 'peer',
    runs: true,
    runsMax: 3,
    runsHref: viewer === 'owner' ? '/dashboard/profile' : teammateHref(athleteId),
  };
}

/**
 * Where the week card's "לתוכנית המלאה" goes. A club member's week is the club's program;
 * an academy-only trainee has no club program — their week is the board their coach writes
 * (/dashboard/academy/week, their own when no athleteId is given).
 */
export function fullPlanHref({ owner, academyOnly }: { owner: boolean; academyOnly: boolean }): string {
  return owner && academyOnly ? '/dashboard/academy/week' : '/dashboard/program';
}
