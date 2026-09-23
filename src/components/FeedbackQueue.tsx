'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { moveInQueue, queuePriority, sortQueue, ticketLabel, type QueuePriority, type QueueRow } from '@/lib/feedback/queue';

/**
 * The work queue, reordered by dragging — the way a list is reordered in any
 * iOS app: a grip at the row's edge, the row lifts under the finger, the others
 * slide out of its way, and the list scrolls when you hold it near an edge.
 *
 * ── WHY POINTER EVENTS AND NOT HTML5 DRAG ─────────────────────────────────
 * The Kanban board this panel once had used native dragstart/drop, which iOS
 * Safari never fires from touch — it did nothing at all on a phone. Pointer
 * events do fire, and `touch-action: none` on the grip (only the grip) is what
 * stops the page from scrolling instead, while the rest of the row still
 * scrolls and still opens the report on a tap.
 *
 * ── HOW THE DROP POSITION IS SHOWN ────────────────────────────────────────
 * The list is re-rendered in the order the drop WOULD produce, from the same
 * `moveInQueue` the save uses — so a row dragged into "urgent" shows up under
 * the urgent header before the finger lifts, and what you see is exactly what
 * gets written. The other rows glide to their new places (a FLIP animation);
 * the lifted row is pinned to the finger with a transform against its slot.
 */

export interface QueueItem extends QueueRow {
  ticket_no?: number | null;
  message: string;
  athlete_name: string;
}

interface Props<T extends QueueItem> {
  rows: T[];
  onOpen: (row: T) => void;
  onMove: (id: string, toIndex: number) => void;
  priorityLabel: (p: QueuePriority) => string;
  statusChip: (row: T) => React.ReactNode;
  dateLabel: (iso: string) => string;
  dragHint: string;
}

const PRIORITY_DOT: Record<QueuePriority, string> = {
  high: 'bg-accent-red',
  medium: 'bg-band-3',
  low: 'bg-band-2',
};

const EDGE = 72; // px from the viewport edge where holding a row scrolls the list
const MAX_SCROLL = 14; // px per frame at the very edge

/** The element that actually scrolls — the app scrolls an inner column, not the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export function FeedbackQueue<T extends QueueItem>({
  rows, onOpen, onMove, priorityLabel, statusChip, dateLabel, dragHint,
}: Props<T>) {
  const queue = useMemo(() => sortQueue(rows), [rows]);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const headerEls = useRef(new Map<string, HTMLDivElement>());
  const prevTops = useRef(new Map<string, number>());
  const live = useRef({ clientY: 0, grab: 0, pointerId: -1, raf: 0, id: '', over: 0 });

  // The order the drop would produce. Identical to `queue` when nothing is held.
  const preview = useMemo(() => {
    if (!drag) return queue;
    const updates = moveInQueue(queue, drag.id, drag.over);
    return sortQueue(queue.map(r => {
      const u = updates.find(x => x.id === r.id);
      return u ? { ...r, sort_order: u.sort_order, priority: u.priority } : r;
    }));
  }, [queue, drag]);

  // FLIP: every row that changed slot starts where it was and glides to where it is.
  useLayoutEffect(() => {
    const els = new Map<string, HTMLDivElement>(rowEls.current);
    headerEls.current.forEach((el, g) => els.set(`h:${g}`, el));
    const tops = new Map<string, number>();
    els.forEach((el, id) => tops.set(id, el.offsetTop));
    tops.forEach((top, id) => {
      const el = els.get(id);
      const before = prevTops.current.get(id);
      if (!el || before === undefined || before === top || id === drag?.id) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${before - top}px)`;
      void el.offsetHeight;
      el.style.transition = 'transform 160ms ease';
      el.style.transform = '';
    });
    prevTops.current = tops;
  });

  /** Pin the lifted row to the finger and work out which slot it is over. */
  const track = useCallback(() => {
    const l = live.current;
    const list = listRef.current;
    const el = rowEls.current.get(l.id);
    if (!list || !el) return;
    const y = l.clientY - list.getBoundingClientRect().top - l.grab; // the row's top edge, in list coordinates
    el.style.transform = `translateY(${y - el.offsetTop}px) scale(1.02)`;

    const centre = y + el.offsetHeight / 2;
    let over = 0;
    rowEls.current.forEach((other, id) => {
      if (id !== l.id && other.offsetTop + other.offsetHeight / 2 < centre) over += 1;
    });
    if (over !== l.over) {
      l.over = over;
      setDrag({ id: l.id, over });
    }
  }, []);

  // The layout just moved under the lifted row (a slot changed); re-pin it in
  // the same frame so it never flickers to its new slot for one paint.
  useLayoutEffect(() => { if (drag) track(); }, [drag, track]);

  const frame = useCallback(() => {
    const l = live.current;
    const scroller = scrollParent(listRef.current);
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    let step = 0;
    if (l.clientY < top + EDGE) step = -MAX_SCROLL * (1 - Math.max(0, l.clientY - top) / EDGE);
    else if (l.clientY > bottom - EDGE) step = MAX_SCROLL * (1 - Math.max(0, bottom - l.clientY) / EDGE);
    if (step) {
      if (scroller) scroller.scrollTop += step;
      else window.scrollBy(0, step);
    }
    track();
    l.raf = requestAnimationFrame(frame);
  }, [track]);

  const end = useCallback((commit: boolean) => {
    const l = live.current;
    cancelAnimationFrame(l.raf);
    const el = rowEls.current.get(l.id);
    if (el) {
      el.style.transition = 'transform 160ms ease';
      el.style.transform = '';
    }
    const from = queue.findIndex(r => r.id === l.id);
    const { id, over } = l;
    l.id = '';
    l.pointerId = -1;
    setDrag(null);
    if (commit && id && over !== from) onMove(id, over);
  }, [queue, onMove]);

  useEffect(() => () => cancelAnimationFrame(live.current.raf), []);

  const onGripDown = (e: React.PointerEvent, id: string) => {
    if (live.current.id) return;
    const el = rowEls.current.get(id);
    const list = listRef.current;
    if (!el || !list) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const listTop = list.getBoundingClientRect().top;
    el.style.transition = 'none';
    live.current = {
      ...live.current,
      clientY: e.clientY,
      grab: e.clientY - listTop - el.offsetTop,
      pointerId: e.pointerId,
      id,
      over: queue.findIndex(r => r.id === id),
    };
    setDrag({ id, over: live.current.over });
    live.current.raf = requestAnimationFrame(frame);
  };

  const onGripMove = (e: React.PointerEvent) => {
    if (e.pointerId !== live.current.pointerId) return;
    live.current.clientY = e.clientY;
  };

  let lastGroup: QueuePriority | null = null;
  let rank = 0;

  return (
    <div>
      <div ref={listRef} className="relative select-none" style={{ WebkitUserSelect: 'none' }}>
        {preview.map((row, i) => {
          const group = queuePriority(row.priority);
          const header = group !== lastGroup;
          lastGroup = group;
          rank += 1;
          const lifted = drag?.id === row.id;
          const next = preview[i + 1];
          const lastInGroup = !next || queuePriority(next.priority) !== group;
          const count = preview.filter(r => queuePriority(r.priority) === group).length;
          return (
            <Fragment key={row.id}>
              {header && (
                // Its own element, not part of the row: the first row of a group
                // is liftable, and the header must not ride along with it.
                <div
                  ref={el => { if (el) headerEls.current.set(group, el); else headerEls.current.delete(group); }}
                  className={cn('flex items-center justify-between px-1 pb-1.5', i === 0 ? 'pt-0' : 'pt-4')}
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500">
                    <span className={cn('h-2 w-2 rounded-full', PRIORITY_DOT[group])} />
                    {priorityLabel(group)}
                  </span>
                  <span className="text-2xs font-semibold tabular-nums text-ink-400">{count}</span>
                </div>
              )}
              <div
                ref={el => { if (el) rowEls.current.set(row.id, el); else rowEls.current.delete(row.id); }}
                className={cn(
                  'relative flex items-stretch overflow-hidden bg-card',
                  lifted ? 'z-20 rounded-xl shadow-lg ring-1 ring-brand-600/30' : 'z-0',
                  !lifted && header && 'rounded-t-xl',
                  !lifted && lastInGroup && 'rounded-b-xl',
                  !lifted && !header && 'border-t border-page',
                )}
              >
                <button
                  onClick={() => onOpen(row)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 ps-3 text-start active:bg-page/40"
                >
                  <span className="w-5 shrink-0 text-center text-base font-extrabold tabular-nums text-ink-300">{rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {ticketLabel(row.ticket_no) && (
                        <span className="rounded bg-brand-600/10 px-1.5 py-0.5 font-mono text-2xs font-bold text-brand-700" dir="ltr">
                          {ticketLabel(row.ticket_no)}
                        </span>
                      )}
                      {statusChip(row)}
                      <span className="truncate text-2xs text-ink-400">
                        {row.athlete_name.split(' ')[0]} · {dateLabel(row.created_at)}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 break-words text-13 leading-snug text-ink-700" dir="auto">{row.message}</span>
                  </span>
                </button>
                {/* The grip. 44 wide and the full row tall; the only element with
                    touch-action:none, so a swipe anywhere else still scrolls. */}
                <span
                  role="button"
                  aria-label={dragHint}
                  onPointerDown={e => onGripDown(e, row.id)}
                  onPointerMove={onGripMove}
                  onPointerUp={e => { if (e.pointerId === live.current.pointerId) end(true); }}
                  onPointerCancel={e => { if (e.pointerId === live.current.pointerId) end(false); }}
                  className="flex w-11 shrink-0 cursor-grab items-center justify-center text-ink-300 active:cursor-grabbing active:text-brand-600"
                  style={{ touchAction: 'none' }}
                  data-testid="queue-grip"
                >
                  <GripVertical className="h-5 w-5" />
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
      <p className="mt-3 px-1 text-3xs font-semibold leading-relaxed text-ink-400">{dragHint}</p>
    </div>
  );
}
