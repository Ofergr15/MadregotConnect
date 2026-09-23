/**
 * The admin's People list (#71, phase 2): every member with ONE state, and the
 * four questions an admin filters by — who is waiting on me, who never finished
 * setting the app up, who has no watch connected, and who has gone quiet.
 *
 * Pure so the state order can be pinned by tests; /api/admin/people does the
 * reads and hands the facts in.
 */

export type PersonState = 'waiting' | 'paused' | 'noWatch' | 'setup' | 'silent' | 'active';
export type PeopleFilter = 'all' | 'waiting' | 'setup' | 'noWatch' | 'silent';

export const PEOPLE_FILTERS: PeopleFilter[] = ['all', 'waiting', 'setup', 'noWatch', 'silent'];

/** Same window as the home tile "no run in 7 days", so the two numbers agree. */
export const SILENT_DAYS = 7;

export interface Person {
  id: string;
  name: string;
  role: string;
  groupName: string | null;
  /** athletes.status: active | invited | paused | … */
  status: string;
  approved: boolean;
  source: 'garmin' | 'strava' | null;
  /** Latest run's Israel calendar date, null when none in the read window. */
  lastRunDay: string | null;
  lastSeenAt: string | null;
  joinedAt: string | null;
  setupDone: boolean;
  pushDevices: number;
  /** Newest push_subscriptions.last_success_at across the member's devices. */
  lastPushAt: string | null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function isSilent(p: Person, today: string): boolean {
  return !p.lastRunDay || daysBetween(p.lastRunDay, today) >= SILENT_DAYS;
}

/**
 * The ONE pill a row shows, most-actionable first: somebody waiting for approval
 * outranks everything, because nothing else about them can happen until then. A
 * missing watch comes before an unfinished setup because no watch means no data
 * at all, and "silent" last because it's only meaningful for somebody set up.
 */
export function personState(p: Person, today: string): PersonState {
  if (!p.approved || p.status === 'invited') return 'waiting';
  if (p.status === 'paused') return 'paused';
  if (!p.source) return 'noWatch';
  if (!p.setupDone) return 'setup';
  if (isSilent(p, today)) return 'silent';
  return 'active';
}

/**
 * Filters are facts, not the pill: a member with no watch who also never
 * finished setup shows under both chips, since both are true and each chip is
 * answering its own question. Paused members only appear under "all".
 */
export function matchesFilter(p: Person, filter: PeopleFilter, today: string): boolean {
  const waiting = !p.approved || p.status === 'invited';
  const live = !waiting && p.status !== 'paused';
  switch (filter) {
    case 'all': return true;
    case 'waiting': return waiting;
    case 'setup': return live && !p.setupDone;
    case 'noWatch': return live && !p.source;
    case 'silent': return live && isSilent(p, today);
  }
}

export function filterCounts(people: Person[], today: string): Record<PeopleFilter, number> {
  const out = { all: 0, waiting: 0, setup: 0, noWatch: 0, silent: 0 } as Record<PeopleFilter, number>;
  for (const p of people) for (const f of PEOPLE_FILTERS) if (matchesFilter(p, f, today)) out[f]++;
  return out;
}
