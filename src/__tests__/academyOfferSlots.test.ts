import { describe, expect, it } from 'vitest';
import {
  COMMON_HOURS,
  MAX_OFFERED_SLOTS,
  buildOffer,
  dayOptions,
  israelInstant,
  offerSummary,
} from '@/lib/academy/offerSlots';

// The DST cases are the reason this module exists: everything else in the invitation slice
// hardcodes `+03:00`, which is an hour wrong from late October to late March.

describe('israelInstant', () => {
  it('reads summer time as +03:00', () => {
    expect(israelInstant('2026-07-15', '07:00')).toBe('2026-07-15T04:00:00.000Z');
  });

  it('reads winter time as +02:00 — the case a hardcoded offset gets wrong', () => {
    expect(israelInstant('2026-01-14', '07:00')).toBe('2026-01-14T05:00:00.000Z');
  });

  it('is still right the morning the clocks go forward', () => {
    // Israel springs forward at 02:00 on the Friday before the last Sunday of March; 2026-03-27.
    expect(israelInstant('2026-03-27', '07:00')).toBe('2026-03-27T04:00:00.000Z');
    // And the evening before, which is still winter.
    expect(israelInstant('2026-03-26', '19:00')).toBe('2026-03-26T17:00:00.000Z');
  });

  it('is still right the morning the clocks go back', () => {
    // Back at 02:00 on the last Sunday of October; 2026-10-25.
    expect(israelInstant('2026-10-25', '07:00')).toBe('2026-10-25T05:00:00.000Z');
    expect(israelInstant('2026-10-24', '19:00')).toBe('2026-10-24T16:00:00.000Z');
  });

  it('round-trips through the label the trainee will read', () => {
    for (const day of ['2026-01-14', '2026-07-15', '2026-03-27', '2026-10-25']) {
      for (const time of COMMON_HOURS) {
        const iso = israelInstant(day, time);
        expect(iso, `${day} ${time}`).toBeTruthy();
        expect(offerSummary([iso!])).toContain(time);
      }
    }
  });

  it('refuses anything it cannot read rather than guessing', () => {
    expect(israelInstant('14/01/2026', '07:00')).toBeNull();
    expect(israelInstant('2026-01-14', '7:00')).toBeNull();
    expect(israelInstant('', '')).toBeNull();
  });
});

describe('dayOptions', () => {
  it('starts tomorrow, because a test needs more notice than this afternoon', () => {
    const days = dayOptions('2026-09-19T09:00:00+03:00', 3);
    expect(days.map(d => d.day)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
  });

  it('names the day and dates it, so two Tuesdays are not the same cell', () => {
    const days = dayOptions('2026-09-19T09:00:00+03:00', 14);
    // `weekday` is what places the cell in its column, and `dayOfMonth` is what it prints —
    // 20.09.2026 is a Sunday, so column 0, and the fortnight ends on a Saturday in column 6.
    expect(days[0]).toEqual({
      day: '2026-09-20', label: 'יום א׳', date: '20.09', dayOfMonth: '20', weekday: 0,
    });
    expect(days[13]).toEqual({
      day: '2026-10-03', label: 'יום ש׳', date: '03.10', dayOfMonth: '3', weekday: 6,
    });
  });

  it('crosses the clock change without skipping or repeating a date', () => {
    const days = dayOptions('2026-10-22T09:00:00+03:00', 6).map(d => d.day);
    expect(days).toEqual([
      '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28',
    ]);
  });

  it('crosses midnight local without offering today twice', () => {
    const days = dayOptions('2026-09-19T23:30:00+03:00', 2).map(d => d.day);
    expect(days).toEqual(['2026-09-20', '2026-09-21']);
  });

  it('returns nothing for an unreadable clock', () => {
    expect(dayOptions('not a date')).toEqual([]);
  });
});

describe('buildOffer', () => {
  const NOW = '2026-09-19T09:00:00+03:00';

  it('is one hour across the chosen days, ascending', () => {
    expect(buildOffer(['2026-09-22', '2026-09-20'], '07:00', NOW)).toEqual([
      '2026-09-20T04:00:00.000Z',
      '2026-09-22T04:00:00.000Z',
    ]);
  });

  it('drops a day offered twice', () => {
    expect(buildOffer(['2026-09-20', '2026-09-20'], '07:00', NOW)).toHaveLength(1);
  });

  it('drops a slot already gone rather than refusing the whole offer', () => {
    // 01:00, so 06:00 today is still ahead but yesterday is not.
    const slots = buildOffer(['2026-09-18', '2026-09-20'], '06:00', '2026-09-19T01:00:00+03:00');
    expect(slots).toEqual(['2026-09-20T03:00:00.000Z']);
  });

  it('never returns more than the screen can show', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    expect(buildOffer(days, '07:00', NOW)).toHaveLength(MAX_OFFERED_SLOTS);
  });

  it('is empty for no days, which is what keeps the send button off', () => {
    expect(buildOffer([], '07:00', NOW)).toEqual([]);
  });

  it('is empty for an unusable time rather than offering midnight', () => {
    expect(buildOffer(['2026-09-20'], '', NOW)).toEqual([]);
    expect(buildOffer(['2026-09-20'], '25:00', NOW)).toEqual([]);
  });
});

describe('offerSummary', () => {
  it('reads as the appointments it is', () => {
    expect(offerSummary(['2026-09-20T04:00:00.000Z', '2026-09-22T04:00:00.000Z']))
      .toBe('יום א׳ · 07:00 · יום ג׳ · 07:00');
  });

  it('is empty rather than showing the word `null` when a slot is unreadable', () => {
    expect(offerSummary(['nonsense'])).toBe('');
  });
});
