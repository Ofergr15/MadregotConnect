/**
 * The academy home's view resolution and manager aggregates (GET /api/academy/hub).
 * Pure: the route reads, this decides.
 */

export type HubView = 'trainee' | 'coach' | 'manager';

export interface HubCaller {
  isSuperUser: boolean;
  isStaff: boolean;
  isManager: boolean;
  isTrainee: boolean;
}

/**
 * The view a caller gets for the view they asked for. Asking wider than you hold gives the
 * narrower one you DO hold — narrow, don't 403 (client-scope.ts). `null` = nothing to show
 * (a plain club member who is not in the academy).
 */
export function resolveHubView(requested: string | null, c: HubCaller): HubView | null {
  const held: HubView[] = [];
  if (c.isManager) held.push('manager');
  if (c.isStaff || c.isSuperUser) held.push('coach');
  if (c.isTrainee) held.push('trainee');
  if (!held.length) return null;
  if (requested && (held as string[]).includes(requested)) return requested as HubView;
  if (requested === 'manager' && held.includes('coach')) return 'coach';
  // Default landing: manager > coach > trainee (NOTES Q1 — a manager-who-coaches lands on manager).
  return held[0];
}

/** Views this caller may switch between (the segmented switch for a manager-who-coaches). */
export function availableViews(c: HubCaller): HubView[] {
  const v: HubView[] = [];
  if (c.isManager) v.push('manager');
  if (c.isStaff || c.isSuperUser) v.push('coach');
  if (c.isTrainee) v.push('trainee');
  return v;
}

export interface PipelineCounts { registered: number; assignedNoPlan: number; active: number; paused: number }

export function pipeline(rows: Array<{ coachIds: string[]; hasAnyPlan: boolean; paused: boolean }>, registered: number): PipelineCounts {
  const p: PipelineCounts = { registered, assignedNoPlan: 0, active: 0, paused: 0 };
  for (const r of rows) {
    if (r.paused) p.paused++;
    else if (r.coachIds.length && !r.hasAnyPlan) p.assignedNoPlan++;
    else if (r.coachIds.length) p.active++;
  }
  return p;
}

/** Share of planned sessions done, 0–100, null with nothing planned. */
export function executionPct(done: number, planned: number): number | null {
  return planned > 0 ? Math.round((done / planned) * 100) : null;
}

/** 2000 m distribution for the manager's tests tab: buckets of 30 s. */
export function roundBuckets(times: number[], width = 30): Array<{ fromSec: number; count: number }> {
  const m = new Map<number, number>();
  for (const t of times) {
    if (!(t > 0)) continue;
    const k = Math.floor(t / width) * width;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([fromSec, count]) => ({ fromSec, count }));
}
