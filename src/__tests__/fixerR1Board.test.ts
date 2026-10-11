import { describe, expect, it } from 'vitest';
import { boardRow, monthDays, monthSummary, rowExcuse } from '@/lib/academy/board';
import { weekTotals } from '@/lib/academy/compliance';
import { assessWeek, buildPlannedWorkout } from '@/lib/academy/adherence';
import { areTwins, twinIds, withoutTwins } from '@/lib/academy/twins';

// Round-1 fixer: the board's issues 1, 13, 14, 16, 25.

const TODAY = '2026-10-13';
const row = (date: string, completed = false, km = 8) => ({
  date, completed,
  distance: { plannedMin: km * 1000, plannedMax: km * 1000, actual: completed ? km * 1000 : null },
  duration: { planned: km * 330, actual: completed ? km * 330 : null, estimated: true },
});

describe('excused sessions are never "לא בוצע"', () => {
  it('a day before joining is uncoloured; an optional session is grey; days after the watch stopped are grey', () => {
    expect(boardRow(row('2026-10-07'), TODAY, null, { joinedOn: '2026-10-10' })).toMatchObject({ excuse: 'beforeJoin', compliance: { color: 'grey' } });
    expect(boardRow(row('2026-10-07'), TODAY, null, { optional: true })).toMatchObject({ excuse: 'optional', compliance: { color: 'grey' } });
    expect(boardRow(row('2026-10-07'), TODAY, null, { feedLostOn: '2026-10-03' })).toMatchObject({ excuse: 'noData', compliance: { color: 'grey' } });
    // Before the watch stopped, a missed session is still missed.
    expect(boardRow(row('2026-10-01'), TODAY, null, { feedLostOn: '2026-10-03' }).compliance.color).toBe('red');
    // A run optional session is graded and still labelled optional.
    expect(boardRow(row('2026-10-07', true), TODAY, null, { optional: true })).toMatchObject({ excuse: 'optional', compliance: { color: 'green' } });
    expect(rowExcuse('2026-10-12', TODAY, false, {})).toBeUndefined();
  });

  it('the month leaves days before joining uncoloured and does not count them as missed (issue 16)', () => {
    const sessions = ['2026-10-02', '2026-10-04', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-11'].map(d => {
      const g = boardRow(row(d, d === '2026-10-11'), TODAY, null, { joinedOn: '2026-10-10' });
      return { date: d, color: g.compliance.color, actualM: g.actualM, excuse: g.excuse };
    });
    const days = monthDays({ month: '2026-10', today: TODAY, sessions });
    expect(days.find(d => d.date === '2026-10-07')!.color).toBeNull();
    expect(monthSummary(days)).toMatchObject({ missed: 0, done: 1, planned: 1 });
  });
});

describe('week totals (issues 13, 25)', () => {
  it('an optional session is neither planned km nor a planned session; an unplanned run is done km only', () => {
    const t = weekTotals([
      { completed: true, plannedM: 10000, actualM: 10000, plannedSec: 3000, actualSec: 3000 },
      { completed: false, plannedM: 5000, actualM: null, plannedSec: 1500, actualSec: null, notPlanned: true },
      { completed: true, plannedM: null, actualM: 12900, plannedSec: null, actualSec: 4000, notPlanned: true },
    ]);
    expect(t).toMatchObject({ plannedCount: 1, doneCount: 1, plannedKm: 10, doneKm: 22.9, plannedSec: 3000, doneSec: 7000 });
  });

  it('assessWeek does not count an optional session as planned, and hands back the runs no session claimed', () => {
    const steps = [{ order: 1, type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 330 }] as any;
    const planned = [
      buildPlannedWorkout({ dayOfWeek: 0, name: 'קל', steps } as any, '2026-10-11'),
      buildPlannedWorkout({ dayOfWeek: 3, name: 'ערב - אופציה', optional: true, steps } as any, '2026-10-14'),
    ];
    const act = (id: string, date: string) => ({ id, date, distance: 8000, duration: 2640, movingDuration: 2640, averagePace: 330, activityType: 'running' });
    const week = assessWeek(planned, [act('a', '2026-10-11'), act('b', '2026-10-12')]);
    expect(week.plannedCount).toBe(1);
    expect(week.completedCount).toBe(1);
    expect(week.unmatched?.map(a => a.id)).toEqual(['b']);
  });
});

describe('a run recorded twice is one run (issue 14)', () => {
  const g = { id: 'g', start_time: '2026-10-12T06:30:00', distance: 8800, duration: 2798, source: 'garmin' };
  const s = { id: 's', start_time: '2026-10-12T06:34:00', distance: 8800, duration: 2798, source: 'strava' };
  it('the Strava copy of a Garmin run is dropped, the Garmin one kept', () => {
    expect(areTwins(g, s)).toBe(true);
    expect([...twinIds([s, g])]).toEqual(['s']);
    expect(withoutTwins([g, s]).map(a => a.id)).toEqual(['g']);
  });
  it('reps logged as separate activities a few minutes apart are not twins', () => {
    const rep = (id: string, min: number) => ({ id, start_time: `2026-10-12T06:${String(min).padStart(2, '0')}:00`, distance: 2000, duration: 430, source: 'garmin' });
    expect(twinIds([rep('1', 0), rep('2', 9), rep('3', 18)]).size).toBe(0);
  });
  it('two runs the same morning, 40 minutes apart, are two runs', () => {
    expect(areTwins(g, { ...s, start_time: '2026-10-12T07:40:00' })).toBe(false);
  });
});
