import { describe, expect, it } from 'vitest';
import {
  boardRow, dayColor, kmLabel, leadingDays, monthDates, monthDays, monthSummary, offLineOf, restDaysOf, shiftMonth,
  summaryParts, type BoardRowInput,
} from '@/lib/academy/board';
import type { ComplianceColor } from '@/lib/academy/compliance';

/**
 * The trainee's board (trainee-experience-v2 screens 2/3): one grading for the week's rows
 * and the month's days, the "▼ 6.2 ק״מ במקום 8" line, the rest days, and the month line
 * that must count exactly what the grid draws.
 */

const TODAY = '2026-10-13';
const row = (o: Partial<BoardRowInput> & { plannedM?: number; actualM?: number | null }): BoardRowInput => ({
  date: o.date ?? '2026-10-12',
  completed: o.completed ?? true,
  distance: o.distance ?? { plannedMin: o.plannedM ?? 8000, plannedMax: o.plannedM ?? 8000, actual: o.actualM === undefined ? 8000 : o.actualM },
  duration: o.duration ?? { planned: 2700, actual: 2700, estimated: true },
});

describe('boardRow — one session, graded as the strip grades it', () => {
  it('a run on plan is green; one cut to 6.2 of 8 km is yellow ▼', () => {
    expect(boardRow(row({ actualM: 8100 }), TODAY).compliance).toMatchObject({ color: 'green', measure: 'distance' });
    const short = boardRow(row({ actualM: 6200 }), TODAY);
    expect(short.compliance).toMatchObject({ color: 'yellow', caret: 'down' });
    expect(short).toMatchObject({ plannedM: 8000, actualM: 6200, plannedSec: 2700 });
  });

  it('not run: red once the day has passed, grey today and after', () => {
    expect(boardRow(row({ completed: false, actualM: null }), TODAY).compliance.color).toBe('red');
    expect(boardRow(row({ date: TODAY, completed: false, actualM: null }), TODAY).compliance.color).toBe('grey');
    expect(boardRow(row({ date: '2026-10-15', completed: false, actualM: null }), TODAY).compliance.color).toBe('grey');
  });

  it('a session planned in minutes (no distance) is judged on time', () => {
    const r = boardRow(row({
      distance: { plannedMin: 0, plannedMax: 0, actual: 9000 },
      duration: { planned: 3600, actual: 2400, estimated: false },
    }), TODAY);
    expect(r.compliance).toMatchObject({ color: 'yellow', measure: 'time', caret: 'down' });
    expect(offLineOf(r)).toEqual({ caret: 'down', unit: 'min', actual: '40', planned: '60' });
  });
});

describe('offLineOf — "▼ 6.2 ק״מ במקום 8"', () => {
  it('carries the caret and the two numbers as the row prints them', () => {
    expect(offLineOf(boardRow(row({ actualM: 6200 }), TODAY))).toEqual({ caret: 'down', unit: 'km', actual: '6.2', planned: '8' });
    expect(offLineOf(boardRow(row({ actualM: 13000 }), TODAY))).toEqual({ caret: 'up', unit: 'km', actual: '13', planned: '8' });
  });

  it('is null on green, missed and planned', () => {
    expect(offLineOf(boardRow(row({ actualM: 8000 }), TODAY))).toBeNull();
    expect(offLineOf(boardRow(row({ completed: false, actualM: null }), TODAY))).toBeNull();
    expect(offLineOf(boardRow(row({ date: '2026-10-15', completed: false, actualM: null }), TODAY))).toBeNull();
  });

  it('kmLabel drops a trailing .0', () => {
    expect(kmLabel(8000)).toBe('8');
    expect(kmLabel(6230)).toBe('6.2');
    expect(kmLabel(10050)).toBe('10.1');
  });
});

describe('restDaysOf — the thin rows', () => {
  it('the days of the week with nothing planned, Sunday first', () => {
    const planned = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-15', '2026-10-17'];
    expect(restDaysOf('2026-10-11', planned)).toEqual([{ date: '2026-10-14', rest: true }, { date: '2026-10-16', rest: true }]);
  });
  it('a week with no plan at all has no rest days (it has no week)', () => {
    expect(restDaysOf('2026-10-11', [])).toEqual([]);
  });
});

describe('dayColor — one day, one colour', () => {
  it('a day is graded by what was run, the worst of it', () => {
    expect(dayColor(['green'])).toBe('green');
    expect(dayColor(['green', 'yellow'])).toBe('yellow');
    expect(dayColor(['red', 'green'])).toBe('green');
    expect(dayColor(['orange', 'yellow'])).toBe('orange');
  });
  it('nothing run: missed once passed, planned before', () => {
    expect(dayColor(['red'])).toBe('red');
    expect(dayColor(['grey'])).toBe('grey');
    expect(dayColor([])).toBeNull();
  });
});

describe('the month grid', () => {
  it('October 2026 starts on a Thursday: four days of September lead the first row', () => {
    expect(leadingDays('2026-10')).toBe(4);
    expect(monthDates('2026-10')).toHaveLength(31);
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(leadingDays('2026-11')).toBe(0);
  });

  it('shiftMonth crosses years', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  // The mockup's October (screen 3): 1,3,4,5,8,10,11 on plan · 6,12 a bit off · 2 missed ·
  // 13 today · the rest of the month planned. 127 km run.
  const MOCK: Record<number, ComplianceColor> = {
    1: 'green', 2: 'red', 3: 'green', 4: 'green', 5: 'green', 6: 'yellow', 8: 'green', 10: 'green', 11: 'green', 12: 'yellow',
    13: 'grey', 15: 'grey', 17: 'grey', 18: 'grey', 20: 'grey', 22: 'grey', 24: 'grey', 25: 'grey', 27: 'grey', 29: 'grey', 31: 'grey',
  };
  const KM: Record<number, number> = { 1: 15.2, 3: 16, 4: 10.2, 5: 8, 6: 13.4, 8: 15.8, 10: 32.1, 11: 10.1, 12: 6.2 };
  const date = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
  const sessions = Object.entries(MOCK).map(([d, color]) => ({
    date: date(Number(d)), color, actualM: KM[Number(d)] != null ? KM[Number(d)] * 1000 : null,
  }));
  // A September session that leaks into the month query must not be drawn or counted.
  const days = monthDays({ month: '2026-10', today: date(13), sessions: [...sessions, { date: '2026-09-30', color: 'green', actualM: 9000 }], raceDate: '2026-12-06' });

  it('draws each day once, today outlined, the race only on its day', () => {
    expect(days).toHaveLength(31);
    expect(days.map(d => d.color)).toEqual(Array.from({ length: 31 }, (_, i) => MOCK[i + 1] ?? null));
    expect(days.filter(d => d.today).map(d => d.date)).toEqual([date(13)]);
    expect(days.some(d => d.race)).toBe(false);
    const withRace = monthDays({ month: '2026-12', today: date(13), sessions: [], raceDate: '2026-12-06' });
    expect(withRace.filter(d => d.race).map(d => d.date)).toEqual(['2026-12-06']);
  });

  it('the summary counts exactly what the grid shows: 9 of 10, 127 km, 7 · 2 · 1', () => {
    const s = monthSummary(days);
    expect(s).toEqual({ done: 9, planned: 10, km: 127, onPlan: 7, bitOff: 2, farOff: 0, missed: 1 });
    // …and re-counting the drawn colours gives the same numbers.
    const drawn = days.map(d => d.color);
    expect(drawn.filter(c => c === 'green').length).toBe(s.onPlan);
    expect(drawn.filter(c => c === 'yellow').length).toBe(s.bitOff);
    expect(drawn.filter(c => c === 'red').length).toBe(s.missed);
    expect(drawn.filter(c => c && c !== 'grey').length).toBe(s.planned);
  });

  it('the sentence names only the parts that are not zero, in order', () => {
    expect(summaryParts(monthSummary(days))).toEqual([
      { key: 'onPlan', n: 7 }, { key: 'bitOff', n: 2 }, { key: 'missed', n: 1 },
    ]);
    expect(summaryParts({ done: 0, planned: 0, km: 0, onPlan: 0, bitOff: 0, farOff: 0, missed: 0 })).toEqual([]);
  });

  it('a double day counts once, by its colour', () => {
    const d = monthDays({
      month: '2026-10', today: date(13),
      sessions: [{ date: date(5), color: 'green', actualM: 10000 }, { date: date(5), color: 'red', actualM: null }],
    });
    expect(d[4].color).toBe('green');
    expect(monthSummary(d)).toMatchObject({ done: 1, planned: 1, km: 10, missed: 0 });
  });
});
