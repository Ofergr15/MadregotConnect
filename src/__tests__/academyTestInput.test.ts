import { describe, expect, it } from 'vitest';
import { checkTestInput, isCalendarDate, readAvgHr } from '@/lib/academy/test-input';

// POST /api/academy/tests' server-side check (lib/academy/test-input.ts): what used to reach the
// database as a 500, or be stored with a 200, now answers 400 with the field.

const TODAY = '2026-10-11';
const ok = { date: '2026-10-01', protocol: '30min', durationSec: 1800, distanceM: 7120, avgHr: 168 };

describe('isCalendarDate', () => {
  it('a day on the calendar, not just the shape of one', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-40')).toBe(false);
    expect(isCalendarDate('14/09/2026')).toBe(false);
  });
});

describe('readAvgHr', () => {
  it('blank is null; anything else is a number (NaN when it is not one)', () => {
    expect(readAvgHr(null)).toBeNull();
    expect(readAvgHr('')).toBeNull();
    expect(readAvgHr('168')).toBe(168);
    expect(readAvgHr('x')).toBeNaN();
  });
});

describe('checkTestInput', () => {
  it('a good test passes for both, with no warning', () => {
    expect(checkTestInput(ok, TODAY, { staff: false })).toEqual({ ok: true, implausible: false });
    expect(checkTestInput({ ...ok, avgHr: null }, TODAY, { staff: true })).toEqual({ ok: true, implausible: false });
  });
  it('today is allowed, tomorrow is not', () => {
    expect(checkTestInput({ ...ok, date: TODAY }, TODAY, { staff: false }).ok).toBe(true);
    expect(checkTestInput({ ...ok, date: '2026-10-12' }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'date' });
  });
  it('protocols: a trainee the card\'s two, staff every one the registry knows', () => {
    expect(checkTestInput({ ...ok, protocol: 'banana' }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'protocol' });
    expect(checkTestInput({ ...ok, protocol: '5000m', distanceM: 5000, durationSec: 1300 }, TODAY, { staff: false })).toMatchObject({ ok: false, field: 'protocol' });
    expect(checkTestInput({ ...ok, protocol: '5000m', distanceM: 5000, durationSec: 1300 }, TODAY, { staff: true }).ok).toBe(true);
  });
  it('avg HR inside migration 105\'s 80-230, or none', () => {
    expect(checkTestInput({ ...ok, avgHr: 79 }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'avgHr' });
    expect(checkTestInput({ ...ok, avgHr: 231 }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'avgHr' });
    expect(checkTestInput({ ...ok, avgHr: Number.NaN }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'avgHr' });
    expect(checkTestInput({ ...ok, avgHr: 230 }, TODAY, { staff: true }).ok).toBe(true);
  });
  it('both halves positive', () => {
    expect(checkTestInput({ ...ok, distanceM: 0 }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'distanceM' });
    expect(checkTestInput({ ...ok, durationSec: Number.NaN }, TODAY, { staff: true })).toMatchObject({ ok: false, field: 'durationSec' });
  });
  it('an implausible pace: refused from a trainee, a warning for staff', () => {
    expect(checkTestInput({ ...ok, distanceM: 70 }, TODAY, { staff: false })).toMatchObject({ ok: false, field: 'pace' });
    expect(checkTestInput({ ...ok, distanceM: 70 }, TODAY, { staff: true })).toEqual({ ok: true, implausible: true });
  });
});
