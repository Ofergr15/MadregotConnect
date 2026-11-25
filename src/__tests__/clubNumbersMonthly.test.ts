import { describe, expect, it } from 'vitest';
import { addMonths, computeMonthlySeries, monthsOf, parseWindow, type MAthlete, type MInput, type MRun } from '@/lib/club-numbers/monthly';

const today = '2026-11-24';
const ath = (id: string, over: Partial<MAthlete> = {}): MAthlete => ({ id, name: `Runner ${id}`, role: 'runner', status: 'active', createdAt: '2026-01-10T00:00:00Z', removedAt: null, ...over });
const run = (athleteId: string, date: string, km: number, over: Partial<MRun> = {}, hour = 6): MRun => ({ athleteId, start: `${date}T${String(hour).padStart(2, '0')}:00:00+00:00`, meters: km * 1000, seconds: km * 300, type: 'running', ...over });
const input = (over: Partial<MInput>): MInput => ({ today, window: '3m', athletes: [], runs: [], kudos: [], comments: [], pain: [], ...over });

describe('windows', () => {
  it('parses only the four windows', () => {
    expect(parseWindow('12m')).toBe('12m');
    expect(parseWindow('6m')).toBeNull();
    expect(parseWindow(null)).toBeNull();
  });
  it('lays the months out', () => {
    expect(monthsOf('3m', today)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(monthsOf('12m', today)).toHaveLength(12);
    expect(monthsOf('12m', today)[0]).toBe('2025-12');
    expect(monthsOf('ytd', today)).toHaveLength(11);
    expect(monthsOf('all', today, '2025-06-03')[0]).toBe('2025-06');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
  });
});

describe('computeMonthlySeries', () => {
  const runs: MRun[] = [];
  for (let d = 1; d <= 9; d++) runs.push(run('a', `2026-11-${String(d).padStart(2, '0')}`, 10)); // a: 9 runs in Nov
  runs.push(run('b', '2026-11-03', 22), run('b', '2026-11-04', 10, { type: 'treadmill_running', seconds: 100 }));
  runs.push(run('b', '2026-11-05', 30, { type: 'cycling' })); // not running
  runs.push(run('admin', '2026-11-05', 10));
  const out = computeMonthlySeries(input({
    athletes: [ath('a'), ath('b'), ath('idle'), ath('admin', { role: 'admin' }), ath('gone', { status: 'removed', removedAt: '2026-10-15T00:00:00Z' }), ath('new', { createdAt: '2026-11-02T00:00:00Z' })],
    runs,
    kudos: [{ athleteId: 'a', createdAt: '2026-11-02T00:00:00Z' }, { athleteId: 'b', createdAt: '2026-11-02T00:00:00Z' }, { athleteId: 'a', createdAt: '2026-11-03T00:00:00Z' }],
    comments: [{ athleteId: 'a', createdAt: '2026-11-02T00:00:00Z' }],
    pain: [{ athleteId: 'b', createdAt: '2026-11-04T00:00:00Z' }, { athleteId: 'b', createdAt: '2026-11-10T00:00:00Z' }],
  }));
  const nov = out.series.at(-1)!;
  const oct = out.series.find((s) => s.month === '2026-10')!;

  it('counts running types only, without the admin', () => {
    expect(nov.runs).toBe(11);
    expect(nov.km).toBe(90 + 22 + 10);
    expect(nov.ran1).toBe(2);
    expect(nov.ran8).toBe(1);
  });
  it('divides km by the runners who ran, not by every account', () => {
    expect(nov.kmPerRunner).toBe(61);
    expect(nov.kudosPerRunner).toBe(1.5);
    expect(nov.commentsPerRunner).toBe(0.5);
  });
  it('counts 20 km+ runs and takes the median pace off the treadmill', () => {
    expect(nov.long20).toBe(1);
    expect(nov.medianPace).toBe(5);
  });
  it('tracks joined / left / retention with removed_at', () => {
    expect(out.removedAtTracked).toBe(true);
    expect(nov.activeMembers).toBe(4); // a, b, idle, new
    expect(nov.joined).toBe(1);
    expect(oct.left).toBe(1);
    expect(oct.activeMembers).toBe(4); // gone still counted in the month they left
    expect(oct.retention).toBe(0.75);
    expect(nov.retention).toBe(1);
  });
  it('falls back to status when removed_at is not there', () => {
    const fb = computeMonthlySeries(input({ athletes: [ath('a', { removedAt: undefined }), ath('gone', { status: 'removed', removedAt: undefined })], runs }));
    expect(fb.removedAtTracked).toBe(false);
    expect(fb.series.at(-1)!.activeMembers).toBe(1);
    expect(fb.series.at(-1)!.left).toBeNull();
    expect(fb.series.at(-1)!.retention).toBeNull();
  });
  it('fills the weekday × hour heat table and the weekday counts', () => {
    expect(out.heat).toHaveLength(7);
    expect(out.heat[0]).toHaveLength(24);
    expect(out.heat.flat().reduce((s, n) => s + n, 0)).toBe(11);
    expect(nov.weekdays.reduce((s, n) => s + n, 0)).toBe(11);
    expect(out.heat[0][6]).toBe(2); // Sundays Nov 1 and Nov 8, 06:00
  });
  it('gives pain as counts only — no names or ids', () => {
    expect(nov.pain).toEqual({ reports: 2, runners: 1 });
    const s = JSON.stringify(out); expect(s).not.toMatch(/Runner [ab]|"b"/);
  });
});

describe('Israel-month bucketing of real timestamps (Q25-8)', () => {
  // 00:30 Israel on 1 Nov 2026 (UTC+2) = 22:30 UTC on 31 Oct.
  const out = computeMonthlySeries(input({
    athletes: [
      ath('early', { createdAt: '2026-10-31T22:30:00Z' }),
      ath('left', { status: 'removed', removedAt: '2026-10-31T22:30:00Z' }),
    ],
  }));
  const nov = out.series.find((s) => s.month === '2026-11')!;
  const oct = out.series.find((s) => s.month === '2026-10')!;
  it('a join at 00:30 Israel on the 1st counts in the new month', () => {
    expect(nov.joined).toBe(1);
    expect(oct.joined).toBe(0);
  });
  it('a removal at 00:30 Israel on the 1st counts in the new month', () => {
    expect(nov.left).toBe(1);
    expect(oct.left).toBe(0);
  });
});
