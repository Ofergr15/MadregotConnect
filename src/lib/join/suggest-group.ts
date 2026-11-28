import { cleanIntake } from './intake';
import { equivalent, packGoal, recommend } from './pace';

/**
 * The pack an applicant's own best time points at, for the approval queue (task 186).
 *
 * The same rule the sign-up form shows the applicant (components/join/JoinFlow: Riegel to a
 * marathon equivalent, then `recommend` = the fastest pack whose goal it is within), run on
 * the server over what the request stored (`signup_requests.intake`, migration 158). It is a
 * SUGGESTION: the approver still picks the group, and nothing is written from it unless the
 * approver says so (`acceptSuggestion` on the decision route).
 *
 * Pure, so every threshold is a test.
 */

export interface SuggestGroupInput {
  id: string;
  name: string;
  /** `pace_profile.marathonGoal`, free text like "SUB 2:45"; the name is the fallback. */
  marathonGoal?: string | null;
}

export type GroupSuggestion =
  | { kind: 'group'; groupId: string; groupName: string; marathonEquivalentSec: number }
  /** Slower than the slowest pack: the form sends them to the academy, so does this. */
  | { kind: 'academy'; marathonEquivalentSec: number }
  /** No usable best time, or no pack with a readable goal. */
  | { kind: 'none'; why: 'no-time' | 'no-goals' };

export function suggestGroup(intake: unknown, groups: SuggestGroupInput[]): GroupSuggestion {
  const i = cleanIntake(intake);
  if (!i || !i.bestDistance || !i.bestSeconds) return { kind: 'none', why: 'no-time' };
  const packs = groups
    .map((g) => ({ g, goal: packGoal(g.marathonGoal || '') ?? packGoal(g.name) }))
    .filter((p): p is { g: SuggestGroupInput; goal: number } => p.goal != null);
  if (!packs.length) return { kind: 'none', why: 'no-goals' };
  const marathonEquivalentSec = Math.round(equivalent(i.bestSeconds, i.bestDistance, 'marathon'));
  const hit = recommend(marathonEquivalentSec, packs);
  if (!hit) return { kind: 'academy', marathonEquivalentSec };
  return { kind: 'group', groupId: hit.g.id, groupName: hit.g.name, marathonEquivalentSec };
}

/** Rejecting needs a reason (staff-only, never mailed); approving may carry one. */
export const DECISION_REASON_MAX = 280;

export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, DECISION_REASON_MAX) : null;
}
