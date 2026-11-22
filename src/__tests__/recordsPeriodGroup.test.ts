import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { israelMonthRange, parseBoardGroup, parseBoardPeriod, rosterInGroup, sumPeriod } from '@/lib/records/period';
import { weeklyBoard, type BoardPerson } from '@/lib/records/board';

const person = (id: string, groupIndex: number | null, optOut = false): BoardPerson =>
  ({ id, name: id, groupId: null, groupIndex, optOut, hidesPace: false } as BoardPerson);

describe('records board — group + month', () => {
  it('month = Israel calendar month, end exclusive, days left counted', () => {
    // 2026-11-30 22:30 UTC is already 1 December in Israel.
    expect(israelMonthRange(new Date('2026-11-30T22:30:00Z'))).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01', end: '2026-12-31', daysLeft: 30 });
    expect(israelMonthRange(new Date('2026-02-10T10:00:00Z'))).toEqual({ start: '2026-02-01', endExclusive: '2026-03-01', end: '2026-02-28', daysLeft: 18 });
  });
  it('parses group 1-3 only, period week|month only', () => {
    expect(parseBoardGroup('2')).toBe(2);
    for (const bad of [null, '', '0', '4', 'x', '1.5']) expect(parseBoardGroup(bad)).toBeNull();
    expect(parseBoardPeriod('month')).toBe('month');
    expect(parseBoardPeriod('year')).toBe('week');
    expect(parseBoardPeriod(null)).toBe('week');
  });
  it('ranks within the group — not the club top 5 filtered down', () => {
    const roster = [person('a', 1), person('b', 1), person('c', 2), person('d', 2), person('e', 2)];
    const totals = new Map([['a', 50e3], ['b', 40e3], ['c', 30e3], ['d', 20e3], ['e', 10e3]].map(([id, m]) => [id as string, { meters: m as number, seconds: 1, runs: 1 }]));
    const b = weeklyBoard(rosterInGroup(roster, 2), totals, 'd', 'km');
    expect(b.rows.map((r) => [r.athleteId, r.rank])).toEqual([['c', 1], ['d', 2], ['e', 3]]);
    expect(rosterInGroup(roster, null)).toHaveLength(5);
  });
  it('an opted-out runner stays off a group board too', () => {
    const roster = [person('a', 1, true), person('b', 1)];
    const totals = new Map([['a', { meters: 9, seconds: 1, runs: 1 }], ['b', { meters: 1, seconds: 1, runs: 1 }]]);
    expect(weeklyBoard(rosterInGroup(roster, 1), totals, null, 'km').rows.map((r) => r.athleteId)).toEqual(['b']);
  });
  it('sums only qualifying runs inside [start, endExclusive) on the wall-clock start_time', () => {
    const rows = [
      { athlete_id: 'a', start_time: '2026-11-30T23:50:00+00:00', distance: 5000, duration: 1500, activity_type: 'running' },
      { athlete_id: 'a', start_time: '2026-12-01T06:00:00+00:00', distance: 8000, duration: 2400, activity_type: 'running' },
      { athlete_id: 'a', start_time: '2026-12-02T06:00:00+00:00', distance: 30000, duration: 3600, activity_type: 'cycling' },
      { athlete_id: 'a', start_time: '2027-01-01T00:10:00+00:00', distance: 1000, duration: 300, activity_type: 'running' },
    ];
    expect(sumPeriod(rows, ['a', 'b'], '2026-12-01', '2027-01-01')).toEqual(new Map([['a', { meters: 8000, seconds: 2400, runs: 1 }], ['b', { meters: 0, seconds: 0, runs: 0 }]]));
  });
  it('the route reads both params and keeps the records_tab gate', () => {
    const s = readFileSync(join(__dirname, '..', 'app', 'api', 'records', 'weekly', 'route.ts'), 'utf8');
    expect(s).toMatch(/recordsGate\(request\)/);
    expect(s).toMatch(/parseBoardGroup\(/);
    expect(s).toMatch(/parseBoardPeriod\(/);
  });
});
