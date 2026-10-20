import { describe, expect, it } from 'vitest';
import { board, distanceOf, fmtRaceTime, packNumber, parseRaceTime, placeOf, type ResultRow } from '@/lib/champions/table';

const r = (id: string, athleteId: string, seconds: number, o: Partial<ResultRow> = {}): ResultRow => ({
  id, athleteId, name: athleteId, avatarUrl: null, gender: 'male', pack: 1, distance: 'half', seconds, raceName: 'x', raceDate: '2026-03-01', ...o,
});
const T = '2026-10-20';

describe('אלופי המדרגות', () => {
  it('packs are numbers', () => {
    expect(packNumber('Group A - SUB 2:30')).toBe(1);
    expect(packNumber('Group C - SUB 2:45')).toBe(3);
    expect(packNumber(null)).toBe(null);
  });
  it('each person once, by their best; fastest first', () => {
    const b = board([r('1', 'a', 4300), r('2', 'a', 4200), r('3', 'b', 4250)], { distance: 'half', sex: 'all', scope: 'all', today: T });
    expect(b.top.map((x) => [x.athleteId, x.seconds, x.rank])).toEqual([['a', 4200, 1], ['b', 4250, 2]]);
  });
  it('men, women, together; this year vs all time', () => {
    const rows = [r('1', 'a', 4200), r('2', 'w', 4100, { gender: 'female' }), r('3', 'old', 4000, { raceDate: '2024-04-01' })];
    expect(board(rows, { distance: 'half', sex: 'men', scope: 'all', today: T }).top.map((x) => x.athleteId)).toEqual(['old', 'a']);
    expect(board(rows, { distance: 'half', sex: 'women', scope: 'all', today: T }).top.map((x) => x.athleteId)).toEqual(['w']);
    expect(board(rows, { distance: 'half', sex: 'all', scope: 'year', today: T }).top.map((x) => x.athleteId)).toEqual(['w', 'a']);
  });
  it('top 10, the reader\'s own place even outside it, and "new"', () => {
    const rows = Array.from({ length: 12 }, (_, i) => r(String(i), `p${i}`, 4000 + i, { raceDate: i === 0 ? '2026-10-10' : '2026-01-01' }));
    const b = board(rows, { distance: 'half', sex: 'all', scope: 'all', today: T, viewerId: 'p11' });
    expect(b.top).toHaveLength(10);
    expect(b.me?.rank).toBe(12);
    expect(b.top[0].isNew).toBe(true);
    expect(b.top[1].isNew).toBe(false);
  });
  it('where a new result lands', () => {
    const rows = [r('1', 'a', 4200), r('2', 'b', 4300)];
    expect(placeOf(rows, r('n', 'c', 4250), T)).toBe(2);
  });
  it('times and distances', () => {
    expect(fmtRaceTime(4198)).toBe('1:09:58');
    expect(fmtRaceTime(1002)).toBe('16:42');
    expect(parseRaceTime('1:15:22')).toBe(4522);
    expect(parseRaceTime('16:42')).toBe(1002);
    expect(parseRaceTime('abc')).toBe(null);
    expect(distanceOf(5046)).toBe('5k');
    expect(distanceOf(5505)).toBe(null);
    expect(distanceOf(21180)).toBe('half');
  });
});
