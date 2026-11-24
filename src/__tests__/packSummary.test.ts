import { describe, expect, it } from 'vitest';
import { summariseWeek } from '@/lib/packs/summary';
import { isSummaryTick } from '@/lib/packs/week-summary-server';

/** b23 pack chat digest: deterministic counts, pain/logistics keywords, unanswered questions. */
describe('summariseWeek', () => {
  const W = '2026-11-15'; // Sunday
  const m = (id: string, userId: string, text: string, createdAt: string) => ({ id, userId, text, createdAt });
  const s = summariseWeek(W, [
    m('1', 'a', 'כואב לי השוק מאתמול', '2026-11-15T06:00:00Z'),
    m('2', 'b', 'איפה נפגשים מחר?', '2026-11-16T15:00:00Z'),
    m('3', 'c', 'בפארק, 05:30', '2026-11-16T15:10:00Z'),
    m('4', 'b', 'מישהו יודע את הקצב לשישי?', '2026-11-19T18:00:00Z'),
    m('5', 'a', 'מחר יש חניה ליד הפארק', '2026-11-20T18:00:00Z'),
    m('6', 'a', 'out of week', '2026-11-22T08:00:00Z'),
  ]);
  it('counts messages per Israel day, Sunday first', () => expect(s.msgByDay).toEqual([1, 2, 0, 0, 1, 1, 0]));
  it('finds pain, unanswered questions and logistics', () => {
    expect(s.items.map((i) => [i.kind, i.messageId])).toEqual([['pain', '1'], ['logistics', '2'], ['question', '4'], ['logistics', '5']]);
  });
  it('fires only Sunday 07:00', () => {
    expect(isSummaryTick(0, 7)).toBe(true);
    expect(isSummaryTick(0, 8)).toBe(false);
    expect(isSummaryTick(1, 7)).toBe(false);
  });
});
