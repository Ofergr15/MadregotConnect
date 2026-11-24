// Night queue #79: the club boards carry the runner's avatar (and pace group) so the native rows can draw a face.
import { describe, it, expect } from 'vitest';
import { weeklyBoard, monthlyChampions, type BoardPerson } from '@/lib/records/board';

const P = (id: string, name: string, avatarUrl: string | null, groupIndex: number | null): BoardPerson =>
  ({ id, name, avatarUrl, groupId: null, groupIndex });

describe('records boards: avatarUrl + groupIndex', () => {
  const people = [P('a', 'Avi', 'https://x/a.jpg', 1), P('b', 'Bea', null, 2)];
  it('weekly rows', () => {
    const totals = new Map([['a', { meters: 10000, seconds: 3000, runs: 2 }], ['b', { meters: 5000, seconds: 1600, runs: 1 }]]);
    const board = weeklyBoard(people, totals, 'b', 'km');
    expect(board.rows.map((r) => [r.athleteId, r.avatarUrl, r.groupIndex])).toEqual([['a', 'https://x/a.jpg', 1], ['b', null, 2]]);
  });
  it('champions', () => {
    const c = monthlyChampions({
      people, monthKm: new Map([['a', 120]]), prevMonthKm: new Map([['a', 60]]),
      weeksHit: new Map([['b', [true, true, true]]]), monthRecordBreaks: [{ athleteId: 'a', bucketKey: '10k', seconds: 2400, date: '2026-11-10' }],
    });
    expect(c.mostImproved).toMatchObject({ athleteId: 'a', avatarUrl: 'https://x/a.jpg', groupIndex: 1 });
    expect(c.streak).toMatchObject({ athleteId: 'b', avatarUrl: null, groupIndex: 2 });
    expect(c.newRecord).toMatchObject({ athleteId: 'a', avatarUrl: 'https://x/a.jpg' });
  });
  it('a missing avatar is null, never undefined (the native decoder reads null)', () => {
    const board = weeklyBoard([{ id: 'c', name: 'C', groupId: null, groupIndex: null }], new Map([['c', { meters: 1, seconds: 1, runs: 1 }]]), null, 'km');
    expect(board.rows[0].avatarUrl).toBeNull();
  });
});
