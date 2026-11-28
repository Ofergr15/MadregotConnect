/**
 * "Who hasn't run" (task 151): active members with no run in this ACTIVITY week (Monday —
 * the watch's week, lib/utils.ts), optionally one pack, and the dry run of a message to them.
 *
 * Pure: the routes (api/admin/not-run, api/admin/not-run/message) do the reads.
 * The dry run never sends; it says who would get it and through what, so a coach sees
 * "12 by push, 3 with no device, 2 turned 'from the coach' off" before anything exists
 * that could send it.
 */
import { resolveGroup } from '@/lib/utils';

/** Dry runs (audit rows) one staff member may make per hour. */
export const BULK_DRY_RUNS_PER_HOUR = 20;
export const BULK_TEXT_MAX = 1000;
/** How far back "last ran" looks; older is "not in 60 days". */
export const LAST_RUN_LOOKBACK_DAYS = 60;

export const MIGRATION_325 = 'migration-325';
export const MIGRATION_325_TEXT = 'צריך להריץ מיגרציה 325';

/** `?group=` — a pack id, 'none' (members with no pack), or nothing (everyone). */
export type GroupFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'group'; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readGroupFilter(raw: unknown): GroupFilter | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'all') return { kind: 'all' };
  if (raw === 'none') return { kind: 'none' };
  if (typeof raw === 'string' && UUID_RE.test(raw)) return { kind: 'group', id: raw };
  return null;
}

export interface Member { id: string; name: string | null; groupId: string | null }

export interface NotRunPerson {
  id: string;
  name: string;
  groupId: string | null;
  /** The runner's own last run day (YYYY-MM-DD, their wall clock), within the lookback; null = none. */
  lastRunDate: string | null;
}

export interface NotRunGroup {
  groupId: string | null;
  name: string | null;
  lane: number | null;
  members: number;
  notRun: number;
  people: NotRunPerson[];
}

export interface NotRunResult {
  weekStart: string;
  filter: GroupFilter;
  total: { members: number; notRun: number };
  groups: NotRunGroup[];
}

const inFilter = (groupId: string | null, f: GroupFilter) =>
  f.kind === 'all' || (f.kind === 'none' ? groupId === null : groupId === f.id);

/**
 * Members with no run this week, per pack (lane order, no pack last), people by name.
 * A pack id the club doesn't have counts as no pack. `lastRun` maps athlete → last run day.
 */
export function notRunThisWeek(
  weekStart: string,
  members: Member[],
  groups: Array<{ id: string; name: string | null }>,
  ranThisWeek: Iterable<string>,
  lastRun: Map<string, string>,
  filter: GroupFilter,
): NotRunResult {
  const ran = new Set(ranThisWeek);
  const known = new Map(groups.map((g) => [g.id, g]));
  const byGroup = new Map<string | null, NotRunGroup>();
  for (const m of members) {
    const gid = m.groupId && known.has(m.groupId) ? m.groupId : null;
    if (!inFilter(gid, filter)) continue;
    let g = byGroup.get(gid);
    if (!g) {
      const name = gid ? known.get(gid)?.name ?? null : null;
      const r = resolveGroup(name);
      g = { groupId: gid, name, lane: gid && r.index >= 0 ? r.index + 1 : null, members: 0, notRun: 0, people: [] };
      byGroup.set(gid, g);
    }
    g.members += 1;
    if (ran.has(m.id)) continue;
    g.notRun += 1;
    g.people.push({ id: m.id, name: (m.name || '').trim() || '—', groupId: gid, lastRunDate: lastRun.get(m.id) ?? null });
  }
  const list = [...byGroup.values()].sort((a, b) => {
    if (a.groupId === null) return 1;
    if (b.groupId === null) return -1;
    const la = a.lane ?? 99, lb = b.lane ?? 99;
    return la !== lb ? la - lb : (a.name ?? '').localeCompare(b.name ?? '', 'he', { numeric: true });
  });
  for (const g of list) g.people.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return {
    weekStart,
    filter,
    total: list.reduce((t, g) => ({ members: t.members + g.members, notRun: t.notRun + g.notRun }), { members: 0, notRun: 0 }),
    groups: list,
  };
}

/** The latest run day per athlete from rows already limited to the lookback. */
export function lastRunDays(rows: Array<{ athlete_id: string; start_time: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const day = String(r.start_time).slice(0, 10);   // wall clock in a UTC-shaped column: the date is the runner's own
    const prev = out.get(r.athlete_id);
    if (!prev || day > prev) out.set(r.athlete_id, day);
  }
  return out;
}

export interface BulkPlan {
  recipients: number;
  /** Would get a push (has a device, 'from the coach' on). */
  push: string[];
  /** Would get only the in-app inbox row: no device registered. */
  inboxOnly: string[];
  /** Turned 'from the coach' (category `coach`) off: no push. */
  muted: string[];
}

/** How a coach_message to these people would land. Muted wins over no-device (it is the person's own choice). */
export function planBulkMessage(ids: string[], withDevice: Set<string>, muted: Set<string>): BulkPlan {
  const plan: BulkPlan = { recipients: ids.length, push: [], inboxOnly: [], muted: [] };
  for (const id of ids) {
    if (muted.has(id)) plan.muted.push(id);
    else if (withDevice.has(id)) plan.push.push(id);
    else plan.inboxOnly.push(id);
  }
  return plan;
}

/** Postgres/PostgREST "no such table". */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /staff_bulk_message_log/.test(e.message || ''));
