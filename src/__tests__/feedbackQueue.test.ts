import { describe, it, expect } from 'vitest';
import { moveInQueue, sortQueue, ticketQuery, type QueueRow } from '@/lib/feedback/queue';

const row = (id: string, created: string, extra: Partial<QueueRow> = {}): QueueRow => ({
  id, created_at: `2026-09-${created}T08:00:00Z`, status: 'new', category: 'bug_report', ...extra,
});

const apply = (queue: QueueRow[], updates: ReturnType<typeof moveInQueue>) =>
  sortQueue(queue.map(r => {
    const u = updates.find(x => x.id === r.id);
    return u ? { ...r, sort_order: u.sort_order, priority: u.priority } : r;
  }));

describe('sortQueue', () => {
  it('orders by priority, then hand order, then oldest first', () => {
    const q = sortQueue([
      row('new', '22'),
      row('old', '19'),
      row('placed', '21', { sort_order: 1 }),
      row('urgent', '23', { priority: 'high' }),
      row('low', '10', { priority: 'low' }),
    ]);
    expect(q.map(r => r.id)).toEqual(['urgent', 'placed', 'old', 'new', 'low']);
  });

  it('leaves out ideas, shipped fixes and the archive', () => {
    const q = sortQueue([
      row('bug', '19'),
      row('wish', '19', { category: 'feature_request' }),
      row('done', '19', { status: 'done' }),
      row('gone', '19', { archived_at: '2026-09-20' }),
      row('working', '19', { status: 'sprint' }),
    ]);
    expect(q.map(r => r.id)).toEqual(['bug', 'working']);
  });
});

describe('moveInQueue', () => {
  const base = sortQueue([
    row('a', '19', { priority: 'high' }),
    row('b', '20'),
    row('c', '21'),
    row('d', '22'),
  ]);

  it('dragging inside a group renumbers the queue densely', () => {
    const next = apply(base, moveInQueue(base, 'd', 1));
    expect(next.map(r => r.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(next.map(r => r.sort_order)).toEqual([1, 2, 3, 4]);
  });

  it('dropping among urgent rows makes it urgent; the seam keeps its own', () => {
    const updates = moveInQueue(base, 'c', 1);
    expect(updates.find(u => u.id === 'c')?.priority).toBe('medium');
    const top = moveInQueue(base, 'c', 0);
    expect(top.find(u => u.id === 'c')?.priority).toBe('high');
    expect(apply(base, top).map(r => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('dropped between two urgent rows it becomes urgent', () => {
    const two = sortQueue([...base.map(r => r.id === 'b' ? { ...r, priority: 'high' } : r)]);
    const u = moveInQueue(two, 'd', 1);
    expect(u.find(x => x.id === 'd')?.priority).toBe('high');
  });

  it('a priority change sends the row to the end of its new group', () => {
    const next = apply(base, moveInQueue(base, 'd', 0, 'high'));
    expect(next.map(r => r.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(next[1].priority).toBe('high');
  });

  it('a priority with no rows yet opens its group in the right place', () => {
    const next = apply(base, moveInQueue(base, 'b', 0, 'low'));
    expect(next.map(r => r.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('an unknown id changes nothing', () => {
    expect(moveInQueue(base, 'zz', 0)).toEqual([]);
  });
});

describe('ticketQuery', () => {
  it('reads a number with or without the hash', () => {
    expect(ticketQuery('84')).toBe(84);
    expect(ticketQuery(' #84 ')).toBe(84);
    expect(ticketQuery('84 km')).toBeNull();
    expect(ticketQuery('login')).toBeNull();
  });
});
