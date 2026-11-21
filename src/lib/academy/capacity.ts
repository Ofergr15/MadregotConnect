/**
 * Coach capacity for the manager's assignment sheet. `athletes.academy_capacity` (migration 188)
 * holds a per-coach ceiling; null = no ceiling recorded, in which case the default applies.
 * Only the manager assigns (isAcademyManager) — a coach never reaches this.
 */

export const DEFAULT_CAPACITY = 8;
/** "Near cap" once this many seats or fewer remain. */
export const NEAR_CAP_SEATS = 1;

export type LoadState = 'open' | 'near' | 'full' | 'over';

export function capacityOf(raw: number | null | undefined): number {
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : DEFAULT_CAPACITY;
}

export function loadState(active: number, capacity: number): LoadState {
  if (active > capacity) return 'over';
  if (active === capacity) return 'full';
  if (capacity - active <= NEAR_CAP_SEATS) return 'near';
  return 'open';
}

export interface AssignCheck {
  ok: boolean;
  /** Coaches the assignment would take past capacity. */
  overCap: string[];
  /** Coaches it would leave at or one below capacity. */
  nearCap: string[];
}

/**
 * May `traineeId` be given `coachIds`? Each coach that is new to the trainee takes a seat;
 * a coach already on the trainee does not. Over capacity is refused unless `force`
 * (the manager confirms — the sheet's "assign anyway").
 */
export function checkAssignment(
  coachIds: string[],
  currentCoachIds: string[],
  loads: Record<string, { active: number; capacity: number }>,
  force = false,
): AssignCheck {
  const overCap: string[] = [];
  const nearCap: string[] = [];
  for (const id of new Set(coachIds)) {
    const l = loads[id];
    if (!l) continue;
    const after = l.active + (currentCoachIds.includes(id) ? 0 : 1);
    const s = loadState(after, l.capacity);
    if (s === 'over') overCap.push(id);
    else if (s === 'full' || s === 'near') nearCap.push(id);
  }
  return { ok: coachIds.length > 0 && (force || overCap.length === 0), overCap, nearCap };
}
