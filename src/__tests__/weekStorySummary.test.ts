import { describe, expect, it } from 'vitest';
import { buildWeekSummary, lastClosedWindow, planWeekOfSummary, summaryWindow, type SummaryRun } from '@/lib/week-story/summary';

// 2026-11-23 is a Monday, 2026-11-29 the Sunday that closes its activity week.
const W = { weekStart: '2026-11-23', weekEnd: '2026-11-29' };

describe('summaryWindow — Sunday 19:00 through Monday, Monday–Sunday week', () => {
  it('opens on Sunday at 19:00 with the week closing that evening', () => {
    expect(summaryWindow('2026-11-29', 18)).toBeNull();
    expect(summaryWindow('2026-11-29', 19)).toEqual(W);
  });
  it('stays all Monday on the week that closed yesterday', () => {
    expect(summaryWindow('2026-11-30', 0)).toEqual(W);
    expect(summaryWindow('2026-11-30', 23)).toEqual(W);
  });
  it('is gone Tuesday to Sunday afternoon', () => {
    for (const d of ['2026-12-01', '2026-12-03', '2026-12-05']) expect(summaryWindow(d, 12)).toBeNull();
  });
  it('lastClosedWindow: the window when open, else the last Monday–Sunday already closed', () => {
    expect(lastClosedWindow('2026-11-29', 20)).toEqual(W);
    expect(lastClosedWindow('2026-12-02', 9)).toEqual(W);
    // Sunday before 19:00: this week has not closed yet.
    expect(lastClosedWindow('2026-12-06', 10)).toEqual(W);
  });
  it('reads the plan share against the plan week that contains the Monday', () => {
    expect(planWeekOfSummary(W)).toBe('2026-11-22');
  });
});

const run = (day: string, km: number, min = km * 5): SummaryRun => ({ day, km, seconds: min * 60 });

describe('buildWeekSummary', () => {
  const base = { window: W, plan: null, records: [], packRank: null };

  it('no run in the week → null (no card)', () => {
    expect(buildWeekSummary({ ...base, runs: [run('2026-11-22', 10)] })).toBeNull();
  });

  it('counts Monday–Sunday: the Sunday before is last week, the closing Sunday is this week', () => {
    const s = buildWeekSummary({ ...base, runs: [run('2026-11-22', 7), run('2026-11-23', 10), run('2026-11-29', 18.4)] })!;
    expect(s.numbers.km).toBe(28.4);
    expect(s.numbers.runs).toBe(2);
    expect(s.dayKm).toEqual([10, 0, 0, 0, 0, 0, 18.4]);
    expect(s.numbers.dayKm).toEqual([18.4, 10, 0, 0, 0, 0, 0]);   // the story's contract: Sunday first
    expect(s.numbers.lastWeekKm).toBe(7);
    expect(s.lastWeekRuns).toBe(1);
  });

  it('plan share and sessions come from the plan week; missed days pass through', () => {
    const s = buildWeekSummary({
      ...base,
      runs: [run('2026-11-24', 12)],
      plan: { plannedKm: 60, km: 50, sessionsPlanned: 5, sessionsDone: 4, missed: [{ dayOfWeek: 3, plannedKm: 12 }] },
    })!;
    expect(s.numbers.planShare).toBeCloseTo(50 / 60);
    expect(s.numbers.sessionsDone).toBe(4);
    expect(s.numbers.sessionsPlanned).toBe(5);
    expect(s.missed).toEqual([{ dayOfWeek: 3, plannedKm: 12 }]);
  });

  it('no plan → no share, no sessions, no missed days', () => {
    const s = buildWeekSummary({ ...base, runs: [run('2026-11-24', 12)], plan: { plannedKm: 0, km: 12, sessionsPlanned: 0, sessionsDone: 0, missed: [{ dayOfWeek: 1, plannedKm: 0 }] } })!;
    expect(s.numbers.planShare).toBeNull();
    expect(s.numbers.sessionsPlanned).toBeNull();
    expect(s.missed).toEqual([]);
  });

  it('highlight follows the story rules: a record first', () => {
    const s = buildWeekSummary({ ...base, runs: [run('2026-11-24', 12)], records: [{ label: '10K', seconds: 2512, previous: null }] })!;
    expect(s.highlight.kind).toBe('record');
  });

  it('highlight: up from last week by 3 km or more', () => {
    const s = buildWeekSummary({ ...base, runs: [run('2026-11-02', 30), run('2026-11-17', 5), run('2026-11-24', 12)] })!;
    expect(s.highlight.kind).toBe('up');
  });

  it('biggest in eight weeks needs to beat every one of them', () => {
    const starts = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28'];
    const history = starts.map((d) => run(d, 20));
    expect(buildWeekSummary({ ...base, runs: [...history, run('2026-11-24', 21)] })!.highlight.kind).toBe('bigWeek');
    expect(buildWeekSummary({ ...base, runs: [...history, run('2026-11-24', 19)] })!.highlight.kind).not.toBe('bigWeek');
  });

  it('pace is the week average in seconds per km', () => {
    expect(buildWeekSummary({ ...base, runs: [run('2026-11-24', 10, 50)] })!.paceSeconds).toBe(300);
  });
});
