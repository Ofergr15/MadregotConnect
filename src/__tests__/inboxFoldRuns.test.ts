import { describe, expect, it } from 'vitest';
import { foldNames, foldRuns, type HistoryItem } from '@/lib/notifications/history';

const it_ = (id: string, kind: string, sentAt: string, actorName: string | null = null): HistoryItem =>
  ({ id, kind, title: id, body: '', url: '/feed', sentAt, unread: false, actorName });

describe('foldRuns — a day of "X finished a run" is one row', () => {
  it('folds 3+ runs of one Israel day into one entry, where the newest was', () => {
    const items = [
      it_('r1', 'kudos_activity', '2026-10-11T13:53:00Z', 'Guy Joselson'),
      it_('k1', 'kudos', '2026-10-11T06:26:00Z', 'Shalev Bahalul'),
      it_('r2', 'kudos_activity', '2026-10-11T05:45:00Z', 'Ido Bar-On'),
      it_('r3', 'kudos_activity', '2026-10-11T04:43:00Z', 'Itai Spiegel'),
      it_('p1', 'plan_pushed', '2026-10-10T20:40:00Z'),
    ];
    const out = foldRuns(items);
    expect(out.map((e) => (e.type === 'item' ? e.item.id : e.key))).toEqual(['runs:2026-10-11', 'k1', 'p1']);
    const fold = out[0];
    expect(fold.type === 'runs' && fold.items.map((x) => x.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('leaves a day with fewer than 3 runs alone', () => {
    const items = [it_('r1', 'kudos_activity', '2026-10-11T10:00:00Z'), it_('r2', 'kudos_activity', '2026-10-11T09:00:00Z')];
    expect(foldRuns(items).every((e) => e.type === 'item')).toBe(true);
  });

  it('splits by the day in Israel, not UTC (23:30 Israel = 20:30Z belongs to that day)', () => {
    const items = [
      it_('a', 'kudos_activity', '2026-10-11T21:30:00Z'), // 00:30 on the 12th in Israel
      it_('b', 'kudos_activity', '2026-10-11T20:30:00Z'),
      it_('c', 'kudos_activity', '2026-10-11T19:00:00Z'),
      it_('d', 'kudos_activity', '2026-10-11T18:00:00Z'),
    ];
    const out = foldRuns(items);
    expect(out.map((e) => (e.type === 'item' ? e.item.id : e.key))).toEqual(['a', 'runs:2026-10-11']);
  });

  it('names: distinct first names, newest first', () => {
    expect(foldNames([it_('1', 'kudos_activity', 'x', 'Yair Gabbay'), it_('2', 'kudos_activity', 'x', 'Yair Gabbay'), it_('3', 'kudos_activity', 'x', 'Roy Roth')])).toEqual(['Yair', 'Roy']);
  });
});
