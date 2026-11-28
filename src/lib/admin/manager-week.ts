/**
 * The two count blocks of the native manager home (task 150), next to the urgent hero
 * (lib/admin/urgent.ts) in GET /api/admin/manager-home:
 *
 *   "מחכה לך עכשיו" — everything waiting for a manager, as counts: join requests, pain
 *                     reports no coach has answered, unpaid store orders.
 *   "השבוע לפי קבוצה" — per pack, who has run this ACTIVITY week (Monday, the watch's
 *                     week — lib/utils.ts) and who has not yet.
 *
 * Pure: the route does the reads. The urgent list is a subset of the waiting counts
 * (urgent = waiting past the line), never a second definition.
 */
import { isWaiting, type FeedbackLike } from '@/lib/feedback/waiting';
import { resolveGroup } from '@/lib/utils';
import type { PendingRequest } from '@/lib/admin/urgent';

export interface UnpaidOrder { id: string; createdAt: string }

export interface WaitingCounts {
  join: number;
  /** Runners (not reports) with pain still waiting for a coach. */
  pain: number;
  unpaid: number;
  total: number;
  /** Days the oldest item of each kind has waited; 0 when there is none. */
  oldestDays: { join: number; pain: number; unpaid: number };
}

const daysSince = (iso: string | undefined, nowMs: number) =>
  iso ? Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86_400_000)) : 0;

export function waitingCounts(
  pain: FeedbackLike[],
  requests: PendingRequest[],
  unpaid: UnpaidOrder[],
  nowISO: string,
): WaitingCounts {
  const now = Date.parse(nowISO);
  const painWaiting = pain.filter((f) => f.pain === true && isWaiting(f)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const painPeople = new Set(painWaiting.map((f) => f.athleteId));
  const join = requests.filter((r) => !r.approved).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const orders = [...unpaid].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    join: join.length,
    pain: painPeople.size,
    unpaid: orders.length,
    total: join.length + painPeople.size + orders.length,
    oldestDays: {
      join: daysSince(join[0]?.createdAt, now),
      pain: daysSince(painWaiting[0]?.createdAt, now),
      unpaid: daysSince(orders[0]?.createdAt, now),
    },
  };
}

export interface GroupWeek {
  groupId: string | null;
  /** The pack's own name; null for members with no pack. */
  name: string | null;
  /** 1–3 by resolveGroup, null when the name is not one of the three. */
  lane: number | null;
  hex: string;
  members: number;
  ran: number;
  notYet: number;
}

export interface WeekByGroup {
  /** The activity week (Monday, YYYY-MM-DD) the counts are for. */
  weekStart: string;
  groups: GroupWeek[];
  totals: { members: number; ran: number; notYet: number };
}

/**
 * Members per pack, ran / not yet. Packs in their lane order (1, 2, 3, then others by
 * name), "no pack" last; a pack with no active members is still listed (0 / 0) so the
 * screen's rows don't jump week to week. A run by someone who is not a member (a
 * removed runner, staff) counts nowhere.
 */
export function weekByGroup(
  weekStart: string,
  members: Array<{ id: string; groupId: string | null }>,
  groups: Array<{ id: string; name: string | null }>,
  ranIds: Iterable<string>,
): WeekByGroup {
  const ran = new Set(ranIds);
  const known = new Map(groups.map((g) => [g.id, g]));
  const keyOf = (m: { groupId: string | null }) => (m.groupId && known.has(m.groupId) ? m.groupId : null);
  const rows = new Map<string | null, GroupWeek>();
  const row = (id: string | null): GroupWeek => {
    let r = rows.get(id);
    if (!r) {
      const name = id ? known.get(id)?.name ?? null : null;
      const g = resolveGroup(name);
      r = { groupId: id, name, lane: id && g.index >= 0 ? g.index + 1 : null, hex: g.hex, members: 0, ran: 0, notYet: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const g of groups) row(g.id);
  for (const m of members) {
    const r = row(keyOf(m));
    r.members += 1;
    if (ran.has(m.id)) r.ran += 1; else r.notYet += 1;
  }
  const noPack = rows.get(null);
  if (noPack && noPack.members === 0) rows.delete(null);
  const list = [...rows.values()].sort((a, b) => {
    if (a.groupId === null) return 1;
    if (b.groupId === null) return -1;
    const la = a.lane ?? 99, lb = b.lane ?? 99;
    return la !== lb ? la - lb : (a.name ?? '').localeCompare(b.name ?? '', 'he', { numeric: true });
  });
  const totals = list.reduce((t, r) => ({ members: t.members + r.members, ran: t.ran + r.ran, notYet: t.notYet + r.notYet }), { members: 0, ran: 0, notYet: 0 });
  return { weekStart, groups: list, totals };
}
