// Event RSVP rules (night task 57) — pure, so the register route, the event edit and
// the publish path all count "who's coming" the same way.
//
// Two invariants:
//  1. An RSVP is IDEMPOTENT. Tapping "I'm coming" twice (or the native outbox
//     resending) must not change anything — in particular a waitlisted member must
//     not lose their place in line, which the old upsert did by refreshing created_at
//     on every POST.
//  2. The waitlist is always rebalanced to the CURRENT capacity: a cancel frees a
//     spot, and a staff edit that raises (or removes) the capacity frees several.
//     Before, only a cancel promoted, and only one row — so after "capacity 20 → 30"
//     ten people stayed waitlisted for an event with ten empty spots.

import type { EventRegistrationStatus } from '@/lib/events';

export interface ExistingRsvp { id: string; status: EventRegistrationStatus | string; created_at?: string | null }

export type RsvpDecision =
  | { action: 'noop'; status: EventRegistrationStatus }
  | { action: 'promote'; status: 'registered' }
  | { action: 'write'; status: EventRegistrationStatus; refreshQueuePosition: boolean };

/**
 * What POST /register should do for this caller. `othersRegistered` excludes the
 * caller's own row, so their stale prior row never waitlists them.
 */
export function rsvpDecision(existing: ExistingRsvp | null, othersRegistered: number, capacity: number | null): RsvpDecision {
  const hasRoom = capacity == null || othersRegistered < capacity;
  if (existing?.status === 'registered') return { action: 'noop', status: 'registered' };
  if (existing?.status === 'waitlisted') {
    // Keep the place in line; move up only if a spot is actually free.
    return hasRoom ? { action: 'promote', status: 'registered' } : { action: 'noop', status: 'waitlisted' };
  }
  // New, or coming back after a cancel: joins the BACK of the line (fresh created_at).
  return { action: 'write', status: hasRoom ? 'registered' : 'waitlisted', refreshQueuePosition: true };
}

/**
 * Which waitlisted rows to promote so `registered` fills `capacity`. `waitlist` must be
 * oldest-first. No capacity = everyone waiting gets in. Never demotes: an edit that
 * LOWERS capacity below the registered count leaves those people registered.
 */
export function promotionsFor(capacity: number | null, registeredCount: number, waitlist: readonly { id: string }[]): string[] {
  const free = capacity == null ? waitlist.length : Math.max(0, capacity - registeredCount);
  return waitlist.slice(0, free).map((w) => w.id);
}
