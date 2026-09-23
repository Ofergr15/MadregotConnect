/**
 * The work queue: the open reports in the order the owner wants them fixed.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * The panel listed reports newest-first, and the only other signal was a
 * priority pill that sorted nothing. So "which bug next" was answered by
 * whoever was looking — and the answer drifted to the newest row, which is the
 * one thing recency is not. The owner now sets it: a priority (urgent / normal
 * / low) and a hand order inside it, dragged on the phone.
 *
 * The order key is (priority, sort_order, created_at). `sort_order` is the
 * column migration 012 added and nothing ever wrote; every move renumbers the
 * whole queue 1..n, so it is always dense and a row nobody has placed yet
 * (null) sorts after the placed ones — oldest first, which is the tiebreak the
 * owner asked for.
 *
 * Which reports are in the queue is lifecycle.ts's call, not this file's: the
 * inbox and the in-flight drawer. Ideas, shipped fixes and the archive are not
 * work waiting to be done.
 */

import { feedbackView, type LifecycleRow } from './lifecycle';

export type QueuePriority = 'high' | 'medium' | 'low';

export const QUEUE_PRIORITIES: QueuePriority[] = ['high', 'medium', 'low'];

export interface QueueRow extends LifecycleRow {
  priority?: string | null;
  sort_order?: number | null;
  created_at: string;
}

const rank = (p: string | null | undefined) => {
  const i = QUEUE_PRIORITIES.indexOf((p || 'medium') as QueuePriority);
  return i < 0 ? 1 : i;
};

export const queuePriority = (p: string | null | undefined): QueuePriority =>
  QUEUE_PRIORITIES[rank(p)];

export function inQueue(row: LifecycleRow): boolean {
  const v = feedbackView(row);
  return v === 'inbox' || v === 'flight';
}

export function compareQueue(a: QueueRow, b: QueueRow): number {
  const byPriority = rank(a.priority) - rank(b.priority);
  if (byPriority !== 0) return byPriority;
  const sa = a.sort_order ?? Number.POSITIVE_INFINITY;
  const sb = b.sort_order ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The queue, in the order work is taken from it. */
export function sortQueue<T extends QueueRow>(rows: T[]): T[] {
  return rows.filter(inQueue).sort(compareQueue);
}

export interface QueueUpdate {
  id: string;
  sort_order: number;
  priority: QueuePriority;
}

/**
 * Move one report to `toIndex` of the (already sorted) queue and return the
 * rows whose position or priority changed.
 *
 * The priority the moved row lands with is its new neighbours': dropping it
 * among the urgent ones makes it urgent. On the seam between two groups it
 * keeps its own (that spot is the end of one and the start of the other);
 * elsewhere the row above decides, or the one below at the very top. It keeps
 * the list sorted — a row can't sit inside "urgent" while saying "low".
 *
 * `priority` overrides that for the sheet's picker, which changes the
 * priority on purpose: the row goes to the END of its new group.
 */
export function moveInQueue<T extends QueueRow>(
  queue: T[],
  id: string,
  toIndex: number,
  priority?: QueuePriority,
): QueueUpdate[] {
  const from = queue.findIndex(r => r.id === id);
  if (from < 0) return [];
  const rest = queue.filter(r => r.id !== id);
  const moving = queue[from];

  let target: QueuePriority;
  let at: number;
  if (priority) {
    target = priority;
    // After the last row of that priority, or where the group would start.
    const lastOfGroup = rest.reduce((last, r, i) => (queuePriority(r.priority) === priority ? i : last), -1);
    at = lastOfGroup >= 0
      ? lastOfGroup + 1
      : rest.findIndex(r => rank(r.priority) > rank(priority));
    if (at < 0) at = rest.length;
  } else {
    at = Math.max(0, Math.min(toIndex, rest.length));
    const own = queuePriority(moving.priority);
    const above = rest[at - 1] ? queuePriority(rest[at - 1].priority) : null;
    const below = rest[at] ? queuePriority(rest[at].priority) : null;
    // On the seam between two groups either neighbour is a fair reading, so the
    // row keeps the group it already had; otherwise the row above decides.
    target = above === own || below === own ? own : (above ?? below ?? own);
  }

  const next = [...rest.slice(0, at), { ...moving, priority: target }, ...rest.slice(at)];
  const updates: QueueUpdate[] = [];
  next.forEach((r, i) => {
    const original = queue.find(q => q.id === r.id)!;
    const order = i + 1;
    const p = queuePriority(r.priority);
    if (original.sort_order !== order || queuePriority(original.priority) !== p) {
      updates.push({ id: r.id, sort_order: order, priority: p });
    }
  });
  return updates;
}

/** "#84" — or null before migration 120 gave the row a number. */
export const ticketLabel = (n: number | null | undefined) => (n ? `#${n}` : null);

/** Whether a search box entry is a ticket number ("84", "#84"). */
export function ticketQuery(q: string): number | null {
  const m = /^#?\s*(\d{1,6})$/.exec(q.trim());
  return m ? Number(m[1]) : null;
}
