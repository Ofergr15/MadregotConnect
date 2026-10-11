import { describe, expect, it } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import { plannedWeeksFor } from '@/lib/academy/pmc';
import { buildLoadPayload } from '@/lib/academy/load-payload';
import type { LoadRow } from '@/lib/academy/pmc';

/** GET /api/academy/load's answer, built from rows: the shape the screens draw. */

const TODAY = '2026-10-13';
const TESTS = [{ date: '2026-07-10', thresholdSec: 261 }, { date: '2026-09-16', thresholdSec: 252 }];

/** 120 days of a run every other day at 60, plus today's. */
function steady(days = 120): LoadRow[] {
  const rows: LoadRow[] = [];
  for (let i = days; i >= 0; i -= 2) rows.push({ date: shiftDate(TODAY, -i), load: 60, source: 'pace' });
  return rows;
}

describe('buildLoadPayload', () => {
  it('ok: today\'s four numbers with their words, the threshold valid today', () => {
    const p = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '6w' });
    expect(p.status).toEqual({ kind: 'ok' });
    expect(p.today).toMatchObject({ band: expect.any(String), rampWord: expect.any(String) });
    expect(Number.isInteger(p.today!.fitness)).toBe(true);
    expect(Math.abs(p.today!.form - (p.today!.fitness - p.today!.fatigue))).toBeLessThanOrEqual(1);
    expect(p).toMatchObject({ thresholdSec: 252, basisTestDate: '2026-09-16', firstLoadDate: shiftDate(TODAY, -120) });
  });

  it('6w is daily, oldest first, ending yesterday; 3m every 3 days', () => {
    const six = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '6w' }).series;
    expect(six).toHaveLength(43);
    expect(six[six.length - 1].date).toBe('2026-10-12');
    expect(six[0].date < six[1].date).toBe(true);
    const three = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '3m' }).series;
    expect(three[three.length - 1].date).toBe('2026-10-12');
    expect(three[1].date).toBe(shiftDate(three[0].date, 3));
  });

  it('race: from 16 weeks before the race (or the first run); no race → 3m', () => {
    const p = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: 'race', raceDate: '2026-12-06' });
    expect(p.range).toBe('race');
    expect(p.series[0].date >= shiftDate('2026-12-06', -112)).toBe(true);
    expect(buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: 'race', raceDate: null }).range).toBe('3m');
  });

  it('8 Sunday weeks, this week with its planned load', () => {
    const p = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '6w', plannedByWeek: { '2026-10-11': 313.4 } });
    expect(p.weekly).toHaveLength(8);
    expect(p.weekly[7]).toMatchObject({ weekStart: '2026-10-11', planned: 313 });
    expect(p.weekly.slice(0, 7).every(w => w.planned === null)).toBe(true);
  });

  it('"שבוע קל" only for a week the coach planned easy — this week included, and the ramp word follows', () => {
    const weeks = plannedWeeksFor(TODAY);
    const full = Object.fromEntries(weeks.map(w => [w, 400]));
    const under = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '6w', plannedByWeek: full });
    expect(under.weekly.some(w => w.easy)).toBe(false);
    const easy = buildLoadPayload({ rows: steady(), tests: TESTS, today: TODAY, range: '6w', plannedByWeek: { ...full, '2026-10-11': 200 } });
    expect(easy.weekly[7]).toMatchObject({ planned: 200, easy: true });
    if (easy.today && easy.today.ramp <= -1) expect(easy.today.rampWord).toBe('easyWeek');
  });

  it('learning: no numbers (never a 0), and no bars before the first run', () => {
    const rows = steady(19);
    const p = buildLoadPayload({ rows, tests: [], today: TODAY, range: '6w' });
    expect(p.status).toEqual({ kind: 'learning', daysLeft: 23, daysSeen: 19 });
    expect(p.today).toBeNull();
    expect(p.weekly.length).toBeLessThan(8);
    expect(p.weekly[0].weekStart <= shiftDate(TODAY, -19)).toBe(true);
    expect(p.thresholdSec).toBeNull();
  });

  it('nothing at all: learning, empty series, no bars', () => {
    const p = buildLoadPayload({ rows: [], tests: [], today: TODAY, range: '6w' });
    expect(p).toMatchObject({ status: { kind: 'learning', daysLeft: 42 }, today: null, series: [], weekly: [], firstLoadDate: null });
  });
});
