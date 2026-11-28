import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  israelToday, israelDateAnchor, israelNow, getActivityWeekStart, planWeekStartOf,
  addDaysToDateStr, shiftWeekStart, weekStartOn, SUNDAY_WEEK, MONDAY_WEEK,
} from '@/lib/utils';

/**
 * Israel DST 2026: starts Fri 2026-03-27 02:00 (UTC+2 -> +3), ends Sun 2026-10-25 02:00 (+3 -> +2).
 * The bug class: `new Date().toISOString().slice(0, 10)` answers the UTC date, which right after
 * Israel midnight is still yesterday. These pin the helpers the api routes now rely on.
 */
describe('date helpers at the Israel DST boundaries', () => {
  afterEach(() => vi.useRealTimers());

  it('autumn: 2026-10-24T22:30Z is already Sunday 2026-10-25 01:30 in Israel (IDT, +3)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T22:30:00Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-24'); // the old, wrong answer
    expect(israelToday()).toBe('2026-10-25');
    expect(israelNow()).toEqual({ weekday: 0, hour: 1, minute: 30 });
    expect(planWeekStartOf()).toBe('2026-10-25'); // Sunday starts a new plan week
    expect(getActivityWeekStart(israelDateAnchor())).toBe('2026-10-19'); // still Monday's week
    expect(weekStartOn(israelDateAnchor(), SUNDAY_WEEK)).toBe('2026-10-25');
  });

  it('autumn, after the switch: 2026-10-25T00:30Z is 02:30 IST (+2)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:30:00Z'));
    expect(israelToday()).toBe('2026-10-25');
    expect(israelNow()).toEqual({ weekday: 0, hour: 2, minute: 30 });
  });

  it('autumn, 22:30Z on the Sunday is 00:30 Monday IST — a new activity week', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T22:30:00Z'));
    expect(israelToday()).toBe('2026-10-26');
    expect(getActivityWeekStart(israelDateAnchor())).toBe('2026-10-26');
    expect(weekStartOn(israelDateAnchor(), MONDAY_WEEK)).toBe('2026-10-26');
  });

  it('spring: 2026-03-26T23:30Z is Friday 2026-03-27 01:30 in Israel (IST, +2)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-26T23:30:00Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-03-26');
    expect(israelToday()).toBe('2026-03-27');
    expect(israelNow()).toEqual({ weekday: 5, hour: 1, minute: 30 });
    expect(planWeekStartOf()).toBe('2026-03-22');
    expect(getActivityWeekStart(israelDateAnchor())).toBe('2026-03-23');
  });

  it('spring, after the switch: 2026-03-27T00:30Z is 03:30 IDT (+3)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-27T00:30:00Z'));
    expect(israelNow()).toEqual({ weekday: 5, hour: 3, minute: 30 });
  });

  it('day arithmetic across both switches moves the date, never the day count', () => {
    expect(addDaysToDateStr('2026-10-19', 6)).toBe('2026-10-25');
    expect(addDaysToDateStr('2026-10-25', 6)).toBe('2026-10-31');
    expect(addDaysToDateStr('2026-03-22', 6)).toBe('2026-03-28');
    expect(addDaysToDateStr('2026-03-29', -7)).toBe('2026-03-22');
    expect(shiftWeekStart('2026-11-01', -1)).toBe('2026-10-25');
    expect(shiftWeekStart('2026-03-29', -1)).toBe('2026-03-22');
  });
});

/** The replaced sites are pure refactors: each must give the old answer on every day of 2026. */
describe('refactor equivalence (my-watch, dashboard/weekly, dispatch, pack-stories, champions, records/weekly, plan matches, push-workouts)', () => {
  beforeEach(() => vi.useRealTimers());
  it('matches the old inline math for every date of 2026', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86400000) {
      const s = new Date(t).toISOString().slice(0, 10);
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
      expect(addDaysToDateStr(s, 6)).toBe(e.toISOString().split('T')[0]);
      const p = new Date(s); p.setUTCDate(p.getUTCDate() - 7);
      expect(shiftWeekStart(s, -1)).toBe(p.toISOString().split('T')[0]);
      // The local addDays copies: a noon-UTC anchor (pack-stories, champions, records/weekly,
      // push-workouts) and a midnight-UTC one (dispatch, plan matches).
      for (const n of [-30, -7, -3, -1, 0, 1, 3, 6, 7]) {
        const noon = new Date(`${s}T12:00:00Z`); noon.setUTCDate(noon.getUTCDate() + n);
        const midnight = new Date(`${s}T00:00:00Z`); midnight.setUTCDate(midnight.getUTCDate() + n);
        expect(addDaysToDateStr(s, n)).toBe(noon.toISOString().slice(0, 10));
        expect(addDaysToDateStr(s, n)).toBe(midnight.toISOString().slice(0, 10));
      }
      const next = new Date(`${s}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 7);
      expect(shiftWeekStart(s, 1)).toBe(next.toISOString().slice(0, 10));
    }
  });
});
