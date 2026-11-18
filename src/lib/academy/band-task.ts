// "לשבץ דבוקה" (Ofer, 2026-11-18): a trainee in the academy without a band (דבוקה) is
// the ASSIGNED coach's task — never guessed, never filled in for them. The task is not
// stored anywhere: it is read off the roster (approved, a coach, no band), so it closes
// by itself the moment the coach saves a band in the "טופס התאמה" (TraineeSetup).
// A trainee with no coach at all is the managers' item instead — they pick the coach,
// this code never does.
import { memberCoachIds } from './members';

export interface BandTaskMember {
  athleteId: string;
  name: string;
  approved: boolean;
  status?: string | null;
  band: { id: string } | null;
  academyCoachId: string | null;
  academyCoachIds?: string[] | null;
}

export interface BandTasks {
  /** Has a coach, no band: the coach's "לשבץ דבוקה". */
  needsBand: Array<{ athleteId: string; name: string }>;
  /** No coach and no band: the managers' item (assign a coach; the coach sets the band). */
  noCoach: Array<{ athleteId: string; name: string }>;
}

/**
 * Who is waiting for a band. `hasBands` false (the academy has no bands yet) is one
 * academy-level setup gap, not a task per trainee, so it yields nothing.
 */
export function bandTasks(members: readonly BandTaskMember[], hasBands = true): BandTasks {
  const out: BandTasks = { needsBand: [], noCoach: [] };
  if (!hasBands) return out;
  for (const m of members) {
    if (!m.approved || m.status === 'removed' || m.band) continue;
    const row = { athleteId: m.athleteId, name: m.name };
    (memberCoachIds(m).length ? out.needsBand : out.noCoach).push(row);
  }
  return out;
}
