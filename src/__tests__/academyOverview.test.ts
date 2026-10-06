import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { agoLabel, joinedInMonth, memberTrend, newJoiners, stageBars } from '@/lib/academy/overview';
import { diffLabel } from '@/components/academy/AcademyOverview';
import type { AcademyMember } from '@/lib/academy/members';
import type { FunnelBoard } from '@/lib/academy/funnel';

/**
 * The academy home screen. What must hold:
 *  - the growth line is built from join dates, oldest week first
 *  - "joined this month" and "new joiners" agree with the join dates
 *  - the first screen carries the charts and the four numbers, and the test
 *    improvement tile is gone from it
 */

const m = (name: string, academyJoinedOn: string | null) => ({ name, academyJoinedOn } as unknown as AcademyMember);
const members = [m('Old', null), m('A', '2026-07-01'), m('B', '2026-09-02'), m('C', '2026-09-29'), m('D', '2026-08-20')];

describe('the home screen numbers', () => {
  it('builds the growth line oldest first, counting members with no join date from the start', () => {
    const trend = memberTrend(members, '2026-09-27', 12);
    expect(trend).toHaveLength(12);
    expect(trend[trend.length - 1]).toBe(5);
    expect(trend[0]).toBe(2); // week ending 07-19: Old + A
    expect([...trend].sort((a, b) => a - b)).toEqual(trend);
  });

  it('counts joiners by calendar month', () => {
    expect(joinedInMonth(members, '2026-09-30')).toBe(2);
    expect(joinedInMonth(members, '2026-09-30', -1)).toBe(1);
    expect(joinedInMonth(members, '2026-01-15', -1)).toBe(0);
  });

  it('lists recent joiners newest first, and not the ones that joined long ago', () => {
    expect(newJoiners(members, '2026-09-30').map(j => [j.member.name, j.daysAgo])).toEqual([['C', 1], ['B', 28], ['D', 41]]);
  });

  it('says how long ago in words', () => {
    expect(agoLabel(0)).toBe('היום');
    expect(agoLabel(1)).toBe('אתמול');
    expect(agoLabel(5)).toBe('לפני 5 ימים');
    expect(agoLabel(21)).toBe('לפני 3 ש׳');
  });

  it('turns the joining board into one short-labelled bar per stage, flagging stuck ones', () => {
    const board = { columns: [
      { spec: { key: 'form' }, candidates: [{ stuck: false }, { stuck: true }] },
      { spec: { key: 'test' }, candidates: [] },
    ] } as unknown as FunnelBoard;
    expect(stageBars(board)).toEqual([
      { key: 'form', label: 'טופס', count: 2, stuck: true },
      { key: 'test', label: 'טסט', count: 0, stuck: false },
    ]);
  });

  it('labels a change against last week', () => {
    expect(diffLabel(2, '')).toEqual({ text: '▲ 2', tone: 'up' });
    expect(diffLabel(-4, '', '%')).toEqual({ text: '▼ 4%', tone: 'down' });
    expect(diffLabel(0, '')).toEqual({ text: 'ללא שינוי', tone: 'flat' });
  });
});

describe('the home screen layout', () => {
  const src = () => readFileSync('src/components/academy/AcademyOverview.tsx', 'utf8');

  // The one-screen home (2026-10-06): four numbers, the chart, the trainees, the
  // coaches row — and only then what the manager scrolls to.
  it('keeps the numbers, the chart and the trainees above the fold, in that order', () => {
    const s = src();
    const fold = s.indexOf('{/* Below the fold');
    const order = ['label="רצו השבוע"', 'label="בתוכנית"', '<AcademyTrendChart', '<TraineeRow', 'מאמנים</span>'];
    let last = -1;
    for (const part of order) {
      const at = s.indexOf(part);
      expect(at, part).toBeGreaterThan(last);
      expect(at, part).toBeLessThan(fold);
      last = at;
    }
  });

  it('has no test-improvement tile and calls the funnel "במשפך"', () => {
    const s = src();
    expect(s).not.toContain('שיפור בטסט');
    expect(s).not.toContain('בדרך פנימה');
    expect(s).not.toContain('ימים עד כניסה');
    expect(s).toContain('label="במשפך"');
  });
});
