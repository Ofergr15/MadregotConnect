/**
 * What is URGENT on the manager home (b22 manager home v2, direction C, owner-approved): the default rule from the
 * mockup — pain no coach has answered within 4 hours, and a join request waiting more than 48 hours. Urgent things
 * become the hero; everything else waiting is a count below it.
 *
 * A coach running late is the third default and is NOT here: nothing in the data model records it (no table, no
 * column, no route). It needs a feature of its own (a coach saying "I'll be there at 19:20"), not a rule.
 *
 * Pure: the route does the reads (src/__tests__/managerUrgent.test.ts).
 */
import { isWaiting, type FeedbackLike } from '@/lib/feedback/waiting';

export const PAIN_URGENT_HOURS = 4;
export const REQUEST_URGENT_HOURS = 48;

export interface UrgentItem {
  kind: 'pain' | 'request';
  /** workout_feedback.id or signup_requests.id */
  id: string;
  athleteId: string | null;
  /** First name + last name as the club knows them; never an email. */
  name: string;
  /** When it started waiting. */
  since: string;
  hoursWaiting: number;
}

export interface PendingRequest { id: string; createdAt: string; athleteId: string | null; fullName: string | null; approved: boolean }

const hoursBetween = (from: string, nowMs: number) => Math.max(0, Math.floor((nowMs - Date.parse(from)) / 3_600_000));

/** Pain still waiting (lib/feedback/waiting) for ≥ 4 h, oldest first, one per runner. */
export function urgentPain(rows: FeedbackLike[], names: Map<string, string>, nowISO: string): UrgentItem[] {
  const now = Date.parse(nowISO);
  const seen = new Set<string>();
  return rows
    .filter((f) => f.pain === true && isWaiting(f) && hoursBetween(f.createdAt, now) >= PAIN_URGENT_HOURS)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .filter((f) => (seen.has(f.athleteId) ? false : (seen.add(f.athleteId), true)))
    .map((f) => ({ kind: 'pain', id: f.id, athleteId: f.athleteId, name: names.get(f.athleteId) ?? '—', since: f.createdAt, hoursWaiting: hoursBetween(f.createdAt, now) }));
}

/** Pending requests (not already approved — the needs-you rule) waiting ≥ 48 h, oldest first. */
export function urgentRequests(rows: PendingRequest[], nowISO: string): UrgentItem[] {
  const now = Date.parse(nowISO);
  return rows
    .filter((r) => !r.approved && hoursBetween(r.createdAt, now) >= REQUEST_URGENT_HOURS)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({ kind: 'request', id: r.id, athleteId: r.athleteId, name: r.fullName?.trim() || '—', since: r.createdAt, hoursWaiting: hoursBetween(r.createdAt, now) }));
}

/** Pain before requests (a body before paperwork), each oldest first. */
export function urgentItems(pain: UrgentItem[], requests: UrgentItem[]): UrgentItem[] {
  return [...pain, ...requests];
}

/** Admin and academy manager (and the super user): the manager home's audience. */
export function mayReadManagerHome(c: { isSuperUser: boolean; role?: string | null; roles?: string[] | null }): boolean {
  const has = (r: string) => c.role === r || !!c.roles?.includes(r);
  return c.isSuperUser || has('admin') || has('academy_manager');
}
