import { describe, expect, it } from 'vitest';
import { boardWindow, packWeek } from '@/lib/packs/pack-week';

const e = (id: string, km: number, runs = 1) => ({ id, name: id, distanceKm: km, runs });

describe('packWeek', () => {
  it('sums the pack only, ranks with non-runners at the bottom, finds me', () => {
    const w = packWeek([e('a', 21), e('b', 14), e('me', 12.6), e('other-pack', 50)], ['a', 'b', 'me', 'z'], 'me');
    expect(w.km).toBe(47.6);
    expect(w.ran).toBe(3);
    expect(w.members).toBe(4);
    expect(w.myRank).toBe(3);
    expect(w.board[w.board.length - 1].id).toBe('z');
  });
  it('window: top 3, then the viewer with neighbours', () => {
    const board = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, rank: i + 1 }));
    const w = boardWindow(board, 'r7');
    expect(w.map((x) => (x === 'gap' ? 'gap' : x.id))).toEqual(['r0', 'r1', 'r2', 'gap', 'r6', 'r7', 'r8']);
  });
});
