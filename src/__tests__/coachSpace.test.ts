import { describe, expect, it } from 'vitest';
import {
  askCount, dayPublish, filterCounts, kmByPack, matchesFilter, notRunThisWeek, packLabel, packOf, packSeries,
  runnerRows, todaySplit, waitingFeedback, watchCountsByDay, type CoachPerson, type FeedbackItem, type VolumeRow,
} from '@/lib/coach-space/model';
import { parseCoachSpaceOn, mayToggleCoachSpace, COACH_SPACE_KEY } from '@/lib/coach-space/switch';
import { coachSpaceBar, coachSpaceOpen } from '@/lib/coach-space/use-coach-space';
import { COACH_SPACE_ITEMS } from '@/lib/nav-items';

const person = (id: string, over: Partial<CoachPerson> = {}): CoachPerson => ({
  id, name: `Runner ${id}`, role: 'runner', groupName: 'SUB 2:30', status: 'active', approved: true,
  source: 'garmin', lastRunDay: null, lastSeenAt: null, ...over,
});
const vol = (athleteId: string, squad: string, series: number[], runs = 1): VolumeRow => ({
  athleteId, name: athleteId, squad, series, thisWeekKm: series.at(-1) ?? 0, thisWeekRuns: (series.at(-1) ?? 0) > 0 ? runs : 0, avgKm: 0, peakKm: Math.max(...series),
});

describe('coach space switch', () => {
  it('is off unless the row says exactly on', () => {
    expect(COACH_SPACE_KEY).toBe('coach_space_enabled');
    expect(parseCoachSpaceOn('on')).toBe(true);
    for (const v of [null, undefined, '', 'off', 'ON', 'true']) expect(parseCoachSpaceOn(v as string)).toBe(false);
  });
  it('only the admin and the super user may flip it', () => {
    expect(mayToggleCoachSpace({ isSuperUser: true })).toBe(true);
    expect(mayToggleCoachSpace({ isSuperUser: false, role: 'admin' })).toBe(true);
    expect(mayToggleCoachSpace({ isSuperUser: false, role: 'coach', roles: ['coach', 'admin'] })).toBe(true);
    expect(mayToggleCoachSpace({ isSuperUser: false, role: 'coach' })).toBe(false);
  });
});

describe('who gets the coach bar', () => {
  it('a coach, only while on', () => {
    expect(coachSpaceBar({ effectiveRole: 'coach', on: true, isSuper: false, preview: false })).toBe(true);
    expect(coachSpaceBar({ effectiveRole: 'coach', on: false, isSuper: false, preview: true })).toBe(false);
  });
  it('the super user previews it while off, as a coach', () => {
    expect(coachSpaceBar({ effectiveRole: 'coach', on: false, isSuper: true, preview: true })).toBe(true);
    expect(coachSpaceBar({ effectiveRole: 'coach', on: false, isSuper: true, preview: false })).toBe(false);
  });
  it('the admin bar never changes', () => {
    expect(coachSpaceBar({ effectiveRole: 'admin', on: true, isSuper: true, preview: true })).toBe(false);
    expect(coachSpaceBar({ effectiveRole: 'academy_coach', on: true, isSuper: false, preview: false })).toBe(false);
    expect(coachSpaceBar({ effectiveRole: 'runner', on: true, isSuper: false, preview: false })).toBe(false);
  });
  it('the screens open for staff while on, for the super user always', () => {
    expect(coachSpaceOpen({ isStaffView: true, on: false, isSuper: false })).toBe(false);
    expect(coachSpaceOpen({ isStaffView: true, on: true, isSuper: false })).toBe(true);
    expect(coachSpaceOpen({ isStaffView: false, on: false, isSuper: true })).toBe(true);
    expect(coachSpaceOpen({ isStaffView: false, on: true, isSuper: false })).toBe(false);
  });
  it('four tabs, in the mockup order', () => {
    expect(COACH_SPACE_ITEMS.map((i) => i.href)).toEqual(['/dashboard/coach/today', '/dashboard/coach/week', '/dashboard/coach/runners', '/dashboard/coach/insights']);
  });
});

describe('coach space model', () => {
  it('packs from the club group names', () => {
    expect(packOf('SUB 2:30')).toBe('A');
    expect(packOf('Group 2')).toBe('B');
    expect(packOf('SUB 2:45')).toBe('C');
    expect(packOf(null)).toBe(null);
    expect(packLabel('SUB 2:35')).toBe('B · 2:35');
  });
  it('splits today into ran / not yet, roster only', () => {
    const ps = [person('1', { lastRunDay: '2026-10-23' }), person('2', { lastRunDay: '2026-10-22' }), person('3', { approved: false }), person('4', { status: 'paused' })];
    const { ran, notYet } = todaySplit(ps, '2026-10-23');
    expect(ran.map((p) => p.id)).toEqual(['1']);
    expect(notYet.map((p) => p.id)).toEqual(['2']);
  });
  it('km by pack this week and the weekly series per pack', () => {
    const rows = [vol('a', 'SUB 2:30', [10, 20]), vol('b', 'SUB 2:30', [5, 15.4]), vol('c', 'SUB 2:45', [8, 0])];
    expect(kmByPack(rows)).toEqual([{ pack: 'A', km: 35, runners: 2 }]);
    expect(packSeries(rows, 2)).toEqual({ A: [15, 35.4], B: [0, 0], C: [8, 0] });
  });
  it('not run this week, with last week for context', () => {
    const out = notRunThisWeek([person('a'), person('c'), person('z')], [vol('a', 'SUB 2:30', [10, 20]), vol('c', 'SUB 2:45', [8, 0])]);
    expect(out.map((o) => [o.person.id, o.lastWeekKm])).toEqual([['c', 8], ['z', null]]);
  });
  it('runner rows, filters and counts', () => {
    const rows = runnerRows(
      [person('a'), person('b', { groupName: 'SUB 2:35', source: null }), person('c', { groupName: 'SUB 2:45' })],
      [vol('a', 'SUB 2:30', [10, 20]), vol('b', 'SUB 2:35', [12, 0])],
      new Set(['b']),
    );
    expect(rows.map((r) => r.person.id)).toEqual(['a', 'b', 'c']);
    expect(rows.filter((r) => matchesFilter(r, 'notRun')).map((r) => r.person.id)).toEqual(['b', 'c']);
    expect(filterCounts(rows)).toEqual({ all: 3, A: 1, B: 1, C: 1, notRun: 2, pain: 1, noWatch: 1 });
  });
  it('waiting feedback follows lib/feedback/waiting, oldest first', () => {
    const f = (id: string, over: Partial<FeedbackItem>): FeedbackItem => ({
      id, athleteId: 'x', name: 'X', createdAt: '2026-10-20T08:00:00Z', pain: false, wantsFeedback: false, comment: null, coachReplyAt: null, messages: [], ...over,
    });
    const items = [
      f('1', { wantsFeedback: true, createdAt: '2026-10-22T08:00:00Z' }),
      f('2', { comment: 'קשה', createdAt: '2026-10-21T08:00:00Z' }),
      f('3', { wantsFeedback: true, coachReplyAt: '2026-10-21T09:00:00Z' }),
      f('4', {}),
    ];
    expect(waitingFeedback(items).map((i) => i.id)).toEqual(['2', '1']);
    expect(askCount(items, 'x')).toBe(2);
  });
  it('watch counts by day and the day state', () => {
    expect(watchCountsByDay([{ days: ['ok', 'ok', 'none', 'none', 'none', 'none', 'none'] }, { days: ['ok', 'failed', 'none', 'none', 'none', 'none', 'none'] }]))
      .toEqual([2, 1, 0, 0, 0, 0, 0]);
    expect(dayPublish('pushed', [0, 1], 0, true, 2)).toBe('published');
    expect(dayPublish('draft', [0, 1], 2, true, 0)).toBe('draft');
    expect(dayPublish('draft', [0, 1], 6, false, 0)).toBe('rest');
    expect(dayPublish('none', [], 3, false, 0)).toBe('none');
  });
});
